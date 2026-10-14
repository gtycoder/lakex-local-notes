
// B2 移动端逐页走查（Android WebView CDP；不联网）。用法：
//   adb forward ... 后：node scripts/css-audit/drive.mjs 9335 /tmp/b2-walk.mjs
import fs from "node:fs";
import { execSync } from "node:child_process";
import { data } from "./paths.mjs";

// ⚠️ Android WebView 的 CDP Page.captureScreenshot **抓不到 GPU canvas 层**（实测：usheet 网格画布 toDataURL() 有完整内容、
// 设备级 adb screencap 也正常，但页面截图整片空白）。所以移动端走查截图一律用**设备级** screencap。
const ADB = process.env.ADB || "/opt/homebrew/share/android-commandlinetools/platform-tools/adb";
function deviceShot(file) { try { execSync(ADB + " exec-out screencap -p > " + JSON.stringify(file), { shell: "/bin/bash" }); return true; } catch (e) { return false; } }

const OUT = data("mobile-walk");
fs.mkdirSync(OUT, { recursive: true });

const PROBE = '(function () {' +
  ' var out = { escape: [], clipped: [], contrast: [], fixedBars: [], smallTap: [] };' +
  // ⚠️ 反斜杠必须写**双份**：这一段是**单引号字符串**，写 \( 会被字符串字面量吃掉，
  // 运行期正则退化成 /rgba?(([^)]+))/ ⇒ m[1] 捕获 "(31, 35, 41"、parseFloat("(31")=NaN
  // ⇒ 所有 ratio 都是 NaN、NaN < 4.5 恒 false ⇒ **对比度探针自 261009 起就是死的**（静默假阴性）。
  // 与桌面版 scripts/css-audit/walkthrough.mjs 的修法逐字一致（AGENTS §7.25）。
  ' var rgb = function (c) { var m = /rgba?\\(([^)]+)\\)/.exec(c || ""); if (!m) return null; var p = m[1].split(",").map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };' +
  ' var lum = function (c) { var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };' +
  ' var ratio = function (a, b) { var l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };' +
  ' var effBg = function (el) { var n = el; while (n) { var c = rgb(getComputedStyle(n).backgroundColor); if (c && c.a > 0.9) return c; n = n.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };' +
  ' var ownText = function (el) { return [].slice.call(el.childNodes).some(function (n) { return n.nodeType === 3 && n.textContent.trim().length > 0; }); };' +
  ' var vis = function (el) { var r = el.getBoundingClientRect(); var cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0.05; };' +
  ' var inScroll = function (el) { var n = el.parentElement; for (var d = 0; d < 8 && n; d++) { var oy = getComputedStyle(n).overflowY; if (oy === "auto" || oy === "scroll") return true; n = n.parentElement; } return false; };' +
  ' var hasEll = function (el) { var n = el.parentElement; for (var d = 0; d < 4 && n; d++) { if (getComputedStyle(n).textOverflow === "ellipsis") return true; n = n.parentElement; } return false; };' +
  ' var vw = innerWidth, vh = innerHeight;' +
  ' document.querySelectorAll("button,a[href],[role=button],input,select,textarea,[tabindex],.doc-card,.mobile-htab").forEach(function (el) {' +
  '   if (!vis(el)) return; var r = el.getBoundingClientRect();' +
  // ⚠️ 261013 修：旧实现把 inScroll(el) 与 escape 一起做**前置 return**，于是「位于任何可滚动祖先内」的元素
  //    被**全部跳过** —— 列表行 / 目录树行 / 卡片（首页主体全在 .mobile-scroll 里）从来看不见。
  //    现在 inScroll 只用于 escape（滚出去本来就不算越界），smallTap 不再被它过滤。
  '   var partiallyVisible = r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;' +
  '   if (!inScroll(el) && partiallyVisible && (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 || r.top < -1)) out.escape.push({ cls: String(el.className).slice(0, 40), text: (el.textContent || "").trim().slice(0, 14), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], vw: vw, vh: vh });' +
  // smallTap 口径（261013）：**任何可点元素**（不再要求 tagName===BUTTON 且有文字 —— 图标按钮 / span[role=button]
  // 正是最常点不中的那批），阈值对齐 MOBILE-DESIGN 的 44 Rule；只报在视口内的，避免滚出屏的噪声。
  // 261013 三处精化：
  //   ① **算上 ::after 的命中区扩张** —— 我们的补足手段就是伪元素（.mb-switch::after { inset:-8px }、
  //      触达补足注册表的 width:max(100%,44px)），只看元素自身会把"已经补好的"一律误报；
  //   ② 跳过 disabled（只读控件不是可点目标，如多维表只读复选框）；
  //   ③ 排除内核 / 第三方命名空间（ant- 是 antd、ne-/lakex- 是 lake6 内核、univer/drawnix 是表格与画板），
  //      它们的尺寸不归我们管（与对比度探针同一排除口径）。
  '   var foreign = /(?:^|\s)(?:ant-|ne-|lakex-|univer|dv-|plait)/.test(String(el.className));' +
  '   if (el.disabled || foreign) return;' +
  '   var hitW = r.width, hitH = r.height;' +
  '   try { var pe = getComputedStyle(el, "::after"); if (pe && pe.content && pe.content !== "none" && pe.content !== "normal") { var pw = parseFloat(pe.width) || 0, ph = parseFloat(pe.height) || 0; if (pw > hitW) hitW = pw; if (ph > hitH) hitH = ph; } } catch (e) {}' +
  '   var inView = r.top < vh && r.bottom > 0 && r.right > 0 && r.left < vw;' +
  '   if (inView && r.width > 0 && r.height > 0 && (hitW < 44 || hitH < 44)) out.smallTap.push({ cls: String(el.className).slice(0, 36), tag: el.tagName, role: el.getAttribute("role") || "", label: (el.getAttribute("aria-label") || el.title || "").slice(0, 16), text: (el.textContent || "").trim().slice(0, 12), size: [Math.round(r.width), Math.round(r.height)], hit: [Math.round(hitW), Math.round(hitH)] });' +
  ' });' +
  ' document.querySelectorAll("div,span,p,h1,h2,h3,strong,td").forEach(function (el) {' +
  '   if (!vis(el)) return; var cs = getComputedStyle(el);' +
  '   if (cs.whiteSpace !== "nowrap" || cs.overflow !== "hidden" || cs.textOverflow === "ellipsis" || hasEll(el)) return;' +
  '   if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 8) out.clipped.push({ cls: String(el.className).slice(0, 44), text: (el.textContent || "").trim().slice(0, 26), over: el.scrollWidth - el.clientWidth });' +
  ' });' +
  ' document.querySelectorAll("[class*=mobile],[class*=ln-],[class*=config-]").forEach(function (el) {' +
  '   if (!vis(el) || !ownText(el)) return; var cs = getComputedStyle(el); var fg = rgb(cs.color); if (!fg || fg.a < 0.9) return;' +
  '   var bg = effBg(el); var size = parseFloat(cs.fontSize); var bold = parseInt(cs.fontWeight, 10) >= 600;' +
  '   var need = (size >= 18.66 || (size >= 14 && bold)) ? 3 : 4.5; var cr = ratio(fg, bg);' +
  '   if (cr < need) out.contrast.push({ cls: String(el.className).slice(0, 44), text: (el.textContent || "").trim().slice(0, 20), fg: cs.color, ratio: Math.round(cr * 100) / 100, need: need });' +
  ' });' +
  ' document.querySelectorAll("body *").forEach(function (el) { var cs = getComputedStyle(el); if (cs.position !== "fixed" || !vis(el)) return; var r = el.getBoundingClientRect(); if (r.height < 24) return; out.fixedBars.push({ cls: String(el.className).slice(0, 40), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], bottom: Math.round(vh - r.bottom) }); });' +
  ' out.fixedBars = out.fixedBars.slice(0, 6);' +
  ' out.tabHit = [].slice.call(document.querySelectorAll(".mobile-htab")).map(function (e) { var p = e.parentElement; var r = e.getBoundingClientRect(); var pr = p ? p.getBoundingClientRect() : null; return { text: (e.textContent || "").trim(), self: [Math.round(r.width), Math.round(r.height)], parent: pr ? [Math.round(pr.width), Math.round(pr.height)] : null, parentCls: p ? String(p.className).slice(0, 30) : null }; });' +
  ' out.pageOverflowX = Math.max(0, document.documentElement.scrollWidth - vw);' +
  ' return out; })()';

