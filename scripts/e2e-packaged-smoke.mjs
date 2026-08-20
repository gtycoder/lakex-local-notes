#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const appPath = process.env.LAKE_PACKAGED_EXECUTABLE || path.resolve("release/mac-arm64/Lake Notes.app/Contents/MacOS/Lake Notes");
const port = Number(process.env.LAKE_CDP_PORT || 9333);
if (!existsSync(appPath)) throw new Error(`找不到 packaged executable: ${appPath}`);
const child = spawn(appPath, [`--remote-debugging-port=${port}`], {
  env: {
    ...process.env,
    LAKE_USER_DATA: process.env.LAKE_USER_DATA || path.join("/tmp", "lake-notes-packaged-smoke-data"),
    // Dev Electron 通常占用 19876；packaged smoke 使用独立资源端口，避免
    // 启动阶段 listen EADDRINUSE 阻塞主进程并让 CDP 看起来“无响应”。
    LAKE_ASSET_PORT: process.env.LAKE_ASSET_PORT || "29876",
  },
  stdio: "ignore",
});
async function waitForCdp() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: controller.signal });
      if (response.ok) return;
    } catch { /* wait */ }
    finally { clearTimeout(timer); }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`packaged CDP 在 ${port} 未就绪`);
}
await waitForCdp();

try {
  const smokeEnv = { ...process.env, LAKE_CDP_PORT: String(port), LAKE_UI_EVIDENCE_DIR: process.env.LAKE_UI_EVIDENCE_DIR || "/tmp/lake-packaged-smoke" };
  for (const script of ["scripts/e2e-electron-smoke.mjs", "scripts/e2e-drawnix-smoke.mjs"]) {
    const result = spawn(process.execPath, [script], { env: smokeEnv, stdio: "inherit" });
    const exitCode = await new Promise((resolve) => result.on("exit", (code) => resolve(code ?? 1)));
    if (exitCode !== 0) { process.exitCode = exitCode; break; }
  }
} finally {
  child.kill("SIGTERM");
}
