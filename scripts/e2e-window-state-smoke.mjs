#!/usr/bin/env node
/**
 * Packaged window-state smoke on macOS. It uses System Events only for the
 * native window geometry; the app itself remains under test through its real
 * persisted window-state.json path.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { spawn } from "node:child_process";

if (process.platform !== "darwin") {
  console.log("window state smoke skipped: macOS only");
  process.exit(0);
}
const execFileAsync = promisify(execFile);
const appPath = process.env.LAKE_PACKAGED_EXECUTABLE || path.resolve("release/mac-arm64/LocalLakeNotes.app/Contents/MacOS/LocalLakeNotes");
const port = Number(process.env.LAKE_CDP_PORT || 9337);
if (!existsSync(appPath)) throw new Error(`找不到 packaged executable: ${appPath}`);
const dataDir = mkdtempSync(path.join(os.tmpdir(), "lake-window-state-smoke-"));
const assetPort = String(Number(process.env.LAKE_ASSET_PORT || 29879));
const expected = { x: 120, y: 120, width: 1000, height: 700 };

async function appleScript(script) {
  const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 8_000 });
  return stdout.trim();
}
async function getBounds() {
  const output = await appleScript(`tell application id "com.lakenotes.electron" to activate
 delay 0.15
 tell application "System Events"
   set frontProcess to first process whose frontmost is true
   set p to position of window 1 of frontProcess
   set s to size of window 1 of frontProcess
   return (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text) & "," & (item 2 of s as text)
 end tell`);
  const [x, y, width, height] = output.split(",").map(Number);
  if (![x, y, width, height].every(Number.isFinite)) throw new Error(`无法读取窗口 bounds: ${output}`);
  return { x, y, width, height };
}
async function waitForNativeWindow() {
  const deadline = Date.now() + 15_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try { return await getBounds(); }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw lastError || new Error("原生窗口未出现");
}
async function setBounds(bounds) {

  await appleScript(`tell application id "com.lakenotes.electron" to activate
 delay 0.15
 tell application "System Events"
   set frontProcess to first process whose frontmost is true
   set position of window 1 of frontProcess to {${bounds.x}, ${bounds.y}}
   set size of window 1 of frontProcess to {${bounds.width}, ${bounds.height}}
 end tell`);
}
async function waitForCdp() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) return;
    } catch { /* wait */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`window smoke CDP 在 ${port} 未就绪`);
}
async function waitExit(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => child.once("exit", resolve));
}
function launch() {
  return spawn(appPath, [`--remote-debugging-port=${port}`, "--disable-gpu"], {
    env: { ...process.env, LAKE_USER_DATA: dataDir, LAKE_ASSET_PORT: assetPort },
    stdio: "ignore",
  });
}
async function quitApp() {
  try { await appleScript('tell application id "com.lakenotes.electron" to quit'); } catch { /* already closed */ }
}

let first = null;
let second = null;
try {
  first = launch();
  await waitForCdp();
  await waitForNativeWindow();
  await setBounds(expected);
  const actualBeforeQuit = await getBounds();
  await quitApp();
  await waitExit(first);
  const persisted = JSON.parse(readFileSync(path.join(dataDir, "window-state.json"), "utf8"));
  second = launch();
  await waitForCdp();
  await waitForNativeWindow();
  const actualAfterRestart = await getBounds();
  const normalize = (value) => ({ x: value.x, y: value.y, width: value.width, height: value.height });
  const result = { expected, actualBeforeQuit, persisted: normalize(persisted), actualAfterRestart };
  console.log(JSON.stringify(result, null, 2));
  if (JSON.stringify(normalize(persisted)) !== JSON.stringify(expected)) throw new Error("window-state.json 未保存预期 bounds");
  if (JSON.stringify(actualAfterRestart) !== JSON.stringify(expected)) throw new Error("重启后窗口未恢复预期 bounds");
} finally {
  await quitApp();
  if (second) await waitExit(second).catch(() => undefined);
  if (first) await waitExit(first).catch(() => undefined);
  rmSync(dataDir, { recursive: true, force: true });
}
