#!/usr/bin/env node
/**
 * 块级编辑 · 多块选区 / 批量操作 端到端（260917 Issue 4）。
 *
 * 在**副本**上用**真实鼠标拖选**跨多个顶层块，验证：
 *   ① 选区成立后出现聚合手柄，高亮覆盖全部选中块；
 *   ② 批量「删除」→ 选中段落全部从正文消失；
 *   ③ 批量「转化为 → 高亮块」→ 选中段落文本都进同一个 <blockquote class="lake-alert">。
 *
 * 用法（应用需在跑，CDP 默认 9222）：
 *   node scripts/e2e-block-multi-select.mjs --note <含若干纯文本段落的文档 id>
 *   node scripts/e2e-block-multi-select.mjs --keep
 * 退出码 0=PASS，1=FAIL，2=出错。
 */
import { argv, exit } from "node:process";

const args = argv.slice(2);
const argOf = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const PORT = Number(argOf("--port", "9222"));
const NOTE = argOf("--note");
const KEEP = args.includes("--keep");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const list = await (await fetch("http://127.0.0.1:" + PORT + "/json")).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("没有 page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error("页面求值失败: " + ((r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text));
    return r.result ? r.result.result.value : undefined;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.bringToFront");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  return { evalJs, send, close: () => ws.close() };
}

const INJECT = [
"(() => {",
"  window.__row = (id) => [...document.querySelectorAll('.tree-row')].find((r) => r.getAttribute('data-tree-node-id') === id);",
"  window.__tab = (id) => [...document.querySelectorAll('.tab-item')].find((t) => t.getAttribute('data-note-id') === id);",
"  window.__activeId = () => { const t = document.querySelector('.tab-item.active'); return t && t.getAttribute('data-note-id'); };",
"  window.__read = async (id) => { const d = await window.lakeNative.readNote(id); return (d && d.content) || ''; };",
"  window.__engine = () => { const vis = [...document.querySelectorAll('.ne-editor')].filter((e) => e.getBoundingClientRect().height > 0); const ed = vis.find((e) => { const w = e.querySelector('.ne-editor-wrap'); return w && w.clientHeight > 200; }) || vis[0]; return ed ? ed.querySelector('.ne-engine') : null; };",
"  window.__wrap = () => { const e = window.__engine(); return e ? e.closest('.ne-editor').querySelector('.ne-editor-wrap') : null; };",
"  window.__dragTargets = async (n) => {",
"    const w = window.__wrap(); w.scrollTop = 0; await new Promise((x) => setTimeout(x, 400));",
"    // 只取「当前视口内完全可见」的段落：避免拖选端点落到视口外触发浏览器自动滚动（会选中远超预期、手柄跑到屏外）",
"    const pick = () => [...window.__engine().querySelectorAll('ne-p')].filter((p) => {",
"      if (p.parentElement !== window.__engine() || (p.textContent || '').trim().length <= 2) return false;",
"      const r = p.getBoundingClientRect();",
"      return r.top > 60 && r.bottom < window.innerHeight - 60;",
"    });",
"    let ps = pick();",
"    for (let i = 0; i < 30 && ps.length < n; i++) { w.scrollTop = Math.min(w.scrollHeight, w.scrollTop + Math.max(240, Math.round(w.clientHeight * 0.6))); await new Promise((x) => setTimeout(x, 260)); ps = pick(); }",
"    if (ps.length < n) return { err: 'not enough visible paragraphs', total: window.__engine().querySelectorAll('ne-p').length, visible: ps.length, scrollTop: Math.round(w.scrollTop), scrollHeight: Math.round(w.scrollHeight), clientHeight: Math.round(w.clientHeight) };",
"    const chosen = ps.slice(0, n); const first = chosen[0]; const last = chosen[chosen.length - 1];",
"    const r0 = first.getBoundingClientRect(); const r1 = last.getBoundingClientRect();",
"    return { start: { x: Math.round(r0.left + 24), y: Math.round(r0.top + Math.min(12, r0.height / 2)) }, end: { x: Math.round(r1.left + r1.width - 24), y: Math.round(r1.bottom - Math.min(8, r1.height / 4)) }, texts: chosen.map((p) => (p.textContent || '').trim()) };",
"  };",
"  window.__highlightCount = () => window.__engine().querySelectorAll('.ne-brick-highlight').length;",
"  window.__handleRect = () => { const h = [...document.querySelectorAll('.ne-block-hover-handle')].find((x) => getComputedStyle(x).opacity === '1' && x.getBoundingClientRect().width > 0); if (!h) return null; const r = h.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) }; };",
"  window.__hoverHandle = () => { const h = [...document.querySelectorAll('.ne-block-hover-handle')].find((x) => getComputedStyle(x).opacity === '1' && x.getBoundingClientRect().width > 0); if (!h) return false; h.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); h.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); return true; };",
"  window.__menuItem = (label) => { const m = document.querySelector('.ne-block-context-menu'); if (!m) return null; return [...m.querySelectorAll('.ne-block-menu-item')].find((el) => (el.querySelector('.ne-block-menu-label') || {}).textContent === label) || null; };",
"  window.__menuLabels = () => { const m = document.querySelector('.ne-block-context-menu'); return m ? [...m.querySelectorAll(':scope > .ne-block-context-menu-inner > .ne-block-menu-item')].map((el) => (el.querySelector('.ne-block-menu-label') || el).textContent.trim()) : null; };",
"  window.__hoverParent = (label) => { const el = window.__menuItem(label); if (!el) return false; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 })); el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 })); return true; };",
"  window.__clickItem = (label) => { const el = window.__menuItem(label); if (!el) return false; el.click(); return true; };",
"  return true;",
"})()",
].join("\n");

