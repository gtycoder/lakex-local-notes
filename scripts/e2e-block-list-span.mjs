#!/usr/bin/env node
/**
 * 块级编辑 · 「列表父项 = 一个整块（含子项）」端到端（260917 Issue 3）。
 *
 * 在**副本**上验证：内核把列表项渲染成 .ne-engine 的平级子节点、嵌套只体现在 ne-level 上，
 * 所以「父项 + 子项」是 DOM 上的一段连续项。手柄/菜单/转化/删除必须按**整段**处理：
 *   ① 手柄高亮的节点数 = 整段项数；
 *   ② 转化为 → 高亮块：整段（父项 + 全部子项）文本都进 <blockquote class="lake-alert">；
 *   ③ 删除：整段文本全部从正文消失。
 *
 * 用法（应用需在跑，CDP 默认 9222）：
 *   node scripts/e2e-block-list-span.mjs --note <含嵌套列表的文档 id>
 *   node scripts/e2e-block-list-span.mjs --keep
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
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
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

const INJECT = `(() => {
  window.__h = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
  window.__row = (id) => [...document.querySelectorAll('.tree-row')].find((r) => r.getAttribute('data-tree-node-id') === id);
  window.__tab = (id) => [...document.querySelectorAll('.tab-item')].find((t) => t.getAttribute('data-note-id') === id);
  window.__activeId = () => { const t = document.querySelector('.tab-item.active'); return t && t.getAttribute('data-note-id'); };
  window.__read = async (id) => { const d = await window.lakeNative.readNote(id); return (d && d.content) || ''; };
  window.__engine = () => {
    const vis = [...document.querySelectorAll('.ne-editor')].filter((e) => e.getBoundingClientRect().height > 0);
    const ed = vis.find((e) => { const w = e.querySelector('.ne-editor-wrap'); return w && w.clientHeight > 200; }) || vis[0];
    return ed ? ed.querySelector('.ne-engine') : null;
  };
  window.__wrap = () => { const e = window.__engine(); return e ? e.closest('.ne-editor').querySelector('.ne-editor-wrap') : null; };
  window.__items = () => { const g = window.__engine(); return g ? [...g.children].filter((c) => /^NE-(TLI|OLI|ULI)$/.test(c.tagName)) : []; };
  window.__lvl = (el) => Number(el.getAttribute('ne-level') || 0);
  window.__fam = (el) => ((el.querySelector('ne-uli-c, ne-oli-c, ne-tli-c') || el).tagName || '').toLowerCase();
  window.__spanOf = (el) => {
    if (!/^NE-(TLI|OLI|ULI)$/.test(el.tagName)) return [el];
    const base = window.__lvl(el); const fam = window.__fam(el); const span = [el];
    let n = el.nextElementSibling;
    while (n && /^NE-(TLI|OLI|ULI)$/.test(n.tagName) && window.__fam(n) === fam && window.__lvl(n) > base) { span.push(n); n = n.nextElementSibling; }
    return span;
  };
  window.__parents = () => {
    window.__pheads = []; const out = [];
    for (const it of window.__items()) { const span = window.__spanOf(it); if (span.length > 1) { window.__pheads.push(it); out.push({ index: window.__pheads.length - 1, id: it.getAttribute('id'), texts: span.map((x) => (x.textContent || '').trim()), levels: span.map((x) => window.__lvl(x)) }); } }
    return out;
  };
  window.__focusParent = async (index) => {
    const it = window.__pheads && window.__pheads[index]; if (!it) return null;
    const w = window.__wrap();
    for (let i = 0; i < 8; i++) { const r = it.getBoundingClientRect(); if (Math.abs(r.top - 260) < 60 && r.bottom < window.innerHeight - 60) break; if (w) w.scrollTop = Math.max(0, w.scrollTop + (r.top - 260)); await new Promise((x) => setTimeout(x, 500)); }
    const r = it.getBoundingClientRect(); const c = it.querySelector('ne-uli-c, ne-oli-c, ne-tli-c'); const cr = c ? c.getBoundingClientRect() : r;
    return { id: it.getAttribute('id'), left: Math.round(r.left), contentLeft: Math.round(cr.left), top: Math.round(r.top), bottom: Math.round(r.bottom), texts: window.__spanOf(it).map((x) => (x.textContent || '').trim()) };
  };
  window.__highlightCount = () => window.__engine().querySelectorAll('.ne-brick-highlight').length;
  window.__handleRect = () => {
    const h = [...document.querySelectorAll('.ne-block-hover-handle')].find((x) => getComputedStyle(x).opacity === '1');
    if (!h) return null; const r = h.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) };
  };
  window.__menuItem = (label) => { const m = document.querySelector('.ne-block-context-menu'); if (!m) return null; return [...m.querySelectorAll('.ne-block-menu-item')].find((el) => (el.querySelector('.ne-block-menu-label') || {}).textContent === label) || null; };
  window.__hoverParent = (label) => { const el = window.__menuItem(label); if (!el) return false; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 })); el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 })); return true; };
  window.__clickItem = (label) => { const el = window.__menuItem(label); if (!el) return false; el.click(); return true; };
  window.__submenuLabels = () => { const m = document.querySelector('.ne-block-context-menu'); if (!m) return null; const s = m.querySelector('.ne-block-submenu'); return s ? [...s.querySelectorAll('.ne-block-menu-item')].map((el) => (el.querySelector('.ne-block-menu-label') || el).textContent.trim()) : null; };
  window.__handleEl = () => [...document.querySelectorAll('.ne-block-hover-handle')].find((x) => getComputedStyle(x).opacity === '1');
  window.__hoverHandle = () => { const h = window.__handleEl(); if (!h) return false; h.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); h.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); return true; };
  window.__menuLabels = () => { const m = document.querySelector('.ne-block-context-menu'); return m ? [...m.querySelectorAll(':scope > .ne-block-context-menu-inner > .ne-block-menu-item')].map((el) => (el.querySelector('.ne-block-menu-label') || el).textContent.trim()) : null; };
  return true;
})()`;

async function main() {
  const { evalJs, send, close } = await connect();
  const failures = [];
  const check = (ok, msg) => { console.log(`  ${ok ? "✓" : "✗"} ${msg}`); if (!ok) failures.push(msg); };
    // 列表项 textContent 带项目符号（●/○/■），序列化 HTML 里符号在独立的 marker 上；比对前剥掉前导符号
    const norm = (t) => String(t).replace(/^[^0-9A-Za-z\u4e00-\u9fa5]+/, '');
  let copyId = null;
  try {
    await evalJs(INJECT);
    let source = NOTE || await evalJs("window.__activeId()");
    if (!source) throw new Error("当前没有活动文档；请用 --note 指定含嵌套列表的文档");
    const meta = await evalJs(`(async () => { const n = (await window.lakeNative.listTreeNodes()).find((x) => x.id === ${JSON.stringify(source)}); return n ? { title: n.title } : null; })()`);
    if (!meta) throw new Error("找不到文档：" + source);
    console.log(`源  : ${meta.title} [${source}]`);

    // 复制副本：走应用自己的右键「复制」（会自动打开副本），避免目录未刷新点不到行
    const tabsBefore = await evalJs("[...document.querySelectorAll('.tab-item')].map((t) => t.getAttribute('data-note-id'))");
    const dup = await evalJs(`(async () => {
      const src = ${JSON.stringify(source)};
      const api = window.lakeNative;
      const nodes = await api.listTreeNodes(); const byId = new Map(nodes.map((n) => [n.id, n]));
      const chain = []; let cur = byId.get(src);
      while (cur && cur.parentId) { chain.push(cur.parentId); cur = byId.get(cur.parentId); }
      for (const pid of chain.reverse()) { const row = window.__row(pid); const chev = row && row.querySelector('.tree-chevron'); if (chev && !chev.classList.contains('open')) { chev.click(); await new Promise((r) => setTimeout(r, 260)); } }
      const row = window.__row(src); if (!row) return { err: '目录里找不到源行' };
      const b = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(b.left + 60), clientY: Math.round(b.top + 8) }));
      await new Promise((r) => setTimeout(r, 400));
      const items = [...document.querySelectorAll('.context-menu button, .context-menu .context-menu-item')];
      const hit = items.find((el) => (el.textContent || '').trim() === '复制');
      if (!hit) return { err: '右键菜单里没有「复制」' };
      hit.click(); return { ok: true };
    })()`);
    if (dup && dup.err) throw new Error(dup.err);
    for (let i = 0; i < 60; i++) { await sleep(250); const active = await evalJs("window.__activeId()"); if (active && !tabsBefore.includes(active)) { copyId = active; break; } }
    if (!copyId) throw new Error("副本没有打开");
    await sleep(4500);
    console.log(`副本: ${copyId}`);

    const parents = await evalJs("window.__parents()");
    check(parents.length > 0, `找到含子项的列表父项：${parents.length} 个`);
    if (!parents.length) throw new Error("该文档没有「父项 + 子项」嵌套列表，无法验证");

    // ---- ① 手柄高亮整段 ----
    const p0 = await evalJs("window.__focusParent(0)");
    const y = Math.round((p0.top + p0.bottom) / 2);
    for (const x of [p0.contentLeft + 80, p0.contentLeft + 20, p0.contentLeft + 4]) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 }); await sleep(180);
    }
    await sleep(320);
    const handle = await evalJs("window.__handleRect()");
    check(!!handle, "父项手柄出现");
    // 高亮由「鼠标进入手柄」触发（不是悬停块）：用合成 mouseover 进入手柄再断言
    // （不动真实鼠标 —— 先移到手柄上会影响随后的点击开菜单）
    if (handle) { await evalJs("window.__hoverHandle()"); await sleep(300); }
    const hovered = await evalJs("window.__highlightCount()");
    check(hovered >= parents[0].levels.length, `手柄高亮整段（高亮 ${hovered} 个节点 ≥ 整段 ${parents[0].levels.length} 项）`);

    // ---- ② 转化：整段进高亮块 ----
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: handle.x, y: handle.y, button: "left", clickCount: 1, buttons: 1 }); await sleep(90);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: handle.x, y: handle.y, button: "left", clickCount: 1, buttons: 0 }); await sleep(700);
    const mainLabels = await evalJs("window.__menuLabels()");
    check(!!mainLabels, `父项主菜单已打开 ${JSON.stringify(mainLabels)}`);
    await evalJs("window.__hoverParent('转化为')"); await sleep(450);
    const subLabels = await evalJs("window.__submenuLabels()");
    const clicked = await evalJs("window.__clickItem('高亮块')");
    check(clicked === true, `「转化为 → 高亮块」已点击（子菜单 ${JSON.stringify(subLabels)}）`);
    let content = "";
    for (let i = 0; i < 30; i++) { await sleep(400); content = await evalJs(`window.__read(${JSON.stringify(copyId)})`); if (/lake-alert/.test(content)) break; }
    const alert = /<blockquote[^>]*class="lake-alert[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/.exec(content);
    check(!!alert, "转化为 → 高亮块：已生成 <blockquote class=\"lake-alert\">");
    if (alert) {
      const inside = alert[1];
      const missing = p0.texts.filter((t) => !inside.includes(norm(t)));
      check(missing.length === 0, `整段（父项 + ${p0.texts.length - 1} 子项）文本都在高亮块内${missing.length ? "；缺：" + missing.join(" / ") : ""}`);
    }

    // ---- ③ 删除：整段一起删 ----
    const parents2 = await evalJs("window.__parents()");
    const victim = parents2.find((p) => p.texts.every((t) => t && !content.includes(t))) || parents2[0];
    if (!victim) { check(false, "删除用例：找不到未被转化的父项"); }
    else {
      const p1 = await evalJs(`window.__focusParent(${victim.index})`);
      if (!p1) { check(false, "删除用例：父项无法定位"); }
      else {
        const y1 = Math.round((p1.top + p1.bottom) / 2);
        for (const x of [p1.contentLeft + 80, p1.contentLeft + 20, p1.contentLeft + 4]) {
          await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y: y1, buttons: 0 }); await sleep(180);
        }
        await sleep(320);
        const h1 = await evalJs("window.__handleRect()");
        if (!h1) { check(false, "删除用例：手柄未出现"); }
        else {
          await send("Input.dispatchMouseEvent", { type: "mousePressed", x: h1.x, y: h1.y, button: "left", clickCount: 1, buttons: 1 }); await sleep(90);
          await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: h1.x, y: h1.y, button: "left", clickCount: 1, buttons: 0 }); await sleep(700);
          await evalJs("window.__clickItem('删除')");
          let after = content;
          for (let i = 0; i < 30; i++) { await sleep(400); after = await evalJs(`window.__read(${JSON.stringify(copyId)})`); if (victim.texts.every((t) => !after.includes(norm(t)))) break; }
          const left = victim.texts.filter((t) => after.includes(norm(t)));
          check(left.length === 0, `删除整段（父项 + ${victim.texts.length - 1} 子项）全部移除${left.length ? "；残留：" + left.join(" / ") : ""}`);
        }
      }
    }

    // 清理
    if (!KEEP) {
      await evalJs(`(() => { const t = window.__tab(${JSON.stringify(copyId)}); const c = t && t.querySelector('.tab-close'); if (c) c.click(); return true; })()`);
      await sleep(400);
      const trashed = await evalJs(`(async () => { try { await window.lakeNative.deleteTreeNode(${JSON.stringify(copyId)}); return true; } catch { return false; } })()`);
      console.log(`清理: 副本${trashed ? "已丢回收站" : "清理失败 " + copyId}`);
    } else {
      console.log(`清理: --keep，副本保留（${copyId}）`);
    }
    const srcNow = await evalJs(`(async () => { const c = await window.__read(${JSON.stringify(source)}); return { bytes: c.length, hash: window.__h(c) }; })()`);
    console.log(`原件复核: ${srcNow.bytes}B hash=${srcNow.hash}`);

    console.log(`\n结果：${failures.length === 0 ? "PASS —— 父项+子项按一个整块处理（高亮/转化/删除）" : "FAIL —— " + failures.length + " 项未通过"}`);
    failures.forEach((f) => console.log("  ✗ " + f));
    close();
    exit(failures.length === 0 ? 0 : 1);
  } catch (e) {
    if (copyId && !KEEP) { try { await evalJs(`window.lakeNative.deleteTreeNode(${JSON.stringify(copyId)})`); } catch {} }
    close();
    console.error("失败：" + (e && e.message ? e.message : e));
    exit(2);
  }
}
main();
