#!/usr/bin/env node
/** Packaged GPU/network utility crash recovery smoke. macOS/Electron only. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";

if (process.platform !== "darwin") { console.log("service crash smoke skipped: macOS only"); process.exit(0); }
const appPath = process.env.LAKE_PACKAGED_EXECUTABLE || path.resolve("release/mac-arm64/LakexLocalNotes.app/Contents/MacOS/LakexLocalNotes");
const port = Number(process.env.LAKE_CDP_PORT || 9341);
if (!existsSync(appPath)) throw new Error(`找不到 packaged executable: ${appPath}`);
const dataDir = mkdtempSync(path.join(os.tmpdir(), "lake-service-crash-smoke-"));
const assetPort = String(Number(process.env.LAKE_ASSET_PORT || 29883));
let child;
function processes() {
  return execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).split("\n").map((line) => {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    return match ? { pid: Number(match[1]), command: match[2] } : null;
  }).filter(Boolean);
}
function killHelper(pattern) {
  const item = processes().find((entry) => entry.command.includes(dataDir) && entry.command.includes(pattern));
  if (!item) return null;
  process.kill(item.pid, "SIGKILL");
  return item.pid;
}
async function waitForCdp() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(`http://127.0.0.1:${port}/json/list`); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`service crash smoke CDP 在 ${port} 未就绪`);
}
async function waitForLog(pattern, timeout = 15_000) {
  const started = Date.now();
  const logPath = path.join(dataDir, "logs", "lakex-local-notes.log");
  while (Date.now() - started < timeout) {
    const text = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    if (pattern.test(text)) return text;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
}
try {
  child = spawn(appPath, [`--remote-debugging-port=${port}`, "--disable-gpu"], { env: { ...process.env, LAKE_USER_DATA: dataDir, LAKE_ASSET_PORT: assetPort }, stdio: "ignore" });
  await waitForCdp();
  const gpuPid = killHelper("--type=gpu-process");
  if (!gpuPid) throw new Error("未找到可注入的 GPU helper 进程");
  let log = await waitForLog(/child-process-gone type=GPU/);
  const networkPid = killHelper("--utility-sub-type=network.mojom.NetworkService");
  if (!networkPid) throw new Error("GPU 重启后未找到可注入的 network helper 进程");
  log = await waitForLog(/network\.mojom\.NetworkService/);
  await waitForCdp();
  const result = { gpuPid, networkPid, gpuObserved: /child-process-gone type=GPU/.test(log), networkObserved: /network\.mojom\.NetworkService/.test(log), cdpAlive: true };
  console.log(JSON.stringify(result, null, 2));
  if (!result.gpuObserved && !result.networkObserved) throw new Error("主进程未记录 helper crash");
} finally {
  try { child?.kill("SIGTERM"); } catch {}
  await new Promise((resolve) => setTimeout(resolve, 800));
  try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* helper cache may still be releasing */ }
}
