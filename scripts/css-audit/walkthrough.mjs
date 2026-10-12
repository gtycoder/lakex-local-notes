/**
 * 逐页走查装置（261009 B1）：一次跑完桌面各屏，每屏输出「截图 + 四类实测探针」。
 *
 * 用法：
 *   npx vite build                                   # scheme 模式服务 dist/
 *   RUN=/tmp/lake-fixture; rm -rf "$RUN"
 *   env -u ELECTRON_RUN_AS_NODE LAKE_RENDERER=scheme LAKE_USER_DATA="$RUN" LAKE_ASSET_PORT=19810 \
 *     ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=9231 .
 *   node scripts/css-audit/drive.mjs 9231 scripts/css-audit/make-fixture.mjs   # 造合成夹具（勿用真实数据）
 *   node scripts/css-audit/drive.mjs 9231 scripts/css-audit/walkthrough.mjs light 1315
 *   node scripts/css-audit/drive.mjs 9231 scripts/css-audit/walkthrough.mjs dark  1000
 *
 * 覆盖 19 屏：library / 四种文档（富文本·表格·多维表·画板）/ quicknotes / search / resources / trash-space
 * / 设置十组（编辑器·外观·快捷键·文档与历史·云端与同步·AI·回收站·浏览器端·日志·关于）。
 * 产物：<.css-audit>/walkthrough/<theme>-<width>-<screen>.{png,json} + report-<theme>-<width>.json
 *
 * 四类探针（判定只认实测值，不认"看着像"）：
 *   1) escape       可见交互元素越出视口（已排除"在滚动容器内"的内容 ⇒ 只见真越界；滚动后自然可见的不算）
 *   2) clipped      nowrap + overflow:hidden + clip 且内容被截断（已排除父级已有 ellipsis 的——那种是父级负责省略）
 *   3) contrast     全仓**自有**文字的对比度（WCAG：正文 4.5 / 大字 3.0），背景取最近的不透明祖先。
 *                   **261012 起不再只扫组件族**（旧口径只扫 ln-/config-/bt-/tree/tab/toolbar/statusbar 外层，
 *                   漏掉状态栏内层"无类名 span"这类真实命中）；排除项：有效透明度 ≤0.05 的子树（父级 opacity:0，
 *                   如 docked 下的 .edge-hotzone-handle）、1×1 的 sr-only 文本、内核与第三方（.ne-* / univer / drawnix）。
 *   4) focus        非 button/input/[role=button] 的 [tabindex] 元素聚焦后的环是否仍走令牌（style=auto 即 UA 默认环）
 *   5) pageOverflowX / fixedOutside：整页横向溢出、固定层越界
 *
 * 已知无需报的（本项目**有意**如此，探针会命中但不算缺陷）：
 *   - `.note-row-copy strong` 的标题裁切（shell.css 注释：标题恒单行、列宽处直接裁切不打省略号）；
 *   - 设置弹窗内的内容"越出视口"（弹窗自己滚动，探针已按滚动祖先过滤）；
 *   - `.ln-split-handle` / 内核 `.ne-engine` 聚焦无环（它们各自处理，实测 outline-style: none）；
 *   - `--lake-text-4` 的 3:1 档（**设计有意**：元信息/占位；要合规得整档提亮并与 text-3 塌成一层，故保留）。
 */

// B1 逐页走查：每屏「截图 + 四类实测探针」-> JSON 供分诊。
// usage: node scripts/css-audit/drive.mjs 9231 /tmp/b1-walk.mjs light 1315
import fs from "node:fs";
import { data } from "./paths.mjs";

const OUT = data("walkthrough");
fs.mkdirSync(OUT, { recursive: true });