var pageRef = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tapExpr(expr, label, waitMs) {
  const page = pageRef;
  const p = await page.evaluate(expr);
  if (!p) throw new Error("not found: " + label);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p[0], y: p[1], button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p[0], y: p[1], button: "left", clickCount: 1 });
  await sleep(waitMs || 1200);
}
const center = (sel) => '(function () { var e = document.querySelector(' + JSON.stringify(sel) + '); if (!e) return null; var r = e.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return null; return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()';
const centerByText = (sel, t, nth) => '(function () { var els = [].slice.call(document.querySelectorAll(' + JSON.stringify(sel) + ')).filter(function (e) { return ((e.getAttribute("aria-label") || e.title || e.textContent || "")).indexOf(' + JSON.stringify(t) + ') >= 0 && e.getBoundingClientRect().width > 0; }); var e = els[' + (nth || 0) + ']; if (!e) return null; var r = e.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()';
const nthRow = (n) => '(function () { var rows = [].slice.call(document.querySelectorAll(".side-panel--left .ln-row, .side-panel--left .mb-row, .mobile-workspace .ln-row, .mobile-workspace .mb-row")).filter(function (e) { return e.getBoundingClientRect().width > 0; }); var e = rows[' + n + ']; if (!e) return null; var r = e.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()';
async function atHome() {
  // 261014：**小记写作卡开着也不算"在首页"** —— 顶栏 tab 仍在，若不排除，goHome() 会直接返回、
  // 后面的 openNotebook() 就找不到笔记本入口（quicknote-editor 这一屏会留下写作卡）。
  return await pageRef.evaluate('(function () { return Boolean(document.querySelector(".mobile-htab")) && !document.querySelector(".mobile-qn-composer") && !document.querySelector(".mobile-settings-mask") && !document.querySelector(".mobile-settings-page") && !document.querySelector(".mobile-workspace"); })()');
}
async function goHome() {
  for (var i = 0; i < 8; i++) {
    if (await atHome()) return;
    const pick = await pageRef.evaluate('(function () {' +
      ' var BACK = String.fromCharCode(0x8fd4, 0x56de);' +
      ' var COLLAPSE = String.fromCharCode(0x6536, 0x8d77);' +
      ' var center = function (e) { var r = e.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; };' +
      ' var hit = function (e) { var r = e.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false; var x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2); if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false; var h = document.elementFromPoint(x, y); return Boolean(h) && (h === e || e.contains(h) || h.contains(e)); };' +
      ' var findByAria = function (aria, scope) { var els = [].slice.call((scope || document).querySelectorAll("[aria-label]")); for (var i = 0; i < els.length; i++) { if (els[i].getAttribute("aria-label") === aria && hit(els[i])) return els[i]; } return null; };' +
      ' var collapse = findByAria(COLLAPSE, document.querySelector(".side-panel--left.on") || document);' +
      ' if (collapse) return { kind: "collapse-tree", pt: center(collapse) };' +
      ' var back = findByAria(BACK);' +
      ' if (back) return { kind: "back", pt: center(back) };' +
      ' var cancel = [].slice.call(document.querySelectorAll(".mobile-qn-actions button")).filter(function (e) { return e.textContent === String.fromCharCode(0x53d6, 0x6d88) && hit(e); })[0];' +
      ' if (cancel) return { kind: "composer-cancel", pt: center(cancel) };' +
      ' var sheet = document.querySelector(".mb-scrim--state.is-open, .mb-scrim, .mobile-sheet-mask.on, .mobile-model-mask.on, .mobile-sheet-mask, .mobile-model-mask");' +
      ' if (sheet && sheet.getBoundingClientRect().width > 0 && hit(sheet)) { var sr = sheet.getBoundingClientRect(); return { kind: "sheet-mask", pt: [Math.round(innerWidth / 2), Math.round(sr.top + 24)] }; }' +
      ' var scrim = document.querySelector(".mobile-menu__scrim.is-open, .mobile-menu__scrim, .mb-scrim.is-open");' +
      ' if (scrim) { var sr = scrim.getBoundingClientRect(); if (sr.width > 0 && sr.height > 0) return { kind: "menu-scrim", pt: [Math.round(innerWidth / 2), 40] }; }' +
      ' var c = document.querySelector(".mobile-settings-close"); if (c && hit(c)) return { kind: "settings-back", pt: center(c) };' +
      ' var pg = document.querySelector(".mobile-settings-page"); var m = document.querySelector(".mobile-settings-mask");' +
      ' if (m && m.getBoundingClientRect().width > 0) { var right = pg ? pg.getBoundingClientRect().right + 20 : innerWidth - 16; if (right > innerWidth - 4) right = innerWidth - 8; return { kind: "settings-mask", pt: [Math.round(right), Math.round(innerHeight / 2)] }; }' +
      ' return null; })()');
    if (!pick) throw new Error("goHome: 卡住（找不到退出控件）");
    await pageRef.click(pick.pt[0], pick.pt[1]);
    await sleep(900);
  }
  throw new Error("goHome: 超过重试");
}
async function openNotebook() {
  const has = await pageRef.evaluate('Boolean(document.querySelector(".nb-row, .nb-shelf-card"))');
  if (!has) { await tapExpr(centerByText(".mobile-htab", "知识库"), "知识库 tab", 1300); }
  const pt = await pageRef.evaluate('(function () { var e = document.querySelector(".nb-row") || document.querySelector(".nb-shelf-card"); if (!e) return null; var r = e.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()');
  if (!pt) throw new Error("no notebook entry");
  await pageRef.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt[0], y: pt[1], button: "left", clickCount: 1 });
  await pageRef.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt[0], y: pt[1], button: "left", clickCount: 1 });
  await sleep(1600);
  const rowsVisible = await pageRef.evaluate('Boolean(document.querySelector(".side-panel--left.on .ln-row, .side-panel--left.on .mb-row"))');
  if (!rowsVisible) {
    const btn = await pageRef.evaluate('(function () { var TREE = String.fromCharCode(0x6587, 0x6863, 0x6811); var els = [].slice.call(document.querySelectorAll(".mobile-bottom-bar__item")).filter(function (e) { var a = (e.getAttribute("aria-label") || "") + e.title; return a.indexOf(TREE) >= 0 && e.getBoundingClientRect().width > 0; }); var e = els[0]; if (!e) return null; var r = e.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()');
    if (btn) { await pageRef.click(btn[0], btn[1]); await sleep(1100); }
  }
}
async function openDoc(n) { await openNotebook(); await tapExpr(nthRow(n), "doc row #" + n, 2600); }
async function openTreeMenu(n) {
  const expr = '(function () { var rows = [].slice.call(document.querySelectorAll(".side-panel--left .ln-row, .side-panel--left .mb-row, .mobile-workspace .ln-row, .mobile-workspace .mb-row")).filter(function (e) { return e.getBoundingClientRect().width > 0; }); var row = rows[' + n + ']; if (!row) return null; var btn = row.querySelector(".nb-tree-action") || row.querySelector(".ln-row__action") || row.querySelector(".mb-row__action"); if (!btn) return null; var r = btn.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()';
  await tapExpr(expr, "tree action #" + n, 1100);
}
async function sheetItem(t) { await tapExpr(centerByText('.mb-menusheet__item, .mobile-menu__item, .mobile-menu [role=menuitem], .mb-sheet .mb-row, .mb-sheet button, .mobile-sheet .ln-row, .mobile-sheet button', t, 0), "menu item: " + t, 1500); }
async function openSettings() {
  await goHome();
  await tapExpr(centerByText(".toolbar__button", "设置", 0), "设置按钮", 1300);
}
async function settingsPage(label) {
  const back = await pageRef.evaluate('Boolean(document.querySelector(".mobile-settings-close"))');
  if (back) { await tapExpr(center(".mobile-settings-close"), "settings back", 900); }
  await tapExpr(centerByText('.mobile-settings-list button, .mobile-settings-list .mb-list-item, .mobile-settings-list .ln-row, .mobile-settings-list .mb-row, .mobile-settings-row', label, 0), "settings row: " + label, 1300);
}

