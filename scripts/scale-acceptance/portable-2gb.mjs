#!/usr/bin/env node
/**
 * 2GB 便携包验收编排（gated vitest + 外部交叉读取 + 清理）。
 *
 * 用法：
 *   node scripts/scale-acceptance/portable-2gb.mjs --seed /tmp/lake-scale-seed-full [选项]
 *
 * 选项：
 *   --seed <dir>        seed-large-library.mjs 产出的目录（必须在 /tmp/lake-scale-*）
 *   --out <dir>         导出目录（默认 /tmp/lake-scale-portable-out-<时间戳>；--force 可清空重建）
 *   --report <file>     报告 JSON（默认 <seed>/portable-report.json）
 *   --sample <n>        抽样读回条目数（默认 8）
 *   --keep-package      保留 2GB zip（默认校验后删除；报告里记录保留/删除与路径）
 *   --skip-unzip        跳过系统 unzip -t 交叉校验（默认跑）
 *   --unzip-timeout <ms> unzip -t 超时（默认 600000）
 *
 * 退出码：0 = 导出+格式校验通过且移动端导入前兼容；
 *         2 = 导出+格式校验通过，但移动端导入前兼容失败（例如条目数 > Android MAX_ENTRIES）；
 *         1 = 导出/校验本身失败（详见报告与日志）。
 *
 * 磁盘：峰值 ≈ seed 数据（约 2GiB）+ zip（约 2GiB）+ 快照/临时（数十 MB）。默认不保留 zip。
 * 绝不触碰正式/开发数据目录；只写 /tmp/lake-scale-*。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import {
  REPO_ROOT,
  TEMP_PREFIX,
  assertIsolatedPath,
  fail,
  hostInfo,
  humanBytes,
  readJsonFile,
  writeJsonFile,
} from "./lib/env.mjs";

function parseArgs(argv) {
  const options = {
    seed: "",
    out: "",
    report: "",
    sample: 8,
    keepPackage: false,
    skipUnzip: false,
    unzipTimeout: 600_000,
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) fail(`参数 ${arg} 缺少取值`);
      return value;
    };
    switch (arg) {
      case "--seed": options.seed = next(); break;
      case "--out": options.out = next(); break;
      case "--report": options.report = next(); break;
      case "--sample": options.sample = Number(next()); break;
      case "--keep-package": options.keepPackage = true; break;
      case "--skip-unzip": options.skipUnzip = true; break;
      case "--unzip-timeout": options.unzipTimeout = Number(next()); break;
      case "--force": options.force = true; break;
      case "--help":
      case "-h":
        console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
        process.exit(0);
        break;
      default:
        fail(`未知参数：${arg}（--help 查看用法）`);
    }
  }
  if (!options.seed) fail("缺少 --seed（先用 seed-large-library.mjs 造大库）");
  options.seed = assertIsolatedPath(options.seed, "seed 目录");
  if (!options.out) options.out = `${TEMP_PREFIX}portable-out-${Date.now()}`;
  options.out = assertIsolatedPath(options.out, "导出目录");
  if (!options.report) options.report = path.join(options.seed, "portable-report.json");
  options.report = assertIsolatedPath(options.report, "报告路径");
  if (!Number.isInteger(options.sample) || options.sample < 4) fail("--sample 必须 >= 4（至少 manifest/两个 DB/一个正文）");
  return options;
}

/** 粗查 /tmp 所在卷剩余空间；不足时给可读错误（2GB 包 + seed 数据）。 */
function checkDiskSpace(targetDir, requiredBytes) {
  const dir = fs.existsSync(targetDir) ? targetDir : path.dirname(targetDir);
  let output = "";
  try {
    output = execFileSync("df", ["-k", dir], { encoding: "utf8" });
  } catch {
    return { checked: false };
  }
  const lines = output.trim().split("\n");
  if (lines.length < 2) return { checked: false };
  const columns = lines[1].split(/\s+/);
  // macOS df -k: Filesystem 1024-blocks Used Available Capacity ...
  const availableKb = Number(columns[3]);
  if (!Number.isFinite(availableKb)) return { checked: false };
  const availableBytes = availableKb * 1024;
  return { checked: true, availableBytes, requiredBytes, ok: availableBytes >= requiredBytes };
}

