#!/usr/bin/env node
/**
 * A3 目录栏悬停召唤 —— 真实指针 e2e（260923 W5 的行为基线/护栏）。
 * 前置：热区只在**非固定态**（collapsed）可交互 ⇒ 先 ⌘] 收起再测。
 * 断言序列（与改动前逐项同值，时序对齐代码常量）：
 *   ① 收起态且指针在正文 ⇒ 无把手
 *   ② 进入左缘热区 ⇒ 立刻出现跟手把手（.edge-hotzone.is-active）
 *   ③ 驻留 < EDGE_HANDLE_DWELL_MS(240ms) ⇒ 仍不浮出
 *   ④ 驻留 ≥ 240ms ⇒ 浮出（.sidebar-floating，left:0）
 *   ⑤ 指针移入面板（走廊并集）⇒ 保持悬浮
 *   ⑥ 指针移到正文 ⇒ 经 SIDEBAR_HOVER_HIDE_DELAY_MS(220ms) 后收起
 *   ⑦ 重新召唤后点把手 ⇒ 固定（.sidebar-docked）
 *   ⑧ ⌘] ⇒ 收起；再 ⌘] ⇒ 复原固定（可重复运行）
 * 用法：LAKE_CDP_PORT=9231 node scripts/e2e-sidebar-hover.mjs
 * ⚠️ 必须在**普通文档**上运行：board 文档的 drawnix 会插入全屏 `.laser-pointer`
 *    （fixed/inset:0/z-index:2022/pointer-events:auto），从 (5,120) 起就命中它，左缘热区收不到指针事件（既有行为）。
 */
const port = Number(process.env.LAKE_CDP_PORT || 9222);
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find((t) => t.type === "page");
if (!target) throw new Error(`没有找到 CDP page（端口 ${port}）`);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
let id = 0; const pending = new Map();
socket.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); socket.send(JSON.stringify({ id: i, method, params })); });
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text || "eval failed");
  return r.result?.result?.value;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(expr, timeout = 12000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await evaluate(expr)) return; await wait(60); } throw new Error("等待超时: " + expr); }
const mouse = (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
const move = (x, y) => mouse("mouseMoved", x, y);
const click = async (x, y) => { await move(x, y); await mouse("mousePressed", x, y); await mouse("mouseReleased", x, y); };
const cmdBracket = async () => {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers: 4, key: "]", code: "BracketRight", windowsVirtualKeyCode: 221, nativeVirtualKeyCode: 221 });
  await wait(60);
  await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 4, key: "]", code: "BracketRight", windowsVirtualKeyCode: 221, nativeVirtualKeyCode: 221 });
};
const mode = () => evaluate("(document.querySelector('.app-shell')?.className || '').match(/sidebar-(\\w+)/)?.[1] || ''");
const handleOn = () => evaluate("Boolean(document.querySelector('.edge-hotzone.is-active'))");
const isMode = (m) => `(document.querySelector('.app-shell')?.className||'').includes('sidebar-${m}')`;

await send("Runtime.enable"); await send("Page.enable"); await send("Page.bringToFront");
await waitFor("Boolean(document.querySelector('.sidebar') && document.querySelector('.edge-hotzone'))");
// 自愈到「固定」态（collapsed/floating ⇒ ⌘] 一次即 docked）
await move(700, 320); await wait(300);
if ((await mode()) !== "docked") { await cmdBracket(); await waitFor(isMode("docked")); }
// 收起（热区只在非固定态生效）
await cmdBracket(); await waitFor(isMode("collapsed"));
const results = {};
// ① 指针在正文 ⇒ 无把手
await move(700, 320); await wait(300);
results.away = { mode: await mode(), handle: await handleOn() };
// ②③④ 进热区
await move(5, 120);
await waitFor("Boolean(document.querySelector('.edge-hotzone.is-active'))", 1500);
results.entered = { handle: await handleOn(), modeEarly: await mode() };
await waitFor(isMode("floating"), 2500);
results.afterDwell = { mode: await mode(), left: await evaluate("Math.round(document.querySelector('.sidebar-floating')?.getBoundingClientRect().left ?? -1)") };
// ⑤ 移入面板 ⇒ 保持悬浮
await move(60, 200); await wait(320);
results.insidePanel = await mode();
// ⑥ 移到正文 ⇒ 220ms 后收起
await move(700, 320); await wait(500);
results.afterLeave = await mode();
// ⑦ 收起态进热区后**立刻**点把手 ⇒ 固定（面板浮出后会盖住把手，故必须在 240ms 窗口内点）
await move(5, 140); await click(5, 140); await wait(340);
results.afterHandleClick = await mode();
// ⑧ 先把指针移出热区（否则 ⌘] 收起后驻留会立刻把它重新唤成浮层），再 ⌘] 收起 ⇒ 再 ⌘] 复原固定
await move(700, 320); await wait(320);
await cmdBracket(); await waitFor(isMode("collapsed"));
results.cmdBracket1 = await mode();
await cmdBracket(); await waitFor(isMode("docked"));
results.cmdBracket2 = await mode();
await move(700, 320); await wait(320);

const fail = [];
if (results.away.handle) fail.push("① 收起态指针在正文却有把手");
if (!results.entered.handle) fail.push("② 进入热区未立刻出现把手");
if (results.entered.modeEarly === "floating") fail.push("③ 未到 240ms 就浮出");
if (!String(results.afterDwell.mode).includes("floating")) fail.push("④ 驻留后未浮出");
if (results.afterDwell.left !== 0) fail.push("④ 悬浮面板未贴左缘");
if (results.insidePanel !== "floating") fail.push("⑤ 面板内却收起（走廊并集失效）");
if (results.afterLeave !== "collapsed") fail.push("⑥ 移到正文后未收起");
if (results.afterHandleClick !== "docked") fail.push("⑦ 点把手未固定");
if (results.cmdBracket1 !== "collapsed") fail.push("⑧ ⌘] 未收起");
if (results.cmdBracket2 !== "docked") fail.push("⑧ 再 ⌘] 未复原固定");
console.log(JSON.stringify(results, null, 2));
if (fail.length) { console.error("FAIL:\n  " + fail.join("\n  ")); process.exit(1); }
console.log("PASS: A3 悬停召唤序列（8 项）");
socket.close();
