#!/usr/bin/env node
/** Real Electron tab-switch timing smoke. Start npm run dev first. */
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
  return new Promise((resolve) => { const requestId = ++id; pending.set(requestId, resolve); socket.send(JSON.stringify({ id: requestId, method, params })); });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text || "Runtime.evaluate failed");
  return result.result?.result?.value;
}
async function wait(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitFor(expression, timeout = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await wait(80);
  }
  throw new Error(`等待超时: ${expression}`);
}
await send("Runtime.enable");
await send("Page.enable");
await send("Page.bringToFront");
await waitFor('document.readyState === "complete" && Boolean(window.lakeNative)');
await waitFor('document.querySelectorAll("[data-tree-node-id].type-note").length >= 2');
const ids = await evaluate(`JSON.stringify([...document.querySelectorAll('[data-tree-node-id].type-note')].slice(0,2).map(row=>row.dataset.treeNodeId))`);
const noteIds = JSON.parse(ids);
const timings = [];
for (const noteId of noteIds) {
  const started = await evaluate(`(()=>{ const row=document.querySelector('[data-tree-node-id="${noteId}"]'); if(!row) return -1; row.click(); return performance.now(); })()`);
  await waitFor(`Boolean(document.querySelector('.tab-item.active[data-note-id="${noteId}"]'))`);
  timings.push({ noteId, elapsedMs: Math.round((await evaluate("performance.now()")) - started) });
  await wait(120);
}
const css = await evaluate(`(()=>{ const text=[...document.styleSheets].flatMap(sheet=>{try{return [...sheet.cssRules].map(rule=>rule.cssText)}catch{return[]}}).join(' '); return JSON.stringify({ old: text.includes('55ms ease-in'), fresh: text.includes('85ms ease-out')}); })()`);
const result = { timings, css: JSON.parse(css) };
console.log(JSON.stringify(result, null, 2));
if (!timings.every((sample) => sample.elapsedMs < 700)) throw new Error("tab 切换耗时超出 700ms");
if (!result.css.old || !result.css.fresh) throw new Error("tab 快速动画 CSS 合约缺失");
socket.close();
