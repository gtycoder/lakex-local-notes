#!/usr/bin/env node
/**
 * 非多维表审计 S0 桌面真实端验收（隔离 userData/端口；owned child 精确收尾，绝不碰正式数据）。
 * 覆盖桌面可达的 S0 面：
 *   F04 写边界：回收站 / 已 purge 笔记的普通保存被真实 IPC+SQLite 拒绝；显式恢复后可继续写。
 *   F04 数据态：恢复一篇不改写仍在回收站的另一篇（tab 只读判定由 jsdom 行为测试覆盖）。
 *   F01 关闭闸：renderer 端 saveNote 失败（.lake 被移走 → NotFound）时脏标签不关闭。
 *   F01/F02 非回归：正常输入 → 自动保存落盘；干净标签正常关闭。
 * 用法：node scripts/e2e-audit-s0.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const port = Number(process.env.LAKE_CDP_PORT || 9361);
const assetPort = String(Number(process.env.LAKE_ASSET_PORT || 29891));
const dataDir = "/tmp/lake-audit-s0-" + Date.now();
const appPath = path.resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const NL = String.fromCharCode(10);
let child = null;
let socket = null;
let seq = 0;
const pending = new Map();

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function targets() { return (await (await fetch("http://127.0.0.1:" + port + "/json/list")).json()); }
async function connect() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const t = (await targets()).find(function (x) { return x.type === "page"; });
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
function send(method, params) {
  return new Promise(function (res) { const id = ++seq; pending.set(id, res); socket.send(JSON.stringify({ id: id, method: method, params: params || {} })); });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression: expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    const ex = r.result.exceptionDetails;
    throw new Error("evaluate failed: " + ((ex.exception && ex.exception.description) || ex.text));
  }
  return r.result ? r.result.result.value : undefined;
}
async function waitFor(expr, timeout) {
  const deadline = Date.now() + (timeout || 20000);
  while (Date.now() < deadline) { if (await evaluate(expr)) return true; await wait(120); }
  return false;
}
async function quit() {
  try { if (child) child.kill("SIGTERM"); } catch (e) { /* ignore */ }
  const exited = await Promise.race([
    new Promise(function (r) { if (child) child.once("exit", function () { r(true); }); }),
    wait(8000).then(function () { return false; }),
  ]);
  if (!exited) { try { if (child) child.kill("SIGKILL"); } catch (e) { /* ignore */ } }
  await wait(400);
}
function findLake(id) {
  const direct = path.join(dataDir, "workspace-default", "notes", id + ".lake");
  if (fs.existsSync(direct)) return direct;
  const stack = [dataDir];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === id + ".lake") return p;
    }
  }
  return null;
}

