#!/usr/bin/env node
/**
 * usheet（Univer 表格）**内核契约运行时探针** —— 升级 @univerjs/* 之后跑这个。
 *
 * 静态存在性由 \`src/features/usheet/univerContract.test.ts\` 在 npm test 时守；本脚本守**运行时行为**
 * （静态符号还在、但语义变了的情况，例如"粘贴图片又变回浮动图"）。每条探针都对应
 * \`src/features/usheet/usheetKernelContract.ts\` 里的一个触点。
 *
 * 用法：
 *   npx vite build                                  # scheme 模式服务 dist/（本脚本不自动 build）
 *   node scripts/usheet-kernel-probes.mjs           # 默认 CDP 9241
 *   node scripts/usheet-kernel-probes.mjs --keep    # 保留隔离 userData（默认每次清空重建）
 *
 * 隔离：只用 $TMPDIR/lake-usheet-probes 这个 userData，**不碰开发/正式数据**；结束 kill 自己拉起的实例。
 * 退出码：0 = 全过；1 = 有探针失败（= 内核契约漂移，按 docs/USHEET-UPGRADE.md 逐条核对）。
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const REPO = path.resolve(import.meta.dirname, "..");
const require2 = createRequire(path.join(REPO, "package.json"));
const sharp = require2("sharp");
const DEST = path.join(os.tmpdir(), "lake-usheet-probes");
const PORT = Number(process.env.LAKE_CDP_PORT || 9241);
const ASSET = String(Number(process.env.LAKE_ASSET_PORT || 19892));
const KEEP = process.argv.includes("--keep");
const PNG = path.join(os.tmpdir(), "usheet-probe.png");
const NL = String.fromCharCode(10);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * 探针分两类：
 *  - **致命**（默认）：结论只依赖我们自己的代码/产物，可以确定性判定；
 *  - **提示**（advisory）：依赖内核对"合成输入"的处理（浮动图插入、右键菜单悬停）——无 OS 焦点时偶发，
 *    只做提示、不影响退出码（要强制也失败就加 --strict）。
 */
const results = [];
const STRICT = process.argv.includes("--strict");
function record(name, ok, detail, advisory) {
  results.push({ name, ok, detail, advisory: Boolean(advisory) });
  const tag = ok ? "[PASS] " : (advisory ? "[WARN] " : "[FAIL] ");
  console.log("  " + tag + name + (detail ? "  —— " + detail : ""));
}

let child = null, socket = null, seq = 0;
const pending = new Map();

async function connect() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
      const t = list.find((x) => x.type === "page");
      if (t) {
        socket = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
        socket.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
        return;
      }
    } catch { /* retry */ }
    await wait(250);
  }
  throw new Error("CDP 未就绪（" + PORT + "）");
}
function send(method, params) { return new Promise((res) => { const id = ++seq; pending.set(id, res); socket.send(JSON.stringify({ id, method, params: params || {} })); }); }
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) throw new Error("evaluate: " + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result ? r.result.result.value : undefined;
}
async function waitFor(expr, timeout) { const d = Date.now() + (timeout || 30000); while (Date.now() < d) { try { if (await evaluate(expr)) return true; } catch { /* ignore */ } await wait(150); } return false; }
/** 真（trusted）左键点一下表格中部：让 Univer 网格拿到焦点/选区（粘贴落点判据依赖"有活动单元格"）。 */
async function focusGrid() {
  // 点**网格画布**（高度 > 200 的那块）：手工 E2E 验证过这个姿势能给网格建立选区。
  // 顺带读名称框真实值（它是 <input>，读 value 不是 textContent）——"有没有活动单元格"的可观测判据。
  const canvas = await evaluate("(function () { var best = null; document.querySelectorAll('.usheet-editor canvas').forEach(function (c) { var r = c.getBoundingClientRect(); if (r.height > 200 && (!best || r.width * r.height > best.w * best.h)) best = { x: Math.round(r.left + 120), y: Math.round(r.top + 60) }; }); return best; })()");
  if (!canvas) return { clicked: false, nameBox: null };
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: canvas.x, y: canvas.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: canvas.x, y: canvas.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: canvas.x, y: canvas.y, button: "left", clickCount: 1 });
  await wait(600);
  const nameBox = await evaluate("(function () { var el = document.querySelector('[data-u-comp=defined-name]'); if (!el) return null; return (el.value !== undefined && el.value !== null && el.value !== '') ? el.value : (el.textContent || '').trim(); })()");
  return { clicked: true, nameBox };
}

