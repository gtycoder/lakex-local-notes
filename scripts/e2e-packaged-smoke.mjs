#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const appPath = process.env.LAKE_PACKAGED_EXECUTABLE || path.resolve("release/mac-arm64/Lake Notes.app/Contents/MacOS/Lake Notes");
const port = Number(process.env.LAKE_CDP_PORT || 9333);
if (!existsSync(appPath)) throw new Error(`找不到 packaged executable: ${appPath}`);
const child = spawn(appPath, [`--remote-debugging-port=${port}`], {
  env: { ...process.env, LAKE_USER_DATA: process.env.LAKE_USER_DATA || path.join("/tmp", "lake-notes-packaged-smoke-data") },
  stdio: "ignore",
});
const deadline = Date.now() + 45_000;
let ready = false;
while (Date.now() < deadline) {
  try { const response = await fetch(`http://127.0.0.1:${port}/json/list`); if (response.ok) { ready = true; break; } } catch { /* wait */ }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready) {
  child.kill("SIGTERM");
  throw new Error(`packaged CDP 在 ${port} 未就绪`);
}
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