const INJECT = [
  "(function(){",
  "  window.__s0 = {",
  "    tabIds: function(){ return Array.prototype.map.call(document.querySelectorAll('.tab-item'), function(t){ return t.getAttribute('data-note-id'); }); },",
  "    hasTab: function(id){ return Array.prototype.some.call(document.querySelectorAll('.tab-item'), function(t){ return t.getAttribute('data-note-id')===id; }); },",
  "    clickRow: function(id){ var r=Array.prototype.find.call(document.querySelectorAll('[data-tree-node-id]'), function(x){ return x.getAttribute('data-tree-node-id')===id; }); if(r){ r.click(); return true; } return false; },",
  "    closeTab: function(id){ var t=Array.prototype.find.call(document.querySelectorAll('.tab-item'), function(x){ return x.getAttribute('data-note-id')===id; }); var c=t&&t.querySelector('.tab-close'); if(c){ c.click(); return true; } return false; },",
  "    status: function(){ var el=document.querySelector('.document-statusbar'); return el? el.innerText : ''; },",
  "    engine: function(){ var eds=Array.prototype.slice.call(document.querySelectorAll('.ne-editor')).filter(function(e){ return e.getBoundingClientRect().height>0; }); var e=eds[0]; return e? e.querySelector('.ne-engine') : null; },",
  "    paraRect: function(){ var en=window.__s0.engine(); if(!en) return null; var p=en.querySelector('ne-p')||en; var r=p.getBoundingClientRect(); return { x: Math.round(r.left+Math.min(30, r.width/2)), y: Math.round(r.top+Math.min(12, r.height/2)) }; },",
  "    dirty: function(){ return /待保存/.test(window.__s0.status()) || Boolean(document.querySelector('.tab-item.active .tab-dirty')); },",
  "    tabText: function(){ var en=window.__s0.engine(); return en? (en.innerText || '') : ''; },",
  "    ctxHistory: function(id){ var r=Array.prototype.find.call(document.querySelectorAll('[data-tree-node-id]'), function(x){ return x.getAttribute('data-tree-node-id')===id; }); if(!r) return false; var b=r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:Math.round(b.left+40),clientY:Math.round(b.top+8)})); return true; },",
  "    clickMenuText: function(text){ var items=Array.prototype.slice.call(document.querySelectorAll('.context-menu button, .context-menu .context-menu-item')); var hit=items.find(function(el){ return (el.textContent||'').trim()===text; }); if(!hit) return false; hit.click(); return true; },",
  "    restoreHistory: function(historyId){ var rows=Array.prototype.slice.call(document.querySelectorAll('.b3-list-item[data-history-id]')); var row=rows.find(function(r){ return r.getAttribute('data-history-id')===String(historyId); }) || rows[rows.length-1]; if(!row) return false; var btn=row.querySelector('button[aria-label=\"恢复此版本\"]'); if(!btn) return false; btn.click(); return true; },",
  "    closeDialog: function(){ document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return true; }",
  "  };",
  "  return true;",
  "})()",
].join(NL);

const F04_EXPR = [
  "(async function(){",
  "  var api = window.lakeNative;",
  "  var out = {};",
  "  var a = await api.createNote('S0-F04-trash');",
  "  await api.saveNote(a.id, a.title, '<p>v1</p>');",
  "  await api.deleteNote(a.id);",
  "  out.aReject = false;",
  "  try { await api.saveNote(a.id, a.title, '<p>late</p>'); } catch(e){ out.aReject = true; out.aErr = String((e && e.message) || e); }",
  "  var aAfter = await api.readNote(a.id);",
  "  out.aUnchanged = !!aAfter && aAfter.content.indexOf('v1') >= 0 && aAfter.content.indexOf('late') < 0;",
  "  await api.restoreTrash(a.id);",
  "  out.aResave = false;",
  "  try { await api.saveNote(a.id, a.title, '<p>after-restore</p>'); out.aResave = true; } catch(e){ out.aResaveErr = String((e && e.message) || e); }",
  "  var aR = await api.readNote(a.id);",
  "  out.aRestored = !!aR && aR.content.indexOf('after-restore') >= 0;",
  "  var b = await api.createNote('S0-F04-purge');",
  "  await api.saveNote(b.id, b.title, '<p>b1</p>');",
  "  await api.deleteNote(b.id);",
  "  await api.purgeTrash(b.id);",
  "  out.bReject = false;",
  "  try { await api.saveNote(b.id, b.title, '<p>b-late</p>'); } catch(e){ out.bReject = true; out.bErr = String((e && e.message) || e); }",
  "  var bNote = null; try { bNote = await api.readNote(b.id); } catch(e){}",
  "  out.bGone = !bNote || !bNote.content || bNote.content.indexOf('b-late') < 0;",
  "  return JSON.stringify(out);",
  "})()",
].join(NL);

const F04B_EXPR = [
  "(async function(){",
  "  var api = window.lakeNative;",
  "  var c = await api.createNote('S0-F04-c');",
  "  var d = await api.createNote('S0-F04-d');",
  "  await api.saveNote(c.id, c.title, '<p>c1</p>');",
  "  await api.saveNote(d.id, d.title, '<p>d1</p>');",
  "  await api.deleteNote(c.id);",
  "  await api.deleteNote(d.id);",
  "  await api.restoreTrash(c.id);",
  "  var cd = await api.getNoteDigest(c.id);",
  "  var dd = await api.getNoteDigest(d.id);",
  "  return JSON.stringify({ cDeleted: !!(cd && cd.deleted), dDeleted: !!(dd && dd.deleted), cContent: (await api.readNote(c.id)).content, dContent: (await api.readNote(d.id)).content });",
  "})()",
].join(NL);

