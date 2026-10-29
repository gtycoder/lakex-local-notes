#!/usr/bin/env node
/**
 * 清理本项目的 dev 进程（vite 1421 + 带 CDP 9222 的 Electron）。
 *
 * 只按「进程可执行文件 + 端口 + cwd 属于本项目/本工作区」三重判据动手，
 * 不 pkill Electron、不扫其它 app —— 这是 AGENTS §7 的硬要求（误杀会打断 IDE/DSH 宿主）。
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE = path.dirname(ROOT);
const PORT = Number(process.env.LAKE_DEV_PORT ?? 1421);
const CDP_PORT = Number(process.env.LAKE_CDP_PORT ?? 9222);

function sh(cmd, args) { try { return execFileSync(cmd, args, { encoding: "utf8" }).trim(); } catch { return ""; } }
function cwdOf(pid) {
  const out = sh("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
  const line = out.split("\n").find((l) => l.startsWith("n/"));
  return line ? line.slice(1) : "";
}
function inWorkspace(cwd) { return cwd === ROOT || cwd.startsWith(ROOT + "/") || (cwd.startsWith(WORKSPACE + "/") && /lakex|local-lake|lake-notes/i.test(path.basename(cwd))); }
function portOwners(port) {
  const out = sh("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  return out ? out.split("\n").filter(Boolean).map(Number) : [];
}
function electronPids(port) {
  const out = sh("ps", ["-axo", "pid=,command="]);
  return out.split("\n").filter((l) => l.includes("Electron.app/Contents/MacOS/Electron") && l.includes(`--remote-debugging-port=${port}`))
    .map((l) => Number(l.trim().split(/\s+/)[0])).filter(Boolean);
}

const targets = new Map();
for (const pid of portOwners(PORT)) targets.set(pid, "vite :" + PORT);
for (const pid of electronPids(CDP_PORT)) targets.set(pid, "electron CDP :" + CDP_PORT);
const victims = [];
for (const [pid, label] of targets) {
  const cwd = cwdOf(pid);
  if (!inWorkspace(cwd)) { console.log(`[dev:clean] 跳过 ${pid}（${label}，cwd=${cwd || "?"} 不在本项目）`); continue; }
  victims.push({ pid, label, cwd });
}
if (victims.length === 0) { console.log("[dev:clean] 没有本项目的残留 dev 进程"); process.exit(0); }
for (const v of victims) console.log(`[dev:clean] kill ${v.pid} — ${v.label} — ${v.cwd}`);
for (const v of victims) { try { process.kill(v.pid, "SIGTERM"); } catch { /* 已退出 */ } }
await new Promise((r) => setTimeout(r, 2500));
for (const v of victims) { try { process.kill(v.pid, 0); process.kill(v.pid, "SIGKILL"); } catch { /* 已退出 */ } }
const left = portOwners(PORT).length + electronPids(CDP_PORT).length;
console.log(left === 0 ? "[dev:clean] 完成，端口与 CDP 已释放" : "[dev:clean] 仍有进程存活，请检查上面输出");
process.exit(left === 0 ? 0 : 1);