const PROBE = '(function () {' +
  ' var out = { escape: [], clipped: [], contrast: [] };' +
  // ⚠️ 这行是**单引号字符串**：正则里的反斜杠必须写双份（\( \)）。261012 修：此前写成 \( 被 JS 字符串吃掉，
  // 正则退化成 /rgba?(([^)]+))/ ⇒ m[1] 捕获到 "(31, 35, 41"、parseFloat("(31")=NaN ⇒ 所有 ratio 都是 NaN、
  // `NaN < 4.5` 恒 false ⇒ **对比度探针自 261009 B1 起一直静默返回 0（假阴性）**。mobile-walkthrough.mjs 同款待修。
  ' var rgb = function (c) { var m = /rgba?\\(([^)]+)\\)/.exec(c || ""); if (!m) return null; var p = m[1].split(",").map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };' +
  ' var lum = function (c) { var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };' +
  ' var ratio = function (a, b) { var l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };' +
  ' var effBg = function (el) { var n = el; while (n) { var c = rgb(getComputedStyle(n).backgroundColor); if (c && c.a > 0.9) return c; n = n.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };' +
  ' var ownText = function (el) { return [].slice.call(el.childNodes).some(function (n) { return n.nodeType === 3 && n.textContent.trim().length > 0; }); };' +
  ' var vis = function (el) { var r = el.getBoundingClientRect(); var cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0.05; };' +
  ' var inScroll = function (el) { var n = el.parentElement; for (var d = 0; d < 8 && n; d++) { var oy = getComputedStyle(n).overflowY; if (oy === "auto" || oy === "scroll") return true; n = n.parentElement; } return false; };' +
  ' var hasEllipsisAncestor = function (el) { var n = el.parentElement; for (var d = 0; d < 4 && n; d++) { if (getComputedStyle(n).textOverflow === "ellipsis") return true; n = n.parentElement; } return false; };' +
  // 对比度专用（261012）：祖先透明度必须参与（父级 opacity:0 的子树不可见，只看自身会误报，如 docked 下的 .edge-hotzone-handle）；
  // 内核/第三方（lakex/univer/drawnix）不属我们的设计系统，一律排除。
  ' var effOpacity = function (el) { var o = 1, n = el, d = 0; while (n && d < 10) { o *= parseFloat(getComputedStyle(n).opacity); if (o <= 0.05) return o; n = n.parentElement; d++; } return o; };' +
  ' var notOurs = function (el) { return el.closest(".ne-engine") || el.closest(".ne-ui") || el.closest(".ne-overlay-container") || el.closest("[class*=univer]") || el.closest("[class*=drawnix]"); };' +
  ' document.querySelectorAll("button,a[href],[role=button],input,select,textarea,[tabindex]").forEach(function (el) {' +
  '   if (!vis(el) || inScroll(el)) return; var r = el.getBoundingClientRect();' +
  '   if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) out.escape.push({ cls: String(el.className).slice(0, 40), title: el.title || el.getAttribute("aria-label") || "", rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], vw: innerWidth, vh: innerHeight });' +
  ' });' +
  ' document.querySelectorAll("div,span,p,h1,h2,h3,h4,strong,td,th").forEach(function (el) {' +
  '   if (!vis(el)) return; var cs = getComputedStyle(el);' +
  '   if (cs.whiteSpace !== "nowrap" || cs.overflow !== "hidden" || cs.textOverflow === "ellipsis") return;' +
  '   if (hasEllipsisAncestor(el)) return;' +
  '   if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 8) out.clipped.push({ cls: String(el.className).slice(0, 46), text: (el.textContent || "").trim().slice(0, 30), over: el.scrollWidth - el.clientWidth });' +
  ' });' +
  ' document.querySelectorAll("body *").forEach(function (el) {' +
  '   if (!ownText(el) || notOurs(el)) return; var r0 = el.getBoundingClientRect(); if (r0.width <= 2 || r0.height <= 2) return;' +
  '   var cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none" || effOpacity(el) <= 0.05) return; var fg = rgb(cs.color); if (!fg || fg.a < 0.9) return;' +
  '   var bg = effBg(el); var size = parseFloat(cs.fontSize); var bold = parseInt(cs.fontWeight, 10) >= 600;' +
  '   var need = (size >= 18.66 || (size >= 14 && bold)) ? 3 : 4.5; var cr = ratio(fg, bg);' +
  '   if (cr < need) out.contrast.push({ cls: String(el.className).slice(0, 46), text: (el.textContent || "").trim().slice(0, 24), fg: cs.color, bg: "rgb(" + bg.r + "," + bg.g + "," + bg.b + ")", size: size, ratio: Math.round(cr * 100) / 100, need: need });' +
  ' });' +
  ' out.pageOverflowX = Math.max(0, document.documentElement.scrollWidth - innerWidth);' +
  ' out.fixedOutside = [];' +
  ' document.querySelectorAll("body *").forEach(function (el) { var cs = getComputedStyle(el); if (cs.position !== "fixed" || !vis(el)) return; var r = el.getBoundingClientRect(); if (r.bottom > innerHeight + 1 || r.right > innerWidth + 1 || r.top < -1 || r.left < -1) out.fixedOutside.push({ cls: String(el.className).slice(0, 40), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }); });' +
  ' out.fixedOutside = out.fixedOutside.slice(0, 8);' +
  ' return out; })()';