const F04M_EXPR = [
  "(async function(){",
  "  var api = window.lakeNative;",
  "  var out = {};",
  "  var m = await api.createNote('S0-F04-meta');",
  "  await api.saveNote(m.id, m.title, '<p>m1</p>');",
  "  await api.deleteNote(m.id);",
  "  out.renameRejected = false;",
  "  try { await api.renameTreeNode(m.id, '改名'); } catch(e){ out.renameRejected = true; out.renameErr = String((e && e.message) || e); }",
  "  out.iconRejected = false;",
  "  try { await api.setNodeIcon(m.id, 'star'); } catch(e){ out.iconRejected = true; }",
  "  out.lockRejected = false;",
  "  try { await api.setNoteLocked(m.id, true); } catch(e){ out.lockRejected = true; }",
  "  var after = await api.readNote(m.id);",
  "  out.titleUnchanged = !!after && after.title === 'S0-F04-meta';",
  "  await api.restoreTrash(m.id);",
  "  out.afterRestore = false;",
  "  try { var t = await api.renameTreeNode(m.id, '恢复后名'); out.afterRestore = !!t && t.title === '恢复后名'; } catch(e){ out.afterRestoreErr = String((e && e.message) || e); }",
  "  return JSON.stringify(out);",
  "})()",
].join(NL);

const checks = [];
function check(name, ok, detail) {
  checks.push({ name: name, ok: !!ok, detail: detail === undefined ? null : detail });
  console.log((ok ? "  ✓ " : "  ✗ ") + name + (detail ? "  [" + detail + "]" : ""));
}

