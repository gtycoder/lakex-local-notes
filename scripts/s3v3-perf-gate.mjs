#!/usr/bin/env node
/**
 * 定向性能门禁（SD-12）：500/2000 两档增量同步 + 12 端并发发布（12 端必须 0 错）。
 *
 * 全量 `vitest run` 里 perf 文件与 470+ 文件并行，实测同一阶段可慢 3–5×，
 * 所以 perf 测试默认用 3.5× 基线的兜底上界；本脚本设 S3V3_PERF_STRICT=1 收紧到 1.8×
 * （持续 2× 退化会红），并保留同轮/跨档比值断言。约 10–20s。
 *
 * 用法：node scripts/s3v3-perf-gate.mjs [500,2000]
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const sizes = process.argv[2] || "500,2000";
const result = spawnSync(
  process.execPath,
  [
    join(REPO, "node_modules/vitest/vitest.mjs"),
    "run",
    "electron/s3v3/perf.integration.test.ts",
    "electron/s3v3/concurrency.integration.test.ts",
    "--reporter=verbose",
  ],
  { cwd: REPO, stdio: "inherit", env: { ...process.env, S3V3_PERF_STRICT: "1", S3V3_PERF_SIZES: sizes } },
);
process.exit(result.status ?? 1);
