// Minimal CDP driver (Node 24 built-in WebSocket).
// usage: node drive.mjs <port> <script.mjs>
// script.mjs: `export default async ({ page, args }) => { ... }`
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export class Page {
  constructor(ws, meta) {
    this.ws = ws;
    this.meta = meta;
    this.id = 0;
    this.pending = new Map();
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
      if (this.pending.size === 0) return;
      for (const { reject } of this.pending.values()) reject(new Error("CDP 连接中断：" + reason));
      this.pending.clear();
    };
    ws.addEventListener("close", () => fail("socket closed"));
    ws.addEventListener("error", () => fail("socket error"));
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
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
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const pages = list.filter((t) => t.type === "page" && !t.url.startsWith("devtools://"));
  const filtered = urlFilter ? pages.filter((p) => p.url.includes(urlFilter)) : pages;
  const target = filtered[index];
  if (!target) {
    throw new Error(`no page target on :${port} (${pages.map((p) => p.url).join(", ")})`);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const page = new Page(ws, target);
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
