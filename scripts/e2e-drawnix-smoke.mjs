#!/usr/bin/env node
/**
 * First-use smoke for the lazy Drawnix card.
 * Requires the dev Electron window (`npm run dev`) on LAKE_CDP_PORT (default 9222).
 * Creates a uniquely named temporary note through the exposed native bridge, reloads
 * the renderer, opens the card, verifies the lazy JS/CSS resources and removes it.
 */
import fs from "node:fs/promises";

const port = Number(process.env.LAKE_CDP_PORT || 9222);
const fixtureTitle = `__drawnix-smoke-${Date.now()}`;
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
async function waitFor(expression, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression);
    if (value) return value;
    await wait(200);
  }
  throw new Error(`等待超时: ${expression}`);
}

let fixtureId = null;
try {
  fixtureId = await evaluate(`(async()=>{
    const note = await window.lakeNative.createNote(${JSON.stringify(fixtureTitle)});
    const value = encodeURIComponent(JSON.stringify({$name:"board-card",$htmlStr:"",elements:[],cardHeight:400}));
    const content = '<p id="' + note.id + '-body" class="ne-p"><br></p><p id="drawnix-smoke-board"><card type="block" name="customBlock" value="' + value + '"></card></p>';
    await window.lakeNative.saveNote(note.id, ${JSON.stringify(fixtureTitle)}, content);
    return note.id;
  })()`);

  await evaluate("location.reload(); true");
  await waitFor(`document.readyState === "complete" && document.querySelectorAll(".lake-editor-tab").length > 0`);
  await wait(1200);
  await evaluate(`(()=>{ const el = document.querySelector('[data-note-id="${fixtureId}"]'); if (el && !el.classList.contains("active")) el.click(); return true; })()`);
  await waitFor(`document.querySelector('[data-note-id="${fixtureId}"]')?.classList.contains("active") || document.querySelector(".board-card-wrapper")`);
  await waitFor(`document.querySelectorAll(".board-card-wrapper").length > 0 && document.querySelectorAll(".plait-board-container").length > 0`);
  await wait(300);
  const result = await evaluate(`JSON.stringify({
    fixtureId: ${JSON.stringify(fixtureId)},
    boardWrappers: document.querySelectorAll(".board-card-wrapper").length,
    plaitBoards: document.querySelectorAll(".plait-board-container").length,
    drawnixJs: performance.getEntriesByType("resource").map(e=>e.name).filter(n=>/drawnix|plait/i.test(n)&&/\\.js/.test(n)),
    drawnixCss: [...new Set([
      ...[...document.styleSheets].map(s=>s.href || ""),
      ...performance.getEntriesByType("resource").map(e=>e.name),
    ])].filter(n=>/drawnix/i.test(n)&&/\.css/.test(n)),
    drawnixModuleRendered: document.querySelectorAll(".plait-board-container, .drawnix").length > 0,
    fallback: Boolean(document.querySelector('[aria-label="画板加载中"]')),
    status: document.querySelector(".document-statusbar")?.innerText || ""
  })`);
  const parsed = JSON.parse(result);
  if (parsed.boardWrappers < 1 || parsed.plaitBoards < 1) throw new Error("Drawnix 画板未渲染");
  if (!parsed.drawnixModuleRendered || parsed.drawnixCss.length < 3) throw new Error("Drawnix 首次加载资源不完整");
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
  if (fixtureId) {
    await evaluate(`(async()=>{
      try { await window.lakeNative.deleteNote(${JSON.stringify(fixtureId)}); } catch {}
      try { const items = await window.lakeNative.listTrash(); const item = items.find(x => x.noteFileId === ${JSON.stringify(fixtureId)}); if (item) await window.lakeNative.purgeTrash(item.id); } catch {}
      try { location.reload(); } catch {}
      return true;
    })()`).catch(() => undefined);
  }
  socket.close();
}
