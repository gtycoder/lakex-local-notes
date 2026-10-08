#!/usr/bin/env node
/**
 * 文档里「粘贴大表格」的压测/复现脚本（261008）。
 *
 * 背景（用户实测）：从本应用的「表格」文档复制 ~5500 行数据，粘进**文档**后整个窗口卡死；
 * 同一份内容在思源约 3s 完成，**云端语雀 Lake 也会卡死** ⇒ 是闭源 lakex 内核的表格卡片问题
 * （整表全量 DOM 渲染、无虚拟化），不是我们这层能根治的。见 HANDOFF §3「大表格粘贴」。
 *
 * 本脚本用来**量化**这条路径（改任何护栏/内核前先跑它拿基线）：
 *   1. 连一个跑着的实例（默认 CDP 9222；用 LAKE_CDP_PORT 覆盖）；
 *   2. 造 N 行 × M 列的 HTML 表格（模拟从表格复制的内容）；
 *   3. 新建一个文档 → 打开 → 用**合成 paste 事件**（带真实 text/html 的 DataTransfer）粘贴；
 *      （等价于真实粘贴：内核同样从 clipboardData.getData("text/html") 读内容，
 *        我们的粘贴拦截器只包装 getData、不重派发 —— 用合成事件是为了不动系统剪贴板。）
 *   4. 打印：同步阻塞时长、DOM 节点数、产物结构（ne-table-hole / 行 / 格）。
 *
 * 用法：
 *   node scripts/table-paste-stress.mjs                      # 默认 1000 与 5500 两档
 *   ROWS=5500,2000 ROWS= node scripts/table-paste-stress.mjs  # 自定义档位（逗号分隔）
 *   LAKE_CDP_PORT=9242 node scripts/table-paste-stress.mjs
 *
 * ⚠️ 会**真的往当前文档里粘贴**（会新建文档，不会改已有内容）。请在隔离实例上跑：
 *   env -u ELECTRON_RUN_AS_NODE LAKE_RENDERER=scheme LAKE_USER_DATA="$TMPDIR/lake-stress" \
 *     LAKE_ASSET_PORT=19899 ./node_modules/.bin/electron --disable-gpu --no-sandbox --remote-debugging-port=9222 .
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.LAKE_CDP_PORT || 9222);
const SIZES = (process.env.SIZES || "1000,5500").split(",").map((x) => Number(x.trim())).filter(Boolean);
const COLS = Number(process.env.COLS || 6);
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), "lake-table-paste-stress");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 造一份「从表格复制」的 HTML 表格（列内容贴近真实：序号+中文、中文、URL）。 */
function makeTableHtml(rows, cols) {
  const parts = ["<html><body><!--StartFragment--><table border=1 style='border-collapse:collapse'>"];
  for (let r = 0; r < rows; r += 1) {
    parts.push("<tr>");
    for (let c = 0; c < cols; c += 1) {
      const v = c === 0 ? (r + 1) + " 上证指数" : c === cols - 1
        ? "https://quote.eastmoney.com/concept/bj93000" + (r % 10) + ".html?from=zixuan"
        : "第" + (r + 1) + "行第" + (c + 1) + "列 测试内容 abcdef";
      parts.push("<td style='mso-number-format:General'>" + v + "</td>");
    }
    parts.push("</tr>");
  }
  parts.push("</table><!--EndFragment--></body></html>");
  return parts.join("");
}

async function connect() {
  let targets = [];
  for (let i = 0; i < 60; i += 1) {
    try { targets = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json(); if (targets.some((t) => t.type === "page")) break; } catch {}
    await wait(500);
  }
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("没有找到 CDP page（端口 " + PORT + "）");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
  let id = 0; const pending = new Map();
  socket.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const rid = ++id; pending.set(rid, res); socket.send(JSON.stringify({ id: rid, method, params })); });
  async function ev(expr, timeoutMs = 180000) {
    const t0 = Date.now();
    const r = await Promise.race([send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }), wait(timeoutMs).then(() => "__TIMEOUT__")]);
    const ms = Date.now() - t0;
    if (r === "__TIMEOUT__") return { ms, timeout: true };
    if (r.result?.exceptionDetails) return { ms, err: JSON.stringify(r.result.exceptionDetails).slice(0, 200) };
    return { ms, value: r.result?.result?.value };
  }
  return { socket, send, ev };
}

const { socket, send, ev } = await connect();
await send("Runtime.enable"); await send("Page.enable"); await send("Page.bringToFront"); await wait(1500);
await fs.mkdir(OUT_DIR, { recursive: true });
const report = [];
for (const rows of SIZES) {
  const html = makeTableHtml(rows, COLS);
  const htmlFile = path.join(OUT_DIR, "table-" + rows + ".html");
  await fs.writeFile(htmlFile, html);
  const made = await ev("(async()=>{ const root=[...document.querySelectorAll('[data-tree-node-id]')].map(e=>e.getAttribute('data-tree-node-id')).find(x=>x&&x.startsWith('notebook')); const n=await window.lakeNative.createNoteIn(root||null,'粘贴压测 "+rows+" 行'); return JSON.stringify({id:n.id}); })()", 30000);
  if (made.err || !made.value) { report.push({ rows, error: made.err || "create note failed" }); continue; }
  const noteId = JSON.parse(made.value).id;
  await wait(800);
  await ev("(()=>{ const rows=[...document.querySelectorAll('[data-tree-node-id]')]; for (const r of rows) { const ch=r.querySelector('.tree-chevron'); if (ch && !ch.classList.contains('open')) ch.click(); } return true; })()");
  await wait(900);
  await ev("(()=>{ const el=document.querySelector('[data-tree-node-id=\"" + "NID" + "\"]'); if(el) el.click(); return Boolean(el); })()".replace("NID", noteId));
  let ready = false;
  for (let i = 0; i < 25; i += 1) { if ((await ev("Boolean(document.querySelector('.ne-engine'))", 6000)).value) { ready = true; break; } await wait(400); }
  const before = await ev("document.querySelectorAll('*').length", 8000);
  const pasteExpr = "(function(){ const ed=document.querySelector('.ne-engine'); if(!ed) return 'no-engine'; ed.focus(); const sel=window.getSelection(); const rg=document.createRange(); rg.selectNodeContents(ed); rg.collapse(false); sel.removeAllRanges(); sel.addRange(rg); const dt=new DataTransfer(); dt.setData('text/html', " + JSON.stringify(html) + "); dt.setData('text/plain','pasted-table'); const t0=performance.now(); ed.dispatchEvent(new ClipboardEvent('paste', {clipboardData:dt, bubbles:true, cancelable:true})); return String(Math.round(performance.now()-t0)); })()";
  const paste = await ev(pasteExpr, 240000);
  const after = await ev("JSON.stringify({nodes:document.querySelectorAll('*').length, holes:[...document.querySelectorAll('ne-table-hole')].map(h=>h.getElementsByTagName('*').length), tables:[...document.querySelectorAll('table')].map(t=>({rows:t.querySelectorAll('tr').length, cells:t.querySelectorAll('td,th').length}))})", 20000);
  report.push({ rows, cols: COLS, htmlBytes: Buffer.byteLength(html), ready, nodesBefore: before.value, syncBlockMs: paste.timeout ? "TIMEOUT>" + paste.ms : Number(paste.value ?? -1), after: after.value });
  await wait(1500);
}
console.log(JSON.stringify(report, null, 1));
socket.close();
process.exit(0);
