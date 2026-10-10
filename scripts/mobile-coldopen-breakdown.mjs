/**
 * 冷开/首开分解：**三条"首次内核或轻量输入"路径**的对比测量（B4 收尾，261010）。
 *
 * 为什么量三条：语雀把小记做成"单独编辑器 + 离线包"，而我们已经有 `QuickNoteFlashComposer`（**不挂内核**）。
 * 要回答的问题是：**小记是否已经够快？内核是不是文档与小记的共同瓶颈？**
 *
 *   P1 深链小记  = `lakenotes://quick-note` → QuickNoteFlashComposer（**无内核**，textarea + 图片）
 *   P2 首页小记写作卡 = 首页底栏「新建小记」→ QuickNoteComposer（**挂内核**）
 *   P3 打开文档   = 知识库 → 书架 → 文档卡片（**挂内核**）
 *
 * 计时：页内 `performance.now()`（MutationObserver/轮询起止），不经 CDP 往返；
 * 另附**内核 chunk 的资源计时**（`LakeEditor-*.js` 等）看"加载/求值"占多少。
 *
 * 前提：App 已装并运行、`bash scripts/emu-cdp.sh 9335` 已转发。脚本会用 adb 触发深链（需 adb 在 PATH）。
 * 用法：node scripts/mobile-coldopen-breakdown.mjs [--port 9335] [--runs 2]
 */
import { execSync } from "node:child_process";

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(argOf("port", "9335"));
const RUNS = Number(argOf("runs", "2"));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.error("no page target（先 bash scripts/emu-cdp.sh " + PORT + "）"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return "ERR:" + r.result.exceptionDetails.text; return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async ([x, y]) => { await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); };
const tap = async (selector) => {
  const pt = await ev(`(function(){var e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;var r=e.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;var x=r.x+r.width/2,y=r.y+r.height/2;var h=document.elementFromPoint(x,y);if(!h||!(e===h||e.contains(h)||h.contains(e)))return null;return [Math.round(x),Math.round(y)];})()`);
  if (!pt) return false; await click(pt); return true;
};
const tapLabel = async (label) => {
  const pt = await ev(`(function(){var els=[].slice.call(document.querySelectorAll("button,[role=button],a"));for(var i=0;i<els.length;i++){var a=(els[i].getAttribute("aria-label")||"")+els[i].title+(els[i].textContent||"");if(a.indexOf(${JSON.stringify(label)})>=0){var r=els[i].getBoundingClientRect();if(r.width<=0||r.height<=0)continue;var x=r.x+r.width/2,y=r.y+r.height/2;var h=document.elementFromPoint(x,y);if(h&&(els[i]===h||els[i].contains(h)||h.contains(els[i])))return [Math.round(x),Math.round(y)];}}return null;})()`);
  if (!pt) return false; await click(pt); return true;
};
const waitFor = async (expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return Date.now() - t0; await sleep(60); } return null; };

/**
 * 页内布防：记录 t0，并等**内容签名变化**。
 * ⚠️ 不能等"元素出现"：标签宿主是 keep-alive，`.ne-editor-wrap` 早就挂在 DOM 里，
 *    存在性判据会立刻命中（实测给出 19ms 的**假**数字）。
 * 签名 = 所有内核宿主的 textContent 长度 + 宿主数；变化即"新文档内容就绪"。
 * kind=flash 时签名取 `[data-mobile-qn-flash]` 子树（轻量输入框无内核）。
 */
const arm = (kind) => ev(`(function(){
  window.__bdKind=${JSON.stringify(kind)};
  var sig=function(){
    if(window.__bdKind==="flash"){var f=document.querySelector("[data-mobile-qn-flash]");if(!f)return "none";var r=f.getBoundingClientRect();return (r.width>0?"v":"h")+":"+f.textContent.length;}
    var hs=[].slice.call(document.querySelectorAll(".ne-editor-wrap, .ne-viewer-body"));
    return hs.length+":"+hs.map(function(h){return h.textContent.length;}).join(",");
  };
  window.__bd={base:sig(),t0:performance.now(),done:null};
  if(window.__bdT){clearInterval(window.__bdT);}
  window.__bdT=setInterval(function(){ if(window.__bd.done===null && sig()!==window.__bd.base){ window.__bd.done=performance.now()-window.__bd.t0; clearInterval(window.__bdT);} },16);
  return true;})()`);
