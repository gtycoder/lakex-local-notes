#!/usr/bin/env node
/**
 * 移动端 Lake 能力覆盖检测装置（261010 实测固化；配套 docs/MOBILE-TECH-STACK.md 八、覆盖矩阵）。
 *
 * 回答一个问题：桌面端 Lake（lakex 内核）能输入的东西，移动端能不能展示、能不能编辑。
 *
 * 用法（需先起好两端）：
 *   # 移动端：模拟器 + App + CDP 转发
 *   bash scripts/emu-up.sh --no-window && bash scripts/android-build.sh --sync --install && bash scripts/emu-cdp.sh 9335
 *   # 桌面基准（可选，用于生成夹具/对照）：隔离实例
 *   env -u ELECTRON_RUN_AS_NODE LAKE_RENDERER=scheme LAKE_USER_DATA="$TMPDIR/lake-cov" \
 *     LAKE_ASSET_PORT=19891 ./node_modules/.bin/electron --disable-gpu --no-sandbox --remote-debugging-port=9231 .
 *
 *   node scripts/mobile-lake-coverage.mjs --matrix          # 只打静态覆盖矩阵（无需设备）
 *   node scripts/mobile-lake-coverage.mjs --dock            # 实测移动端输入面（dock / 两个面板 / 内核工具栏 / 斜杠）
 *   node scripts/mobile-lake-coverage.mjs --doc "标题"       # 打开某篇并逐格式探针其渲染
 *   node scripts/mobile-lake-coverage.mjs --doc "标题" --shot /tmp/x.png   # 附带设备级截图
 *   node scripts/mobile-lake-coverage.mjs --capture-panel "画板,思维导图,折叠块"  # 桌面实例：抓面板项的真实内核调用（hook execCommand）
 *
 * 装置坑（都踩过，别退回旧写法）：
 *  1. 必须用 DOM 派发事件点树行：移动端左侧文档树在抽屉关闭时 x 约 -354（画布外），
 *     CDP 的 Input.dispatchTouchEvent / MouseEvent 按坐标点在画布外，无效；
 *     在行/标题元素上派发 pointerdown → mousedown → pointerup → mouseup → click 才生效（React 事件委托）。
 *  2. element.click() 不触发导航（HANDOFF 八 已记），必须上面那串事件。
 *  3. Runtime.evaluate 的 expression 必须是字符串：传函数会被 JSON.stringify 丢掉，
 *     CDP 报 mandatory field missing。
 *  4. App 会恢复最多 8 个 keep-alive 标签页，所以 .doc-pane.active 可能不是你以为的那篇；
 *     判据要「标题栏文本 + 正文文本」成对读，别只看一处。
 *  5. 移动端截图一律 adb exec-out screencap -p：CDP 的 Page.captureScreenshot 抓不到 GPU canvas（表格会假空白）。
 *  6. 打开文档会重置文档树展开态，嵌套文档每次都要重新展开父行。
 */
import { execSync } from "node:child_process";

const ADB = process.env.LAKE_ADB || "/opt/homebrew/share/android-commandlinetools/platform-tools/adb";
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt; };
const has = (name) => process.argv.includes(name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (file) => { execSync(ADB + " exec-out screencap -p > " + file); return file; };

// ---------- CDP 驱动（Node 内置 WebSocket，零依赖） ----------
async function connect(port) {
  const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no page target on " + port);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  let id = 0; const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error("timeout " + method)); } }, 45000);
  });
  await send("Runtime.enable"); await send("Page.enable");
  const api = {
    send,
    async evaluate(expr) { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error("EXC " + JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result?.value; },
    evalFn(fn, ...args) { return api.evaluate("(" + fn + ")(" + args.map((a) => JSON.stringify(a)).join(",") + ")"); },
    close() { ws.close(); },
  };
  return api;
}