async function realDrag(send, start, end) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x, y: start.y, buttons: 0 });
  await sleep(120);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "left", clickCount: 1, buttons: 1 });
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(start.x + ((end.x - start.x) * i) / steps);
    const y = Math.round(start.y + ((end.y - start.y) * i) / steps);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
    await sleep(35);
  }
  await sleep(150);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: end.x, y: end.y, button: "left", clickCount: 1, buttons: 0 });
  await sleep(500);
}

async function clickHandle(send, evalJs) {
  const handle = await evalJs("window.__handleRect()");
  if (!handle) return null;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: handle.x, y: handle.y, buttons: 0 });
  await sleep(150);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: handle.x, y: handle.y, button: "left", clickCount: 1, buttons: 1 });
  await sleep(90);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: handle.x, y: handle.y, button: "left", clickCount: 1, buttons: 0 });
  await sleep(700);
  return handle;
}
async function openCopy(evalJs, source) {
  const tabsBefore = await evalJs("[...document.querySelectorAll('.tab-item')].map((t) => t.getAttribute('data-note-id'))");
  const dup = await evalJs("(async () => { const src = " + JSON.stringify(source) + "; const api = window.lakeNative; const nodes = await api.getHomeSnapshot().then(function(s){return s.treeNodes;}); const byId = new Map(nodes.map((n) => [n.id, n])); const chain = []; let cur = byId.get(src); while (cur && cur.parentId) { chain.push(cur.parentId); cur = byId.get(cur.parentId); } for (const pid of chain.reverse()) { const row = window.__row(pid); const chev = row && row.querySelector('.tree-chevron'); if (chev && !chev.classList.contains('open')) { chev.click(); await new Promise((r) => setTimeout(r, 260)); } } const row = window.__row(src); if (!row) return { err: '目录里找不到源行' }; const b = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(b.left + 60), clientY: Math.round(b.top + 8) })); await new Promise((r) => setTimeout(r, 400)); const items = [...document.querySelectorAll('.context-menu button, .context-menu .context-menu-item')]; const hit = items.find((el) => (el.textContent || '').trim() === '复制'); if (!hit) return { err: '右键菜单里没有「复制」' }; hit.click(); return { ok: true }; })()");
  if (dup && dup.err) throw new Error(dup.err);
  let id = null;
  for (let i = 0; i < 60; i++) { await sleep(250); const active = await evalJs("window.__activeId()"); if (active && !tabsBefore.includes(active)) { id = active; break; } }
  if (!id) throw new Error("副本没有打开");
  await sleep(4500);
  return id;
}

async function closeCopy(evalJs, id) {
  await evalJs("(() => { const t = window.__tab(" + JSON.stringify(id) + "); const c = t && t.querySelector('.tab-close'); if (c) c.click(); return true; })()");
  await sleep(400);
  await evalJs("(async () => { try { await window.lakeNative.deleteTreeNode(" + JSON.stringify(id) + "); return true; } catch { return false; } })()");
  await sleep(300);
}

