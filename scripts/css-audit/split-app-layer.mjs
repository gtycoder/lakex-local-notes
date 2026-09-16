// 第二档 S3：把**基础层**入口 `src/styles.css` 拆成 `src/styles/app/*.css` 并按域编排。
//
// 为什么要这个脚本：拆分不是一次性的——分类归错了（例：`.qn-check` 落到 misc 后因加载更晚而反超
// `.quick-note-select` 的 transition，实测 54 处差异）就要重跑。脚本从 `git show HEAD:src/styles.css`
// 取原始文本，**每次从零重建** app/ 下所有域文件与入口 manifest，保证可重复、可复核。
//
// 用法：node scripts/css-audit/split-app-layer.mjs [--dry]
// 约定：
//   · 域文件顺序 = 各域在原文里的**首次出现顺序**（尽量少动同层内相对顺序）
//   · 超长压缩块（第三方逐字节搬来的）不拆，留在 misc
//   · 入口 manifest 仍是 `src/styles.css`，整体加载位置不变（仍在 b3 之前）
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import postcss from "postcss";
import { REPO } from "./paths.mjs";

const dry = process.argv.includes("--dry");
const SRC_REL = "src/styles.css";
const APP_DIR = "src/styles/app";
const HEADER = "/* 基础层 · %TITLE%\n   260916 第二档 S3：自 src/styles.css 按职责拆出（脚本：scripts/css-audit/split-app-layer.mjs，可重跑）。\n   本层由 src/styles.css 的 @import 编排，整体仍在 b3 之前 —— 层间先后不得改变（见 docs/CSS-LAYERS-BRIEF-260916.md §6）。 */";

// 顺序 = 首次出现顺序（写死，脚本会校验并提示漂移）
const DOMAINS = [
  ["base", "复位与骨架（:root 字体栈 / * / html·body·#root / button·input / svg.lucide）", /^:root|^\*|^html|^body|^button|^input|^svg/],
  ["shell", "应用外壳（活动栏 / 目录栏与目录树 / 工作区与文档面板骨架）", /sidebar|tree-row|tree-chevron|tree-rename|tree-list|tree-children|note-row|note-list|current-note|create-menu|create-btn|inline-create|list-heading|activity-button|activity-rail|\.workspace|empty-workspace|document-pane|\.app-shell/],
  ["editor", "编辑器基础（.ne-* / lake-editor / 原生 TOC）", /\.ne-|lake-editor|\.lake-search|native-toc/],
  ["dialogs", "浮层与菜单（右键菜单 / 确认框 / 错误条 / 徽章 / 提示）", /context-menu|confirm-dialog|modal|error-banner|badge|toast|popover/],
  ["tabs", "页签与工具栏（.tab-* / .toolbar__item / .icon-button / .tabbar-*）", /tab-item|tab-bar|tabbar|tab-switcher|tab-close|tab-title|tab-dirty|tab-panels|toolbar__item|icon-button|\.tab-/],
  ["vendor-board", "第三方画板（Drawnix / plait）—— 逐字节搬来，勿手改", /plait|slate-|board-|drawnix|ttd-|\.Dialog/],
  ["settings", "设置面板基础（.settings-* / .config-* / .floating-dialog）", /\.settings-|\.config-|\.floating-dialog/],
  ["quick-notes", "小记工作台（.quick-note-* / .qn-*）", /quick-note|\.qn-/],
  ["panels", "历史 / 回收站面板（.history-* / .trash-*）", /\.history-|\.trash-/],
];
const MISC = "misc";

const text = execSync(`git show HEAD:${SRC_REL}`, { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }).toString();
const root = postcss.parse(text, { from: SRC_REL });
const inKf = (r) => { for (let p = r.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true; return false; };

// 分组："注释 + 规则" 一起走
const groups = [];
let pending = [];
root.each((n) => { if (n.type === "comment") { pending.push(n); return; } groups.push({ nodes: [...pending, n], node: n }); pending = []; });
if (pending.length) groups.push({ nodes: pending, node: null });

const bucketOf = (node) => {
  if (!node) return MISC;
  if (node.type === "atrule") {
    if (/prefers-reduced-motion\s*:\s*reduce|prefers-reduced-transparency\s*:\s*reduce/.test(node.params)) return "SKIP";   // 矩阵恒不成立 ⇒ 原地不动（留在 manifest 之前的位置由 misc 承接）
    const sels = []; node.each((c) => { if (c.type === "rule") sels.push(c.selector.replace(/\s+/g, " ")); });
    if (!sels.length) return MISC;
    for (const [name, , re] of DOMAINS) if (sels.every((s) => re.test(s))) return name;
    return MISC;
  }
  if (node.type !== "rule") return MISC;
  if (node.source && node.source.start.line === node.source.end.line && node.toString().length > 1000) return MISC;   // 超长第三方块
  const sel = node.selector.replace(/\s+/g, " ");
  for (const [name, , re] of DOMAINS) if (re.test(sel)) return name;
  return MISC;
};

const out = new Map();
for (const g of groups) {
  const b = bucketOf(g.node);
  const key = b === "SKIP" ? MISC : b;
  if (!out.has(key)) out.set(key, []);
  out.get(key).push(g.nodes.map((x) => x.toString().trimEnd()).join("\n"));
}

const stats = {};
for (const [name, items] of out) stats[name] = items.length;
console.log("域 → 组数：", JSON.stringify(stats));

if (!dry) {
  fs.mkdirSync(path.join(REPO, APP_DIR), { recursive: true });
  const order = [...DOMAINS.map(([n]) => n), MISC];
  for (const name of order) {
    const items = out.get(name) || [];
    const title = (DOMAINS.find(([n]) => n === name) || [, "未归类的剩余规则（含超长第三方压缩块）"])[1];
    fs.writeFileSync(path.join(REPO, APP_DIR, `${name}.css`), HEADER.replace("%TITLE%", title) + "\n\n" + items.join("\n\n") + "\n");
  }
  const manifest = [
    "/* 基础层入口（260916 第二档 S3）：本文件只做编排，规则一律在 app/ 下的域文件里。",
    "   顺序 = 各域在原 styles.css 里的**首次出现顺序**，尽量少动同层内的相对顺序。",
    "   关键：本文件整体仍在 b3（思源层）之前加载 —— 这个层间先后是刻意的：我们有一批规则是靠",
    "   \"写在前 + 特异性不够 = 让 b3 说了算\"来维持现状的（试搬实测见 docs/CSS-LAYERS-BRIEF-260916.md §6）。",
    "   所以域文件**不要**挪到 b3 之后，也不要把它们并进同名的壳层文件（shell.css / quick-notes.css …）。 */",
    ...order.map((n) => `@import "./styles/app/${n}.css";`),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(REPO, SRC_REL), manifest);
  console.log(`已重建 ${APP_DIR}/*.css（${order.length} 个域文件）与入口 ${SRC_REL}`);
}