const readArmed = () => ev("window.__bd && window.__bd.done");
/** 内核 chunk 的资源计时（累计到当前文档）。 */
const resourceTimings = () => ev(`JSON.stringify(performance.getEntriesByType("resource").filter(function(e){return /LakeEditor|UniverSheetViewer|BitableViewer|DrawnixBoard/.test(e.name);}).map(function(e){return {f:e.name.split("/").pop(), start:Math.round(e.startTime), dur:Math.round(e.duration)};}))`);

/** 重置页面：reload 会清掉所有 keep-alive 宿主/实例 ⇒ 下一次打开是**真正的首次挂载**（bundle 走 HTTP 缓存）。 */
const resetPage = async () => {
  await send("Page.enable");
  await send("Page.reload", { ignoreCache: false });
  await waitFor(`Boolean(document.querySelector(".mobile-htab"))`, 20000);
  await sleep(400);
};

const goHome = async () => { for (let i = 0; i < 6; i += 1) { if (await ev(`Boolean(document.querySelector(".mobile-htab")) && !document.querySelector(".mobile-workspace") && !document.querySelector("[data-mobile-qn-flash]")`)) return true; if (await tapLabel("取消")) { await sleep(600); continue; } if (await tapLabel("返回")) { await sleep(800); continue; } break; } return await ev(`Boolean(document.querySelector(".mobile-htab"))`); };

const results = {};

// ── P1 深链小记（无内核）
const p1 = [];
for (let i = 0; i < RUNS; i += 1) {
  await resetPage();
  await arm("flash");
  try { execSync(`adb shell am start -a android.intent.action.VIEW -d "lakenotes://quick-note" com.lakenotes.mobile`, { stdio: "ignore" }); } catch { /* ignore */ }
  const t0 = Date.now(); let v = null;
  while (Date.now() - t0 < 8000) { v = await readArmed(); if (typeof v === "number") break; await sleep(60); }
  p1.push(typeof v === "number" ? Math.round(v) : null);
  await sleep(800);
}
results["P1 深链小记（无内核）"] = p1;

// ── P2 首页小记写作卡（挂内核）
const p2 = [];
for (let i = 0; i < RUNS; i += 1) {
  await resetPage();
  await tapLabel("小记"); await sleep(500);
  await arm("kernel");
  await tapLabel("新建小记");
  const t0 = Date.now(); let v = null;
  while (Date.now() - t0 < 20000) { v = await readArmed(); if (typeof v === "number") break; await sleep(60); }
  p2.push(typeof v === "number" ? Math.round(v) : null);
  await sleep(800);
}
results["P2 首页小记写作卡（内核）"] = p2;

// ── P3 打开文档（挂内核）
const p3 = [];
for (let i = 0; i < RUNS; i += 1) {
  await resetPage();
  await tapLabel("知识库"); await sleep(700);
  if (!(await ev(`document.querySelectorAll(".doc-card").length > 0`))) { await tapLabel("切换到书架"); await sleep(900); }
  await arm("kernel");
  const ok = await tap(".doc-card");
  if (!ok) { p3.push(null); continue; }
  const t0 = Date.now(); let v = null;
  while (Date.now() - t0 < 20000) { v = await readArmed(); if (typeof v === "number") break; await sleep(60); }
  p3.push(typeof v === "number" ? Math.round(v) : null);
  await sleep(800);
}
results["P3 打开文档（内核）"] = p3;

results["内核 chunk 资源计时（当前文档累计）"] = JSON.parse((await resourceTimings()) || "[]");
console.log(JSON.stringify(results, null, 2));
ws.close();