async function main() {
  const { evalJs, send, close } = await connect();
  const failures = [];
  const check = (ok, msg) => { console.log((ok ? "  ✓ " : "  ✗ ") + msg); if (!ok) failures.push(msg); };
  let current = null;
  try {
    await evalJs(INJECT);
    const source = NOTE || await evalJs("window.__activeId()");
    if (!source) throw new Error("当前没有活动文档；请用 --note 指定");
    const meta = await evalJs("(async () => { const n = (await window.lakeNative.getHomeSnapshot().then(function(s){return s.treeNodes;})).find((x) => x.id === " + JSON.stringify(source) + "); return n ? { title: n.title } : null; })()");
    console.log("源  : " + (meta ? meta.title : "?") + " [" + source + "]");

    // ---- 副本 A：聚合手柄 + 批量删除 ----
    current = await openCopy(evalJs, source);
    console.log("副本A: " + current);
    const t1 = await evalJs("window.__dragTargets(3)");
    check(!!t1 && !t1.err, "定位 3 个纯文本段落" + (t1 && t1.err ? "（" + t1.err + " visible " + t1.visible + "）" : ""));
    if (t1 && !t1.err) {
      await realDrag(send, t1.start, t1.end);
      const handle1 = await evalJs("window.__handleRect()");
      check(!!handle1, "多块选区出现聚合手柄" + (handle1 ? " @" + handle1.left + "," + handle1.top : ""));
      if (handle1) { await evalJs("window.__hoverHandle()"); await sleep(300); }
      const hl = await evalJs("window.__highlightCount()");
      check(hl >= 3, "聚合手柄高亮覆盖全部选中块（高亮 " + hl + " ≥ 3）");
      if (handle1) {
        await clickHandle(send, evalJs);
        const labels = await evalJs("window.__menuLabels()");
        check(!!labels, "聚合手柄主菜单已打开 " + JSON.stringify(labels));
        await evalJs("window.__clickItem('删除')");
        let after = "";
        for (let i = 0; i < 30; i++) { await sleep(400); after = await evalJs("window.__read(" + JSON.stringify(current) + ")"); if (t1.texts.every((t) => !after.includes(t.slice(0, 6)))) break; }
        const left = t1.texts.filter((t) => after.includes(t.slice(0, 6)));
        check(left.length === 0, "批量删除：选中段落全部移除" + (left.length ? "；残留 " + left.length : ""));
      } else {
        check(false, "批量删除：手柄不可用");
      }
    }
    if (!KEEP) await closeCopy(evalJs, current);
    current = null;

    // ---- 副本 B：批量转化 ----
    current = await openCopy(evalJs, source);
    console.log("副本B: " + current);
    const t2 = await evalJs("window.__dragTargets(3)");
    check(!!t2 && !t2.err, "定位 3 个纯文本段落（转化）" + (t2 && t2.err ? "（" + t2.err + "）" : ""));
    if (t2 && !t2.err) {
      await realDrag(send, t2.start, t2.end);
      const handle2 = await clickHandle(send, evalJs);
      if (!handle2) { check(false, "批量转化：聚合手柄未出现"); }
      else {
        await evalJs("window.__hoverParent('转化为')"); await sleep(450);
        await evalJs("window.__clickItem('高亮块')");
        let content = "";
        for (let i = 0; i < 30; i++) { await sleep(400); content = await evalJs("window.__read(" + JSON.stringify(current) + ")"); if (/lake-alert/.test(content)) break; }
        const alert = /<blockquote[^>]*class="lake-alert[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/.exec(content);
        check(!!alert, "批量转化为高亮块：已生成 <blockquote class=\"lake-alert\">");
        if (alert) {
          const missing = t2.texts.filter((t) => !alert[1].includes(t.slice(0, 6)));
          check(missing.length === 0, "选中段落文本都在同一个高亮块内" + (missing.length ? "；缺 " + missing.length : ""));
        }
      }
    }
    if (!KEEP) await closeCopy(evalJs, current);
    current = null;

    console.log("\n结果：" + (failures.length === 0 ? "PASS —— 多块选区聚合手柄 / 批量删除 / 批量转化" : "FAIL —— " + failures.length + " 项未通过"));
    failures.forEach((line) => console.log("  ✗ " + line));
    close();
    exit(failures.length === 0 ? 0 : 1);
  } catch (e) {
    if (current && !KEEP) { try { await closeCopy(evalJs, current); } catch {} }
    close();
    console.error("失败：" + (e && e.message ? e.message : e));
    exit(2);
  }
}
main();
