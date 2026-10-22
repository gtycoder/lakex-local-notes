#!/usr/bin/env node
/**
 * 闭源 lakex 内核的「私有恢复 / 私有备份」脚本。
 *
 * 背景（261022）：`@dlient/lakex-doc-react` 里打包了语雀闭源内核（`@alipay/lakex-doc` v1.99.0）。
 * 这部分**不随公开仓库分发**（源码树与 git 历史里都不再包含），公开仓库只保留集成代码。
 * 本地开发/构建前，用本脚本从**私有归档**把三处产物恢复回工作区：
 *
 *   vendor/lakex-doc-react/            # 包装层 + 内核 bundle + patches
 *   public/vendor/lakex-doc/           # kitchen-iconfont.js（index.html / mobile.html 的 KITCHEN_URL）
 *   public/vendor/lakex/               # alipay 字体/图标（scripts/lakexLocalize.ts 本地化目标）
 *
 * 用法：
 *   npm run setup:lakex                       # 有 .lakex-private.source / 环境变量时恢复；已存在则跳过
 *   npm run setup:lakex -- --force            # 删掉后重新恢复
 *   LAKEX_PRIVATE_TARBALL=/path/a.tar.gz npm run setup:lakex
 *   LAKEX_PRIVATE_DIR=/path/archive-root npm run setup:lakex
 *   npm run backup:lakex                      # 生成 ../private/lakex-private-<stamp>.tar.gz（含 .json 元数据）
 *   npm run backup:lakex -- /path/out.tar.gz
 *
 * 归档格式：归档根 = 仓库根布局（直接含 `vendor/` 与 `public/`），由本脚本的 --backup 生成。
 * ⚠️ 私有归档、`vendor/` 与 `public/vendor/lakex*` 都**禁止**提交、上传、打进公开 release。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PATHS = ["vendor/lakex-doc-react", "public/vendor/lakex-doc", "public/vendor/lakex"];
const SENTINEL = "vendor/lakex-doc-react/package.json";
const KITCHEN = "public/vendor/lakex-doc/kitchen-iconfont.js";
const SOURCE_FILE = ".lakex-private.source";

const log = (msg) => console.log(`[lakex-private] ${msg}`);
const fail = (msg) => {
  console.error(`[lakex-private] ✖ ${msg}`);
  process.exit(1);
};

const exist = (rel) => existsSync(path.join(ROOT, rel));

function missingPaths() {
  return PATHS.filter((p) => !exist(p) || (p === "public/vendor/lakex" && readdirSync(path.join(ROOT, p)).length === 0));
}

function verify() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, SENTINEL), "utf8"));
  if (pkg.name !== "@dlient/lakex-doc-react") fail(`${SENTINEL} 不是 @dlient/lakex-doc-react（name=${pkg.name}）`);
  if (!existsSync(path.join(ROOT, KITCHEN)) || statSync(path.join(ROOT, KITCHEN)).size < 1000) fail(`${KITCHEN} 缺失或异常`);
  const alipay = path.join(ROOT, "public/vendor/lakex/alipay");
  if (!existsSync(alipay) || readdirSync(alipay).length === 0) fail(`${alipay} 缺失或为空`);
  return `@dlient/lakex-doc-react@${pkg.version}`;
}

function readSourceConfig() {
  const cfg = path.join(ROOT, SOURCE_FILE);
  if (!existsSync(cfg)) return null;
  const line = readFileSync(cfg, "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith("#"));
  return line ?? null;
}

function resolveSource() {
  const candidates = [];
  if (process.env.LAKEX_PRIVATE_TARBALL) candidates.push(["LAKEX_PRIVATE_TARBALL", process.env.LAKEX_PRIVATE_TARBALL]);
  if (process.env.LAKEX_PRIVATE_DIR) candidates.push(["LAKEX_PRIVATE_DIR", process.env.LAKEX_PRIVATE_DIR]);
  const cfg = readSourceConfig();
  if (cfg) candidates.push([SOURCE_FILE, cfg]);

  for (const [label, raw] of candidates) {
    const abs = path.resolve(ROOT, raw);
    if (!existsSync(abs)) {
      console.warn(`[lakex-private] ⚠ ${label} 指向的路径不存在，跳过：${abs}`);
      continue;
    }
    return { label, abs };
  }
  return null;
}

function isTarArchive(file) {
  return /\.(tar\.gz|tgz|tar)$/i.test(file) || statSync(file).isFile();
}

function restoreFrom(src, label) {
  if (statSync(src).isDirectory()) {
    if (!existsSync(path.join(src, SENTINEL))) {
      fail(`${label} 目录不是归档根（应直接包含 vendor/lakex-doc-react/）：${src}`);
    }
    for (const rel of PATHS) {
      const from = path.join(src, rel);
      if (!existsSync(from)) fail(`${label} 缺少 ${rel}`);
      cpSync(from, path.join(ROOT, rel), { recursive: true, force: true });
    }
    log(`已从目录恢复：${src}`);
    return;
  }
  const tar = spawnSync("tar", ["-xzf", src, "-C", ROOT], { stdio: "inherit" });
  if (tar.error) fail(`无法执行 tar：${tar.error.message}`);
  if (tar.status !== 0) fail(`tar 解压失败（exit ${tar.status}）：${src}`);
  log(`已从归档恢复：${src}`);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function defaultBackupPath() {
  return path.join(ROOT, "..", "private", `lakex-private-${stamp()}.tar.gz`);
}

function gitCommit() {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "unknown";
}

function sha256File(file) {
  const hash = createHash("sha256");
  const buf = readFileSync(file);
  hash.update(buf);
  return hash.digest("hex");
}

function backup(outArg) {
  const missing = missingPaths();
  if (missing.length) fail(`无法备份，以下产物不存在：\n  - ${missing.join("\n  - ")}`);
  const out = path.resolve(process.cwd(), outArg || defaultBackupPath());
  mkdirSync(path.dirname(out), { recursive: true });
  log(`生成私有归档：${out}`);
  const tar = spawnSync("tar", ["-czf", out, "-C", ROOT, ...PATHS], { stdio: "inherit" });
  if (tar.error) fail(`无法执行 tar：${tar.error.message}`);
  if (tar.status !== 0) fail(`tar 打包失败（exit ${tar.status}）`);
  const meta = {
    createdAt: new Date().toISOString(),
    commit: gitCommit(),
    package: `@dlient/lakex-doc-react@${JSON.parse(readFileSync(path.join(ROOT, SENTINEL), "utf8")).version}`,
    archive: path.basename(out),
    bytes: statSync(out).size,
    sha256: sha256File(out),
    entries: PATHS,
    restore: "LAKEX_PRIVATE_TARBALL=<this file> npm run setup:lakex",
    note: "闭源 lakex 内核私有备份，禁止提交/上传/公开分发",
  };
  writeFileSync(`${out}.json`, `${JSON.stringify(meta, null, 2)}\n`);
  log(`完成：${(meta.bytes / 1024 / 1024).toFixed(1)} MB，sha256=${meta.sha256}`);
  log(`元数据：${out}.json`);
}

function usage() {
  console.log("用法：node scripts/setup-lakex-private.mjs [--force] [--check] [--backup [out.tar.gz]]");
}

function main() {
  const args = process.argv.slice(2);
  let backupOut;
  let force = false;
  let checkOnly = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--backup") {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        backupOut = next;
        i += 1;
      } else {
        backupOut = defaultBackupPath();
      }
    } else if (a === "--force") {
      force = true;
    } else if (a === "--check") {
      checkOnly = true;
    } else if (a === "--help" || a === "-h") {
      usage();
      return;
    } else {
      fail(`未知参数：${a}`);
    }
  }

  if (backupOut) {
    backup(backupOut);
    return;
  }

  const missing = missingPaths();
  if (missing.length === 0 && !force) {
    log(`已就绪：${verify()}`);
    return;
  }
  if (checkOnly) {
    fail(`缺少闭源内核产物：\n  - ${missing.join("\n  - ")}`);
  }

  const src = resolveSource();
  if (!src) {
    fail(
      [
        "缺少闭源 lakex 内核产物（不随仓库分发）：",
        ...missing.map((m) => `  - ${m}`),
        "",
        "请准备私有归档后任选其一：",
        "  1) 在仓库根写 .lakex-private.source（内容 = 归档路径，相对仓库根或绝对路径）",
        "  2) LAKEX_PRIVATE_TARBALL=/path/lakex-private.tar.gz npm run setup:lakex",
        "  3) LAKEX_PRIVATE_DIR=/path/archive-root npm run setup:lakex",
        "",
        "说明见 README「环境 / 安装与本地开发」与 docs/LAKEX-CONTRACT.md 顶部。",
      ].join("\n"),
    );
  }

  if (force) {
    for (const rel of PATHS) rmSync(path.join(ROOT, rel), { recursive: true, force: true });
  }
  if (!isTarArchive(src.abs)) fail(`不支持的归档格式：${src.abs}`);
  restoreFrom(src.abs, src.label);

  const missingAfter = missingPaths();
  if (missingAfter.length) fail(`恢复后仍缺失：\n  - ${missingAfter.join("\n  - ")}`);
  log(`恢复完成：${verify()}`);
}

main();
