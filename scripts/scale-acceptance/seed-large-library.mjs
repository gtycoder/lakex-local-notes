#!/usr/bin/env node
/**
 * 10k 文档 + 100k 附件大库种子（隔离在 /tmp）。
 *
 * 用法：
 *   node scripts/scale-acceptance/seed-large-library.mjs [选项]
 *   node scripts/scale-acceptance/seed-large-library.mjs --docs 100 --assets 1000   # 小规模自证
 *
 * 选项：
 *   --root <dir>        种子根目录（默认 /tmp/lake-scale-seed-<时间戳>；必须在 /tmp/lake-scale-* 下）
 *   --docs <n>          文档数（默认 10000）
 *   --assets <n>        附件数（默认 100000，须能被 --docs 整除）
 *   --asset-bytes <n>   单附件字节（默认 20480 ≈ 20KiB）
 *   --notebooks <n>     笔记本数（默认 20）
 *   --write-concurrency 附件写盘并发（默认 24）
 *   --asset-port <port> 写进正文资产 URL 的端口（默认 19876；只影响 card value 文本）
 *   --report <file>     报告 JSON（默认 <root>/seed-report.json）
 *   --force             目标目录已存在时先删除（仅限 /tmp/lake-scale-*）
 *
 * 说明：数据写入走产品真实 Store（createNoteIn / saveNote / FTS 索引 / 树查询），
 * 附件文件按真实命名约定（{13位时间戳}_{8hex}.{ext}）由 Node fs 写入
 * workspace-default/note-assets/<noteId>/，并在正文里以 file 卡引用（= 在用资源）。
 * 不经过 upload_resource IPC，因此不产生 DB 资产行（桌面端没有资产表；引用集由正文扫描得出）。
 *
 * 预计耗时/磁盘：10k/100k/20KiB ≈ 2.0GiB 附件 + 约 30~120s（取决于磁盘），详见 README。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  REPO_ROOT,
  TEMP_PREFIX,
  assertIsolatedPath,
  directoryStats,
  fail,
  hostInfo,
  humanBytes,
  readJsonFile,
  writeJsonFile,
} from "./lib/env.mjs";

function parseArgs(argv) {
  const options = {
    root: "",
    docs: 10_000,
    assets: 100_000,
    assetBytes: 20_480,
    notebooks: 20,
    writeConcurrency: 24,
    assetPort: 19_876,
    report: "",
    force: false,
    keepOnFail: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) fail(`参数 ${arg} 缺少取值`);
      return value;
    };
    switch (arg) {
      case "--root": options.root = next(); break;
      case "--docs": options.docs = Number(next()); break;
      case "--assets": options.assets = Number(next()); break;
      case "--asset-bytes": options.assetBytes = Number(next()); break;
      case "--notebooks": options.notebooks = Number(next()); break;
      case "--write-concurrency": options.writeConcurrency = Number(next()); break;
      case "--asset-port": options.assetPort = Number(next()); break;
      case "--report": options.report = next(); break;
      case "--force": options.force = true; break;
      case "--no-keep-on-fail": options.keepOnFail = false; break;
      case "--help":
      case "-h":
        console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
        process.exit(0);
        break;
      default:
        fail(`未知参数：${arg}（--help 查看用法）`);
    }
  }
  for (const key of ["docs", "assets", "assetBytes", "notebooks", "writeConcurrency", "assetPort"]) {
    if (!Number.isInteger(options[key]) || options[key] <= 0) fail(`--${key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())} 必须是正整数`);
  }
  if (options.assets % options.docs !== 0) fail(`--assets（${options.assets}）必须能被 --docs（${options.docs}）整除`);
  if (options.docs > options.assets) fail("附件数不能少于文档数（每篇至少 1 个附件）");
  if (!options.root) options.root = `${TEMP_PREFIX}seed-${Date.now()}`;
  options.root = assertIsolatedPath(options.root, "种子根目录");
  if (!options.report) options.report = path.join(options.root, "seed-report.json");
  options.report = assertIsolatedPath(options.report, "报告路径");
  return options;
}

const options = parseArgs(process.argv.slice(2));
const startedAt = Date.now();

console.log(`[seed] 目标：${options.docs} 文档 / ${options.assets} 附件 × ${options.assetBytes}B ≈ ${humanBytes(options.assets * options.assetBytes)}`);
console.log(`[seed] 隔离目录：${options.root}`);

if (fs.existsSync(options.root)) {
  if (!options.force) {
    fail(`种子目录已存在：${options.root}\n  目标必须不存在（可重复、不覆盖）。确认要重建请加 --force。`);
  }
  fs.rmSync(options.root, { recursive: true, force: true });
  console.log("[seed] --force：已删除旧目标目录");
}
// 根目录由种子进程创建（它先做「必须不存在」的守卫，避免并发/重复运行覆盖数据）。

const vitestBin = path.join(REPO_ROOT, "node_modules", ".bin", "vitest");
if (!fs.existsSync(vitestBin)) fail(`找不到 vitest：${vitestBin}（先 npm install）`);

const env = {
  ...process.env,
  LAKE_SCALE_SEED_ROOT: options.root,
  LAKE_SCALE_DOCS: String(options.docs),
  LAKE_SCALE_ASSETS: String(options.assets),
  LAKE_SCALE_ASSET_BYTES: String(options.assetBytes),
  LAKE_SCALE_NOTEBOOKS: String(options.notebooks),
  LAKE_SCALE_WRITE_CONCURRENCY: String(options.writeConcurrency),
  LAKE_SCALE_ASSET_PORT: String(options.assetPort),
  LAKE_SCALE_REPORT: options.report,
};
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(
  vitestBin,
  ["run", "scripts/scale-acceptance/seedLargeLibrary.gated.test.ts", "--reporter=verbose", "--disable-console-intercept"],
  {
  cwd: REPO_ROOT,
  env,
  stdio: "inherit",
});

const exitCode = await new Promise((resolve) => child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0))));
const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

if (exitCode !== 0) {
  console.error(`[seed] 失败（exit=${exitCode}，${elapsedSec}s）。诊断：\n` +
    `  - 报告（若已写）：${options.report}\n` +
    `  - 目录（可能是半成品，先用 --force 清理再重跑）：${options.root}`);
  if (!options.keepOnFail) fs.rmSync(options.root, { recursive: true, force: true });
  process.exit(exitCode === 0 ? 1 : exitCode);
}

if (!fs.existsSync(options.report)) fail(`种子进程成功但没有报告：${options.report}`);
const report = readJsonFile(options.report);
const workspace = path.join(options.root, "workspace-default");
const stats = directoryStats(workspace);
const summary = {
  ok: true,
  seedRoot: options.root,
  workspaceRoot: workspace,
  report: options.report,
  actual: report.actual,
  timingsMs: report.timings,
  checks: report.checks,
  workspaceOnDisk: { files: stats.files, bytes: stats.bytes, human: humanBytes(stats.bytes) },
  elapsedSec: Number(elapsedSec),
  host: hostInfo(),
  next: [
    `node scripts/scale-acceptance/measure.mjs --seed ${options.root} --report ${path.join(options.root, "measure-report.json")}`,
    `node scripts/scale-acceptance/portable-2gb.mjs --seed ${options.root} --report ${path.join(options.root, "portable-report.json")} --keep-package`,
  ],
};
writeJsonFile(path.join(options.root, "seed-summary.json"), summary);
console.log("\n[seed] 完成：");
console.log(JSON.stringify(summary, null, 2));