const options = parseArgs(process.argv.slice(2));
const startedAt = Date.now();

if (!fs.existsSync(path.join(options.seed, "workspace-default", "metadata.sqlite3"))) {
  fail(`不是有效 seed：${options.seed}（缺 workspace-default/metadata.sqlite3；先跑 seed-large-library.mjs）`);
}

// 预估所需空间：seed 数据字节 + zip 字节（store-only 与数据同量级）+ 快照
const workspaceBytes = (() => {
  const seedReportPath = path.join(options.seed, "seed-report.json");
  if (fs.existsSync(seedReportPath)) {
    const report = readJsonFile(seedReportPath);
    const total = Number(report?.actual?.assetBytes ?? 0) + Number(report?.actual?.dbBytes ?? 0) + 64 * 1024 * 1024;
    return Number.isFinite(total) ? total : 0;
  }
  return 0;
})();
const requiredBytes = Math.max(2.3 * 1024 * 1024 * 1024, workspaceBytes + 512 * 1024 * 1024);
const disk = checkDiskSpace(options.out, requiredBytes);
if (disk.checked && !disk.ok) {
  fail(`磁盘空间不足：${options.out} 所在卷剩余 ${humanBytes(disk.availableBytes)}，本次预计需要 ≈ ${humanBytes(requiredBytes)}（2GB 包 + 快照，默认不保留 zip）`);
}

if (fs.existsSync(options.out)) {
  const entries = fs.readdirSync(options.out);
  if (entries.length > 0) {
    if (!options.force) fail(`导出目录非空：${options.out}（确认可清空请加 --force）`);
    fs.rmSync(options.out, { recursive: true, force: true });
  }
}
fs.mkdirSync(options.out, { recursive: true });

const vitestBin = path.join(REPO_ROOT, "node_modules", ".bin", "vitest");
if (!fs.existsSync(vitestBin)) fail(`找不到 vitest：${vitestBin}（先 npm install）`);

console.log(`[portable] seed=${options.seed}`);
console.log(`[portable] 导出目录=${options.out}`);
console.log(`[portable] 预计耗时：导出 100k 文件/2GiB 约 1~4 分钟（store-only 每条目读两遍），unzip -t 另加 1~2 分钟`);

const env = {
  ...process.env,
  PORTABLE_2GB: "1",
  LAKE_SCALE_SEED_ROOT: options.seed,
  PORTABLE_2GB_OUT_DIR: options.out,
  PORTABLE_2GB_REPORT: options.report,
  PORTABLE_2GB_SAMPLE: String(options.sample),
};
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(
  vitestBin,
  ["run", "electron/portable/portableExport2gb.gated.test.ts", "--reporter=verbose", "--disable-console-intercept"],
  { cwd: REPO_ROOT, env, stdio: "inherit" },
);
const testExit = await new Promise((resolve) => child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0))));

if (!fs.existsSync(options.report)) {
  console.error(`[portable] 测试未产出报告（exit=${testExit}）。检查导出是否因 4GiB 上限/磁盘/seed 不合法而失败。`);
  process.exit(1);
}
const report = readJsonFile(options.report);
const zipPath = report?.package?.path;
let unzipResult = null;

