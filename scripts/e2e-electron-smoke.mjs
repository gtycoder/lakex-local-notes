#!/usr/bin/env node
/**
 * Lightweight Electron smoke test. Start `npm run dev` first; this script only
 * talks to the existing CDP page and never mutates note content.
 */
import fs from "node:fs/promises";

const port = Number(process.env.LAKE_CDP_PORT || 9222);
const outputDir = process.env.LAKE_UI_EVIDENCE_DIR || "/tmp/lake-notes-ui-smoke";
await fs.mkdir(outputDir, { recursive: true });
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((target) => target.type === "page");
if (!page) throw new Error(`没有找到 CDP page（端口 ${port}）`);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
};
function send(method, params = {}) { return new Promise((resolve) => { const requestId = ++id; pending.set(requestId, resolve); socket.send(JSON.stringify({ id: requestId, method, params })); }); }
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text || "Runtime.evaluate failed");
  const value = result.result?.result?.value;
  if (value === undefined) throw new Error("Runtime.evaluate returned undefined");
  return value;
}
async function screenshot(name) { const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true }); await fs.writeFile(`${outputDir}/${name}.png`, Buffer.from(result.result.data, "base64")); }
async function wait(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }

await send("Runtime.enable");
await send("Page.enable");
await send("Page.bringToFront");
await wait(1200);
const baseline = await evaluate(`JSON.stringify({
  title: document.title,
  theme: document.documentElement.dataset.theme,
  viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
  nodes: document.querySelectorAll('*').length,
  toolbarButtons: document.querySelectorAll('.ne-ui-toolbar button').length,
  drawnixJs: performance.getEntriesByType('resource').map(e => e.name).filter(n => /drawnix|plait/i.test(n) && (n.endsWith('.js') || n.includes('.js?'))),
  status: document.querySelector('.document-statusbar')?.innerText || '',
  workspace: document.querySelector('[aria-label="工作空间"]')?.innerText || '',
  railWidths: {
    left: document.querySelector('.activity-rail')?.getBoundingClientRect().width,
    right: document.querySelector('.outline-sidebar')?.getBoundingClientRect().width,
  }
})`);
await screenshot("01-baseline");

await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }))`);
await wait(500);
const search = await evaluate(`JSON.stringify({ open: Boolean(document.querySelector('.search-command-panel')), focused: document.activeElement?.matches('.search-command-panel input') })`);
await screenshot("02-search");
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
await wait(150);

await evaluate(`(()=>{document.querySelector('.sync-status-button')?.click(); return true})()`);
await wait(200);
const sync = await evaluate(`JSON.stringify({ open: Boolean(document.querySelector('.sync-status-popover')), text: document.querySelector('.sync-status-popover')?.innerText || '' })`);
await screenshot("03-sync-popover");
await evaluate(`(()=>{document.querySelector('.sync-status-button')?.click(); return true})()`);

const result = { baseline: JSON.parse(baseline), search: JSON.parse(search), sync: JSON.parse(sync) };
await fs.writeFile(`${outputDir}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
socket.close();
