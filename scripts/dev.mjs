#!/usr/bin/env node
/**
 * 桌面临开发启动器（npm run dev 的入口）。
 *
 * 为什么不再直接调 vite：开发机上最常见的三种「打不开」都是环境问题，
 * 直接跑 vite 时它们表现成"窗口没出现 / 一闪就退"，看不出原因：
 *   1) Node 不是 v24（vite 8/rolldown 直接失败，且可能被 npm 日志淹没）；
 *   2) 端口 1421 或 dev Electron(9222) 已被别的进程（常见：旧副本 private/…obsolete…）占着；
 *   3) 从 DSH/宿主终端启动时继承了 ELECTRON_RUN_AS_NODE=1（Electron 以纯 Node 跑，报 bad option）。
 * 这里统一做前置检查，失败时给一条能直接照做的命令；--doctor 只体检不启动。
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.LAKE_DEV_PORT ?? 1421);
const CDP_PORT = Number(process.env.LAKE_CDP_PORT ?? 9222);
const DOCTOR = process.argv.includes("--doctor");

function die(msg, hint) {
  console.error("\n[dev] ✗ " + msg);
  if (hint) console.error("       " + hint);
  process.exit(1);
}
function sh(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: "utf8" }).trim(); } catch { return ""; }
}
function cwdOf(pid) {
  const out = sh("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
  const line = out.split("\n").find((l) => l.startsWith("n/"));
  return line ? line.slice(1) : "";
}
function portOwners(port) {
  const out = sh("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  return out ? out.split("\n").filter(Boolean).map(Number) : [];
}
function electronPids(port) {
  const out = sh("ps", ["-axo", "pid=,command="]);
  return out.split("\n").filter((l) => l.includes("Electron.app/Contents/MacOS/Electron") && l.includes(`--remote-debugging-port=${port}`))
    .map((l) => Number(l.trim().split(/\s+/)[0])).filter(Boolean);
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 24) {
  die(`Node ${process.versions.node} 太旧（必须 ≥ v24）`, 'export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"  然后重跑');
}
if (/obsolete|DISABLED-/i.test(ROOT)) {
  die("当前目录是旧的实验副本（路径含 obsolete/DISABLED）", "cd /Users/admin/file/local-lake/lakex-local-notes && npm run dev");
}
if (process.env.ELECTRON_RUN_AS_NODE) {
  console.warn("[dev] 检测到宿主注入的 ELECTRON_RUN_AS_NODE，已为本次启动移除（否则 Electron 会以纯 Node 启动）");
  delete process.env.ELECTRON_RUN_AS_NODE;
}

const vitePids = portOwners(PORT);
const devElectron = electronPids(CDP_PORT);
if (DOCTOR) {
  console.log("[dev:doctor] node      : " + process.versions.node + " at " + process.execPath);
  console.log("[dev:doctor] repo      : " + ROOT);
  console.log("[dev:doctor] port " + PORT + "   : " + (vitePids.length ? vitePids.map((p) => p + " (" + cwdOf(p) + ")").join(", ") : "空闲"));
  console.log("[dev:doctor] cdp  " + CDP_PORT + "   : " + (devElectron.length ? devElectron.map((p) => p + " (" + cwdOf(p) + ")").join(", ") : "空闲"));
  const lock = path.join(process.env.HOME ?? "", "Library/Application Support/lakex-local-notes-dev/SingletonLock");
  console.log("[dev:doctor] SINGLE    : " + (fs.existsSync(lock) ? "存在（可能有实例在跑）" : "无"));
  process.exit(0);
}
if (vitePids.includes(process.pid)) { /* noop */ }
if (vitePids.length > 0) {
  const mine = vitePids.some((pid) => cwdOf(pid) === ROOT);
  if (mine) {
    console.log("[dev] 本仓库的 vite 已在运行：http://127.0.0.1:" + PORT + "/（窗口应已在前台）");
    process.exit(0);
  }
  die(`端口 ${PORT} 被别的进程占用：${vitePids.map((p) => p + " " + cwdOf(p)).join(", ")}`,
    "先跑 npm run dev:clean（只清本项目的 dev 进程），或手动 kill 上面 PID");
}
if (devElectron.length > 0) {
  const mine = devElectron.some((pid) => cwdOf(pid) === ROOT);
  die(`已有 dev Electron 在跑（CDP ${CDP_PORT}）：${devElectron.map((p) => p + " " + cwdOf(p)).join(", ")}`,
    mine ? "窗口可能在其他桌面/被最小化；没看到就跑 npm run dev:clean 后重试" : "上面的实例来自别的目录（可能是旧副本），跑 npm run dev:clean 再启动");
}

console.log("[dev] node " + process.versions.node + " / repo " + ROOT);
console.log("[dev] vite http://127.0.0.1:" + PORT + "/  ·  Electron CDP " + CDP_PORT);
const child = spawn(path.join(ROOT, "node_modules/.bin/vite"), ["--host", "127.0.0.1", "--port", String(PORT)], {
  cwd: ROOT, stdio: "inherit", env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
