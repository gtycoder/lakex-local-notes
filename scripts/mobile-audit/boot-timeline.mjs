#!/usr/bin/env node
/**
 * 移动端冷启动时间线探针（261014 立；配合 AGENTS §7.31「页面优先」口径）。
 *
 * 为什么需要：冷启动"慢/快了"必须**量**而不是感觉 —— 261014 就是靠它定位到
 * 「入口静态图里有 6.1MB 内核 ⇒ modulepreload 45 条 ⇒ 真首页 6123ms」。
 *
 * 量的东西（标准 Performance API，不依赖我们的埋点）：
 *   · navigation: TTFB / DCL / load
 *   · paint: first-paint / first-contentful-paint
 *   · longtask: 逐个长任务（含时长）——"谁在抢主线程"的直接证据
 *   · 里程碑：bar=骨架胶囊 / native=桥就绪(window.lakeNative) / home=真首页(.mobile-htab)
 *
 * 用法（先起 App + 转发 CDP；脚本会 addScriptToEvaluateOnNewDocument 后 reload 一次）：
 *   bash scripts/emu-cdp.sh 9336
 *   node scripts/mobile-audit/boot-timeline.mjs 9336            # 正常
 *   node scripts/mobile-audit/boot-timeline.mjs 9336 --no-idle  # A/B：idle 回调置空（预热/后台同步都不跑）
 */
const port = Number(process.argv[2] || 9336);
const noIdle = process.argv.includes("--no-idle");
const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.error("no page target（App 起了吗？cdp 转了吗？）"); process.exit(1); }
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
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error("timeout " + method)); } }, 30000);
});
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Page.enable"); await send("Runtime.enable");
const instrument = [
  noIdle ? "window.requestIdleCallback = function () { return 0; }; window.cancelIdleCallback = function () {};" : "",
  "window.__boot = { marks: [] };",
  "(function () {",
  "  var mark = function (k) { try { window.__boot.marks.push([k, Math.round(performance.now())]); } catch (e) {} };",
  "  document.addEventListener('DOMContentLoaded', function () { mark('dcl'); });",
  "  window.addEventListener('load', function () { mark('load'); });",
  "  try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { mark('longtask:' + Math.round(e.duration)); }); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}",
  "  try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { mark('paint:' + e.name + ':' + Math.round(e.startTime)); }); }).observe({ type: 'paint', buffered: true }); } catch (e) {}",
  "  var iv = setInterval(function () {",
  "    try {",
  "      if (!window.__boot.bar && document.querySelector('.mobile-bottom-bar')) window.__boot.bar = Math.round(performance.now());",
  "      if (!window.__boot.native && window.lakeNative) window.__boot.native = Math.round(performance.now());",
  "      if (!window.__boot.home && document.querySelector('.mobile-htab')) window.__boot.home = Math.round(performance.now());",
  "    } catch (e) {}",
  "  }, 20);",
  "  setTimeout(function () { clearInterval(iv); }, 20000);",
  "})();",
].join("\n");
await send("Page.addScriptToEvaluateOnNewDocument", { source: instrument });
await send("Page.reload", { ignoreCache: false });
await sleep(9000);
console.log("时间线（相对导航开始，ms；bar=骨架胶囊 / native=桥就绪 / home=真首页）");
console.log(await evaluate("JSON.stringify(window.__boot)"));
console.log("navigation:", await evaluate("JSON.stringify((function(){var n=performance.getEntriesByType('navigation')[0];return n?{ttfb:Math.round(n.responseStart),dcl:Math.round(n.domContentLoadedEventEnd),load:Math.round(n.loadEventEnd)}:null;})())"));
if (noIdle) console.log("（--no-idle：requestIdleCallback 置空 ⇒ 兼容预热与后台同步均未跑）");
process.exit(0);
