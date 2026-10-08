#!/usr/bin/env node
/**
 * usheet 大表压测（连到已运行的 Electron CDP）。
 * 用法: LAKE_CDP_PORT=9239 SIZES=500,1000,2000,5000 COLS=20 node scripts/usheet-stress.mjs
 * 逐尺寸：页内建表(生成 cellData)+saveNote → reload → 点行开表量 openMs/DOM/heap → 关标签量回收。
 */
const port = Number(process.env.LAKE_CDP_PORT || 9239);
const sizes = (process.env.SIZES || "500,1000,2000,5000").split(",").map(Number);
const cols = Number(process.env.COLS || 20);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageCreate(title, rows, cols) {
  const tree = await window.lakeNative.listTreeNodes();
  const nb = tree.find((n) => n.nodeType === "notebook");
  const note = await window.lakeNative.createUsheetIn(nb.id, title);
  const cellData = {};
  for (let r = 0; r < rows; r++) {
    const row = {};
    for (let c = 0; c < cols; c++) row[c] = c % 4 === 0 ? { v: "r" + r + "c" + c } : { v: r * cols + c };
    cellData[r] = row;
  }
  const workbook = { id: "workbook", name: title, sheetOrder: ["s1"], sheets: { s1: { id: "s1", name: "Sheet1", rowCount: rows, columnCount: cols, defaultColumnWidth: 88, defaultRowHeight: 24, cellData } } };
  const body = JSON.stringify({ kind: "usheet", version: 1, workbook });
  const t0 = performance.now();
  await window.lakeNative.saveNote(note.id, note.title, body);
  return { id: note.id, bytes: body.length, saveMs: Math.round(performance.now() - t0) };
}

async function pageOpen(title) {
  const row = [...document.querySelectorAll(".tree-row")].find((e) => (e.textContent || "").includes(title));
  if (!row) return { error: "row not found" };
  const t0 = performance.now();
  row.click();
  for (let i = 0; i < 900; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const host = document.querySelector('.usheet-editor[data-active="true"] .usheet-univer-root');
    if (host && [...host.querySelectorAll("canvas")].some((c) => c.getBoundingClientRect().height > 100)) {
      return { openMs: Math.round(performance.now() - t0), dom: document.querySelectorAll("*").length, heapMB: Math.round(((performance.memory || {}).usedJSHeapSize || 0) / 1048576) };
    }
  }
  return { openMs: -1, timeout: true };
}

async function pageClose(title) {
  const tab = [...document.querySelectorAll(".tab-items > *")].find((e) => (e.textContent || "").includes(title));
  if (!tab) return { error: "no tab" };
  const x = tab.querySelector(".tab-close");
  if (x) x.click();
  await new Promise((r) => setTimeout(r, 1500));
  return { canvases: document.querySelectorAll("canvas").length };
}

const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.error("no page target"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
let id = 0; const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id; pending.set(i, { resolve, reject });
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error("timeout " + method)); } }, 180000);
});
const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300));
  return r.result?.value;
};
await send("Runtime.enable");
await send("Page.enable");
await send("HeapProfiler.enable");
/** 强制 GC 后再读堆，避免"关表后堆反而更高"的 GC 滞后噪声。 */
const gcHeap = async () => { await send("HeapProfiler.collectGarbage"); return await evalJs("Math.round(((performance.memory || {}).usedJSHeapSize || 0) / 1048576)"); };
const baseHeapMB = await gcHeap();
console.log("base heapMB(GC):", baseHeapMB);

const results = [];
for (const rows of sizes) {
  const title = "压测-" + rows + "x" + cols;
  try {
    const created = await evalJs("(" + pageCreate.toString() + ")(" + JSON.stringify(title) + "," + rows + "," + cols + ")");
    results.push({ title, rows, cols, ...created, openMs: null, dom: null, heapMB: null, afterClose: null });
    console.log("created", JSON.stringify({ title, rows, cols, bytes: created.bytes, saveMs: created.saveMs }));
  } catch (e) { console.log("create failed", title, String(e).slice(0, 200)); }
}

await send("Page.reload", {});
await sleep(6000);

for (const item of results) {
  try { Object.assign(item, await evalJs("(" + pageOpen.toString() + ")(" + JSON.stringify(item.title) + ")")); }
  catch (e) { item.error = String(e).slice(0, 200); }
  item.heapMB = await gcHeap();
  try { item.afterClose = await evalJs("(" + pageClose.toString() + ")(" + JSON.stringify(item.title) + ")"); }
  catch (e) { item.afterClose = { error: String(e).slice(0, 200) }; }
  item.afterClose.heapMB = await gcHeap();
  console.log("measured", JSON.stringify(item));
}

console.log("\n==== SUMMARY (cols=" + cols + ") ====");
console.log("rows\tbytes\tsaveMs\topenMs\tdom\theapMB\tafterCloseHeapMB");
for (const r of results) {
  console.log([r.rows, r.bytes, r.saveMs, r.openMs, r.dom, r.heapMB, r.afterClose ? r.afterClose.heapMB : "-"].join("\t"));
}
ws.close();
