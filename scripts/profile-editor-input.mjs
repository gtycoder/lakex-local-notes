#!/usr/bin/env node
/**
 * opt-in：长正文"按键 → 序列化 → dirty → 保存" profile（审计 §6.1 输入全量序列化）。
 * 不改产品代码，只测量。隔离 userData/端口 + owned child。
 * 用法：node scripts/profile-editor-input.mjs
 *   LAKE_PROFILE_SIZES="0,0.5,2"   正文大小（MB）
 *   LAKE_PROFILE_CHARS=30          每篇连续输入字符数
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const port = Number(process.env.LAKE_CDP_PORT || 9371);
const assetPort = String(Number(process.env.LAKE_ASSET_PORT || 29897));
const dataDir = "/tmp/lake-profile-input-" + Date.now();
const appPath = path.resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const sizesMB = (process.env.LAKE_PROFILE_SIZES || "0,0.5,2").split(",").map(Number).filter(function (n) { return !isNaN(n); });
const chars = Number(process.env.LAKE_PROFILE_CHARS || 30);
const NL = String.fromCharCode(10);
let child = null;
let socket = null;
let seq = 0;
const pending = new Map();
const noteIds = [];
const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
async function connect() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const t = (await (await fetch("http://127.0.0.1:" + port + "/json/list")).json()).find(function (x) { return x.type === "page"; });
      if (t) {
        socket = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise(function (res, rej) { socket.onopen = res; socket.onerror = rej; });
        socket.onmessage = function (ev) { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
        return;
      }
    } catch (e) { /* retry */ }
    await wait(250);
  }
  throw new Error("CDP 未就绪: " + port);
}
function send(method, params) { return new Promise(function (res) { const id = ++seq; pending.set(id, res); socket.send(JSON.stringify({ id: id, method: method, params: params || {} })); }); }
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression: expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) { const ex = r.result.exceptionDetails; throw new Error("evaluate: " + ((ex.exception && ex.exception.description) || ex.text)); }
  return r.result ? r.result.result.value : undefined;
}
async function waitFor(expr, timeout) { const d = Date.now() + (timeout || 20000); while (Date.now() < d) { try { if (await evaluate(expr)) return true; } catch (e) {} await wait(150); } return false; }
async function quit() { try { if (child) child.kill("SIGTERM"); } catch (e) {} const ex = await Promise.race([ new Promise(function (r) { if (child) child.once("exit", function () { r(true); }); }), wait(8000).then(function () { return false; }) ]); if (!ex) { try { if (child) child.kill("SIGKILL"); } catch (e) {} } await wait(300); }
function stats(arr) {
  if (!arr.length) return { n: 0 };
  const s = arr.slice().sort(function (a, b) { return a - b; });
  const pick = function (q) { return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
  return { n: s.length, min: +s[0].toFixed(2), median: +pick(0.5).toFixed(2), p95: +pick(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2), mean: +(s.reduce(function (a, b) { return a + b; }, 0) / s.length).toFixed(2) };
}

const INJECT = [
  "(function(){",
  "  window.__prof = { longtasks: [] };",
  "  try { new PerformanceObserver(function(list){ list.getEntries().forEach(function(e){ window.__prof.longtasks.push(Math.round(e.duration)); }); }).observe({ entryTypes: ['longtask'] }); } catch(e){}",
  "  window.__prof.engine = function(){ var eds=Array.prototype.slice.call(document.querySelectorAll('.ne-editor')).filter(function(e){ return e.getBoundingClientRect().height>0; }); var e=eds[0]; return e? e.querySelector('.ne-engine') : null; };",
  "  window.__prof.paraRect = function(){ var en=window.__prof.engine(); if(!en) return null; var p=en.querySelector('ne-p')||en; var r=p.getBoundingClientRect(); return { x: Math.round(r.left+Math.min(30,r.width/2)), y: Math.round(r.top+Math.min(12,r.height/2)) }; };",
  "  window.__prof.makeContent = function(bytes){ var per='<p>'+Array(181).join('x')+'</p>'; var n=Math.ceil(bytes/per.length); var out=''; for(var i=0;i<n;i++) out+=per; return out; };",
  "  window.__prof.status = function(){ var el=document.querySelector('.document-statusbar'); return el? el.innerText : ''; };",
  "  window.__prof.count = function(){ var en=window.__prof.engine(); return en? (en.innerText||'').length : -1; };",
  "  return true;",
  "})()",
].join(NL);

try {
  const env = Object.assign({}, process.env, { LAKE_RENDERER: "scheme", LAKE_USER_DATA: dataDir, LAKE_ASSET_PORT: assetPort });
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(appPath, [".", "--remote-debugging-port=" + port, "--disable-gpu", "--no-sandbox"], { env: env, stdio: "ignore" });
  await connect(); await send("Runtime.enable"); await send("Page.enable");
  await waitFor("document.readyState === 'complete' && Boolean(window.lakeNative)", 40000);
  await evaluate(INJECT);

  const results = [];
  for (const mb of sizesMB) {
    const bytes = Math.round(mb * 1024 * 1024);
    const row = { sizeMB: mb, bytes: bytes };
    try {
      const createT0 = Date.now();
      const noteId = await evaluate("(async function(){ var api=window.lakeNative; var n=await api.createNote('PROF-" + mb + "MB'); var c=window.__prof.makeContent(" + bytes + "); await api.saveNote(n.id, n.title, c, null); return n.id; })()");
      row.createMs = Date.now() - createT0;
      noteIds.push(noteId);
      row.noteId = noteId;
      const rowDeadline = Date.now() + 20000;
      let rowFound = false;
      while (Date.now() < rowDeadline) { rowFound = await evaluate("Boolean(Array.prototype.find.call(document.querySelectorAll('[data-tree-node-id]'), function(x){ return x.getAttribute('data-tree-node-id')===" + JSON.stringify(noteId) + "; }))"); if (rowFound) break; await wait(200); }
      const openT0 = Date.now();
      await evaluate("(function(){ var r=Array.prototype.find.call(document.querySelectorAll('[data-tree-node-id]'), function(x){ return x.getAttribute('data-tree-node-id')===" + JSON.stringify(noteId) + "; }); if(r) r.click(); return true; })()");
      await waitFor("window.__prof.engine() !== null", 90000);
      row.openMs = Date.now() - openT0;
      await wait(1500);
      // 聚焦编辑区
      const rectRaw = await evaluate("JSON.stringify(window.__prof.paraRect())");
      if (rectRaw) {
        const rect = JSON.parse(rectRaw);
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
        await wait(300);
      }
      // warmup
      await evaluate("(function(){ for(var i=0;i<5;i++) document.execCommand('insertText', false, 'w'); return true; })()");
      await wait(300);
      const before = await evaluate("window.__prof.count()");
      await evaluate("window.__prof.longtasks.length = 0; true");
      // page-side 单字符计时（隔离 CDP 往返）
      const times = JSON.parse(await evaluate("(function(){ var t=[]; for(var i=0;i<" + chars + ";i++){ var t0=performance.now(); document.execCommand('insertText', false, 'x'); t.push(performance.now()-t0); } return JSON.stringify(t); })()"));
      const after = await evaluate("window.__prof.count()");
      row.changed = before >= 0 && after > before;
      row.perCharMs = stats(times);
      row.longtasks = await evaluate("JSON.stringify(window.__prof.longtasks)");
      // Node 侧 CDP 往返（真实 Input.insertText）
      const rt = [];
      for (let i = 0; i < 8; i++) { const t0 = performance.now(); await send("Input.insertText", { text: "y" }); rt.push(performance.now() - t0); }
      row.roundTripMs = stats(rt);
      // dirty 延迟
      const dirtyT0 = Date.now();
      const dirty = await waitFor("window.__prof.status().indexOf('待保存') >= 0", 5000);
      row.dirtyVisible = dirty; row.dirtyMs = dirty ? Date.now() - dirtyT0 : null;
      // 保存 ack：等状态出现"已保存"/"同步"
      const saveOk = await waitFor("!/待保存/.test(window.__prof.status()) && /保存|同步|已/.test(window.__prof.status())", 15000);
      row.saveSettled = saveOk;
    } catch (e) {
      row.error = String(e && e.message || e).slice(0, 300);
    }
    results.push(row);
    console.log("PROFILE " + JSON.stringify(row));
  }
  console.log(NL + "SUMMARY " + JSON.stringify({ sizesMB: sizesMB, chars: chars, results: results }, null, 2));
} catch (error) {
  console.error("profile error:", error && error.stack ? error.stack : error);
  process.exitCode = 2;
} finally {
  try { if (noteIds.length) await evaluate("(async function(){ for (const id of " + JSON.stringify(noteIds) + ") { try { await window.lakeNative.deleteNote(id); } catch(e){} } return true; })()"); } catch (e) {}
  await quit();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
}
