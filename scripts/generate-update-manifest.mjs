#!/usr/bin/env node
/**
 * 生成应用内更新中心清单（latest.json）与 GitHub Release 正文（release-body.md）。
 *
 * 规格：docs/UPDATE-CENTER.md §3（清单 schema）/ §7（CI 发版 job）。
 * 纯 Node（node:fs / node:path / node:crypto），不引入任何依赖；CI 与本地干跑共用同一入口。
 *
 * 用法：
 *   node scripts/generate-update-manifest.mjs --tag v1.0.4 --dist dist --out-dir dist
 *   node scripts/generate-update-manifest.mjs --tag v1.0.4 --dist /tmp/fake-dist --out-dir /tmp/fake-out
 *
 * 输入：
 *   <repo>/package.json                  version（版本号单一来源；必须与 tag 去 v 后一致，否则报错）
 *   <repo>/docs/RELEASE-NOTES.md         当前 tag 段落 → release-body.md / latest.json.notes
 *   --dist <dir>                         发布产物（mac *arm64*.dmg / *x64*.dmg、*.zip 兜底、
 *                                        windows *.exe、android *-android-release.apk）
 * 输出（--out-dir，默认 = --dist）：
 *   latest.json                          GitHub Release 资产；应用读 .../releases/latest/download/latest.json
 *   release-body.md                      softprops/action-gh-release 的 body_path
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGE_JSON = path.join(ROOT, "package.json");
const RELEASE_NOTES = path.join(ROOT, "docs/RELEASE-NOTES.md");
const DEFAULT_REPO = "gtycoder/lakex-local-notes";
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

const USAGE = [
  "用法：node scripts/generate-update-manifest.mjs --tag vX.Y.Z [--dist <dir>] [--out-dir <dir>] [--repo owner/name]",
  "",
  "  --tag <vX.Y.Z>      发布 tag（必填；必须与 package.json 的 version 一致）",
  "  --dist <dir>        发布产物目录（默认 dist）",
  "  --out-dir <dir>     输出目录（默认与 --dist 相同；--out 是等价别名）",
  "  --repo <owner/name> GitHub 仓库（默认 GITHUB_REPOSITORY，回退 gtycoder/lakex-local-notes）",
  "  -h, --help          显示本帮助",
].join("\n");

/** 生成过程中的提示（缺平台产物等）：打印 + 打 GitHub Actions annotation。 */
const warn = (message) => {
  console.warn(`警告：${message}`);
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::warning::${message.replace(/\r?\n/g, " ")}`);
};

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = {
    tag: "",
    dist: "dist",
    outDir: null,
    repo: process.env.GITHUB_REPOSITORY || DEFAULT_REPO,
  };
  const known = new Set(["tag", "dist", "out-dir", "out", "repo"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    }
    const eq = arg.indexOf("=");
    const flag = (eq >= 0 ? arg.slice(0, eq) : arg).replace(/^--/, "");
    if (!arg.startsWith("--") || !known.has(flag)) fail(`未知参数 ${arg}（--help 查看用法）`);
    const value = eq >= 0 ? arg.slice(eq + 1) : argv[(i += 1)];
    if (value === undefined || value === "" || (eq < 0 && value.startsWith("--"))) {
      fail(`参数 --${flag} 缺少取值`);
    }
    if (flag === "tag") args.tag = value;
    else if (flag === "dist") args.dist = value;
    else if (flag === "out-dir" || flag === "out") args.outDir = value;
    else if (flag === "repo") args.repo = value;
  }
  return args;
}

/** 流式 sha256：dmg 可达 200MB+，不整读进内存。 */
async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** 从 docs/RELEASE-NOTES.md 抽取 `# LakexLocalNotes vX.Y.Z` 段落。 */
function extractReleaseBody(markdown, tag) {
  const heading = `# LakexLocalNotes ${tag}`;
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) fail(`${path.relative(ROOT, RELEASE_NOTES)} 找不到段落「${heading}」（发版前补齐更新日志）`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    // 到下一个版本标题（或文件尾）为止；段内的 "## xxx" 子标题不受影响。
    if (/^# LakexLocalNotes\b/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start + 1, end);
  // H1 标题不写入正文：Release 名称 / 清单 version 已经表明版本，正文只要内容。
  while (body.length && body[0].trim() === "") body.shift();
  while (body.length && body[body.length - 1].trim() === "") body.pop();
  // 版本之间的 "---" 分隔线不带走。
  while (body.length && body[body.length - 1].trim() === "---") {
    body.pop();
    while (body.length && body[body.length - 1].trim() === "") body.pop();
  }
  const text = body.join("\n").trim();
  if (!text) fail(`${path.relative(ROOT, RELEASE_NOTES)} 的「${heading}」段落为空`);
  return { heading, text, lines: text.split("\n").length };
}

/** mac 产物按文件名判架构（electron-builder artifactName = `${productName}-${version}-${arch}.${ext}`）。 */
function macArchOf(name) {
  if (/arm64/i.test(name)) return "arm64";
  if (/x64|x86_64|intel/i.test(name)) return "x64";
  return null;
}

/** 同一类候选有多个时取排序第一个（并告警），保证输出确定。 */
function pickOne(candidates, label) {
  if (candidates.length > 1) {
    warn(`${label} 有多个候选，取首个：${candidates[0]}（忽略：${candidates.slice(1).join("、")}）`);
  }
  return candidates[0];
}

function describeAsset(asset) {
  return `${asset.os}${asset.arch ? `/${asset.arch}` : ""}  ${asset.filename}  ${asset.size} B`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.tag) fail("缺少 --tag vX.Y.Z（--help 查看用法）");
  const tagMatch = TAG_RE.exec(args.tag);
  if (!tagMatch) fail(`--tag 必须形如 v1.2.3（实际：${args.tag}）`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(args.repo)) fail(`--repo 必须形如 owner/name（实际：${args.repo}）`);
  const version = `${Number(tagMatch[1])}.${Number(tagMatch[2])}.${Number(tagMatch[3])}`;

  // 版本号单一来源 = package.json（见 AGENTS.md §4「发版 / 版本号」）：tag 与它不一致说明发版姿势错了。
  let pkg;
  try {
    pkg = JSON.parse(await readFile(PACKAGE_JSON, "utf8"));
  } catch (error) {
    fail(`读取 ${PACKAGE_JSON} 失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof pkg.version !== "string" || !SEMVER_RE.test(pkg.version)) {
    fail(`package.json 的 version 不是 x.y.z（实际：${String(pkg.version)}）`);
  }
  if (pkg.version !== version) {
    fail(`package.json version=${pkg.version} 与 tag=${args.tag} 不一致：先 npm version patch --no-git-tag-version 再打 tag`);
  }

  // versionCode 与 android/app/build.gradle 同一公式：1000 + major*10000 + minor*100 + patch（只增不减）。
  const versionCode = 1000 + Number(tagMatch[1]) * 10000 + Number(tagMatch[2]) * 100 + Number(tagMatch[3]);

  const distDir = path.resolve(process.cwd(), args.dist);
  const outDir = path.resolve(process.cwd(), args.outDir ?? args.dist);

  let entries;
  try {
    entries = await readdir(distDir, { withFileTypes: true });
  } catch (error) {
    fail(`--dist 目录不可读：${distDir}（${error instanceof Error ? error.message : String(error)}）`);
  }
  // 只扫目录第一层：CI 用 actions/download-artifact 的 merge-multiple:true 拍平到一个目录。
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) fail(`--dist 目录为空：${distDir}`);

  // 分类候选：mac 按架构且 dmg 优先（zip 兜底）；windows 一个 nsis exe；android 一个 release apk。
  const mac = { arm64: { dmg: [], zip: [] }, x64: { dmg: [], zip: [] } };
  const windows = [];
  const android = [];
  const unknown = [];
  for (const name of files) {
    const arch = macArchOf(name);
    if (/\.dmg$/i.test(name)) {
      if (arch) mac[arch].dmg.push(name);
      else unknown.push(name);
    } else if (/\.zip$/i.test(name)) {
      if (arch) mac[arch].zip.push(name);
      else unknown.push(name);
    } else if (/\.exe$/i.test(name)) {
      windows.push(name);
    } else if (/-android-release\.apk$/i.test(name)) {
      android.push(name);
    }
  }
  if (unknown.length > 0) warn(`无法判定架构的 mac 产物已忽略：${unknown.join("、")}`);

  const picked = [];
  const missing = [];
  for (const arch of ["arm64", "x64"]) {
    if (mac[arch].dmg.length > 0) {
      picked.push({ os: "macos", arch, filename: pickOne(mac[arch].dmg, `macos ${arch} dmg`) });
    } else if (mac[arch].zip.length > 0) {
      warn(`macos ${arch} 没有 dmg，回退用 zip（桌面优先 dmg）`);
      picked.push({ os: "macos", arch, filename: pickOne(mac[arch].zip, `macos ${arch} zip`) });
    } else {
      missing.push(`macos ${arch}`);
    }
  }
  if (windows.length > 0) {
    picked.push({ os: "windows", arch: "x64", filename: pickOne(windows, "windows exe") });
  } else {
    missing.push("windows exe");
  }
  if (android.length > 0) {
    picked.push({ os: "android", arch: null, filename: pickOne(android, "android apk") });
  } else {
    missing.push("android apk");
  }
  if (missing.length > 0) {
    // windows job continue-on-error、Android 失败不阻断发版（见 release.yml）⇒ 缺平台只告警、不阻断清单生成。
    warn(`缺少产物（清单里将没有对应平台）：${missing.join("、")}`);
  }
  if (picked.length === 0) fail(`--dist 目录里没有可识别的发布产物：${distDir}`);

  const downloadBase = `https://github.com/${args.repo}/releases/download/${args.tag}`;
  const assets = [];
  for (const item of picked) {
    const file = path.join(distDir, item.filename);
    const info = await stat(file);
    if (info.size <= 0) fail(`产物是空文件：${item.filename}`);
    assets.push({
      os: item.os,
      arch: item.arch,
      filename: item.filename,
      // Release 资产名可能带空格（Windows NSIS 默认 "… Setup 1.0.4.exe"）⇒ 必须 URL 编码。
      url: `${downloadBase}/${encodeURIComponent(item.filename)}`,
      sha256: await sha256File(file),
      size: info.size,
    });
  }

  const notesSource = await readFile(RELEASE_NOTES, "utf8");
  const body = extractReleaseBody(notesSource, args.tag);

  const manifest = {
    schemaVersion: 1,
    version,
    versionCode,
    publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    notes: body.text,
    releasePageUrl: `https://github.com/${args.repo}/releases/tag/${args.tag}`,
    assets,
  };

  await mkdir(outDir, { recursive: true });
  const manifestPath = path.join(outDir, "latest.json");
  const bodyPath = path.join(outDir, "release-body.md");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(bodyPath, `${body.text}\n`, "utf8");

  console.log("\n更新清单生成完成");
  console.log(`  仓库        ${args.repo}`);
  console.log(`  版本        ${version}（versionCode ${versionCode}）`);
  console.log(`  tag         ${args.tag}`);
  console.log(`  publishedAt ${manifest.publishedAt}`);
  console.log(`  正文        ${body.lines} 行 ← ${path.relative(process.cwd(), RELEASE_NOTES)}「${body.heading}」`);
  console.log(`  资产        ${assets.length} 个`);
  for (const asset of assets) console.log(`    - ${describeAsset(asset)}  sha256=${asset.sha256}`);
  console.log(`  输出        ${manifestPath}`);
  console.log(`              ${bodyPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n[generate-update-manifest] 失败：${message}`);
  if (process.env.GITHUB_ACTIONS === "true") console.error(`::error::${message.replace(/\r?\n/g, " ")}`);
  process.exitCode = 1;
});
