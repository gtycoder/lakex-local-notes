/**
 * 移动端内核挂载耗时测量（B4：先拿我们自己的数据，再决定要不要做内核预热/复用）。
 *
 * 量什么：**点开一篇文档 → 内核宿主（`.ne-editor-wrap` 编辑态 / `.ne-viewer-body` 阅读态）内容就绪**的耗时。
 * 判据是**可见内核内容签名变化**（标签宿主 keep-alive，切文档不增加宿主数量 —— 实测同时存在 3 个宿主）。
 * 计时用页内 performance.now()（MutationObserver 起止），不经 CDP 往返。
 *
 * 导航复用 scripts/css-audit/mobile-walkthrough.mjs 已验的配方：
 *   知识库 tab(.mobile-htab) → .nb-row → 抽屉打开时行选择器 = `.side-panel--left.on .ln-row` / `.mobile-workspace .ln-row`；
 *   底栏「文档树」按 **aria-label/title** 找（.mobile-bottom-bar__item，textContent 不可靠）。
 *   ⚠️ 未打开的抽屉里也有 .ln-row（keep-alive 隐藏视图）⇒ **必须限定 `.on`**，否则点到不可见元素（HANDOFF §8 坑）。
 *
 * 用法：node scripts/mobile-kernel-perf.mjs [--port 9335] [--runs 4]
 */

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(argOf("port", "9335"));
const RUNS = Number(argOf("runs", "4"));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.error("no page target（先 bash scripts/emu-cdp.sh " + PORT + "）"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async ([x, y]) => {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};
const CENTER = (sel) => `(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];})()`;
const TREE_ROWS = '[].slice.call(document.querySelectorAll(".side-panel--left.on .ln-row, .mobile-workspace .ln-row")).filter(function(e){return e.getBoundingClientRect().width>0;})';

async function tapCenter(sel, waitMs) { const p = await ev(CENTER(sel)); if (!p) return false; await click(p); await sleep(waitMs || 1200); return true; }

/** 复刻 walkthrough 的 openNotebook：知识库 → 笔记本 →（必要时）底栏「文档树」。 */
async function ensureDocTree() {
  const inWs = await ev('Boolean(document.querySelector(".mobile-workspace"))');
  if (!inWs) {
    if (!(await ev('Boolean(document.querySelector(".nb-row, .nb-shelf-card"))'))) {
      await tapCenter('.mobile-htab:nth-of-type(2)', 1200);
    }
    await tapCenter(".nb-row, .nb-shelf-card", 1600);
  }
  if (await ev(`Boolean(document.querySelector(".side-panel--left.on .ln-row"))`)) return true;
  const btn = await ev(`(function(){var TREE=String.fromCharCode(0x6587,0x6863,0x6811);` +
    `var els=[].slice.call(document.querySelectorAll(".mobile-bottom-bar__item")).filter(function(e){` +
    `var a=(e.getAttribute("aria-label")||"")+e.title;return a.indexOf(TREE)>=0&&e.getBoundingClientRect().width>0;});` +
    `var e=els[0];if(!e)return null;var r=e.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];})()`);
  if (btn) { await click(btn); await sleep(1100); }
  return await ev(`Boolean(document.querySelector(".side-panel--left.on .ln-row"))`);
}

/** 页内计时：t0 → 可见内核内容签名变化。 */
const arm = `(()=>{
  const hosts=()=>[].slice.call(document.querySelectorAll(".ne-editor-wrap, .ne-viewer-body"));
  const sig=()=>hosts().map(h=>h.textContent.length).join(",")+"|"+hosts().length;
  window.__km={base:sig(),start:performance.now(),done:null};
  window.__kmObs&&window.__kmObs.disconnect();
  window.__kmObs=new MutationObserver(()=>{if(window.__km.done===null&&sig()!==window.__km.base){window.__km.done=performance.now()-window.__km.start;window.__kmObs.disconnect();}});
  window.__kmObs.observe(document.body,{childList:true,subtree:true,characterData:true});
  return window.__km.base;
})()`;

/**
 * --cold：从**首页**开始计时（知识库 → 笔记本 → 自动打开首篇文档），量"进程内首次挂载内核"。
 * 与热切换（本文件的默认模式）分开报告：热切换走 keep-alive 复用宿主，量到的不是挂载成本。
 */
if (argv.includes("--cold")) {
  const atHome = await ev(`Boolean(document.querySelector(".mobile-htab")) && !document.querySelector(".mobile-workspace")`);
  if (!atHome) { console.error("--cold 需要先在首页（返回后再跑）"); ws.close(); process.exit(4); }
  await ev(arm);
  const t0 = Date.now();
  await tapCenter('.mobile-htab:nth-of-type(2)', 1200);
  await tapCenter(".nb-row, .nb-shelf-card", 1600);
  let coldMs = null;
  while (Date.now() - t0 < 30000) { const v = await ev("window.__km && window.__km.done"); if (typeof v === "number") { coldMs = v; break; } await sleep(80); }
  console.log(JSON.stringify({ mode: "cold", firstKernelMountMs: typeof coldMs === "number" ? Math.round(coldMs) : null, wallMs: Date.now() - t0 }, null, 2));
  ws.close();
  process.exit(0);
}

if (!(await ensureDocTree())) { console.error("文档树不可见：请先在界面上进入笔记本并打开文档树"); ws.close(); process.exit(3); }
const rows = await ev(`${TREE_ROWS}.map(function(e,i){return {i:i,label:(e.textContent||"").trim().slice(0,16)};})`);
console.log("可见文档树行：" + rows.length);

const results = [];
for (let k = 0; k < RUNS && k < rows.length; k += 1) {
  const row = rows[k];
  const pt = await ev(`${TREE_ROWS}[${row.i}] && (function(e){var r=e.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];})(${TREE_ROWS}[${row.i}])`);
  if (!pt) { results.push({ run: k + 1, row: row.i, label: row.label, skipped: "不可点" }); continue; }
  await ev(arm);
  await click(pt);
  const t0 = Date.now();
  let done = null;
  while (Date.now() - t0 < 20000) { done = await ev("window.__km && window.__km.done"); if (typeof done === "number") break; await sleep(80); }
  results.push({ run: k + 1, row: row.i, label: row.label, ms: typeof done === "number" ? Math.round(done) : null });
  await sleep(1200);
  if (!(await ev(`Boolean(document.querySelector(".side-panel--left.on .ln-row"))`))) await ensureDocTree();
}

const ok = results.filter((r) => typeof r.ms === "number").map((r) => r.ms).sort((a, b) => a - b);
console.log(JSON.stringify({ results, summary: ok.length ? { n: ok.length, min: ok[0], p50: ok[Math.floor(ok.length / 2)], max: ok[ok.length - 1] } : null }, null, 2));
ws.close();