#!/usr/bin/env node
/**
 * S3 v3 门禁一键跑（不联网、不需要 S3 凭证）。
 * 真实 S3 测试默认跳过；需要时按各测试文件顶部的环境变量（如 S3V3_LIVE / S3V3_PERF_*）单独跑（原 docs/S3-V3-FINAL-REPORT.md 已删，git 可查）。
 */
import { spawnSync } from "node:child_process";

const steps = [
  ["tsc", "npx", ["tsc", "--noEmit"]],
  ["core-v3", "npx", ["vitest", "run", "src/core/s3v3Protocol.test.ts", "src/core/s3v3Core.test.ts", "src/core/s3v3Pool.test.ts", "src/core/s3v3Scale.test.ts"]],
  ["engine", "npx", ["vitest", "run", "electron/s3v3/syncEngine.test.ts"]],
  // 261029：迁移策略已定「不迁移」⇒ electron/s3v3/migrate.test.ts 早已删除，不再列入（否则脚本一跑即 FAIL）。
  ["desktop", "npx", ["vitest", "run", "electron/s3v3/desktopStoreAdapter.test.ts", "electron/s3v3/desktopSync.test.ts"]],
];

let failed = 0;
for (const [name, cmd, args] of steps) {
  process.stdout.write("\n== " + name + " ==\n");
  const r = spawnSync(cmd, args, { stdio: "inherit", env: process.env });
  if (r.status !== 0) { failed++; console.error("[FAIL] " + name); }
}
console.log(failed === 0 ? "\nS3 v3 gates: PASS" : "\nS3 v3 gates: " + failed + " FAILED");
process.exit(failed === 0 ? 0 : 1);