// ---------- 静态覆盖矩阵（261010 实测结论的单一来源） ----------
export const DESKTOP_INPUT = {
  toolbar: ["撤销", "重做", "格式刷", "清除格式", "段落样式", "字号", "加粗", "斜体", "删除线", "下划线", "行内代码",
    "字色", "背景色", "对齐", "无序列表", "有序列表", "缩进", "行高", "待办", "链接", "引用", "分割线", "搜索", "插入面板"],
  insertPanel: ["图片", "表格", "附件", "本地视频", "本地音频", "状态", "引用", "分割线", "高亮块", "分栏卡片", "折叠块",
    "画板", "流程图", "UML 图", "思维导图", "代码块", "公式", "文本绘图", "日历", "日期", "表情", "文档引用"],
  blockOps: ["整块复制/剪切/删除", "转化为其它块", "拖拽移动", "整块/多块选中", "添加间距", "全屏/宽度"],
};
export const MOBILE_INPUT = {
  dockBar: ["插入", "字体", "加粗", "列表", "待办", "收起键盘"],
  insertPanel: ["图片", "拍照", "附件", "表格", "音频", "视频", "高亮块", "状态", "引用", "分割线", "代码块"],
  fontPanel: ["正文", "H1", "H2", "H3", "H4", "加粗", "斜体", "下划线", "删除线", "行内代码", "引用", "列表", "有序列表", "待办", "分割线", "撤销", "重做"],
  absent: ["内核固定工具栏", "块悬浮手柄", "选区浮栏", "斜杠 / 面板", "第三方服务嵌入（双端都无）"],
};
export const MOBILE_DISPLAY_OK = ["H1–H6", "粗体/斜体/下划线/删除线/行内代码", "字色/背景色", "字号", "对齐", "上标/下标",
  "链接", "无序/有序/待办列表", "表格(table.lake-table)", "代码块", "分隔线", "状态", "公式", "日历", "日期", "表情",
  "折叠块", "分栏", "图片", "附件", "音频", "视频", "画板", "流程图", "UML", "思维导图", "文本绘图", "文档引用"];
export const MOBILE_INPUT_GAPS = {
  "文本格式": ["H5/H6", "字号", "字色", "背景色", "对齐", "缩进", "行高", "清除格式", "格式刷", "链接"],
  "插入项": ["分栏卡片", "折叠块", "画板", "流程图", "UML 图", "思维导图", "公式", "文本绘图", "日历", "日期", "表情", "文档引用"],
  "块级操作": DESKTOP_INPUT.blockOps,
  "文档类型": ["表格文档(usheet) 只读", "多维表(bitable) 只读", "画板(board) 只读"],
};

function printMatrix() {
  const line = (t, arr) => console.log("  " + t + "：" + arr.join(" · "));
  console.log("# 移动端 Lake 覆盖矩阵（261010 实测）");
  console.log("");
  console.log("## 桌面输入面");
  line("固定工具栏", DESKTOP_INPUT.toolbar);
  line("插入面板", DESKTOP_INPUT.insertPanel);
  line("块级操作", DESKTOP_INPUT.blockOps);
  console.log("");
  console.log("## 移动端输入面（dock = 唯一入口）");
  line("dock 主条", MOBILE_INPUT.dockBar);
  line("插入面板", MOBILE_INPUT.insertPanel);
  line("字体面板", MOBILE_INPUT.fontPanel);
  line("不存在", MOBILE_INPUT.absent);
  console.log("");
  console.log("## 移动端展示（实测通过）");
  line("OK", MOBILE_DISPLAY_OK);
  console.log("");
  console.log("## 移动端输入缺口");
  for (const [k, v] of Object.entries(MOBILE_INPUT_GAPS)) line(k, v);
}

