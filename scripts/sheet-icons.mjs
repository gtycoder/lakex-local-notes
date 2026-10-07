#!/usr/bin/env node
/**
 * 表格（FortuneSheet）图标 = **云端 lakex 表格的图标**（用户 261008 定稿）。
 *
 * 云端表格工具栏用的是阿里 iconfont 项目 `lake-icon`（font_943843）+ 少量内联 SVG；这里把用得到的字形
 * 轮廓抽成 `scripts/sheet-icons.cloud.json`（24 网格、Y 已翻转、纯 path），由本脚本写进 vendored
 * `@fortune-sheet/react` 的 `<symbol>` 雪碧图里。**云端没有对应字形的图标一律保持内核原样**
 * （不自己画、也不引入第三方图标库）—— 即「找得到就用云端的，找不到就恢复原样」。
 *
 * 用法：
 *   node scripts/sheet-icons.mjs            # 就地改写 node_modules 里的 dist
 *   node scripts/sheet-icons.mjs --check    # 只报告会改哪些，不落盘
 * 改完必须重建补丁（否则重装依赖就丢）：
 *   PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH" npx patch-package @fortune-sheet/react
 *
 * 口径：只换 `<symbol>` 里的几何与右键菜单的图标位；**id / viewBox / DOM / 交互 / 数据一律不动**。
 * 颜色一律 `currentColor`（跟随 --lake-* 三主题）。机制与坑见 docs/TROUBLESHOOTING.md §M。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = path.join(ROOT, "node_modules/@fortune-sheet/react/dist");
const TARGETS = ["index.esm.js", "index.js"];
const CHECK = process.argv.includes("--check");
const CLOUD = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/sheet-icons.cloud.json"), "utf8")).icons;

/** 右键菜单：内核 `Menu` 只渲染文案 ⇒ 补一个图标位（图标同样取自云端字形；菜单条目与快捷键提示都不动）。 */
const MENU_ICONS = {
  copy: "copy",
  paste: "cm-paste",
  "add-col-left": "cm-col-left",
  "add-col-right": "cm-col-right",
  "add-row-top": "cm-row-top",
  "add-row-bottom": "cm-row-bottom",
  "delete-row": "cm-delete",
  "delete-column": "cm-delete",
  "hide-row": "hidden",
  "hide-column": "hidden",
  "set-row-height": "cm-move-vertical",
  "set-column-width": "cm-move-horizontal",
  clear: "clear-format",
  orderAZ: "cm-order-az",
  orderZA: "cm-order-za",
  sort: "sort",
  filter: "filter",
  image: "image",
  "cell-image": "image",
  link: "link",
  "auto-row-height": "cm-move-vertical",   // 右键「自动行高」（自定义项；只在右键菜单出现）
};
const MENU_MAP = "_LAKE_MENU_ICONS";
const MENU_HELPER = "_lakeMenuIcon";

const js = (v) => JSON.stringify(v);
const assert = (v, msg) => { if (!v) throw new Error(msg); };

/** 取 `createElement` 前面的 callee（esm 是 `React`，cjs 是 `React__default['default']`）。 */
const CALLEE_RE = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]*\])*)\.$/;
function calleeAt(src, at) {
  const from = Math.max(0, at - 120);
  const m = src.slice(from, at).match(CALLEE_RE);
  assert(m, "取不到 createElement 的 callee");
  return { name: m[1], start: from + m.index };
}

