#!/usr/bin/env node
/**
 * First-use smoke for the lazy Drawnix board card (vendor `drawing-board`).
 * Requires the dev Electron window (`npm run dev`) on LAKE_CDP_PORT (default 9222).
 *
 * 方案（2026-09-16 重写）：
 *   临时把 `drawing-board` 自定义块注入「欢迎」笔记（reload 后必重开，确定性最好），
 *   校验画板渲染 + 懒加载 Drawnix chunk 真被请求，最后还原「欢迎」笔记正文。
 * 自定义卡序列化见 docs/LAKEX-CONTRACT.md §5.3
 * （value = "data:" + encodeURIComponent(JSON)，tag 的 name 恒为 `customBlock`）。
 */
import fs from "node:fs/promises";

const port = Number(process.env.LAKE_CDP_PORT || 9222);
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((target) => target.type === "page");
if (!page) throw new Error(`没有找到 CDP page（端口 ${port}）`);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
};
function send(method, params = {}) {
  return new Promise((resolve) => {
    const requestId = ++id;
    pending.set(requestId, resolve);
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text || "Runtime.evaluate failed");
  return result.result?.result?.value;
}
async function wait(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitFor(expression, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression);
    if (value) return value;
    await wait(200);
  }
  throw new Error(`等待超时: ${expression}`);
}

let welcomeBackup = null;
try {
  // 1) 读取「欢迎」笔记并把 drawing-board 卡追加进去（返回备份用于还原）
  welcomeBackup = await evaluate(`(async()=>{
    const n = await window.lakeNative.readNote('welcome-note');
    const initValue = {
      $name: "drawing-board",
      $htmlStr: "",
      version: 2,
      engine: "drawnix",
      preset: "drawing",
      plaitValue: [],
      plaitViewport: { x: 0, y: 0, zoom: 1 },
      cardHeight: 560,
    };
    const value = "data:" + encodeURIComponent(JSON.stringify(initValue));
    const card = '<p><card type="block" name="customBlock" value="' + value + '"></card></p>';
    await window.lakeNative.saveNote('welcome-note', n.title, n.content + card);
    return JSON.stringify({ title: n.title, content: n.content });
  })()`);

  // 2) reload：欢迎笔记必重开，编辑器从磁盘读到含画板卡的正文
  await evaluate("location.reload(); true");
  await waitFor(`document.readyState === "complete" && document.querySelectorAll(".lake-editor-tab").length > 0`);
  await waitFor(`document.querySelectorAll(".drawing-board-resizer").length > 0 && document.querySelectorAll(".plait-board-container").length > 0`, 30000);
  await wait(800);
  const result = await evaluate(`JSON.stringify({
    boardResizers: document.querySelectorAll(".drawing-board-resizer").length,
    plaitBoards: document.querySelectorAll(".plait-board-container").length,
    drawnixJs: performance.getEntriesByType("resource").map(e=>e.name).filter(n=>/lakex-drawnix|DrawnixBoardCore|\\/drawnix-|plait/i.test(n)&&/\\.js/.test(n)),
    drawnixModuleRendered: document.querySelectorAll(".plait-board-container, .drawnix").length > 0,
    fallback: Boolean(document.querySelector('[aria-label="画板加载中"]')),
    protocol: location.protocol,
    status: document.querySelector(".document-statusbar")?.innerText || ""
  })`);
  const parsed = JSON.parse(result);
  if (parsed.boardResizers < 1 || parsed.plaitBoards < 1) throw new Error("Drawnix 画板未渲染");
  if (!parsed.drawnixModuleRendered) throw new Error("Drawnix 模块未渲染");
  // 非 http(s) 页面（打包版：A1 起是私有协议 lakexlocalnotes://app，此前是 file://）下 Chromium 不记录
  // JS module 的 resource timing（两者实测 drawnixJs=0），该断言只在 http(s)（vite dev/preview）下有意义；
  // 非 http(s) 时由上面的「画板已渲染 + 模块已渲染」证明引擎已加载。
  // 懒加载/首屏体积的护栏归 scripts/check-bundle-budget.mjs，不在这里。
  if (/^https?:$/.test(parsed.protocol) && parsed.drawnixJs.length < 1) throw new Error("懒加载 Drawnix JS 未被请求");
  if (parsed.fallback) throw new Error("Drawnix 仍停留在加载占位");
  console.log(result);
  const output = process.env.LAKE_UI_EVIDENCE_DIR;
  if (output) {
    await fs.mkdir(output, { recursive: true });
    const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await fs.writeFile(`${output}/drawnix-first-use.png`, Buffer.from(shot.result.data, "base64"));
    await fs.writeFile(`${output}/drawnix-first-use.json`, result);
  }
} finally {
  if (welcomeBackup) {
    const backup = JSON.parse(welcomeBackup);
    await evaluate(`(async()=>{
      try { await window.lakeNative.saveNote('welcome-note', ${JSON.stringify(backup.title)}, ${JSON.stringify(backup.content)}); } catch {}
      try { location.reload(); } catch {}
      return true;
    })()`).catch(() => undefined);
  }
  socket.close();
}
