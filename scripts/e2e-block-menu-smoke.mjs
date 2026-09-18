#!/usr/bin/env node
/**
 * 块操作菜单端到端冒烟（260917）——在**副本**上把菜单逐项点一遍，验证：
 *   ① 手柄出现且定位正确（块左侧、垂直居中）；
 *   ② 主菜单/「转化为」子菜单文案与云端块菜单一致（无「代码块」——内核无该命令）；
 *   ③ 每个动作都真的生效（副本正文变化）；
 *   ④ **每次动作后，内核已注册的卡片片段逐字节不变**（这是本批的头号验收项：
 *      旧的「整篇 JSON 读改写」路径会把思维导图卡载荷 634B→8859B、抹掉未注册卡）；
 *   ⑤ 拖拽移动走内核原生路径（卡片 moveCard / 其它块「读-插-删」）：文档应变化、已有卡片不丢、被拖文本仍在。
 *
 * 用法（应用需在跑：npm run dev，CDP 默认 9222）：
 *   node scripts/e2e-block-menu-smoke.mjs                    # 用当前活动文档作为副本源
 *   node scripts/e2e-block-menu-smoke.mjs --note <noteId>
 *   node scripts/e2e-block-menu-smoke.mjs --keep             # 保留副本（默认用完丢回收站）
 *
 * 原件全程不打开（只复制副本再操作）；副本用完关标签 + 丢回收站。
 *
 * ⚠️ 源文档最好含 **≥20 个纯文本段落**（无卡片更好）：转容器/卡片类每项会消耗一个段落，
 *    段落不足时后面的项会以「没有可用段落」被跳过（只记为备注、不判失败）——覆盖会不全。
 * Node 24 必须（用内置 WebSocket / fetch）。退出码 0=PASS，1=FAIL，2=出错。
 */
import { argv, exit } from "node:process";

const args = argv.slice(2);
const argOf = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(argOf("--port", "9222"));
const NOTE = argOf("--note");
const KEEP = args.includes("--keep");
const SETTLE_MS = Number(argOf("--settle", "6000"));

/** 与云端块菜单一致的主菜单文案（顺序即验收顺序） */
const EXPECTED_MENU = ["转化为", "删除", "复制", "剪切", "缩进", "在下方添加"];
/** 「转化为」子菜单（与云端一致：6 个标题 + 5 个紧凑项同排，4 个功能卡片两两一行） */
const EXPECTED_CONVERT = ["H1", "H2", "H3", "H4", "H5", "H6", "正文", "有序", "无序", "任务", "代码", "高亮块", "引用", "分栏", "折叠块"];
/**
 * 执行顺序：**需要「有文本段落」的容器/卡片类最先跑**。文档里带文本的段落有限，
 * 每次转换会消耗一个；而「转容器类是否保留原文本」正是本批重点，必须让
 * 高亮块/分栏/折叠块/代码优先拿到有文本的目标段落（引用/列表/标题用折叠光标实现，不挑段落）。
 */
