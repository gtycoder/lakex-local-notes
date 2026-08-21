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
if (!(await evaluate('Boolean(document.querySelector(".app-shell")?.classList.contains("sidebar-docked"))'))) {
  const activityRect = await evaluate('document.querySelectorAll(".activity-button")[0]?.getBoundingClientRect()?.toJSON()');
  if (!activityRect) throw new Error("资料库 activity button 不存在");
  await clickRect(activityRect);
  await waitFor('Boolean(document.querySelector(".app-shell")?.classList.contains("sidebar-docked"))');
}

const searchRect = await evaluate(`document.querySelector('.sidebar-docked .search-box input')?.getBoundingClientRect()?.toJSON()`);
if (!searchRect) throw new Error("固定资料库搜索框不存在");
await clickRect(searchRect);
await wait(120);
const fixedHit = await evaluate(`(()=>{ const input=document.querySelector('.sidebar-docked .search-box input'); const r=input?.getBoundingClientRect(); const hit=r ? document.elementFromPoint(r.x+r.width/2,r.y+r.height/2) : null; input?.focus(); return { hitInput: hit === input || Boolean(hit?.closest('.search-box')) }; })()`);
await send("Input.insertText", { text: "pointer" });
const fixedSearch = await evaluate(`JSON.stringify({ mode: document.querySelector('.app-shell')?.className || '', value: document.querySelector('.sidebar-docked .search-box input')?.value || '', focused: document.activeElement === document.querySelector('.sidebar-docked .search-box input'), pointer: getComputedStyle(document.querySelector('.sidebar-docked .search-box input')).pointerEvents, hitInput: ${JSON.stringify(fixedHit.hitInput)} })`);
await evaluate(`(()=>{ const input=document.querySelector('.sidebar-docked .search-box input'); if(input){ input.focus(); input.value=''; input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'})); } return true; })()`);

const fixedButtons = await evaluate(`JSON.stringify([...document.querySelectorAll('.sidebar-docked .sidebar-toolbar-row .list-heading button')].map((button)=>({ title: button.title, rect: button.getBoundingClientRect().toJSON(), disabled: button.disabled })))`);
for (const button of JSON.parse(fixedButtons).slice(0, 3)) {
  if (!button.disabled) await clickRect(button.rect);
}
const createRect = await evaluate(`document.querySelector('.sidebar-docked .create-btn')?.getBoundingClientRect()?.toJSON()`);
if (createRect) await clickRect(createRect);
await wait(80);
const fixedButtonsResult = await evaluate(`JSON.stringify({ buttons: [...document.querySelectorAll('.sidebar-docked .sidebar-toolbar-row .list-heading button')].map(b=>({title:b.title,rect:b.getBoundingClientRect().toJSON()})), mode: document.querySelector('.app-shell')?.className || '', menu: Boolean(document.querySelector('.create-menu')), toolbar: Boolean(document.querySelector('.sidebar-toolbar-row')) })`);
await evaluate(`document.querySelector('.create-menu-wrap > button')?.click(); true`);

// Switch to collapsed, enter the rail, then move into toolbar: it must remain floating.
await evaluate(`document.querySelector('.activity-button[aria-label="资料库"]')?.click(); true`);
await wait(180);
await mouse("mouseMoved", 20, 120);
await wait(180);
const floatingToolbarRect = await evaluate(`document.querySelector('.sidebar-floating .sidebar-toolbar-row')?.getBoundingClientRect()?.toJSON()`);
if (!floatingToolbarRect) throw new Error("悬浮资料库工具栏不存在");
await mouse("mouseMoved", floatingToolbarRect.x + 25, floatingToolbarRect.y + 20);
await wait(80);
const floating = await evaluate(`JSON.stringify({ mode: document.querySelector('.app-shell')?.className || '', toolbar: Boolean(document.querySelector('.sidebar-floating .sidebar-toolbar-row')), hitToolbar: Boolean(document.elementFromPoint(${floatingToolbarRect.x + 25},${floatingToolbarRect.y + 20})?.closest('.sidebar-toolbar-row')), hit: document.elementFromPoint(${floatingToolbarRect.x + 25},${floatingToolbarRect.y + 20})?.tagName || '' })`);

// Static transition contract: avoid relying on a full page screenshot for timing.
const transition = await evaluate(`JSON.stringify({
  name: getComputedStyle(document.querySelector('.tab-panels')).viewTransitionName,
  css: [...document.styleSheets].flatMap(sheet=>{ try{return [...sheet.cssRules].map(rule=>rule.cssText)}catch{return[]} }).join(' ')
})`);
const transitionData = JSON.parse(transition);
const result = {
  fixed: JSON.parse(fixedSearch),
  fixedButtons: JSON.parse(fixedButtonsResult),
  floating: JSON.parse(floating),
  transition: { name: transitionData.name, fastOld: transitionData.css.includes('55ms ease-in'), fastNew: transitionData.css.includes('85ms ease-out') },
};
console.log(JSON.stringify(result, null, 2));
if (!result.fixed.mode.includes('sidebar-docked') || !result.fixed.value.includes('pointer') || !result.fixed.focused) throw new Error("固定资料库搜索未命中");
if (!result.fixedButtons.mode.includes('sidebar-docked') || result.fixedButtons.buttons.length !== 4) throw new Error("固定资料库按钮未命中");
if (!result.floating.mode.includes('sidebar-floating') || !result.floating.hitToolbar) throw new Error("悬浮资料库顶部命中或生命周期失败");
if (result.transition.name !== 'note-pane' || !result.transition.fastOld || !result.transition.fastNew) throw new Error("tab 切换快速动画契约缺失");
socket.close();
