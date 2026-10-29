#!/usr/bin/env node
/**
 * 手动大库性能档（SD-12）：不进默认门禁。
 *
 * 默认门禁 = perf.integration.test.ts 的 500/2000 两档（带阶段上界/跨档比值断言，约 10s）。
 * 本脚本跑默认门禁之外的档：
 *   node scripts/s3v3-manual-perf.mjs 5000    # 5000 档（复用同一测试与断言）
 *   node scripts/s3v3-manual-perf.mjs 20000   # 2 万档（绕过 Store API 造数，默认）
 *   node scripts/s3v3-manual-perf.mjs 200     # 小规模冒烟（只验证造数/schema 可用）
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const arg = process.argv[2] || "20000";
const vitest = join(REPO, "node_modules/vitest/vitest.mjs");
let file;
let env;

if (arg === "5000") {
  file = "electron/s3v3/perf.integration.test.ts";
  // 手动跑通常是空闲机器，直接用定向门禁的紧口径（1.8×），避免只有兜底上界。
  env = { ...process.env, S3V3_PERF_STRICT: "1", S3V3_PERF_SIZES: "5000" };
} else {
  const docs = Number(arg);
  if (!Number.isInteger(docs) || docs < 100) {
    console.error("文档数必须是 >=100 的整数（5000 档请用参数 5000）：" + arg);
    process.exit(2);
  }
  file = "electron/s3v3/perf.big.integration.test.ts";
  env = { ...process.env, S3V3_PERF_BIG: "1", S3V3_PERF_BIG_DOCS: String(docs) };
}

const result = spawnSync(process.execPath, [vitest, "run", file, "--reporter=verbose"], { cwd: REPO, stdio: "inherit", env });
process.exit(result.status ?? 1);