async function clickInPage(selector) {
  const ok = await evaluate("(function () { var el = document.querySelector(" + JSON.stringify(selector) + "); if (!el) return false; el.click(); return true; })()");
  if (!ok) throw new Error("未找到元素 " + selector);
}
async function ensureRow(nodeId) {
  const sel = '[data-tree-node-id="' + nodeId + '"]';
  for (let i = 0; i < 14; i++) {
    if (await evaluate("Boolean(document.querySelector(" + JSON.stringify(sel) + "))")) {
      await evaluate("(function () { var el = document.querySelector(" + JSON.stringify(sel) + "); el.scrollIntoView({ block: 'center' }); return true; })()");
      return true;
    }
    const more = await evaluate("(function () { var c = [...document.querySelectorAll('.tree-chevron')].find(function (e) { return !e.disabled && !e.classList.contains('open'); }); if (!c) return false; c.click(); return true; })()");
    if (!more) break;
    await wait(200);
  }
  return await evaluate("Boolean(document.querySelector(" + JSON.stringify(sel) + "))");
}

function bodyPath(noteId) { return path.join(DEST, "workspace-default", "usheets", noteId + ".usheet.json"); }
function readBody(noteId) { return JSON.parse(fs.readFileSync(bodyPath(noteId), "utf8")); }
function sheetSummary(noteId) {
  const wb = readBody(noteId).workbook;
  const sheets = Object.values(wb.sheets);
  const first = sheets[0];
  return { count: sheets.length, rows: first.rowCount, cols: first.columnCount, sheets: sheets.map((s) => s.name + ":" + s.rowCount + "x" + s.columnCount) };
}
/** 图片落点统计（跨**所有**工作表；粘贴时的活动表不一定是第一个）。
 *  - 单元格图片 = 单元格富文本里的内联 drawing（cellData 里出现 drawingType）；
 *  - 浮动图 = 总 drawingId 数 − 单元格内联数（浮动图存在 workbook.resources 的 SHEET_DRAWING_PLUGIN 里）。 */
function imageStats(noteId) {
  const txt = fs.readFileSync(bodyPath(noteId), "utf8");
  const doc = JSON.parse(txt);
  const sheets = Object.values(doc.workbook.sheets);
  const cellText = JSON.stringify(sheets.map((s) => s.cellData || {}));
  const drawingsInCells = (cellText.match(/"drawingType"/g) || []).length;
  const totalDrawings = (txt.match(/"drawingId"/g) || []).length;
  return { drawingsInCells, floatDrawings: Math.max(0, totalDrawings - drawingsInCells) };
}
/** 合成一次粘贴。目标元素很重要：
 *  - 单图走**我们的**处理器（只要落在宿主内即可）；
 *  - 多图我们要**放行**给内核，而内核的剪贴板控制器认的是它自己的画布/焦点元素 ⇒ 目标取
 *    "宿主内的 activeElement → 网格画布 → 宿主"，否则内核收不到，表现为"两张图凭空消失"（探针踩过）。 */
const PASTE_ONCE = (b64, two) => "(async function () { var b64 = " + JSON.stringify(b64) + "; var bin = atob(b64); var arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); var dt = new DataTransfer(); dt.items.add(new File([arr], 'probe-a.png', { type: 'image/png' })); " + (two ? "dt.items.add(new File([arr], 'probe-b.png', { type: 'image/png' })); " : "") + "var host = document.querySelector('.usheet-editor'); var inside = function (n) { return n && host && host.contains(n); }; var canvas = [...document.querySelectorAll('.usheet-editor canvas')].filter(function (c) { return c.getBoundingClientRect().height > 200; })[0] || null; var target = (inside(document.activeElement) ? document.activeElement : null) || canvas || host || document.body; var ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); target.dispatchEvent(ev); return { prevented: ev.defaultPrevented }; })()";