export default async function run(ctx) {
  const page = ctx.page; pageRef = page;
  await page.send("Runtime.enable"); await page.send("Page.enable");
  await sleep(800);
  const screens = [];
  const add = (name, fn) => screens.push([name, fn]);
  add("home-library", async () => { await goHome(); await tapExpr(centerByText(".mobile-htab", "知识库"), "知识库", 1100); });
  add("home-quicknotes", async () => { await tapExpr(centerByText(".mobile-htab", "小记"), "小记", 1400); });
  add("home-library-shelf", async () => {
    await goHome();
    await tapExpr(centerByText(".mobile-htab", "知识库"), "知识库 tab", 1200);
    const t = await pageRef.evaluate('(function () { var els = [].slice.call(document.querySelectorAll(".toolbar__button")).filter(function (e) { var a = (e.getAttribute("aria-label") || "") + e.title; return /书架|列表/.test(a) && e.getBoundingClientRect().width > 0; }); if (!els.length) throw new Error("no view toggle"); var r = els[0].getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()');
    await pageRef.click(t[0], t[1]); await sleep(1400);
  });
  add("notebook-workspace", async () => { await goHome(); await openNotebook(); });
  for (var di = 0; di < 5; di++) { (function (n) { add("doc-" + n, async () => { await goHome(); await openDoc(n); }); })(di); }
  add("quicknote-editor", async () => {
    await goHome();
    await tapExpr(centerByText(".mobile-htab", "小记"), "小记 tab", 1500);
    // 261014：首页「＋」是**统一加号**（aria-label 从「新建小记」改为「新建」），且**短按 = 新建面板** ⇒
    // 装置跟着走单一来源：不再按 tab 找旧文案、也不再假设"点＋直接进写作卡"。
    // 这里走用户口径的「正常点击创建小记」：＋ → 空白小记 → 写作卡（长按上滑速记那条由设备探针单独验）。
    await tapExpr(centerByText(".mobile-bottom-bar__item", String.fromCharCode(0x65b0, 0x5efa)), "新建", 1200);
    await tapExpr(centerByText(".mb-create__tile", "空白小记"), "空白小记", 2600);
  });
  add("doc-outline", async () => {
    await goHome(); await openDoc(0);
    await tapExpr(centerByText(".mobile-bottom-bar__item", "大纲"), "底栏·大纲", 1500);
  });
  add("doc-note-info", async () => { await goHome(); await openNotebook(); await openTreeMenu(0); await sheetItem("属性"); });
  add("doc-history", async () => { await goHome(); await openNotebook(); await openTreeMenu(0); await sheetItem("历史"); });
  // 261014 补：目录行 ⋯ →「设置图标」的选图标 sheet（**此前 22 屏没覆盖**，而 261014 恰好在这屏上加了
  // 分类条末尾动作键 ⇒ 探针必须先看得见它，否则又是"探针全绿但整屏没量过"）。
  add("notebook-icon-sheet", async () => { await goHome(); await openNotebook(); await openTreeMenu(0); await sheetItem("设置图标"); });
  add("settings", async () => { await openSettings(); });
  ["编辑器", "外观", "历史", "资源管理", "同步设置", "清理缓存", "回收站", "关于"].forEach(function (label) { add("settings-" + label, async () => { await openSettings(); await settingsPage(label); }); });

  const only = (ctx.args[2] || "").split(",").filter(Boolean);
  const chosen = only.length ? screens.filter(function (s) { return only.indexOf(s[0]) >= 0; }) : screens;
  const report = { screens: {} };
  for (const [name, nav] of chosen) {
    const rec = { ok: false };
    try {
      await nav();
      await sleep(700);
      deviceShot(OUT + "/" + name + ".png");
      const probe = await page.evaluate(PROBE);
      rec.escape = (probe.escape || []).slice(0, 10);
      rec.clipped = (probe.clipped || []).slice(0, 10);
      rec.contrast = (probe.contrast || []).slice(0, 10);
      rec.smallTap = (probe.smallTap || []).slice(0, 10);
      rec.fixedBars = (probe.fixedBars || []).slice(0, 6);
      rec.pageOverflowX = probe.pageOverflowX || 0;
      rec.tabHit = probe.tabHit || [];
      rec.ok = true;
    } catch (e) { rec.error = String((e && e.message) || e).slice(0, 150); }
    report.screens[name] = rec;
    const bad = [];
    if (rec.escape && rec.escape.length) bad.push("escape:" + rec.escape.length);
    if (rec.clipped && rec.clipped.length) bad.push("clip:" + rec.clipped.length);
    if (rec.contrast && rec.contrast.length) bad.push("contrast:" + rec.contrast.length);
    if (rec.smallTap && rec.smallTap.length) bad.push("smallTap:" + rec.smallTap.length);
    if (rec.pageOverflowX) bad.push("pageX:" + rec.pageOverflowX);
    console.log("[mwalk] " + name + " " + (rec.ok ? "ok" : "ERR " + rec.error) + (bad.length ? "  " + bad.join(" ") : ""));
  }
  fs.writeFileSync(OUT + "/report.json", JSON.stringify(report, null, 1));
  return { screens: Object.keys(report.screens).length, out: OUT };
}