const FOCUS = '(function () {' +
  ' var covered = function (e) { return e.matches("button, input, textarea, select, [role=button]"); };' +
  ' var cands = [].slice.call(document.querySelectorAll("[tabindex]")).filter(function (e) { return e.getAttribute("tabindex") !== "-1" && !covered(e) && e.getBoundingClientRect().width > 0; });' +
  ' var res = [];' +
  ' for (var i = 0; i < cands.length && i < 14; i++) { var el = cands[i]; el.focus();' +
  '   if (!el.matches(":focus-visible")) { res.push({ cls: String(el.className).slice(0, 44), skipped: "not-focus-visible" }); continue; }' +
  '   var cs = getComputedStyle(el);' +
  '   res.push({ tag: el.tagName, cls: String(el.className).slice(0, 44), color: cs.outlineColor, width: cs.outlineWidth, style: cs.outlineStyle, offset: cs.outlineOffset }); }' +
  ' if (document.activeElement && document.activeElement.blur) document.activeElement.blur();' +
  ' return res; })()';

var pageRef = null;
async function space(label) {
  const page = pageRef;
  const trig = await page.evaluate('(function () { var scope = document.querySelector(".workspace-view:not(.workspace-view--hidden)") || document; var el = [].slice.call(scope.querySelectorAll("[title^=空间], [aria-label^=空间]")).find(function (e) { return e.getBoundingClientRect().width > 0; }); if (!el) return null; var r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()');
  if (!trig) throw new Error("no space trigger");
  await page.click(trig[0], trig[1]); await page.sleep(450);
  const item = await page.evaluate('(function () { var want = ' + JSON.stringify(label) + '; var el = [].slice.call(document.querySelectorAll("button")).find(function (e) { return (e.textContent || "").trim().indexOf(want) === 0 && e.getBoundingClientRect().width > 0; }); if (!el) return null; var r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()');
  if (!item) throw new Error("no space item: " + label);
  await page.click(item[0], item[1]); await page.sleep(1400);
}
async function openDoc(label) {
  const page = pageRef;
  const pt = await page.evaluate('(function () { var el = [].slice.call(document.querySelectorAll("[data-tree-node-id]")).find(function (e) { return (e.textContent || "").indexOf(' + JSON.stringify(label) + ') >= 0; }); if (!el) return null; el.scrollIntoView({ block: "center" }); var r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()');
  if (!pt) throw new Error("no tree row: " + label);
  await page.click(pt[0], pt[1]); await page.sleep(2800);
}
async function openSettings(label) {
  const page = pageRef;
  const trig = await page.evaluate('(function () { var scope = document.querySelector(".workspace-view:not(.workspace-view--hidden)") || document; var el = [].slice.call(scope.querySelectorAll("[title^=空间], [aria-label^=空间]")).find(function (e) { return e.getBoundingClientRect().width > 0; }); if (!el) return null; var r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()');
  if (!trig) throw new Error("no space trigger");
  await page.click(trig[0], trig[1]); await page.sleep(450);
  const s = await page.evaluate('(function () { var el = [].slice.call(document.querySelectorAll("button,[role=menuitem]")).find(function (e) { return (e.textContent || "").indexOf("偏好设置") >= 0 && e.getBoundingClientRect().width > 0; }); if (!el) return null; var r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()');
  if (!s) throw new Error("no 偏好设置");
  await page.click(s[0], s[1]); await page.sleep(900);
  if (label) {
    const n = await page.evaluate('(function () { var el = [].slice.call(document.querySelectorAll(".settings-nav-item")).find(function (e) { return (e.textContent || "").trim() === ' + JSON.stringify(label) + '; }); if (!el) return null; var r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()');
    if (n) { await page.click(n[0], n[1]); await page.sleep(900); }
  }
}
async function contextRow(label) {
  const page = pageRef;
  const pt = await page.evaluate('(function () { var el = [].slice.call(document.querySelectorAll("[data-tree-node-id]")).find(function (e) { return (e.textContent || "").indexOf(' + JSON.stringify(label) + ') >= 0; }); if (!el) return null; el.scrollIntoView({ block: "center" }); var r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()');
  if (!pt) throw new Error("no row: " + label);
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt[0], y: pt[1] });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt[0], y: pt[1], button: "right", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt[0], y: pt[1], button: "right", clickCount: 1 });
  await page.sleep(800);
}
async function clickMenuItem(text) {
  const page = pageRef;
  const p = await page.evaluate('(function () { var el = [].slice.call(document.querySelectorAll("[role=menuitem], .ln-menu__item, .context-menu-item, .context-menu > button, button")).find(function (e) { return (e.textContent || "").trim() === ' + JSON.stringify(text) + ' && e.getBoundingClientRect().width > 0; }); if (!el) return null; var r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()');
  if (!p) throw new Error("no menu item: " + text);
  await page.click(p[0], p[1]); await page.sleep(1400);
}
async function splitWithFirstTab() {
  const page = pageRef;
  const b = await page.evaluate('(function () { var el = document.querySelector(".split-entry button"); if (!el || el.disabled) return null; var r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()');
  if (!b) throw new Error("split button unavailable");
  await page.click(b[0], b[1]); await page.sleep(700);
  const item = await page.evaluate('(function () { var el = [].slice.call(document.querySelectorAll(".tab-switcher-menu .tab-switcher-select, [data-split-menu] [role=menuitem]")).find(function (e) { return e.getBoundingClientRect().width > 0 && !e.disabled; }); if (!el) return null; var r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()');
  if (!item) throw new Error("no split candidate");
  await page.click(item[0], item[1]); await page.sleep(2000);
}

