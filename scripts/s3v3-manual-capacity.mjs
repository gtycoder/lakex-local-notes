#!/usr/bin/env node
/**
 * 手动并发容量档（20/28 端，SD-08）：不进默认门禁。
 *
 * 默认门禁只锁「已承诺的能力」= 12 端并发发布必须 0 错（electron/s3v3/concurrency.integration.test.ts）。
 * 20/28 端是「无 CAS provider」下的已知上限（锁 TTL + 重试上限，见 docs/SYNC-PROTOCOL.md §12.1），
 * 这里只跑观测档，输出可对比 JSON 行：CONC-CAP（每档）/ CONC-CAP-SUMMARY（汇总错误数）。
 *
 * 用法：node scripts/s3v3-manual-capacity.mjs [20,28]
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const sizes = process.argv[2] || "20,28";
const result = spawnSync(
  process.execPath,
  [join(REPO, "node_modules/vitest/vitest.mjs"), "run", "electron/s3v3/concurrency.integration.test.ts", "-t", "手动档", "--reporter=verbose"],
  { cwd: REPO, stdio: "inherit", env: { ...process.env, S3V3_CONC_CAPACITY: "1", S3V3_CONC_CAPACITY_SIZES: sizes } },
);
process.exit(result.status ?? 1);