// ---------- 移动端：输入面实测 ----------
async function probeDock(port) {
  const m = await connect(port);
  const r = {};
  r.toolbar = await m.evalFn(function () { const d = document.querySelector(".mobile-editor-dock"); return d ? [...d.querySelectorAll(".med-toolbar button")].map((b) => b.getAttribute("aria-label")) : null; });
  r.kernelToolbar = await m.evaluate("document.querySelectorAll('.ne-ui-toolbar').length");
  r.blockHandle = await m.evaluate("document.querySelectorAll('.lake-block-handle-host').length");
  r.selectionToolbar = await m.evaluate("document.querySelectorAll('.lake-selection-toolbar-host').length");
  await m.evalFn(function () { const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "插入" && x.offsetHeight > 0); if (!b) return false; const o = { bubbles: true, cancelable: true, view: window, button: 0 }; ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((ty) => b.dispatchEvent(new (ty.startsWith("pointer") ? PointerEvent : MouseEvent)(ty, o))); return true; });
  await sleep(1200);
  r.insertPanel = await m.evaluate("JSON.stringify([...document.querySelectorAll('.med-ins-item')].map(b=>b.getAttribute('aria-label')))");
  await m.evalFn(function () { const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "字体" && x.offsetHeight > 0); if (!b) return false; const o = { bubbles: true, cancelable: true, view: window, button: 0 }; ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((ty) => b.dispatchEvent(new (ty.startsWith("pointer") ? PointerEvent : MouseEvent)(ty, o))); return true; });
  await sleep(1000);
  r.fontPanel = await m.evaluate("JSON.stringify([...document.querySelectorAll('.med-f-btn')].map(b=>b.getAttribute('aria-label')))");
  try { execSync(ADB + " shell input text '/'"); } catch { /* 无设备时跳过 */ }
  await sleep(1500);
  r.slashPanel = await m.evaluate("[...document.querySelectorAll('.ne-overlay-container')].filter(e=>e.querySelectorAll('*').length>50).length");
  m.close();
  return r;
}

// ---------- 移动端：某篇文档的渲染探针 ----------
async function openByTitle(m, title) {
  return m.evalFn(function (t) {
    const el = [...document.querySelectorAll(".ln-row__title")].find((e) => (e.textContent || "").trim() === t);
    if (!el) return JSON.stringify({ err: "row not found", rows: document.querySelectorAll(".ln-row__title").length });
    const o = { bubbles: true, cancelable: true, view: window, button: 0 };
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((ty) => el.dispatchEvent(new (ty.startsWith("pointer") ? PointerEvent : MouseEvent)(ty, o)));
    return JSON.stringify({ ok: true });
  }, title);
}
const PROBE = function () {
  const p = [...document.querySelectorAll(".doc-pane")].filter((e) => String(e.className).includes("active"))[0];
  if (!p) return JSON.stringify({ err: "no active pane" });
  const ed = p.querySelector(".lake-editor") || p;
  return JSON.stringify({
    viewer: !!p.querySelector(".ne-viewer"),
    textLen: (ed.innerText || "").length,
    head: (ed.innerText || "").slice(0, 60).replace(/\n/g, " "),
    cards: [...ed.querySelectorAll("ne-card")].map((c) => c.getAttribute("data-card-name")),
    table: ed.querySelectorAll("table.lake-table").length,
    details: ed.querySelectorAll("details").length,
    columns: ed.querySelectorAll(".lake-column-item").length,
    emptyCollapse: ed.querySelectorAll("ne-collapse.content-empty").length,
    img: ed.querySelectorAll("img.ne-image").length,
    audio: ed.querySelectorAll("audio").length,
    video: ed.querySelectorAll("video").length,
    canvas: ed.querySelectorAll("canvas").length,
    svg: ed.querySelectorAll("svg").length,
  });
};
async function probeDoc(port, title, shotPath) {
  const m = await connect(port);
  const open = JSON.parse(await openByTitle(m, title));
  if (open.err) { m.close(); return { err: open.err, rows: open.rows }; }
  await sleep(4200);
  const r = JSON.parse(await m.evalFn(PROBE));
  if (shotPath) shot(shotPath);
  m.close();
  return r;
}