(async () => {
  const univerVersion = JSON.parse(fs.readFileSync(path.join(REPO, "node_modules/@univerjs/presets/package.json"), "utf8")).version;
  console.log("== usheet 内核契约探针（Univer " + univerVersion + "）");
  if (!fs.existsSync(path.join(REPO, "dist/index.html"))) throw new Error("dist/ 不存在：先 npx vite build");
  await sharp({ create: { width: 48, height: 32, channels: 4, background: { r: 30, g: 120, b: 220, alpha: 1 } } }).png().toFile(PNG);
  const b64 = fs.readFileSync(PNG).toString("base64");
  if (!KEEP) execSync('rm -rf "' + DEST + '"', { stdio: "pipe" });
  fs.mkdirSync(DEST, { recursive: true });

  const app = path.join(REPO, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
  const env = Object.assign({}, process.env, { LAKE_RENDERER: "scheme", LAKE_USER_DATA: DEST, LAKE_ASSET_PORT: ASSET });
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(app, [".", "--remote-debugging-port=" + PORT, "--no-sandbox"], { cwd: REPO, env, stdio: "ignore" });
  await connect();
  await send("Runtime.enable"); await send("Page.enable");
  const ready = await waitFor("document.readyState === 'complete' && Boolean(window.lakeNative)", 90000);
  if (!ready) throw new Error("应用未就绪（窗口没起来？看 $TMPDIR/lake-usheet-probes/logs）");
  await wait(2000);

  // 关掉恢复的标签，保证从干净状态开始
  for (let i = 0; i < 6; i++) {
    const has = await evaluate("Boolean(document.querySelector('.tab-bar .tab-close[aria-label^=\"关闭\"]'))");
    if (!has) break;
    await evaluate("(function () { var el = document.querySelector('.tab-bar .tab-close[aria-label^=\"关闭\"]'); if (el) el.click(); return true; })()");
    await wait(300);
  }

  // 1) 新建表格文档（走 store.createUsheetIn → core/usheetDoc.emptyUsheetBody）
  const created = await evaluate("window.lakeNative.createUsheetIn(null, 'kernel-probe')");
  const noteId = created && created.id ? created.id : created;
  await wait(1200);
  const s1 = sheetSummary(noteId);
  record("新建表格文档 = 50 行 × 16 列（core/usheetDoc）", s1.rows === 50 && s1.cols === 16, JSON.stringify(s1));

  // 打开它
  if (!(await ensureRow(noteId))) throw new Error("树里找不到新文档");
  await clickInPage('[data-tree-node-id="' + noteId + '"]');
  await waitFor("Boolean(document.querySelector('[data-u-comp=defined-name]')) && Boolean(document.querySelector('[data-u-comp=sheet-bar-append-button]'))", 60000);
  await wait(2500);

  // 2) 计算条高度（我们在 usheetEditor.css 里把内核行内 36px 覆盖成 30px）
  const bar = await evaluate("(function () { var bar = document.querySelector('[data-u-comp=slide-tab-bar]'); var sec = bar ? bar.closest('section') : null; var st = document.querySelector('.document-statusbar'); var ws = document.querySelector('.workspace'); return { barH: bar ? Math.round(bar.getBoundingClientRect().height) : null, sectionH: sec ? Math.round(sec.getBoundingClientRect().height) : null, tabH: (document.querySelector('[data-u-comp=slide-tab-item]') || {}).getBoundingClientRect ? Math.round(document.querySelector('[data-u-comp=slide-tab-item]').getBoundingClientRect().height) : null, statusBottom: st ? getComputedStyle(st).bottom : null, statusVar: ws ? ws.style.getPropertyValue('--usheet-status-bottom') : null }; })()");
  record("计算条压到 30px（CSS 覆盖内核行内 height 仍生效）", bar.sectionH === 30 && bar.tabH === 28, JSON.stringify(bar));
  record("状态栏让位变量已实测写入（--usheet-status-bottom）", Boolean(bar.statusVar), JSON.stringify({ statusBottom: bar.statusBottom, statusVar: bar.statusVar }));

  // 2b) 内核 floating 层（CanvasPopup：cell popup / **CellAlert 黄叹号** / 下拉 / 日期 / 颜色 / 选区）必须在**我们的标签宿主内**。
  //     补丁前它挂在 document.body（patches/@univerjs+ui+1.0.3.patch）⇒ keep-alive 的隐藏对它无效、切文档后浮层残留（用户 261009 报）。
  const floatLayer = await evaluate("(function () { var el = document.querySelector('[data-lake-univer-floating]'); if (!el) return { found: false }; var host = document.querySelector('.usheet-editor'); return { found: true, inHost: Boolean(host && host.contains(el)), inUniverRoot: Boolean(el.closest('.usheet-univer-root')), atBody: el.parentElement === document.body, visibility: getComputedStyle(el).visibility }; })()");
  record("内核 floating 容器在表格宿主内（@univerjs/ui 补丁生效）", floatLayer.found && floatLayer.inHost && floatLayer.inUniverRoot && !floatLayer.atBody, JSON.stringify(floatLayer));

  // 3) 工作表标签「＋」→ footer 配置的 50×16
  await clickInPage('[data-u-comp="sheet-bar-append-button"]');
  await wait(4000);
  const s2 = sheetSummary(noteId);
  const added = s2.sheets.find((x) => x.indexOf("Sheet1") !== 0);
  record("工作表「＋」= 50 行 × 16 列（preset footer 配置）", Boolean(added) && added.indexOf(":50x16") > 0, JSON.stringify(s2));

  // 4) 单图粘贴 → 单元格图片
  //    ⚠️ 上一步「＋」把活动表切到了新工作表，而**新表没有活动单元格** ⇒ 按我们的落点规则会回退浮动图。
  //    所以先切回第一个工作表，再用真左键点网格建立选区（这一步等价于真实用户"点一下格子再粘贴"）。
  await evaluate("(function () { var tabs = [...document.querySelectorAll('[data-u-comp=slide-tab-item]')]; if (tabs[0]) tabs[0].click(); return tabs.length; })()");
  await wait(800);
  await focusGrid();
  const singleEvent = await evaluate(PASTE_ONCE(b64, false));
  await wait(4000);
  const single = imageStats(noteId);
  record("单图粘贴 → 我们接管（preventDefault）+ 落单元格图片", singleEvent && singleEvent.prevented === true && single.drawingsInCells >= 1 && single.floatDrawings === 0, JSON.stringify({ event: singleEvent, body: single }));

  // 5) 双图粘贴 → **我们放行**给内核（不 preventDefault）⇒ 内核按自己的逻辑插浮动图
  await focusGrid();
  const twoEvent = await evaluate(PASTE_ONCE(b64, true));
  await wait(4000);
  const two = imageStats(noteId);
  // 合成事件的 defaultPrevented 也会受"谁先处理"影响 ⇒ 与"最终落成浮动图"一起归入提示项
  record("（提示）双图粘贴 → 我们放行（未 preventDefault，交内核插浮动图）", twoEvent && twoEvent.prevented === false, JSON.stringify(twoEvent), true);
  record("（提示）双图最终落成 2 张浮动图", two.floatDrawings >= 2, JSON.stringify(two), true);

  // 6) 右键「插入」子菜单里有我们的项
  // 右键菜单 + 悬停展开子菜单：自动化里偶发（窗口焦点/时机），所以重试几次再判失败
  let menuItem = false;
  for (let attempt = 0; attempt < 3 && !menuItem; attempt++) {
    if (attempt > 0) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
      await wait(500);
    }
    const pt = await evaluate("(function () { var host = document.querySelector('.usheet-editor'); var r = host.getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.62), y: Math.round(r.top + r.height * 0.45) }; })()");
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "right", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "right", clickCount: 1 });
    await wait(1200);
    await evaluate("(function () { var host = document.querySelector('.usheet-editor'); var cs = [...document.querySelectorAll('*')].filter(function (e) { return e.children.length === 0 && e.textContent.trim() === '插入' && e.getBoundingClientRect().width > 0 && host && !host.contains(e); }); if (!cs.length) return false; var el = cs[cs.length - 1]; var r = el.getBoundingClientRect(); ['pointerenter','mouseover','mousemove'].forEach(function (t) { el.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: Math.round(r.left + 8), clientY: Math.round(r.top + r.height / 2) })); }); return true; })()");
    await wait(1500);
    menuItem = await evaluate("(function () { var el = [...document.querySelectorAll('*')].find(function (e) { return e.children.length === 0 && e.textContent.trim() === '插入单元格图片'; }); return Boolean(el); })()");
  }
  record("（提示）单元格右键 → 插入 → 有「插入单元格图片」", Boolean(menuItem), "尝试 " + (menuItem ? "一次" : "三次") + "；静态路径键由 univerContract.test.ts 守", true);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });

  // 7) keep-alive：先造一个普通文档当"别的标签"，再切走切回（univer root 的 children 不掉 0）
  const otherDoc = await evaluate("window.lakeNative.createNoteIn(null, 'kernel-probe-doc')");
  const otherDocId = otherDoc && otherDoc.id ? otherDoc.id : otherDoc;
  await wait(800);
  await ensureRow(otherDocId);
  await clickInPage('[data-tree-node-id="' + otherDocId + '"]');
  await wait(2000);
  await evaluate("window.__probe = { emptied: false }; (function () { var root = document.querySelector('.usheet-editor .usheet-univer-root'); window.__probe.timer = setInterval(function () { if (root && root.childElementCount === 0) window.__probe.emptied = true; }, 20); })()");
  const otherTab = otherDocId;
  if (otherTab) {
    await evaluate("(function () { var t = [...document.querySelectorAll('.tab-bar [data-note-id]')].find(function (e) { return e.getAttribute('data-note-id') === " + JSON.stringify(otherTab) + "; }); if (t) t.click(); return true; })()");
    await wait(1500);
    // 切走期间：floating 层必须随宿主一起不可见（补丁前它在 body、恒可见 ⇒ 黄叹号盖住别的文档，用户 261009 报）。
    // 若这一步没能真正切走（合成点击偶发），记为提示项、不影响退出码。
    const awayFloat = await evaluate("(function () { var host = document.querySelector('.usheet-editor'); var el = document.querySelector('[data-lake-univer-floating]'); return { hostActive: host ? host.getAttribute('data-active') : null, elExists: Boolean(el), visibility: el ? getComputedStyle(el).visibility : null }; })()");
    const awayInactive = awayFloat.hostActive !== "true";
    const awayHidden = awayFloat.elExists ? awayFloat.visibility === "hidden" : true;
    record("切走后 floating 层不可见（黄叹号不再残留）", awayInactive && awayHidden, JSON.stringify(awayFloat), !awayInactive);
    await evaluate("(function () { var t = [...document.querySelectorAll('.tab-bar [data-note-id]')].find(function (e) { return e.getAttribute('data-note-id') === " + JSON.stringify(noteId) + "; }); if (t) t.click(); return true; })()");
    await wait(1500);
    const emptied = await evaluate("window.__probe.emptied");
    record("切标签 keep-alive：切走再切回不销毁实例", emptied === false, "emptied=" + emptied);
  } else {
    record("切标签 keep-alive：切走再切回不销毁实例", false, "只有一个标签，无法验证（先在库里留一个文档再跑）");
  }

  const fatalFails = results.filter((r) => !r.ok && (!r.advisory || STRICT));
  const warned = results.filter((r) => !r.ok && r.advisory);
  console.log(NL + "== 汇总：" + (results.length - fatalFails.length - warned.length) + "/" + results.length + " 通过" +
    (warned.length ? "，提示 " + warned.length + " 项（无 OS 焦点时的合成输入偶发，非契约漂移）" : "") +
    (fatalFails.length ? "，失败：" + fatalFails.map((f) => f.name).join("；") : ""));
  if (fatalFails.length) console.log("→ 对照 docs/USHEET-UPGRADE.md 的触点清单逐个核对；改完再跑一遍。");
})().then(async () => {
  try { if (child) child.kill("SIGTERM"); } catch { /* ignore */ }
  await wait(1200);
  try { if (child && child.exitCode === null) child.kill("SIGKILL"); } catch { /* ignore */ }
  process.exit(results.some((r) => !r.ok && (!r.advisory || STRICT)) ? 1 : 0);
}).catch(async (error) => {
  console.error("探针运行失败：" + ((error && error.stack) || error));
  try { if (child) child.kill("SIGKILL"); } catch { /* ignore */ }
  process.exit(1);
});