try {
  const env = Object.assign({}, process.env, { LAKE_RENDERER: "scheme", LAKE_USER_DATA: dataDir, LAKE_ASSET_PORT: assetPort });
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(appPath, [".", "--remote-debugging-port=" + port, "--disable-gpu", "--no-sandbox"], { env: env, stdio: "ignore" });
  await connect();
  await send("Runtime.enable");
  await send("Page.enable");
  const ready = await waitFor("document.readyState === 'complete' && Boolean(window.lakeNative)", 40000);
  check("app boot + window.lakeNative", ready);

  const origin = await evaluate("JSON.stringify({ protocol: location.protocol, host: location.host })");
  check("scheme origin（lakexlocalnotes://app）", /"protocol":"lake:"/.test(origin), origin);

  await evaluate(INJECT);

  const f04 = JSON.parse(await evaluate(F04_EXPR));
  check("F04 回收站中普通保存被拒绝", f04.aReject, f04.aErr);
  check("F04 拒绝后正文未被改写", f04.aUnchanged);
  check("F04 显式恢复后可继续保存", f04.aResave && f04.aRestored, f04.aResaveErr || null);
  check("F04 purge 后普通保存被拒绝（不复活）", f04.bReject && f04.bGone, f04.bErr);

  const f04b = JSON.parse(await evaluate(F04B_EXPR));
  check("F04 恢复 c 不改写仍在回收站的 d", f04b.cDeleted === false && f04b.dDeleted === true, JSON.stringify(f04b));

  const f04m = JSON.parse(await evaluate(F04M_EXPR));
  check("F04 元数据：回收站节点 rename/icon/lock 被拒绝", f04m.renameRejected && f04m.iconRejected && f04m.lockRejected, f04m.renameErr);
  check("F04 元数据：拒绝后标题未被改写", f04m.titleUnchanged);
  check("F04 元数据：显式恢复后 rename 可写", f04m.afterRestore, f04m.afterRestoreErr);

  // ---- F03：按文档 reload 取消作用域（真实端：两篇不同文档各自历史恢复都生效）----
  const f03 = JSON.parse(await evaluate([
    "(async function(){",
    "  var api = window.lakeNative;",
    "  var a = await api.createNote('S0-F03-a'); await api.saveNote(a.id, a.title, '<p>A0</p>');",
    "  var ha = await api.createHistorySnapshot(a.id, undefined, true);",
    "  await api.saveNote(a.id, 'S0-F03-a', '<p>A1</p>');",
    "  var b = await api.createNote('S0-F03-b'); await api.saveNote(b.id, b.title, '<p>B0</p>');",
    "  var hb = await api.createHistorySnapshot(b.id, undefined, true);",
    "  await api.saveNote(b.id, 'S0-F03-b', '<p>B1</p>');",
    "  return JSON.stringify({ a: a.id, ha: ha, b: b.id, hb: hb });",
    "})()",
  ].join(NL)));
  await evaluate("window.confirm = function(){ return true; }; true");
  for (const id of [f03.a, f03.b]) {
    await waitFor("Boolean(Array.prototype.find.call(document.querySelectorAll('[data-tree-node-id]'), function(x){ return x.getAttribute('data-tree-node-id')===" + JSON.stringify(id) + "; }))", 15000);
    await evaluate("window.__s0.clickRow(" + JSON.stringify(id) + ")");
    await waitFor("window.__s0.hasTab(" + JSON.stringify(id) + ")", 15000);
    await wait(1200);
  }
  const restoreOne = async (id, historyId) => {
    await evaluate("window.__s0.ctxHistory(" + JSON.stringify(id) + ")");
    await wait(500);
    await evaluate("window.__s0.clickMenuText('历史版本')");
    const panel = await waitFor("Boolean(document.querySelector('.b3-list-item[data-history-id]'))", 10000);
    const clicked = await evaluate("window.__s0.restoreHistory(" + historyId + ")");
    await wait(1600);
    await evaluate("window.__s0.closeDialog()");
    await wait(500);
    return { panel, clicked };
  };
  const ra = await restoreOne(f03.a, f03.ha);
  const rb = await restoreOne(f03.b, f03.hb);
  await evaluate("window.__s0.clickRow(" + JSON.stringify(f03.a) + ")");
  await wait(1000);
  const textA = await evaluate("window.__s0.tabText()");
  await evaluate("window.__s0.clickRow(" + JSON.stringify(f03.b) + ")");
  await wait(1000);
  const textB = await evaluate("window.__s0.tabText()");
  check("F03 A 历史恢复生效（tab 重载为快照内容）", ra.clicked && /A0/.test(textA), JSON.stringify({ panel: ra.panel, clicked: ra.clicked, text: String(textA).slice(0, 40) }));
  check("F03 B 历史恢复生效（不同文档不被互相取消）", rb.clicked && /B0/.test(textB), JSON.stringify({ panel: rb.panel, clicked: rb.clicked, text: String(textB).slice(0, 40) }));

  // ---- F01/F02 非回归：正常输入 → 自动保存 ----
  const g = await evaluate("(async function(){ var n = await window.lakeNative.createNote('S0-normal-save'); await window.lakeNative.saveNote(n.id, n.title, '<p>base</p>'); return n.id; })()");
  await waitFor("Boolean(Array.prototype.find.call(document.querySelectorAll('[data-tree-node-id]'), function(x){ return x.getAttribute('data-tree-node-id')===" + JSON.stringify(g) + "; }))", 15000);
  await evaluate("window.__s0.clickRow(" + JSON.stringify(g) + ")");
  await waitFor("window.__s0.hasTab(" + JSON.stringify(g) + ")", 15000);
  await wait(1500);
  const rectRaw = await evaluate("JSON.stringify(window.__s0.paraRect())");
  let typed = false;
  if (rectRaw) {
    const rect = JSON.parse(rectRaw);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await wait(200);
    await send("Input.insertText", { text: "S0-normal-edit" });
    typed = await waitFor("window.__s0.dirty()", 5000);
  }
  check("F01/F02 输入后进入待保存（dirty）", typed);
  await wait(2200);
  const saved = await evaluate("(async function(){ var n = await window.lakeNative.readNote(" + JSON.stringify(g) + "); return !!(n && n.content && n.content.indexOf('S0-normal-edit') >= 0); })()");
  check("F01/F02 自动保存落盘（读回含输入）", saved);

  // ---- F01 关闭闸：saveNote 失败（.lake 缺失 → NotFound）时不关闭脏标签 ----
  const closeId = await evaluate("(async function(){ var n = await window.lakeNative.createNote('S0-F01-close'); await window.lakeNative.saveNote(n.id, n.title, '<p>base</p>'); return n.id; })()");
  await waitFor("Boolean(Array.prototype.find.call(document.querySelectorAll('[data-tree-node-id]'), function(x){ return x.getAttribute('data-tree-node-id')===" + JSON.stringify(closeId) + "; }))", 15000);
  await evaluate("window.__s0.clickRow(" + JSON.stringify(closeId) + ")");
  await waitFor("window.__s0.hasTab(" + JSON.stringify(closeId) + ")", 15000);
  await wait(1500);
  const rectRaw2 = await evaluate("JSON.stringify(window.__s0.paraRect())");
  let dirty2 = false;
  if (rectRaw2) {
    const rect = JSON.parse(rectRaw2);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await wait(200);
    await send("Input.insertText", { text: "S0-dirty-close" });
    dirty2 = await waitFor("window.__s0.dirty()", 5000);
  }
  const lakePath = findLake(closeId);
  let stayed = false;
  let closed = false;
  if (dirty2 && lakePath && fs.existsSync(lakePath)) {
    const bytes = fs.readFileSync(lakePath);
    fs.unlinkSync(lakePath);
    await evaluate("window.__s0.closeTab(" + JSON.stringify(closeId) + ")");
    await wait(1500);
    stayed = await evaluate("window.__s0.hasTab(" + JSON.stringify(closeId) + ")");
    fs.writeFileSync(lakePath, bytes);
    await evaluate("window.__s0.closeTab(" + JSON.stringify(closeId) + ")");
    await wait(1500);
    closed = !(await evaluate("window.__s0.hasTab(" + JSON.stringify(closeId) + ")"));
  }
  check("F01 保存失败时脏标签不关闭（留在原文档）", stayed, dirty2 ? (lakePath || "no .lake") : "未能制造 dirty");
  check("F01 恢复可写后再次关闭成功", closed);

  // 捕获契约：输入后不等 1s 防抖、直接关闭 → 关闭前按需 capture 必须把最后输入落盘
  const qId = await evaluate("(async function(){ var n = await window.lakeNative.createNote('S0-quick-close'); return n.id; })()");
  await waitFor("Boolean(Array.prototype.find.call(document.querySelectorAll('[data-tree-node-id]'), function(x){ return x.getAttribute('data-tree-node-id')===" + JSON.stringify(qId) + "; }))", 15000);
  await evaluate("window.__s0.clickRow(" + JSON.stringify(qId) + ")");
  await waitFor("window.__s0.hasTab(" + JSON.stringify(qId) + ")", 15000);
  await wait(1500);
  const qRectRaw = await evaluate("JSON.stringify(window.__s0.paraRect())");
  let quickTyped = false;
  if (qRectRaw) {
    const rect = JSON.parse(qRectRaw);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await wait(200);
    await send("Input.insertText", { text: "QCLOSE-MARKER" });
    quickTyped = true;
  }
  await evaluate("window.__s0.closeTab(" + JSON.stringify(qId) + ")");
  await wait(1600);
  const qSaved = await evaluate("(async function(){ var n = await window.lakeNative.readNote(" + JSON.stringify(qId) + "); return !!(n && n.content && n.content.indexOf('QCLOSE-MARKER') >= 0); })()");
  check("捕获契约：输入后立即关闭也把最后输入落盘", quickTyped && qSaved);

  const failed = checks.filter(function (c) { return !c.ok; });
  console.log(NL + "RESULT " + JSON.stringify({ dataDir: dataDir, passed: checks.length - failed.length, failed: failed.length, checks: checks }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
} catch (error) {
  console.error("e2e-audit-s0 error:", error && error.stack ? error.stack : error);
  process.exitCode = 2;
} finally {
  await quit();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}