/** 从 createElement("symbol" 起点扫到整个调用结束（跳过字符串）。 */
function callEnd(src, start) {
  const open = src.indexOf("(", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      for (i++; i < src.length && src[i] !== q; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error("括号不配对");
}

/** 云端图标 → `<symbol>` 子元素。`d` = 单条路径；`nodes` = [包装组, ...子元素]（内联 chevron 的缩放用）。 */
function renderSymbol(id, icon, callee) {
  const ce = `${callee}.createElement`;
  // 节点：["tag", attrs] 或 ["tag", attrs, children[]]（SVG 的嵌套 <g transform> 必须原样保留）
  const CAMEL = { "stroke-width": "strokeWidth", "stroke-linecap": "strokeLinecap", "stroke-linejoin": "strokeLinejoin",
    "stroke-dasharray": "strokeDasharray", "fill-rule": "fillRule", "clip-rule": "clipRule", "fill-opacity": "fillOpacity",
    "stroke-opacity": "strokeOpacity", "stroke-miterlimit": "strokeMiterlimit", "stop-color": "stopColor" };
  const fix = (attrs) => Object.fromEntries(Object.entries(attrs).map(([k, v]) => [CAMEL[k] ?? k, v]));
  const el = ([tag, attrs, kids]) =>
    kids && kids.length
      ? `${ce}(${js(tag)}, ${js(fix(attrs))}, ${kids.map(el).join(", ")})`
      : `${ce}(${js(tag)}, ${js(fix(attrs))})`;
  const kids = icon.d
    ? `${ce}("path", { d: ${js(icon.d)}, fill: "currentColor" })`
    : icon.nodes.length === 1
      ? el(icon.nodes[0])
      : el([icon.nodes[0][0], icon.nodes[0][1], icon.nodes.slice(1)]);
  return `${ce}("symbol", {\n    viewBox: "0 0 24 24",\n    fill: "none",\n    id: ${js(id)}\n  }, ${kids})`;
}

/** 右键菜单改造：注入「key→符号」表 + 装饰器，并给 Menu 补图标位（幂等）。 */
function patchContextMenu(src, callee) {
  if (src.includes(MENU_MAP)) {
    return { src: src.replace(new RegExp(`var ${MENU_MAP} = \\{[^}]*\\};`), `var ${MENU_MAP} = ${js(MENU_ICONS)};`), count: 0 };
  }
  const ce = `${callee}.createElement`;
  let n = 0;
  const anchor = "var Menu = function Menu";
  assert(src.includes(anchor), "找不到 Menu 组件锚点");
  src = src.replace(
    anchor,
    `var ${MENU_MAP} = ${js(MENU_ICONS)};\n` +
      `var ${MENU_HELPER} = function ${MENU_HELPER}(el, menu) {\n` +
      `  if (Array.isArray(el)) return el.map(function (item) { return ${MENU_HELPER}(item, menu); });\n` +
      `  if (el && el.type === Menu) return ${callee}.cloneElement(el, { menuKey: el.key != null ? String(el.key) : menu });\n` +
      `  return el;\n};\n` + anchor,
  );
  n++;
  const mapOld = "return getMenuElement(menu, i);";
  const cnt = src.split(mapOld).length - 1;
  assert(cnt === 2, `getMenuElement 包装点数量异常：${cnt}`);
  src = src.split(mapOld).join(`return ${MENU_HELPER}(getMenuElement(menu, i), menu);`);
  n += cnt;
  const contentOld = `${ce}("div", {\n    className: "luckysheet-cols-menuitem-content luckysheet-mousedown-cancel"\n  }, children)`;
  assert(src.includes(contentOld), "找不到 Menu 内容渲染锚点");
  const icon =
    `${ce}("span", { className: "luckysheet-cols-menuicon" }, ${MENU_MAP}[_ref.menuKey] ? ` +
    `${ce}("svg", { width: 16, height: 16, "aria-hidden": "true" }, ` +
    `${ce}("use", { xlinkHref: "#" + ${MENU_MAP}[_ref.menuKey] })) : null)`;
  src = src.replace(contentOld, contentOld.replace("}, children)", `}, ${icon}, children)`));
  n++;
  return { src, count: n };
}

/** 云端有、原 sprite 里没有的符号 → 插到 defs 开头（幂等）。 */
function insertExtraSymbols(src, callee) {
  const missing = Object.keys(CLOUD).filter((id) => !src.includes(`id: ${js(id)}`));
  if (missing.length === 0) return { src, count: 0 };
  const anchor = 'createElement("defs", null, ';
  assert(src.includes(anchor), "找不到 defs 锚点");
  const block = missing
    .map((id) => `${callee}.createElement("symbol", { viewBox: "0 0 24 24", fill: "none", id: ${js(id)}}), `)
    .join("");
  return { src: src.replace(anchor, anchor + block), count: missing.length };
}

async function rewrite(file) {
  const abs = path.join(PKG, file);
  let src = fs.readFileSync(abs, "utf8");
  const calleeName = src.includes("React__default['default'].createElement") ? "React__default['default']" : "React";
  const added = insertExtraSymbols(src, calleeName); src = added.src;
  const menu = patchContextMenu(src, calleeName); src = menu.src;
  // 枚举**所有** <symbol>（`id: "x"` 也可能是普通 div 的属性，不能只按 id 找）
  const symbols = new Map();
  for (let i = 0; (i = src.indexOf('createElement("symbol"', i)) >= 0;) {
    const end = callEnd(src, i);
    const m = src.slice(i, end).match(/id:\s*"([^"]+)"/);
    if (m) symbols.set(m[1], { start: i, end });
    i = end;
  }
  const edits = [];
  for (const [id, icon] of Object.entries(CLOUD)) {
    const hit = symbols.get(id);
    if (!hit) continue;
    const callee = calleeAt(src, hit.start);
    const next = renderSymbol(id, icon, callee.name);
    if (src.slice(callee.start, hit.end) === next) continue;   // 幂等
    edits.push({ start: callee.start, end: hit.end, next });
  }
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    src = src.slice(0, e.start) + e.next + src.slice(e.end);
  }
  if (!CHECK) fs.writeFileSync(abs, src);
  const untouched = [...symbols.keys()].filter((id) => !CLOUD[id]);
  return { file, replaced: edits.length, total: symbols.size, addedSymbols: added.count, menuEdits: menu.count, untouched };
}

for (const f of TARGETS) {
  const r = await rewrite(f);
  console.log(
    `${CHECK ? "[check] " : ""}${r.file}: 云端图标 ${r.replaced}/${r.total}（其余 ${r.untouched.length} 个保持内核原样）` +
      `，新增符号 ${r.addedSymbols}，菜单改造 ${r.menuEdits} 处`,
  );
}
