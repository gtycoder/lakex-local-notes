#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const appPath = process.env.LAKE_PACKAGED_EXECUTABLE || path.resolve("release/mac-arm64/LocalLakeNotes.app/Contents/MacOS/LocalLakeNotes");
const port = Number(process.env.LAKE_CDP_PORT || 9333);
if (!existsSync(appPath)) throw new Error(`找不到 packaged executable: ${appPath}`);
// 受限/沙箱环境（如 agent 宿主的 seatbelt）里 Chromium 自身 sandbox 会初始化失败，
// 打包版直接崩 ⇒ CDP 拿不到 page。允许用 LAKE_PACKAGED_ARGS 透传运行参数（如 "--no-sandbox --disable-gpu"）；
// 正常运行不设该变量，行为不变。
const extraArgs = (process.env.LAKE_PACKAGED_ARGS || "").split(/\s+/).filter(Boolean);
const child = spawn(appPath, [`--remote-debugging-port=${port}`, ...extraArgs], {
  env: {
    ...process.env,
    LAKE_USER_DATA: process.env.LAKE_USER_DATA || path.join("/tmp", "lake-notes-packaged-smoke-data"),
    // Dev Electron 通常占用 19876；packaged smoke 使用独立资源端口，避免
    // 启动阶段 listen EADDRINUSE 阻塞主进程并让 CDP 看起来“无响应”。
    LAKE_ASSET_PORT: process.env.LAKE_ASSET_PORT || "29876",
  },
  stdio: "ignore",
});
async function waitForExit(process, timeoutMs = 10_000) {
  if (process.exitCode !== null) return true;
  const exited = await Promise.race([
    new Promise((resolve) => process.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
  return exited === true;
}
async function waitForCdp() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: controller.signal });
      if (response.ok) {
        // 只等「CDP 有响应」不够：打包版会先暴露 about:blank 目标，随后才导航到 lake://app；
        // 若此时就跑 smoke，会抓到空页面（.tab-bar 缺失）而误判失败。必须等到真正的应用页。
        const list = await response.json().catch(() => null);
        if (Array.isArray(list) && list.some((t) => t.type === "page" && String(t.url || "").includes("lake://"))) {
          await new Promise((resolve) => setTimeout(resolve, 1500)); // 再等 React 挂载外壳
          return;
        }
      }
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
  const exited = await waitForExit(child);
  if (!exited) {
    child.kill("SIGKILL");
    await waitForExit(child, 2_000);
  }
  // Give LaunchServices/System Events a moment to release the old packaged app
  // before the next native-window smoke launches the same bundle identifier.
  await new Promise((resolve) => setTimeout(resolve, 500));
}
