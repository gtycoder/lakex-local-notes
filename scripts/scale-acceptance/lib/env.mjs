/**
 * 规模验收脚本的隔离环境：路径守护、端口检查、隔离 Electron 启停、报告读写、目录统计。
 *
 * 红线（见 AGENTS §5 与任务约束）：
 *  - 只允许 /tmp/lake-scale-* 目录；绝不触碰 ~/Library/Application Support/lakex-local-notes；
 *  - 只按 CDP 端口定位自己启动的 Electron 进程（pgrep -f remote-debugging-port=<自己端口>），
 *    绝不 pkill -f Electron（会误伤他人实例）；
 *  - 以 DSH 宿主里启动本仓 Electron 必须 env -u ELECTRON_RUN_AS_NODE（宿主注入 =1 会变成纯 Node）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Cdp, wait } from "./cdp.mjs";

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
export const TEMP_PREFIX = "/tmp/lake-scale-";
/** 允许的 /tmp 真实路径前缀（macOS /tmp 是 /private/tmp 的软链）。 */
const TEMP_REAL_PREFIXES = ["/tmp/lake-scale-", "/private/tmp/lake-scale-"];

export function fail(message) {
  throw new Error(message);
}

/** 断言目录在隔离区（接受尚未创建的新目录）。 */
export function assertIsolatedPath(target, label = "路径") {
  const resolved = path.resolve(target);
  if (!TEMP_REAL_PREFIXES.some((prefix) => resolved.startsWith(prefix))) {
    fail(`${label}必须是 ${TEMP_PREFIX}*（收到 ${resolved}）；本脚本绝不操作正式/开发数据目录`);
  }
  return resolved;
}

export function dirExists(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** 递归统计目录（文件数/字节数）；不存在返回 0。 */
export function directoryStats(dir) {
  const result = { files: 0, bytes: 0 };
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = fs.statSync(abs);
        result.files += 1;
        result.bytes += stat.size;
      } catch {
        /* 竞态删除：忽略 */
      }
    }
  };
  walk(dir);
  return result;
}

