#!/usr/bin/env node
/**
 * S3 v3 门禁一键跑（不联网、不需要 S3 凭证）。
 * 真实 S3 测试默认跳过；需要时按 docs/S3-V3-FINAL-REPORT.md 的环境变量单独跑。
 */
import { spawnSync } from "node:child_process";

const steps = [
  ["tsc", "npx", ["tsc", "--noEmit"]],
  ["core-v3", "npx", ["vitest", "run", "src/core/s3v3Protocol.test.ts", "src/core/s3v3Core.test.ts", "src/core/s3v3Pool.test.ts", "src/core/s3v3Scale.test.ts"]],
  ["engine", "npx", ["vitest", "run", "electron/s3v3/syncEngine.test.ts"]],
  ["desktop", "npx", ["vitest", "run", "electron/s3v3/desktopStoreAdapter.test.ts", "electron/s3v3/desktopSync.test.ts", "electron/s3v3/migrate.test.ts"]],
];

let failed = 0;
for (const [name, cmd, args] of steps) {
  process.stdout.write("\n== " + name + " ==\n");
  const r = spawnSync(cmd, args, { stdio: "inherit", env: process.env });
  if (r.status !== 0) { failed++; console.error("[FAIL] " + name); }
}
console.log(failed === 0 ? "\nS3 v3 gates: PASS" : "\nS3 v3 gates: " + failed + " FAILED");
process.exit(failed === 0 ? 0 : 1);