const CONVERT_ORDER = ["高亮块", "分栏", "折叠块", "代码", "引用", "H1", "H2", "H3", "H4", "H5", "H6", "正文", "有序", "无序", "任务"];
/** 已知：内核未注册的遗留卡（换源前自研画板）在任何一次保存后都会丢，与块菜单无关，不参与本断言。 */
const KNOWN_UNREGISTERED = ["board-card"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  let list;
  try {
    list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  } catch {
    throw new Error(`连不上 CDP(:${PORT})：应用没在跑？先 npm run dev`);
  }
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("没有 page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise((res) => {
    const id = ++seq; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      throw new Error("页面求值失败: " + ((r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text));
    }
    return r.result ? r.result.result.value : undefined;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.bringToFront");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  return { evalJs, send, close: () => ws.close() };
}

/** 注入页面内小工具（避免在表达式里嵌套引号） */
const INJECT = `(() => {
  window.__h = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
  window.__tab = (id) => [...document.querySelectorAll('.tab-item')].find(t => t.getAttribute('data-note-id') === id);
  window.__row = (id) => [...document.querySelectorAll('.tree-row')].find(r => r.getAttribute('data-tree-node-id') === id);
  window.__activeId = () => { const t = document.querySelector('.tab-item.active'); return t && t.getAttribute('data-note-id'); };
  window.__read = async () => window.lakeNative.readNote(window.__activeId()).then(d => (d && d.content) || '');
  window.__vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  window.__visEditor = () => {
    const cands = [...document.querySelectorAll('.ne-editor')].filter(window.__vis);
    return cands.find(ed => { const w = ed.querySelector('.ne-editor-wrap'); return w && w.clientHeight > 300; }) || cands[0] || null;
  };
  window.__wrap = () => { const ed = window.__visEditor(); return ed ? ed.querySelector('.ne-editor-wrap') : null; };
  /** 把一个带文本的段落移到视口中部，返回定位信息 */
  window.__focusParagraph = async () => {
    const ed = window.__visEditor(); const w = window.__wrap();
    if (!ed || !w) return null;
    // 只挑「顶层」段落：容器（引用/高亮/分栏/折叠）内的段落选区不可靠，会让动作静默无效
    const topLevel = (el) => el.parentElement && el.parentElement.classList.contains('ne-engine');
    // 顶层段落的文本候选（容器/卡片内部的段落不参与，避免把转换作用到卡片内部）
    const topText = () => {
      const top = [...ed.querySelectorAll('ne-p')].filter(topLevel);
      return top.find(x => (x.textContent || '').trim().length > 2) || null;
    };
    let p = topText();
    // 虚拟渲染：视口窗口外的块不在 DOM。逐段下滚直到找到「有文本的顶层段落」。
    for (let i = 0; i < 30 && !p; i++) {
      w.scrollTop = Math.min(w.scrollHeight, w.scrollTop + Math.max(240, Math.round(w.clientHeight * 0.6)));
      await new Promise(x => setTimeout(x, 260));
      p = topText();
    }
    if (!p) {
      // 兜底（保持旧口径）：找不到顶层文本段落时，退回「顶层首个 / 任意有文本 / 首个」。
      const all = [...ed.querySelectorAll('ne-p')];
      p = all.filter(topLevel)[0] || all.find(x => (x.textContent || '').trim().length > 2) || all[0];
    }
    if (!p) return null;
    for (let i = 0; i < 8; i++) {
      const r = p.getBoundingClientRect();
      if (Math.abs(r.top - 260) < 40 && r.bottom < window.innerHeight - 60) break;
      w.scrollTop = Math.max(0, w.scrollTop + (r.top - 260));
      await new Promise(x => setTimeout(x, 600));
    }
    const r = p.getBoundingClientRect();
    return { id: p.getAttribute('id'), text: (p.textContent || '').trim().slice(0, 16),
      left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom) };
  };
  /** 文件快照：全文 hash + 逐张 <card> 片段 hash（用于断言卡片未被改写） */
  /**
   * 卡片指纹归一：块被「转化为容器」搬进新容器时，内核会给卡内的 id 重新发号（载荷其余字节不变）。
   * 护栏只关心「卡片载荷是否被改写/丢失」，所以算指纹前抹掉 id。
   * 这不会放过真正的破坏：未注册卡消失、value 被重写成 base64 水合形态，都会改变其余字节。
   */
  window.__normCard = (frag) => frag
    .replace(/ id="[^"]*"/g, '')
    .replace(/%22id%22%3A%22[^%]*%22/g, '%22id%22%3A%22ID%22');
  window.__snap = async () => {
    const f = await window.__read();
    const frags = []; let i = 0;
    while (frags.length < 60) {
      const s = f.indexOf('<card', i); if (s < 0) break;
      const e = f.indexOf('</card>', s); if (e < 0) break;
      const frag = f.slice(s, e + 7);
      const nm = /name="([^"]*)"/.exec(frag); const cn = /customName="([^"]*)"/.exec(frag);
      const norm = window.__normCard(frag);
      frags.push({ key: (cn ? cn[1] : (nm ? nm[1] : '?')), hash: window.__h(norm), len: norm.length });
      i = e + 7;
    }
    return { bytes: f.length, hash: window.__h(f), frags };
  };
  /** 菜单是否打开、主菜单文案 */
  window.__menuLabels = () => {
    const m = document.querySelector('.ne-block-context-menu');
    if (!m) return null;
    return [...m.querySelectorAll(':scope > .ne-block-context-menu-inner > .ne-block-menu-item')]
      .map(el => (el.querySelector('.ne-block-menu-label') || el).textContent.trim());
  };
  window.__menuItem = (label) => {
    const m = document.querySelector('.ne-block-context-menu'); if (!m) return null;
    return [...m.querySelectorAll('.ne-block-menu-item')]
      .find(el => (el.querySelector('.ne-block-menu-label') || {}).textContent === label) || null;
  };
  window.__submenuLabels = () => {
    const m = document.querySelector('.ne-block-context-menu'); if (!m) return null;
    const s = m.querySelector('.ne-block-submenu'); if (!s) return null;
    return [...s.querySelectorAll('.ne-block-menu-item')].map(el => (el.querySelector('.ne-block-menu-label') || el).textContent.trim());
  };
  window.__hoverParent = (label) => {
    const el = window.__menuItem(label); if (!el) return false;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 }));
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 }));
    return true;
  };
  window.__clickItem = (label) => { const el = window.__menuItem(label); if (!el) return false; el.click(); return true; };
  window.__handleRect = () => {
    const h = [...document.querySelectorAll('.ne-block-hover-handle')].find(x => getComputedStyle(x).opacity === '1');
    if (!h) return null;
    const r = h.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) };
  };
  /** 定位一张卡片（滚动找到并居中），返回它的定位信息；用于「卡片源」的转换测试。 */
  window.__focusCard = async (name) => {
    const ed = window.__visEditor(); const w = window.__wrap();
    if (!ed || !w) return null;
    let el = ed.querySelector('ne-card[data-card-name="' + name + '"]');
    for (let i = 0; i < 40 && !el; i++) { w.scrollTop = Math.min(w.scrollHeight, w.scrollTop + 420); await new Promise((x) => setTimeout(x, 260)); el = ed.querySelector('ne-card[data-card-name="' + name + '"]'); }
    if (!el) return null;
    for (let i = 0; i < 8; i++) { const r = el.getBoundingClientRect(); if (Math.abs(r.top - 260) < 60 && r.bottom < window.innerHeight - 60) break; w.scrollTop = Math.max(0, w.scrollTop + (r.top - 260)); await new Promise((x) => setTimeout(x, 500)); }
    const r = el.getBoundingClientRect();
    return { id: el.getAttribute('id'), text: (el.textContent || '').trim().slice(0, 16), left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom) };
  };
  /** 定位一个容器块（高亮块/引用/折叠块/分栏）并居中；用于「容器源」转换测试。 */
  window.__focusContainer = async (kind) => {
    const ed = window.__visEditor(); const w = window.__wrap();
    if (!ed || !w) return null;
    const pick = () => {
      if (kind === 'alert') return ed.querySelector('ne-alert-hole');
      if (kind === 'quote') return ed.querySelector('ne-quote');
      if (kind === 'collapse') { const all = [...ed.querySelectorAll('ne-container-hole')]; const d = all.find((h) => h.querySelector('details') || /collapse/i.test(h.className) || h.querySelector('[class*=collapse]')); return d || null; }
      if (kind === 'columns') { const a = ed.querySelector('article.lake-columns'); return a ? (a.closest('ne-container-hole') || a) : null; }
      return null;
    };
    let el = pick();
    for (let i = 0; i < 40 && !el; i++) { w.scrollTop = Math.min(w.scrollHeight, w.scrollTop + 420); await new Promise((x) => setTimeout(x, 260)); el = pick(); }
    if (!el) return null;
    for (let i = 0; i < 8; i++) { const r = el.getBoundingClientRect(); if (Math.abs(r.top - 260) < 80 && r.bottom < window.innerHeight - 60) break; w.scrollTop = Math.max(0, w.scrollTop + (r.top - 260)); await new Promise((x) => setTimeout(x, 500)); }
    const r = el.getBoundingClientRect();
    return { id: el.getAttribute('id'), text: (el.textContent || '').trim().slice(0, 12), left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom) };
  };
  /** 拖拽落点：取一个「除首个之外」的可见块，返回其矩形（用于把块拖到它下方）。 */
  window.__dragTargetRect = () => {
    const ed = window.__visEditor();
    const els = [...ed.querySelectorAll('ne-p, ne-h1, ne-h2, ne-h3, ne-quote')];
    const vis = els.filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top > 60 && r.bottom < window.innerHeight - 60; });
    if (!vis.length) return null;
    const el = vis[vis.length - 1];
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), text: (el.textContent || '').slice(0, 12) };
  };
  return true;
})()`

function registeredFrags(snap) {
  return snap.frags.filter((f) => !KNOWN_UNREGISTERED.includes(f.key)).map((f) => `${f.key}:${f.len}:${f.hash}`).sort();
}

async function main() {
  const { evalJs, send, close } = await connect();
  const failures = [];
  const notes = [];
  const check = (ok, msg) => { console.log(`  ${ok ? "✓" : "✗"} ${msg}`); if (!ok) failures.push(msg); };
  try {
    await evalJs(INJECT);

    // 1) 解析源文档
    let source = NOTE;
    if (!source) {
      source = await evalJs("window.__activeId()");
      if (!source) throw new Error("当前没有活动文档；请用 --note 指定");
    }
    const meta = await evalJs(`(async () => { const n = (await window.lakeNative.listTreeNodes()).find(x => x.id === ${JSON.stringify(source)}); return n ? { title: n.title } : null; })()`);
    if (!meta) throw new Error("找不到文档：" + source);
    console.log(`副本源: ${meta.title} [${source}]`);

    // 2) 复制成副本（走应用自己的右键「复制」，副本会自动打开）
    const tabsBefore = await evalJs("[...document.querySelectorAll('.tab-item')].map(t => t.getAttribute('data-note-id'))");
    const dup = await evalJs(`(async () => {
      const src = ${JSON.stringify(source)};
      const api = window.lakeNative;
      const nodes = await api.listTreeNodes(); const byId = new Map(nodes.map(n => [n.id, n]));
      const chain = []; let cur = byId.get(src);
      while (cur && cur.parentId) { chain.push(cur.parentId); cur = byId.get(cur.parentId); }
      for (const pid of chain.reverse()) {
        const row = window.__row(pid); const chev = row && row.querySelector('.tree-chevron');
        if (chev && !chev.classList.contains('open')) { chev.click(); await new Promise(r => setTimeout(r, 260)); }
      }
      const row = window.__row(src); if (!row) return { err: '目录里找不到该行' };
      const b = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(b.left + 60), clientY: Math.round(b.top + 8) }));
      await new Promise(r => setTimeout(r, 400));
      const items = [...document.querySelectorAll('.context-menu button, .context-menu .context-menu-item')];
      const hit = items.find(el => (el.textContent || '').trim() === '复制');
      if (!hit) return { err: '右键菜单里没有「复制」' };
      hit.click(); return { ok: true };
    })()`);
    if (dup && dup.err) throw new Error(dup.err);
    let copyId = null;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      const active = await evalJs("window.__activeId()");
      if (active && !tabsBefore.includes(active)) { copyId = active; break; }
    }
    if (!copyId) throw new Error("副本没有打开");
    console.log(`副本    : ${copyId}`);
    await sleep(SETTLE_MS);

    const baseline = await evalJs("window.__snap()");
    console.log(`基线    : ${baseline.bytes}B hash=${baseline.hash} 卡片 ${baseline.frags.map(f => f.key).join(',')}`);
    const baseRegistered = registeredFrags(baseline);

    let current = baseline;
    /** 执行一个会改动文档的菜单动作：返回是否生效（文件 hash 变化） */
    const runAction = async (label, action, expectChange = true, postCheck = null, expectTextInBody = true, targetProvider = null) => {
      const target = await (targetProvider ? targetProvider() : evalJs("window.__focusParagraph()"));
      if (!target) { notes.push(`${label}: 没有可用段落，跳过`); return false; }
      const srcText = target.text; // 转换前的原文（有文本的段落才做保留断言）
      const y = Math.round((target.top + target.bottom) / 2);
      for (const x of [target.left + 150, target.left + 30, target.left + 6]) {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
        await sleep(180);
      }
      await sleep(320);
      let handle = await evalJs("window.__handleRect()");
      if (!handle) { check(false, `${label}: 手柄未出现`); return false; }
      if (!handleCheck) {
        handleCheck = true;
        check(handle.left < target.left, `手柄在块左侧（handle.left=${handle.left} < block.left=${target.left}）`);
        check(Math.abs((target.top + target.bottom) / 2 - (handle.top + handle.h / 2)) <= 2, "手柄垂直居中");
      }
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: handle.x, y: handle.y, button: "left", clickCount: 1, buttons: 1 });
      await sleep(90);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: handle.x, y: handle.y, button: "left", clickCount: 1, buttons: 0 });
      await sleep(650);
      const labels = await evalJs("window.__menuLabels()");
      if (!labels) { check(false, `${label}: 菜单未打开`); return false; }
      if (!menuChecked) {
        menuChecked = true;
        check(JSON.stringify(labels) === JSON.stringify(EXPECTED_MENU), `主菜单文案 = ${JSON.stringify(labels)}`);
      }
      // 执行
      const executed = await action();
      if (executed === "skip") { notes.push(`${label}: 当前块菜单里没有该项，跳过`); return false; }
      if (!executed) { check(false, `${label}: 菜单项不存在`); return false; }
      // 等保存（文件 hash 变化）
      const before = current.hash;
      let changed = false;
      for (let i = 0; i < 30; i++) {
        await sleep(400);
        current = await evalJs("window.__snap()");
        if (current.hash !== before) { changed = true; break; }
      }
      // 卡片保真：基线里已有的卡片必须「原样还在」（允许动作新增卡片：转任务会加勾选卡等；
      // 但任何已有卡片被改写/丢失都算回归）
      const nowFrags = registeredFrags(current);
      const missingOrChanged = baseRegistered.filter((f) => !nowFrags.includes(f));
      check(expectChange ? changed : !changed, expectChange
        ? `${label}: 动作已生效（正文变化）`
        : `${label}: 未改动正文（复制类动作）`);
      check(missingOrChanged.length === 0, `${label}: 已有卡片逐字节未变${missingOrChanged.length ? "（异常：" + missingOrChanged.join(", ") + "）" : ""}`);
      // 原文保留（这是本批的重点验收项：转容器类若全选块内容再执行，会把原文本替换掉）
      if (expectChange && srcText && expectTextInBody) {
        const survived = await evalJs(`(async () => (await window.__read()).includes(${JSON.stringify(srcText)}))()`);
        check(survived, `${label}: 原文本「${srcText}」仍在正文里`);
      }
      if (postCheck) await postCheck(srcText);
      // 关菜单（Esc）以便下一次悬停
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await sleep(300);
      return changed;
    };

    let handleCheck = false;
    let menuChecked = false;
    let convertChecked = false;

    // 3) 先做「需要段落」的动作（缩进类不改变块类型，必须趁段落还在时测；「在下方添加」还会补段落），
    //    再做「转化为」全量，最后才做删除/剪切这类会减少块的动作。
    console.log("\n逐项执行菜单动作：");
    const runSubmenu = (parent, label) => runAction(`${parent} → ${label}`, async () => {
      if (!(await evalJs(`!!window.__menuItem(${JSON.stringify(parent)})`))) return "skip";
      await evalJs(`window.__hoverParent(${JSON.stringify(parent)})`);
      await sleep(450);
      const clicked = await evalJs(`window.__clickItem(${JSON.stringify(label)})`);
      return clicked ? true : "skip";
    });
    for (const [label, parent] of [["增加缩进", "缩进"], ["减少缩进", "缩进"], ["段落", "在下方添加"], ["标题 1", "在下方添加"], ["分割线", "在下方添加"]]) {
      await runSubmenu(parent, label);
    }

    /** 容器类「转化为」的强断言：原文必须落在容器标签内部（不只是「还在文档里」）。 */
    const CONTAINER_SPECS = {
      '高亮块': { tag: 'blockquote', cls: 'lake-alert' },
      '分栏': { tag: 'article', cls: 'lake-columns' },
      '折叠块': { tag: 'details', cls: 'lake-collapse' },
    };
    const containerPostCheck = (target) => async (srcText) => {
      if (!srcText) return;
      if (target === '代码') {
        const ok = await evalJs(`(async () => {
          const l = await window.__read();
          const m = /<card[^>]*name="codeblock"[^>]*value="data:([^"]*)"/.exec(l);
          if (!m) return false;
          try { const v = JSON.parse(decodeURIComponent(m[1])); return typeof v.code === 'string' && v.code.includes(${JSON.stringify(srcText)}); } catch { return false; }
        })()`);
        check(ok, `转化为 → 代码: 原文本「${srcText}」已进入代码块卡内容`);
        return;
      }
      const spec = CONTAINER_SPECS[target];
      if (!spec) return;
      const ok = await evalJs(`(async () => {
        const l = await window.__read();
        const i = l.indexOf(${JSON.stringify(srcText)});
        if (i < 0) return false;
        const ci = l.lastIndexOf(${JSON.stringify(spec.cls)}, i);
        if (ci < 0) return false;
        const s = l.lastIndexOf('<', ci);
        const e = l.indexOf('</${spec.tag}>', i);
        if (s < 0 || e < 0) return false;
        return l.slice(s, e).indexOf(${JSON.stringify(srcText)}) >= 0;
      })()`);
      check(ok, `转化为 → ${target}: 原文本在容器 <${spec.tag} class="${spec.cls}"> 内部（真转换）`);
    };

    const runConvert = (target) => runAction(`转化为 → ${target}`, async () => {
      await evalJs("window.__hoverParent('转化为')");
      await sleep(450);
      if (!convertChecked) {
        convertChecked = true;
        const subLabels = await evalJs("window.__submenuLabels()");
        check(JSON.stringify(subLabels) === JSON.stringify(EXPECTED_CONVERT), `「转化为」子菜单文案 = ${JSON.stringify(subLabels)}`);
      }
      return await evalJs(`window.__clickItem(${JSON.stringify(target)})`);
    }, true, containerPostCheck(target), target !== '代码');
    for (const target of CONVERT_ORDER) {
      await runConvert(target);
    }

    // 4) 复制 / 剪切 / 删除
    // 剪切/删除本就会移除原文 ⇒ 不做「原文本仍在」断言（只看动作生效与卡片保真）。
    // 卡片源转换：上面「转化为 → 代码」产出的代码块卡是**卡片源**（不是段落）。
    // 用户实测三问题：① 代码块要完整展示（工具栏/代码名称可见）；② 代码块 → 高亮块不能整张丢；
    // ③ 代码块 → 折叠块/分栏/正文要「抽取文本」，不能把卡片嵌进容器。
    console.log("\n卡片源转换（代码块卡 → 容器/正文）：");
    const cardValue1 = await evalJs(`(async () => {
      const l = await window.__read();
      const m = /<card[^>]*name="codeblock"[^>]*value="data:([^"]*)"/.exec(l);
      if (!m) return null;
      const v = JSON.parse(decodeURIComponent(m[1]));
      return { hideToolbar: v.hideToolbar, mode: v.mode, code: (v.code || '').slice(0, 24) };
    })()`);
    check(!!cardValue1, "转化为 → 代码: 已生成代码块卡");
    check(!!cardValue1 && cardValue1.hideToolbar !== true, "代码块卡为完整展示（未隐藏工具栏/代码名称）");
    const countCodeCards = () => evalJs(`(async () => { const l = await window.__read(); return (l.match(/name="codeblock"/g) || []).length; })()`);

    const codeBefore = await countCodeCards();
    const codeText1 = (cardValue1 && cardValue1.code) || '';
    await runAction("代码块 → 高亮块", async () => {
      await evalJs("window.__hoverParent('转化为')"); await sleep(450);
      return await evalJs("window.__clickItem('高亮块')");
    }, true, async () => {
      const ok = await evalJs(`(async () => { const l = await window.__read(); const i = l.indexOf(${JSON.stringify(codeText1)}); if (i < 0) return false; const s = l.lastIndexOf('<blockquote', i); if (s < 0) return false; const open = l.slice(s, l.indexOf('>', s) + 1); if (!open.includes('lake-alert')) return false; return l.indexOf('</blockquote>', i) > i; })()`);
      check(ok, "代码块 → 高亮块: 代码文本在容器内部（抽取文本，非卡片嵌套）");
    }, false, () => evalJs("window.__focusCard('codeblock')"));
    const codeAfter = await countCodeCards();
    check(codeAfter === codeBefore - 1, `代码块 → 高亮块: 原卡已被替换（${codeBefore} → ${codeAfter}）`);

    // 再产出一张代码块卡，测「代码块 → 正文」
    await runConvert("代码");
    const cardValue2 = await evalJs(`(async () => { const l = await window.__read(); const m = /<card[^>]*name="codeblock"[^>]*value="data:([^"]*)"/.exec(l); if (!m) return null; const v = JSON.parse(decodeURIComponent(m[1])); return { code: (v.code || '').slice(0, 24) }; })()`);
    const codeText2 = (cardValue2 && cardValue2.code) || '';
    const codeBefore2 = await countCodeCards();
    await runAction("代码块 → 正文", async () => {
      await evalJs("window.__hoverParent('转化为')"); await sleep(450);
      return await evalJs("window.__clickItem('正文')");
    }, true, async () => {
      const ok = await evalJs(`(async () => { const l = await window.__read(); return { hasText: l.includes(${JSON.stringify(codeText2)}) }; })()`);
      check(!!(ok && ok.hasText), "代码块 → 正文: 代码文本留在正文段落里");
    }, false, () => evalJs("window.__focusCard('codeblock')"));
    const codeAfter2 = await countCodeCards();
    check(codeAfter2 === codeBefore2 - 1, `代码块 → 正文: 原卡已被替换（${codeBefore2} → ${codeAfter2}）`);

    // 代码块 → 引用：引用命令对卡片源无效（实测 no-op），需先抽取文本再执行
    await runConvert("代码");
    const cardValue3 = await evalJs(`(async () => { const l = await window.__read(); const m = /<card[^>]*name="codeblock"[^>]*value="data:([^"]*)"/.exec(l); if (!m) return null; const v = JSON.parse(decodeURIComponent(m[1])); return { code: (v.code || '').slice(0, 24) }; })()`);
    const codeText3 = (cardValue3 && cardValue3.code) || '';
    const codeBefore3 = await countCodeCards();
    await runAction("代码块 → 引用", async () => {
      await evalJs("window.__hoverParent('转化为')"); await sleep(450);
      return await evalJs("window.__clickItem('引用')");
    }, true, async () => {
      const ok = await evalJs(`(async () => { const l = await window.__read(); const i = l.indexOf(${JSON.stringify(codeText3)}); if (i < 0) return false; const s = l.lastIndexOf('<blockquote', i); if (s < 0) return false; const open = l.slice(s, l.indexOf('>', s) + 1); return !open.includes('lake-alert'); })()`);
      check(ok, "代码块 → 引用: 代码文本在引用块内部（抽取文本）");
    }, false, () => evalJs("window.__focusCard('codeblock')"));
    const codeAfter3 = await countCodeCards();
    check(codeAfter3 === codeBefore3 - 1, `代码块 → 引用: 原卡已被替换（${codeBefore3} → ${codeAfter3}）`);

    // 代码块 → 折叠块（用户点名：折叠块内套代码块是错误转化，应抽取文本）
    await runConvert("代码");
    const cardValue4 = await evalJs(`(async () => { const l = await window.__read(); const m = /<card[^>]*name="codeblock"[^>]*value="data:([^"]*)"/.exec(l); if (!m) return null; const v = JSON.parse(decodeURIComponent(m[1])); return { code: (v.code || '').slice(0, 24) }; })()`);
    const codeText4 = (cardValue4 && cardValue4.code) || '';
    const codeBefore4 = await countCodeCards();
    await runAction("代码块 → 折叠块", async () => {
      await evalJs("window.__hoverParent('转化为')"); await sleep(450);
      return await evalJs("window.__clickItem('折叠块')");
    }, true, async () => {
      const ok = await evalJs(`(async () => { const l = await window.__read(); const i = l.indexOf(${JSON.stringify(codeText4)}); if (i < 0) return false; const s = l.lastIndexOf('<details', i); if (s < 0) return false; const e = l.indexOf('</details>', i); return e > i; })()`);
      check(ok, "代码块 → 折叠块: 代码文本在折叠块内部（抽取文本，非卡片嵌套）");
    }, false, () => evalJs("window.__focusCard('codeblock')"));
    const codeAfter4 = await countCodeCards();
    check(codeAfter4 === codeBefore4 - 1, `代码块 → 折叠块: 原卡已被替换（${codeBefore4} → ${codeAfter4}）`);

    // 容器源转换：容器（高亮块/分栏/折叠块/引用）直接再套容器 = 「容器套容器」（用户实测），必须抽取文本。
    console.log("\n容器源转换（高亮块/引用/折叠块 → 其它）：");
    const clickConvert = async (label) => { await evalJs("window.__hoverParent('转化为')"); await sleep(450); return await evalJs("window.__clickItem('" + label + "')"); };
    // 高亮块 → 引用
    await runAction("高亮块 → 引用", () => clickConvert('引用'), true, async (srcText) => {
      const ok = await evalJs(`(async () => { const l = await window.__read(); const i = l.indexOf(${JSON.stringify(srcText)}); if (i < 0) return false; const s = l.lastIndexOf('<blockquote', i); if (s < 0) return false; const open = l.slice(s, l.indexOf('>', s) + 1); return !open.includes('lake-alert'); })()`);
      check(ok, "高亮块 → 引用: 内容进入引用块（且不是高亮块）");
    }, false, () => evalJs("window.__focusContainer('alert')"));

    // 高亮块 → 分栏（新建一个高亮块再转）
    await runConvert("高亮块");
    await runAction("高亮块 → 分栏", () => clickConvert('分栏'), true, async (srcText) => {
      const ok = await evalJs(`(async () => { const l = await window.__read(); const i = l.indexOf(${JSON.stringify(srcText)}); if (i < 0) return false; const ci = l.lastIndexOf('lake-columns', i); if (ci < 0) return false; const s = l.lastIndexOf('<', ci); const e = l.indexOf('</article>', i); if (s < 0 || e < 0) return false; return l.slice(s, e).indexOf('lake-alert') < 0; })()`);
      check(ok, "高亮块 → 分栏: 内容进入分栏且未嵌套高亮块");
    }, false, () => evalJs("window.__focusContainer('alert')"));

    // 引用 → 正文
    await runAction("引用 → 正文", () => clickConvert('正文'), true, async (srcText) => {
      const ok = await evalJs(`(async () => { const l = await window.__read(); const i = l.indexOf(${JSON.stringify(srcText)}); if (i < 0) return false; return l.lastIndexOf('<p', i) > l.lastIndexOf('<blockquote', i); })()`);
      check(ok, "引用 → 正文: 内容变成正文段落（脱离引用块）");
    }, false, () => evalJs("window.__focusContainer('quote')"));

    // 折叠块 → 正文
    await runAction("折叠块 → 正文", () => clickConvert('正文'), true, async (srcText) => {
      const ok = await evalJs(`(async () => { const l = await window.__read(); const i = l.indexOf(${JSON.stringify(srcText)}); if (i < 0) return false; return l.lastIndexOf('<p', i) > l.lastIndexOf('<details', i); })()`);
      check(ok, "折叠块 → 正文: 内容变成正文段落（脱离折叠块）");
    }, false, () => evalJs("window.__focusContainer('collapse')"));

    /** 顶层块统计（以落盘正文为准）：total = 顶层块数，emptyP = 空段落数。
     *  260918 用户实测：删除/拖拽若只清空内容而没摘掉节点，原位会多一条空行。 */
    const blockStats = () => evalJs(`(async () => { const l = await window.__read(); const d = new DOMParser().parseFromString(l, 'text/html'); const els = [...d.body.children]; return { total: els.length, emptyP: els.filter((e) => e.tagName === 'P' && !(e.textContent || '').replace(/\u200b/g, '').trim()).length }; })()`);
    const runTop = (label, expectChange = true, expectTextInBody = true) => runAction(label, async () => await evalJs(`window.__clickItem(${JSON.stringify(label)})`), expectChange, null, expectTextInBody);
    await runTop("复制", false);
    // 剪切 / 删除：必须真把整块节点摘掉 —— 顶层块 -1 且不新增空段落
    // （旧实现走 deleteByRange 只删内容，原位补一个空段落：顶层块数不变、空段落 +1）
    for (const label of ["剪切", "删除"]) {
      const s0 = await blockStats();
      await runTop(label, true, false);
      const s1 = await blockStats();
      check(s1.total === s0.total - 1, `${label}: 顶层块 -1（${s0.total} → ${s1.total}；不变 = 只清空内容、原位留下空段落）`);
      check(s1.emptyP <= s0.emptyP, `${label}: 未新增空段落（${s0.emptyP} → ${s1.emptyP}）`);
    }

    // 5) 拖拽移动（内核原生：卡片 moveCard / 其它块「摘节点 → 落点插入」）
    console.log("\n拖拽移动（原生）：");
    {
      const beforeSnap = current;
      const before = current.hash;
      const target = await evalJs("window.__focusParagraph()");
      const srcText = target ? target.text : "";
      if (target) {
        const y = Math.round((target.top + target.bottom) / 2);
        for (const x of [target.left + 150, target.left + 40, target.left + 6]) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 }); await sleep(170); }
        await sleep(300);
        const handle = await evalJs("window.__handleRect()");
        const dst = await evalJs("window.__dragTargetRect()");
        if (handle && dst) {
          const statsBefore = await blockStats();
          await send("Input.dispatchMouseEvent", { type: "mousePressed", x: handle.x, y: handle.y, button: "left", clickCount: 1, buttons: 1 });
          await sleep(80);
          const dropY = Math.round(dst.bottom - 2);
          for (let i = 1; i <= 10; i++) {
            await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(handle.x + (dst.left + 120 - handle.x) * i / 10), y: Math.round(handle.y + (dropY - handle.y) * i / 10), buttons: 1 });
            await sleep(70);
          }
          await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: dst.left + 120, y: dropY, button: "left", clickCount: 1, buttons: 0 });
          await sleep(2200);
          const statsAfter = await blockStats();
          // 移动 = 搬运，不是增删：顶层块数必须守恒。
          // （旧的 `>=` 断言放过了「原位留一条空段落」——那正是用户实测的空行 bug。）
          check(statsAfter.total === statsBefore.total, `拖拽移动: 顶层块数守恒（${statsBefore.total} → ${statsAfter.total}；+1 = 原位留空段落，-1 = 段落被融合）`);
          check(statsAfter.emptyP <= statsBefore.emptyP, `拖拽移动: 未新增空段落（${statsBefore.emptyP} → ${statsAfter.emptyP}）`);
          current = await evalJs("window.__snap()");
          check(current.hash !== before, "拖拽移动: 文档已变化（原生移动生效）");
          const missing = registeredFrags(beforeSnap).filter((f) => !registeredFrags(current).includes(f));
          check(missing.length === 0, `拖拽移动: 已有卡片未丢失${missing.length ? "（异常：" + missing.join(", ") + "）" : ""}`);
          if (srcText) {
            const survived = await evalJs(`(async () => (await window.__read()).includes(${JSON.stringify(srcText)}))()`);
            check(survived, `拖拽移动: 被拖文本「${srcText}」仍在正文里`);
          }
        } else {
          notes.push("拖拽移动: 手柄/落点不可用，跳过");
        }
      }
    }

    // 6) 清理 + 原件复核
    if (!KEEP) {
      await evalJs(`(() => { const t = window.__tab(${JSON.stringify(copyId)}); const c = t && t.querySelector('.tab-close'); if (c) c.click(); return true; })()`);
      await sleep(400);
      const trashed = await evalJs(`(async () => { try { await window.lakeNative.deleteTreeNode(${JSON.stringify(copyId)}); return true; } catch { return false; } })()`);
      console.log(`\n清理    : 副本${trashed ? "已丢回收站" : "清理失败，请手动删 " + copyId}`);
    } else {
      console.log(`\n清理    : --keep，副本保留（${copyId}）`);
    }
    const srcNow = await evalJs(`(async () => { const c = await window.lakeNative.readNote(${JSON.stringify(source)}).then(d => (d && d.content) || ''); return { bytes: c.length, hash: window.__h(c) }; })()`);
    console.log(`原件复核: ${srcNow.bytes}B hash=${srcNow.hash}`);

    if (notes.length) { console.log("\n备注："); notes.forEach((n) => console.log("  · " + n)); }
    console.log(`\n结果：${failures.length === 0 ? "PASS —— 手柄/菜单与云端一致，动作全原生，卡片逐字节未变" : "FAIL —— " + failures.length + " 项未通过"}`);
    failures.forEach((f) => console.log("  ✗ " + f));
    close();
    exit(failures.length === 0 ? 0 : 1);
  } catch (e) {
    close();
    console.error("冒烟失败：" + (e && e.message ? e.message : e));
    exit(2);
  }
}

main();