export function humanBytes(bytes) {
  if (!Number.isFinite(bytes)) return "n/a";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)}${units[unit]}`;
}

export function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

export function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function hostInfo() {
  const cpus = os.cpus();
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpus: cpus.length,
    cpuModel: cpus[0]?.model?.trim() || "",
    totalMemBytes: os.totalmem(),
    osRelease: os.release(),
  };
}

/** 端口是否被监听（lsof 退出码 0 = 占用，1 = 空闲）。 */
export function isPortInUse(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail(`非法端口：${port}`);
  try {
    execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { stdio: "pipe" });
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    // lsof 不存在等异常：按「未知」处理，保守报错
    fail(`无法检查端口 ${port}：${error.message}`);
  }
}

/** 启动前断言端口全空闲（避免误连他人 Electron/资源服务）。 */
export function assertPortsFree(ports) {
  const busy = ports.filter((port) => isPortInUse(port));
  if (busy.length > 0) fail(`端口已被占用：${busy.join(", ")}；请用 --cdp-port/--asset-port 换一组`);
}

/**
 * 解析被测应用。默认 = 本仓 dev Electron + LAKE_RENDERER=scheme（服务已构建的 dist/，
 * app.isPackaged=false，启动路径接近正式包；如需真 .app 用 LAKE_SCALE_APP 覆盖）。
 */
export function resolveApp() {
  const packaged = process.env.LAKE_SCALE_APP?.trim();
  if (packaged) {
    const exe = path.resolve(packaged);
    if (!exe.includes(".app/Contents/MacOS/") || !fs.existsSync(exe)) {
      fail(`LAKE_SCALE_APP 必须是存在的 .app 可执行文件（收到 ${exe}）`);
    }
    return { kind: "packaged", exe, args: [], env: {}, distHint: "app.asar 内构建产物" };
  }
  const exe = path.join(REPO_ROOT, "node_modules", ".bin", "electron");
  if (!fs.existsSync(exe)) fail(`找不到 dev Electron：${exe}（先 npm install）`);
  const distIndex = path.join(REPO_ROOT, "dist", "index.html");
  const distElectronMain = path.join(REPO_ROOT, "dist-electron", "main.js");
  for (const required of [distIndex, distElectronMain]) {
    if (!fs.existsSync(required)) fail(`缺少构建产物 ${required}；先跑 npx vite build 与主进程构建（dist-electron）`);
  }
  const stat = fs.statSync(distIndex);
  return {
    kind: "dev-scheme",
    exe,
    args: [],
    env: { LAKE_RENDERER: "scheme" },
    distHint: `dist/index.html mtime=${stat.mtime.toISOString()}`,
  };
}

/**
 * 启动隔离 Electron。
 * @param {{ userData: string, cdpPort: number, assetPort: number, logPath: string, extraArgs?: string[] }} options
 */
export function startIsolatedApp(options) {
  const userData = assertIsolatedPath(options.userData, "LAKE_USER_DATA ");
  assertPortsFree([options.cdpPort, options.assetPort]);
  const app = resolveApp();
  const args = [
    `--remote-debugging-port=${options.cdpPort}`,
    "--disable-gpu",
    "--no-sandbox",
    ...app.args,
    ...(options.extraArgs || []),
  ];
  if (app.kind === "dev-scheme") args.push(".");
  const env = { ...process.env, ...app.env, LAKE_USER_DATA: userData, LAKE_ASSET_PORT: String(options.assetPort) };
  // 关键：宿主（DSH）注入 ELECTRON_RUN_AS_NODE=1，会让 Electron 以纯 Node 启动 ⇒ 必须移除。
  delete env.ELECTRON_RUN_AS_NODE;
  fs.mkdirSync(path.dirname(options.logPath), { recursive: true });
  const logFd = fs.openSync(options.logPath, "a");
  const child = spawn(app.exe, args, {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", logFd, logFd],
    detached: false,
  });
  child.on("exit", () => {
    try { fs.closeSync(logFd); } catch { /* 已关闭 */ }
  });
  return {
    child,
    kind: app.kind,
    exe: app.exe,
    args,
    userData,
    cdpPort: options.cdpPort,
    assetPort: options.assetPort,
    logPath: options.logPath,
    distHint: app.distHint,
    startedAt: Date.now(),
  };
}

/** 连接应用页（等 window.lakeNative 桥就绪）。 */
export async function attachAppPage(app, timeoutMs = 90_000) {
  const cdp = await Cdp.connect(app.cdpPort, undefined, timeoutMs);
  try {
    await cdp.send("Runtime.enable", {}, 10_000);
    await cdp.send("Page.enable", {}, 10_000).catch(() => undefined);
    await cdp.send("Page.bringToFront", {}, 10_000).catch(() => undefined);
    // 桥就绪：app 页首帧可能还没有 lakeNative
    await waitUntil(async () => (await cdp.evaluate("!!(window.lakeNative && window.lakeNative.listTreeNodes)")) === true, timeoutMs, 50, "window.lakeNative 未就绪");
  } catch (error) {
    cdp.close();
    throw error;
  }
  return cdp;
}

async function waitUntil(check, timeoutMs, intervalMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      /* 页面尚未就绪 */
    }
    await wait(intervalMs);
  }
  fail(message + `（${timeoutMs}ms 超时）`);
}

/** 关停自己启动的应用：SIGTERM → 等 → SIGKILL → 按端口兜底清理。 */
export async function stopIsolatedApp(app) {
  const result = { termRequested: false, forcedKill: false, leftoverPids: [] };
  const child = app.child;
  if (child && child.exitCode === null && child.signalCode === null) {
    result.termRequested = true;
    try { child.kill("SIGTERM"); } catch { /* 已退出 */ }
    const exited = await Promise.race([
      new Promise((resolve) => child.once("exit", () => resolve(true))),
      wait(15_000).then(() => false),
    ]);
    if (!exited) {
      result.forcedKill = true;
      try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
      await Promise.race([new Promise((resolve) => child.once("exit", resolve)), wait(5_000)]);
    }
  }
  // 兜底：只按「本次 CDP 端口」定位残留（绝不 pkill Electron）
  try {
    const pids = execFileSync("pgrep", ["-f", `remote-debugging-port=${app.cdpPort}`], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
    if (pids.length > 0) {
      result.leftoverPids = pids.map(Number);
      for (const pid of result.leftoverPids) {
        try { process.kill(pid, "SIGKILL"); } catch { /* 已退出 */ }
      }
      await wait(1_000);
    }
  } catch {
    /* pgrep 无匹配 = 干净 */
  }
  return result;
}

/** 从应用日志里读启动耗时标记（[perf] boot.ready <n>ms）。 */
export function readBootReadyMs(logPath) {
  let text = "";
  try {
    text = fs.readFileSync(logPath, "utf8");
  } catch {
    return null;
  }
  const matches = [...text.matchAll(/\[perf\]\s+boot\.ready\s+(\d+)ms/g)];
  if (matches.length === 0) return null;
  return Number(matches[matches.length - 1][1]);
}

/** 日志尾部（失败时附在报告里，便于复盘）。 */
export function tailLog(logPath, maxChars = 8000) {
  try {
    const text = fs.readFileSync(logPath, "utf8");
    return text.length <= maxChars ? text : text.slice(text.length - maxChars);
  } catch {
    return "";
  }
}