// ---------- 桌面：抓「内核插入面板某一项」的真实调用（复核 / 换机复现用） ----------
async function capturePanel(port, items) {
  const cdp = await connect(port);
  const out = {};
  for (const label of items) {
    const title = "zz 抓取 " + label;
    await cdp.evalFn(async function (t) { await window.lakeNative.createNoteIn("notebook-personal", t); return true; }, title);
    await sleep(1100);
    await cdp.evalFn(function (t) {
      const rows = [...document.querySelectorAll(".note-row.tree-row")];
      const el = rows.find((r) => (r.textContent || "").trim() === t);
      if (!el) return false;
      el.scrollIntoView({ block: "nearest" });
      const o = { bubbles: true, cancelable: true, view: window, button: 0 };
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((ty) => el.dispatchEvent(new (ty.startsWith("pointer") ? PointerEvent : MouseEvent)(ty, o)));
      return true;
    }, title);
    await sleep(3200);
    // 光标：必须有点进正文（否则面板打不开/插入落到无效位置）
    const spot = JSON.parse(await cdp.evaluate("JSON.stringify((function(){const m=[...document.querySelectorAll('.lake-editor-mount')].filter(e=>getComputedStyle(e).visibility==='visible')[0];const w=m.querySelector('.ne-editor-wrap');const r=w.getBoundingClientRect();return{x:r.left+140,y:r.top+56};})())"));
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp.send("Input.dispatchMouseEvent", { type, x: spot.x, y: spot.y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
    await sleep(500);
    // hook 三处 execCommand（面板可能走 editor / kernel / renderer 任一条）
    await cdp.evalFn(function () {
      const ed = window.__desktopEditor; window.__cmdLog = [];
      const wrap = (obj, tag) => { if (!obj || typeof obj.execCommand !== "function" || obj.__hooked) return; const orig = obj.execCommand.bind(obj); obj.execCommand = function (...args) { try { window.__cmdLog.push({ via: tag, args }); } catch { /* 忽略 */ } return orig(...args); }; obj.__hooked = true; };
      wrap(ed, "editor"); wrap(ed.kernel, "kernel"); wrap(ed.renderer, "renderer");
      return "hooked";
    });
    const opened = await cdp.evalFn(function () {
      if ([...document.querySelectorAll(".ne-overlay-container")].some((e) => e.querySelectorAll("*").length > 100)) return "already";
      const m = [...document.querySelectorAll(".lake-editor-mount")].filter((e) => getComputedStyle(e).visibility === "visible")[0];
      const b = m.querySelector('[data-testid="ui-toolbar-card-select-button"]');
      const r = b.getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    });
    if (opened !== "already") {
      const p = JSON.parse(opened);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
      for (let i = 0; i < 20; i++) { await sleep(250); if (await cdp.evaluate("[...document.querySelectorAll('.ne-overlay-container')].some(e=>e.querySelectorAll('*').length>100)")) break; }
    }
    // DOM 派发点击面板项（CDP 合成鼠标点面板项无效）
    await cdp.evalFn(function (l) {
      const host = [...document.querySelectorAll(".ne-overlay-container")].filter((e) => e.querySelectorAll("*").length > 100).pop();
      if (!host) return "no panel";
      const t = [...host.querySelectorAll(".ne-menu-item-container-title")].find((x) => (x.textContent || "").trim().includes(l));
      if (!t) return "no item";
      const item = t.closest(".ne-menu-item-container") || t;
      const r = item.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, view: window, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((ty) => item.dispatchEvent(new (ty.startsWith("pointer") ? PointerEvent : MouseEvent)(ty, o)));
      return "clicked";
    }, label);
    await sleep(1600);
    out[label] = JSON.parse(await cdp.evaluate("JSON.stringify(window.__cmdLog||[])"));
  }
  cdp.close();
  return out;
}

// ---------- CLI ----------
const mobilePort = Number(arg("--port", 9335));
if (has("--dock")) { console.log(JSON.stringify(await probeDock(mobilePort), null, 1)); }
else if (has("--doc")) { console.log(JSON.stringify(await probeDoc(mobilePort, arg("--doc"), arg("--shot")), null, 1)); }
else if (has("--capture-panel")) { console.log(JSON.stringify(await capturePanel(Number(arg("--desktop-port", 9231)), String(arg("--capture-panel")).split(",")), null, 1)); }
else { printMatrix(); console.log(""); console.log("提示：--dock 实测移动端输入面；--doc <标题> 探针某篇渲染；--capture-panel \"画板,折叠块\" 抓内核面板真实调用。"); }
