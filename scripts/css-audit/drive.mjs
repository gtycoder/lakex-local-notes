// Minimal CDP driver (Node 24 built-in WebSocket).
// usage: node drive.mjs <port> <script.mjs>
// script.mjs: `export default async ({ page, args }) => { ... }`
//
// 261117（device-qa P1-6）：**CDP 断连自动重连** —— App 重启/重装后 WebView socket 失效（/json/list 空、
// fetch failed: other side closed），此前每次都要手工重跑 emu-cdp.sh（一轮改动实测 5+ 次）。现在：
//   ① connect 阶段拿不到 page target ⇒ 自动重转发（仅当该端口是 adb forward；桌面 Electron 不受影响）并重试；
//   ② 运行中断连 ⇒ 自动重连并重试该次调用（**已发出且未回包的 Input.* 不重试**，防双击/双滑；
//      发送前 socket 已死 = 确定没送达 ⇒ 任意方法都安全重试）；
//   ③ 长驻自动重连用 scripts/emu-cdp.sh --watch；本文件只在失败时按需修复转发（单一来源 = emu-cdp.sh）。
// 关闭自动重连：LK_CDP_RECONNECT=0。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const RECONNECT = process.env.LK_CDP_RECONNECT !== "0";

/** 连接类错误（socket 死了 / 转发失效），区别于「页面忙」的超时（超时不重连，避免打断在途动作）。 */
const isConnError = (e) => /CDP 连接中断|WebSocket is not open|fetch failed|other side closed|ECONNREFUSED|socket hang up/i.test(String(e && e.message));

const adbBin = () =>
  process.env.ADB ||
  (process.env.ANDROID_SDK_ROOT ? path.join(process.env.ANDROID_SDK_ROOT, "platform-tools/adb") : "adb");

/** 该端口是不是 adb 转发（桌面 Electron CDP 不是 ⇒ 永远不会被 emu-cdp.sh 重转发）。 */
export function isAdbForward(port) {
  try {
    const r = spawnSync(adbBin(), ["forward", "--list"], { encoding: "utf8", timeout: 5000 });
    // adb forward --list 行首是 serial（emulator-5554 tcp:9335 localabstract:…）⇒ 不能锚 ^tcp:
    return r.status === 0 && new RegExp("tcp:" + port + "\\s").test(r.stdout || "");
  } catch {
    return false;
  }
}

/**
 * 修复转发（单一来源 = scripts/emu-cdp.sh，不在这儿重写 socket 选取逻辑）。
 * 只对**已有 adb 转发**的端口自动重转发（App 重启后 forward 还挂着、指向死 socket = 实测痛点）；
 * 桌面 Electron 的端口不在 adb forward --list 里 ⇒ 永远不会被劫持。
 * 转发整个消失（adb server 重启等）时设 LK_CDP_FORWARD=adb 显式允许重转发。
 */
export function refreshForward(port) {
  const forced = process.env.LK_CDP_FORWARD === "adb";
  if (!forced && !isAdbForward(port)) return false;
  // adb 高负载时偶发卡住（screencap/多客户端排队）⇒ 给 30s 并重试一次；失败带上退出状态好排查。
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = spawnSync("bash", [path.join(REPO, "scripts/emu-cdp.sh"), String(port)], {
      encoding: "utf8",
      timeout: 30000,
      cwd: REPO,
    });
    if (r.status === 0) return true;
    const why = (r.stderr || r.stdout || "").trim().slice(0, 160) || ("status=" + r.status + (r.signal ? " signal=" + r.signal : "") + (r.error ? " " + r.error.message : ""));
    console.error("[drive] emu-cdp.sh 重转发失败（第 " + attempt + " 次）：" + why);
  }
  return false;
}

async function fetchPageList(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error("http " + res.status);
  return res.json();
}

/**
 * 取 page target 列表；拿不到（转发失效 / App 刚重启）时自动重转发重试。
 * 桌面 Electron 端口不会被重转发，只做纯重试。
 */
export async function ensureCdpTarget(port, { attempts = 6, quiet = false } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const list = await fetchPageList(port);
      const pages = list.filter((t) => t.type === "page" && !t.url.startsWith("devtools://"));
      if (pages.length) return pages;
      lastErr = new Error("no page target");
    } catch (e) {
      lastErr = e;
    }
    if (!RECONNECT) break;
    if (i === 0 && !quiet) console.error("[drive] :" + port + " 拿不到 page target（" + lastErr.message + "）→ 自动重连");
    refreshForward(port);
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(
    `no page target on :${port}（${lastErr ? lastErr.message : "unknown"}）` +
      (RECONNECT ? "；若这是移动实例且转发已整个消失，先跑 bash scripts/emu-cdp.sh " + port + "（或 LK_CDP_FORWARD=adb 允许自动重转发）" : ""),
  );
}

