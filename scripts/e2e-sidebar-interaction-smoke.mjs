#!/usr/bin/env node
/** Real-pointer smoke for tab motion and library controls. Start npm run dev first. */
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
  return new Promise((resolve) => { const requestId = ++id; pending.set(requestId, resolve); socket.send(JSON.stringify({ id: requestId, method, params })); });
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
    if (await evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`等待超时: ${expression}`);
}
async function mouse(type, x, y, button = "left") {
  await send("Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1 });
}
async function clickRect(rect) {
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await mouse("mouseMoved", x, y);
  await mouse("mousePressed", x, y);
  await mouse("mouseReleased", x, y);
}

await send("Runtime.enable");
await send("Page.enable");
await send("Page.bringToFront");
await waitFor('Boolean(document.querySelector(".sidebar") && document.querySelector(".sidebar-toolbar-row"))');
// 260923：活动栏已下线 ⇒ 用 ⌘]（toggleSidebarDock，见 PANEL-CONTRACT §5）恢复「固定」态。
// 本脚本会把自己留在「收起」态，所以每次开跑先自愈，保证可重复运行（状态泄漏曾是本脚本的坑）。
if (!(await evaluate('Boolean(document.querySelector(".app-shell")?.classList.contains("sidebar-docked"))'))) {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers: 4, key: "]", code: "BracketRight", windowsVirtualKeyCode: 221, nativeVirtualKeyCode: 221 });
  await wait(70);
  await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 4, key: "]", code: "BracketRight", windowsVirtualKeyCode: 221, nativeVirtualKeyCode: 221 });
  await waitFor('Boolean(document.querySelector(".app-shell")?.classList.contains("sidebar-docked"))');
}

// 260923：目录栏头部的搜索框已随 UI 重设计移除（全局搜索移到顶栏，见提交 85a4ed5；src 已无 .search-box）
// ⇒ 原「固定资料库搜索未命中」用例删除；顶栏搜索的无障碍/行为断言由 e2e-electron-smoke.mjs 覆盖。

const fixedButtons = await evaluate(`JSON.stringify([...document.querySelectorAll('.sidebar-docked .sidebar-toolbar-row > .list-heading > button, .sidebar-docked .sidebar-toolbar-row > .list-heading > .create-menu-wrap > .create-btn')].map((button)=>({ title: button.title, rect: button.getBoundingClientRect().toJSON(), disabled: button.disabled })))`);
for (const button of JSON.parse(fixedButtons)) {
  if (button.disabled) continue;
  // 📌 会切走「固定」态（本用例接着要测固定态），其余按钮点完都必须仍是 docked（260923）。
  if ((button.title || '').includes('固定')) continue;
  await clickRect(button.rect);
  if (button.title.includes('全文搜索')) {
    await wait(120);
    await evaluate(`document.querySelector('.search-panel-close')?.click(); true`);
    await wait(120);
  }
}
await wait(80);
await evaluate(`document.querySelector('.create-menu-wrap > button')?.click(); true`);
await wait(80);
const fixedButtonsResult = await evaluate(`JSON.stringify({ buttons: [...document.querySelectorAll('.sidebar-docked .sidebar-toolbar-row > .list-heading > button, .sidebar-docked .sidebar-toolbar-row > .list-heading > .create-menu-wrap > .create-btn')].map(b=>({title:b.title,rect:b.getBoundingClientRect().toJSON()})), mode: document.querySelector('.app-shell')?.className || '', menu: Boolean(document.querySelector('.create-menu')), toolbar: Boolean(document.querySelector('.sidebar-toolbar-row')) })`);
await evaluate(`document.querySelector('.create-menu-wrap > button')?.click(); true`);

// Switch to collapsed, enter the rail, then move into toolbar: it must remain floating.
// 260923：活动栏已下线 ⇒ 改用面板头 📌 把「固定」切成「收起」（PANEL-CONTRACT §3 记录的可靠入口）。
await evaluate(`document.querySelector('.sidebar-docked .pin-btn')?.click(); true`);
await wait(200);
// A3 冻结交互：隐形热区 **10px** + 驻留 **240ms** 才浮出预览 ⇒ 悬停点必须在热区内、等待必须 > 240ms。
await mouse("mouseMoved", 5, 120);
await wait(450);
const floatingToolbarRect = await evaluate(`document.querySelector('.sidebar-floating .sidebar-toolbar-row')?.getBoundingClientRect()?.toJSON()`);
if (!floatingToolbarRect) throw new Error("悬浮资料库工具栏不存在（热区 10px / 驻留 240ms 契约）");
await mouse("mouseMoved", floatingToolbarRect.x + 25, floatingToolbarRect.y + 20);
await wait(80);
const floating = await evaluate(`JSON.stringify({ mode: document.querySelector('.app-shell')?.className || '', toolbar: Boolean(document.querySelector('.sidebar-floating .sidebar-toolbar-row')), hitToolbar: Boolean(document.elementFromPoint(${floatingToolbarRect.x + 25},${floatingToolbarRect.y + 20})?.closest('.sidebar-toolbar-row')), hit: document.elementFromPoint(${floatingToolbarRect.x + 25},${floatingToolbarRect.y + 20})?.tagName || '', panelLeft: Math.round(document.querySelector('.sidebar-floating')?.getBoundingClientRect().left ?? -1) })`);

const result = {
  fixedButtons: JSON.parse(fixedButtonsResult),
  floating: JSON.parse(floating),
};
console.log(JSON.stringify(result, null, 2));
// 260923：原「tab 快速动画契约」（viewTransitionName=note-pane + 55ms/85ms 字符串）已随 UI 重设计移除
// （src 已无 view-transition / 这些字符串）⇒ 删该断言；保留活契约：固定态按钮齐全、悬浮态生命周期、面板贴左缘。
if (!result.fixedButtons.mode.includes('sidebar-docked') || result.fixedButtons.buttons.length < 4) throw new Error("固定资料库按钮未命中");
if (!result.floating.mode.includes('sidebar-floating') || !result.floating.hitToolbar) throw new Error("悬浮资料库顶部命中或生命周期失败");
if (result.floating.panelLeft !== 0) throw new Error("悬浮面板必须贴左缘 left:0（PANEL-CONTRACT §3）");
// 收尾把侧栏恢复「固定」：否则下次运行从「收起」态开始（本脚本自身依赖 docked 起步）。
if (!(await evaluate('Boolean(document.querySelector(".app-shell")?.classList.contains("sidebar-docked"))'))) {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers: 4, key: "]", code: "BracketRight", windowsVirtualKeyCode: 221, nativeVirtualKeyCode: 221 });
  await wait(70);
  await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 4, key: "]", code: "BracketRight", windowsVirtualKeyCode: 221, nativeVirtualKeyCode: 221 });
  await wait(300);
}
await evaluate("location.reload(); true");
await wait(600);
socket.close();
