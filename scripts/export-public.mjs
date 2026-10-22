#!/usr/bin/env node
/**
 * 私有开发仓 → 公开镜像仓导出。
 *
 * 私有仓 local-lakex-notes-private 是唯一真源：闭源 lakex 内核以 vendored 形式入库。
 * 公开镜像 local-lakex-notes（Gitee / 后续 GitHub）**不含内核**，由本脚本生成：
 *   - 复制私有仓全部跟踪文件，但排除 vendor/lakex-doc-react、public/vendor/lakex*；
 *   - 公开仓 .gitignore 由本脚本生成（追加内核忽略块）；
 *   - 公开仓 package.json 去掉仅私有仓使用的 export:public 脚本；
 *   - 自检：公开仓不得出现内核路径 / 私有文件；提交信息标注 private@<hash>。
 *
 * 用法（在私有仓）：
 *   npm run export:public                      # 只导出 + 本地提交
 *   npm run export:public -- --push            # 再 push 到公开仓 origin/master
 *   LAKE_PUBLIC_REPO=/path/to/public npm run export:public -- --push
 *   npm run export:public -- --force           # 公开仓有未提交改动时仍然覆盖
 *
 * 约定：公开仓只读镜像，**不要**在公开仓直接改代码；改动回流私有仓后重新导出。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRIVATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.resolve(process.env.LAKE_PUBLIC_REPO || path.join(PRIVATE, "..", "lake-notes-electron-public"));
const GIT = fs.existsSync("/usr/bin/git") ? "/usr/bin/git" : "git";

const EXCLUDE_PREFIXES = ["vendor/lakex-doc-react/", "public/vendor/lakex/", "public/vendor/lakex-doc/"];
const EXCLUDE_FILES = new Set(["docs/PRIVATE-REPO.md", "scripts/export-public.mjs"]);
const DROP_SCRIPTS = ["export:public"];
const PUBLIC_GITIGNORE_BLOCK = `
# 公开镜像：闭源内核不入库（由私有开发仓导出；本地恢复见 README）
vendor/lakex-doc-react/
public/vendor/lakex/
public/vendor/lakex-doc/
`;

function fail(message) {
  console.error(`[export-public] ✖ ${message}`);
  process.exit(1);
}

function git(cwd, args) {
  return execFileSync(GIT, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function tracked(cwd) {
  return git(cwd, ["ls-files", "-z"]).split("\0").filter(Boolean);
}

function isExcluded(rel) {
  return EXCLUDE_PREFIXES.some((prefix) => rel.startsWith(prefix)) || EXCLUDE_FILES.has(rel);
}

function transformPackage(text) {
  const pkg = JSON.parse(text);
  for (const name of DROP_SCRIPTS) delete pkg.scripts?.[name];
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const push = args.includes("--push");
  const force = args.includes("--force");
  if (!fs.existsSync(path.join(PUBLIC, ".git"))) {
    fail(`公开镜像仓不存在或不是 git 仓库：${PUBLIC}\n  先 git clone 私有仓到该路径，或用 LAKE_PUBLIC_REPO=/path 指定`);
  }
  const dirty = git(PUBLIC, ["status", "--porcelain"]).trim();
  if (dirty && !force) {
    fail(`公开镜像仓有未提交改动（加 --force 可覆盖）：\n${dirty}`);
  }

  const desired = tracked(PRIVATE).filter((rel) => !isExcluded(rel));
  let copied = 0;
  for (const rel of desired) {
    const src = path.join(PRIVATE, rel);
    const dst = path.join(PUBLIC, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    let buf = fs.readFileSync(src);
    if (rel === ".gitignore") {
      buf = Buffer.from(`${buf.toString("utf8").replace(/\s*$/, "")}\n${PUBLIC_GITIGNORE_BLOCK}`);
    } else if (rel === "package.json") {
      buf = Buffer.from(transformPackage(buf.toString("utf8")));
    }
    fs.writeFileSync(dst, buf);
    try {
      fs.chmodSync(dst, fs.statSync(src).mode & 0o777);
    } catch {
      /* 权限位不重要，忽略 */
    }
    copied += 1;
  }

  const desiredSet = new Set(desired);
  const stale = tracked(PUBLIC).filter((rel) => !desiredSet.has(rel));
  for (const rel of stale) {
    try {
      git(PUBLIC, ["rm", "-q", "-f", "--", rel]);
    } catch {
      fs.rmSync(path.join(PUBLIC, rel), { force: true });
    }
  }
  git(PUBLIC, ["add", "-A"]);

  const after = tracked(PUBLIC);
  const leaks = after.filter((rel) => isExcluded(rel) || EXCLUDE_PREFIXES.some((prefix) => rel.startsWith(prefix)));
  if (leaks.length) fail(`公开镜像仍含私有文件：\n  ${leaks.join("\n  ")}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(PUBLIC, "package.json"), "utf8"));
  for (const name of DROP_SCRIPTS) {
    if (pkg.scripts?.[name]) fail(`公开镜像 package.json 仍含私有脚本 ${name}`);
  }
  const publicIgnore = fs.readFileSync(path.join(PUBLIC, ".gitignore"), "utf8");
  if (!publicIgnore.includes("vendor/lakex-doc-react/")) fail("公开镜像 .gitignore 缺少内核忽略块");

  const staged = git(PUBLIC, ["status", "--porcelain"]).trim();
  if (!staged) {
    console.log("[export-public] 已同步，无变化");
    return;
  }
  const head = git(PRIVATE, ["rev-parse", "HEAD"]).trim();
  git(PUBLIC, ["commit", "-q", "-m", `chore(public): sync from private@${head.slice(0, 8)}\n\nprivate-commit: ${head}`]);
  console.log(`[export-public] 已导出 ${copied} 个文件 / 清理 ${stale.length} 个 → ${PUBLIC}`);
  if (push) {
    git(PUBLIC, ["push", "origin", "HEAD:master"]);
    console.log("[export-public] 已推送 origin/master");
  } else {
    console.log("[export-public] 未推送（加 --push）");
  }
}

main();