/**
 * 转发/目标是否还活着（两次探测都失败才判死：页面忙时 /json/list 偶发一次超时不算死）。
 * 死转发黑洞（forward 挂着、对端已死）里 CDP 调用既不回也不断 ⇒ 靠它把「忙」和「死」分开。
 */
async function forwardAlive(port) {
  try { await fetchPageList(port); return true; } catch { /* 继续第二次探测 */ }
  await new Promise((r) => setTimeout(r, 2000));
  try { await fetchPageList(port); return true; } catch { return false; }
}

export class Page {
  constructor(ws, meta, opts = {}) {
    this.meta = meta;
    this.id = 0;
    this.pending = new Map();
    this.port = opts.port ?? null;
    this.reconnects = 0;
    this._attach(ws);
  }

  _attach(ws) {
    if (this._watchdog) { clearInterval(this._watchdog); this._watchdog = null; }
    this.ws = ws;
    this._wsDead = false;
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result ?? {});
      }
    });
    // 连接掉了必须让在途请求 reject：否则 Promise 永不 settle，Node 以 exit 13
    // 「unsettled top-level await」退出，把真正的原因（target 崩溃 / 连接断开）整条盖掉
    // —— 2026-10-06 实测两次（同一份代码、只换实例世代），排查时完全看不到线索。
    const fail = (reason) => {
      this._wsDead = true;
      if (this.pending.size === 0) return;
      for (const { reject } of this.pending.values()) reject(new Error("CDP 连接中断：" + reason));
      this.pending.clear();
    };
    ws.addEventListener("close", () => fail("socket closed"));
    ws.addEventListener("error", () => fail("socket error"));
  }

  /**
   * 在途调用看门狗：死转发黑洞里调用会挂满 90s 超时才被发现（实测 App 重启后必现）⇒
   * 每 12s 探一次 /json/list，连续两次失败 = 转发已死 ⇒ 立刻让在途调用失败并走自动重连，
   * 把恢复时间从 90s 压到 ~15s。「页面忙」的单次探测失败不算死（forwardAlive 两击制）。
   */
  _startWatchdog() {
    if (!RECONNECT || this.port == null || this._watchdog || this.pending.size === 0) return;
    this._watchdog = setInterval(() => {
      if (this.pending.size === 0) { clearInterval(this._watchdog); this._watchdog = null; return; }
      void forwardAlive(this.port).then((alive) => {
        if (alive || !this._watchdog) return;
        clearInterval(this._watchdog); this._watchdog = null;
        if (this.pending.size === 0) return;
        for (const { reject } of this.pending.values()) reject(new Error("CDP 连接中断：转发失活（/json/list 不可达）"));
        this.pending.clear();
      });
    }, 12000);
  }

  /** 断连后重建：修复 adb 转发（如是）→ 拿新 target → 新 WS → 重新 enable 各域。 */
  async _reconnect() {
    if (this.port == null) throw new Error("CDP 连接中断：本 Page 未记录端口，无法自动重连");
    if (++this.reconnects > 5) throw new Error("CDP 连接中断：自动重连已超过 5 次，停止重试");
    try { this.ws.close(); } catch { /* 已死 */ }
    const pages = await ensureCdpTarget(this.port, { quiet: true });
    const target = pages.find((p) => p.id === this.meta.id) || pages[0];
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    this.meta = target;
    this._attach(ws);
    await this.prep();
    console.error("[drive] CDP 已自动重连（第 " + this.reconnects + " 次）：" + target.url.slice(0, 60));
  }

  _sendOnce(method, params) {
    const id = ++this.id;
    const TIMEOUT_MS = Number(process.env.LK_CDP_TIMEOUT_MS || 90000);
    // 发送前 socket 已死 ⇒ 这条**确定没送达**，任何方法（含 Input）重试都安全。
    const notDelivered = this._wsDead || this.ws.readyState !== WebSocket.OPEN;
    return new Promise((resolve, reject) => {
      // 页面/主进程卡住时 CDP 既不回也不断 ⇒ 没有超时的话整个进程以 exit 13
      // 「unsettled top-level await」静默退出，看起来像"装置随机崩"（2026-10-06 实测三次）。
      // 有超时至少能指名道姓说是哪个调用卡住了。
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error("CDP 调用超时 " + TIMEOUT_MS + "ms：" + method));
      }, TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
        notDelivered,
        method,
      });
      this._startWatchdog();
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error("CDP 连接中断：send failed（" + String(e && e.message) + "）"));
      }
    });
  }

  send(method, params = {}) {
    return this._sendOnce(method, params).catch(async (err) => {
      if (!RECONNECT || this.port == null) throw err;
      const msg = String(err.message);
      // 断连的两种形态：① 明确的连接类错误；② **死转发黑洞** —— adb forward 还挂着但对端（App）已死，
      // WS 不 close 也不断（实测：App 重启后 Runtime.evaluate 静默挂满 90s 超时，看起来像"页面忙"）。
      // 形态②用超时 + /json/list 健康检查区分：转发死了一定 fetch 不动；页面忙则 fetch 正常、不重试。
      const isTimeout = /CDP 调用超时/.test(msg);
      if (!isConnError(err) && !isTimeout) throw err;
      // Input：只有「确定没送达」才重试。已发出未回包的不重试 —— 不知道手势有没有被处理，
      // 重放 = 双击/双滑，而且 App 重启后 UI 已复位，补点旧坐标只会点到别的东西（AGENTS §7.19 口径）。
      const undelivered = /send failed|未送达/.test(msg);
      if (/^Input\./.test(method) && !undelivered) {
        throw new Error(msg + "（Input 类调用不自动重试，请重跑该步骤）");
      }
      if (isTimeout) {
        if (await forwardAlive(this.port)) throw err; // 页面真忙：保留原始超时错误，不打断在途动作
      }
      console.error("[drive] " + method + " 断连（" + msg.slice(0, 80) + "）→ 自动重连并重试一次");
      await this._reconnect();
      return this._sendOnce(method, params);
    });
  }

  async evaluate(expr, { awaitPromise = true } = {}) {
    const wrapped = `(async()=>{ return (${expr}); })()`;
    const r = await this.send("Runtime.evaluate", {
      expression: wrapped,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        "eval error: " +
          (r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)),
      );
    }
    return r.result?.value;
  }

  async raw(expr) {
    return this.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
  }

  async shot(file, { clip, fromSurface = true, format = "png", quality } = {}) {
    const params = { format, fromSurface, captureBeyondViewport: false };
    if (quality) params.quality = quality;
    if (clip) params.clip = { scale: 1, ...clip };
    const r = await this.send("Page.captureScreenshot", params);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  }

  async prep() {
    // 每个域启用调用都加超时：某个调用偶发不返回时（HMR 重挂载/页面忙），不要让整个脚本卡死。
    const guard = (p, ms = 2500) =>
      Promise.race([p.catch(() => {}), new Promise((resolve) => setTimeout(resolve, ms))]);
    await guard(this.send("Runtime.enable"));
    await guard(this.send("Page.enable"));
    await guard(this.send("Emulation.setFocusEmulationEnabled", { enabled: true }));
    await guard(this.send("Page.setWebLifecycleState", { state: "active" }));
  }

  async tap(x, y, { hold = 70 } = {}) {
    await this.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await new Promise((r) => setTimeout(r, hold));
    await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  async click(x, y, { button = "left", clickCount = 1 } = {}) {
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount });
  }

  async move(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  }

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export async function connect(port, { index = 0, urlFilter } = {}) {
  const pages = await ensureCdpTarget(port);
  const filtered = urlFilter ? pages.filter((p) => p.url.includes(urlFilter)) : pages;
  const target = filtered[index];
  if (!target) {
    throw new Error(`no page target on :${port}（${pages.map((p) => p.url).join(", ")}）`);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const page = new Page(ws, target, { port });
  await page.prep();
  return page;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2]);
  const scriptPath = process.argv[3];
  const script = (await import(pathToFileURL(path.resolve(scriptPath)).href)).default;
  const page = await connect(port, {
    index: Number(process.env.LK_INDEX ?? 0),
    urlFilter: process.env.LK_URL,
  });
  try {
    const out = await script({ page, args: process.argv.slice(4) });
    if (out !== undefined) console.log(JSON.stringify(out, null, 2));
  } finally {
    page.ws.close();
  }
}