async function closeAll() {
  const page = pageRef;
  for (var i = 0; i < 6; i++) {
    const c = await page.evaluate('(function () { var el = [].slice.call(document.querySelectorAll("button")).find(function (e) { return String(e.className).indexOf("ln-close") >= 0 && e.getBoundingClientRect().width > 0; }); if (!el) return null; var r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()');
    if (!c) break;
    await page.click(c[0], c[1]); await page.sleep(320);
  }
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await page.sleep(260);
}

export default async function run(ctx) {
  const page = ctx.page; pageRef = page;
  const theme = ctx.args[0] || "light";
  const width = Number(ctx.args[1] || 1315);
  await page.evaluate('(function () { var k = "lake-notes-v1.settings"; var s = JSON.parse(localStorage.getItem(k) || "{}"); s.theme = ' + JSON.stringify(theme) + '; localStorage.setItem(k, JSON.stringify(s)); localStorage.setItem("lake-notes-v2.sidebar-mode", "docked"); })()');
  await page.send("Emulation.setDeviceMetricsOverride", { width: width, height: 868, deviceScaleFactor: 1, mobile: false });
  await page.send("Page.reload", { ignoreCache: false });
  await page.sleep(4600);
  await page.send("Runtime.enable"); await page.send("Page.enable");

  const settingsLabels = ["编辑器", "外观", "快捷键", "文档与历史", "云端与同步", "AI", "回收站", "浏览器端", "日志", "关于"];
  const screens = [
    ["library", async () => { await closeAll(); }],
    ["doc-richtext", async () => { await openDoc("合成·富文本"); }],
    ["doc-usheet", async () => { await openDoc("合成·表格"); }],
    ["doc-bitable", async () => { await openDoc("合成·多维表"); }],
    ["doc-board", async () => { await openDoc("合成·画板"); }],
    ["quicknotes", async () => { await closeAll(); await space("小记"); }],
    ["search", async () => { await space("资料库"); await page.sleep(700); const p = await page.evaluate('(function () { var el = [].slice.call(document.querySelectorAll("button")).find(function (e) { return /搜索/.test((e.title || "") + " " + (e.getAttribute("aria-label") || "")) && e.getBoundingClientRect().width > 0; }); if (!el) return null; var r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()'); if (p) { await page.click(p[0], p[1]); await page.sleep(900); const ok = await page.evaluate('(function () { var i = document.querySelector("input[type=search], input[placeholder*=搜索]"); if (!i) return false; i.focus(); return true; })()'); if (ok) { await page.send("Input.insertText", { text: "记" }); await page.sleep(1500); } } }],
    ["note-info", async () => { await openDoc("合成·富文本"); await contextRow("合成·富文本"); await clickMenuItem("属性"); }],
    ["history-panel", async () => { await closeAll(); await contextRow("合成·富文本"); await clickMenuItem("历史版本"); }],
    ["split-view", async () => { await closeAll(); await openDoc("合成·富文本"); await openDoc("合成·表格"); await splitWithFirstTab(); }],
    ["resources", async () => { await closeAll(); await space("资源"); }],
    ["trash-space", async () => { await closeAll(); await space("回收站"); }],
  ];
  for (var i = 0; i < settingsLabels.length; i++) {
    (function (label) { screens.push(["settings-" + label, async () => { await closeAll(); await openSettings(label); }]); })(settingsLabels[i]);
  }

  const only = (ctx.args[2] || "").split(",").filter(Boolean);
  const chosen = only.length ? screens.filter(function (s) { return only.indexOf(s[0]) >= 0; }) : screens;
  const report = { theme: theme, width: width, screens: {} };
  for (var s = 0; s < chosen.length; s++) {
    const name = chosen[s][0], nav = chosen[s][1];
    const rec = { ok: false };
    try {
      await nav();
      await page.sleep(700);
      const shot = await page.send("Page.captureScreenshot", { format: "png" });
      var b64 = shot && (shot.data || (shot.result && shot.result.data)); if (b64) fs.writeFileSync(OUT + "/" + theme + "-" + width + "-" + name + ".png", Buffer.from(b64, "base64"));
      const probe = await page.evaluate(PROBE);
      rec.focus = await page.evaluate(FOCUS);
      rec.escape = probe.escape.slice(0, 12);
      rec.clipped = probe.clipped.slice(0, 12);
      rec.contrast = probe.contrast.slice(0, 12);
      rec.pageOverflowX = probe.pageOverflowX || 0;
      rec.fixedOutside = (probe.fixedOutside || []).slice(0, 8);
      rec.ok = true;
    } catch (e) { rec.error = String((e && e.message) || e).slice(0, 170); }
    report.screens[name] = rec;
    const bad = [];
    if (rec.escape && rec.escape.length) bad.push("escape:" + rec.escape.length);
    if (rec.clipped && rec.clipped.length) bad.push("clip:" + rec.clipped.length);
    if (rec.contrast && rec.contrast.length) bad.push("contrast:" + rec.contrast.length);
    if (rec.pageOverflowX) bad.push("pageX:" + rec.pageOverflowX);
    if (rec.fixedOutside && rec.fixedOutside.length) bad.push("fixedOut:" + rec.fixedOutside.length);
    const auto = (rec.focus || []).filter(function (f) { return f.style === "auto"; }).length;
    if (auto) bad.push("ua-ring:" + auto);
    console.log("[walk] " + name + " " + (rec.ok ? "ok" : "ERR " + rec.error) + (bad.length ? "  " + bad.join(" ") : ""));
  }
  fs.writeFileSync(OUT + "/report-" + theme + "-" + width + ".json", JSON.stringify(report, null, 1));
  return { theme: theme, screens: Object.keys(report.screens).length, out: OUT };
}