// ===== 外部交叉读取：系统 unzip -t（独立实现，验证「别的解压器也能读」）=====
if (!options.skipUnzip && zipPath && fs.existsSync(zipPath)) {
  const unzipLog = path.join(options.out, "unzip-test.log");
  console.log(`[portable] unzip -t 交叉校验（${(fs.statSync(zipPath).size / 1024 / 1024 / 1024).toFixed(2)}GiB / ${report.package.entries} 条目）...`);
  const startedUnzip = Date.now();
  const fd = fs.openSync(unzipLog, "a");
  const unzip = spawn("unzip", ["-t", zipPath], { stdio: ["ignore", fd, fd] });
  const timer = setTimeout(() => {
    try { unzip.kill("SIGKILL"); } catch { /* 已退出 */ }
  }, options.unzipTimeout);
  const code = await new Promise((resolve) => {
    unzip.on("exit", (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
    unzip.on("error", () => resolve(-1));
  });
  clearTimeout(timer);
  try { fs.closeSync(fd); } catch { /* 已关 */ }
  const logTail = (() => {
    try {
      const text = fs.readFileSync(unzipLog, "utf8");
      return text.slice(Math.max(0, text.length - 1200));
    } catch {
      return "";
    }
  })();
  unzipResult = {
    command: `unzip -t ${zipPath}`,
    exitCode: code,
    ok: code === 0,
    timedOut: code !== 0 && Date.now() - startedUnzip >= options.unzipTimeout,
    elapsedMs: Date.now() - startedUnzip,
    logPath: unzipLog,
    logTail,
  };
  if (!unzipResult.ok) console.warn(`[portable] unzip -t 失败（exit=${code}），详见 ${unzipLog}`);
  else console.log(`[portable] unzip -t 通过：${(unzipResult.elapsedMs / 1000).toFixed(1)}s，全部条目 CRC 校验通过`);
} else if (!options.skipUnzip) {
  console.warn("[portable] 报告里没有包路径或包已被删除，跳过 unzip -t");
}

// ===== 清理 / 保留 2GB 产物 =====
const retention = { keepPackage: options.keepPackage, packagePath: zipPath ?? null, deleted: false, retained: false };
if (zipPath && fs.existsSync(zipPath)) {
  if (options.keepPackage) {
    retention.retained = true;
    console.log(`[portable] --keep-package：已保留 ${zipPath}（验证完请手动删除）`);
  } else {
    const bytes = fs.statSync(zipPath).size;
    fs.rmSync(zipPath, { force: true });
    retention.deleted = true;
    retention.deletedBytes = bytes;
    console.log(`[portable] 已删除导出包（${humanBytes(bytes)}），只保留报告/日志`);
  }
} else {
  retention.missing = true;
}
// 导出目录里的 unzip 日志保留，报告要能复现
report.crossReader = unzipResult;
report.retention = retention;
report.elapsedMs = Date.now() - startedAt;
report.host = hostInfo();
writeJsonFile(options.report, report);

const mobileVerdict = report?.mobileCompat?.verdict ?? "unknown";
const exportOk = Boolean(report?.package) && report?.verify?.storeOnlyOk === true && report?.verify?.countsMatch === true;
const summary = {
  ok: exportOk && mobileVerdict !== "fail" && (unzipResult === null || unzipResult.ok),
  exportOk,
  testExit,
  package: report.package ? { bytes: report.package.bytes, bytesHuman: humanBytes(report.package.bytes), entries: report.package.entries } : null,
  exportTimings: report.exportTimings,
  verify: report.verify ? {
    elapsedMs: report.verify.elapsedMs,
    entries: report.verify.entries,
    zip64: report.verify.zip64,
    centralDirectoryBytes: report.verify.centralDirectoryBytes,
    countsMatch: report.verify.countsMatch,
    forbiddenAbsent: report.verify.forbiddenAbsent,
    nameSafetyOk: report.verify.nameSafetyOk,
    sampleEntries: report.verify.sample?.length ?? 0,
  } : null,
  crossReader: unzipResult ? { ok: unzipResult.ok, elapsedMs: unzipResult.elapsedMs } : null,
  mobileCompat: report.mobileCompat ?? null,
  retention,
  report: options.report,
  elapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
};
console.log("\n[portable] 完成：");
console.log(JSON.stringify(summary, null, 2));

if (!exportOk) process.exit(1);
if (mobileVerdict === "fail") process.exit(2);
process.exit(0);
