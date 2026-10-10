/**
 * F16 收尾验收：**弱网下"同步进行中的本地写"不得被网络阻塞**。
 *
 * 口径严格照 HANDOFF §3#12 的实测方法（同一入口、同一量法，便于与旧值 152.0s 对比）：
 *   `window.lakeNative.syncNow()` 起整轮同步 → 等 250ms 让它进入队列 → 发一次本地写 →
 *   量**这次写**的完成耗时；同法先量"无同步时"的基线写。页内 performance.now() 计时。
 *
 * 判据：写等待应回到基线量级（数十毫秒），**不随同步时长增长**。
 * 旧实现（两域共用一条 key="main" 的队列）实测：弱网 68 篇/40 对象 → 同步 152.3s，写等待 **152.0s**（基线 32ms）。
 *
 * ⚠️ 会新建 2 篇探针文档（`F16 验收 A/B`，挂到同一父）。按 AGENTS §4 **不自动删除**：脚本会打印其 id，
 *    要清理请自行删除。
 * 用法：node scripts/mobile-f16-acceptance.mjs [--port 9335]
 */

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(argOf("port", "9335"));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.error("no page target"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");
const ev = async (x) => {
  const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!(await ev("typeof window.lakeNative === 'object'"))) { console.error("window.lakeNative 不存在"); process.exit(3); }

// 取一个合法父（移动端文档必须挂在笔记本下）
const parentId = await ev(`(async()=>{const ns=await window.lakeNative.listNotes();return (ns.find(n=>n.parentId)||{}).parentId||null;})()`);
if (!parentId) { console.error("取不到 parentId（库为空？）"); process.exit(4); }

/** 页内计时一次写操作。 */
const timedWrite = (title) => ev(`(async()=>{
  const t0=performance.now();
  const id=await window.lakeNative.createNote(${JSON.stringify(title)}, ${JSON.stringify(parentId)});
  return { ms: Math.round(performance.now()-t0), id };
})()`);

console.log("父笔记本:", parentId);
const before = await ev("(async()=>(await window.lakeNative.listNotes()).length)()");

// ① 基线写（无同步）
const baseline = await timedWrite("F16 验收 A");
await sleep(400);

// ② 起整轮同步（不 await），250ms 后发写
await ev(`window.__f16={t0:performance.now(),p:window.lakeNative.syncNow()}; "go"`);
await sleep(250);
const during = await timedWrite("F16 验收 B");

// ③ 等同步收尾，读它的总时长与结论
const sync = await ev(`window.__f16.p.then(r=>({ms:Math.round(performance.now()-window.__f16.t0),message:String((r&&r.message)||"").slice(0,90)})).catch(e=>({ms:Math.round(performance.now()-window.__f16.t0),message:"ERR "+String(e).slice(0,80)}))`);
const after = await ev("(async()=>(await window.lakeNative.listNotes()).length)()");

const verdict = {
  baselineWriteMs: baseline.ms,
  writeDuringSyncMs: during.ms,
  syncRoundMs: sync.ms,
  // 旧实现里这两个数几乎相等（写等待 = 整轮同步）；新实现里写等待应远小于同步时长
  ratioWriteToSync: sync.ms > 0 ? Math.round((during.ms / sync.ms) * 1000) / 1000 : null,
  blockedBySync: during.ms >= Math.max(1000, sync.ms * 0.5),
};
console.log(JSON.stringify({
  baseline: { ms: baseline.ms, id: baseline.id },
  duringSync: { ms: during.ms, id: during.id },
  sync,
  notesBefore: before, notesAfter: after,
  verdict,
}, null, 2));
ws.close();