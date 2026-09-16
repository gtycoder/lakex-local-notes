// 按选择器把某个样式文件里的规则**整块搬到**别的文件（只搬家，不改任何声明）。
// 用途：第二档「按职责归并样式层」的 S2/S3（HANDOFF §2.48 / docs/CSS-LAYERS-BRIEF-260916.md）。
//
// 用法：node scripts/css-audit/split-file.mjs <源文件> <映射.json> [--dry]
//   映射.json：[{ "match": "<正则>", "target": "src/styles/shell.css", "note": "..." }, ...]
//   未匹配任何条的规则**留在源文件**；注释跟随其后的规则一起搬；目标文件按映射顺序追加到末尾。
//
// 两条硬约束：
//   1. `@media (prefers-reduced-motion: reduce)` 这类**测试矩阵恒不成立**的块默认不搬（搬了无法验证，见 §2.47）。
//   2. 顶层 @media/@supports 整块搬，不拆散；块内选择器必须同域（否则报错让人工处理）。
import fs from "node:fs";
import postcss from "postcss";
import { REPO, data } from "./paths.mjs";

const src = process.argv[2];
const mapFile = process.argv[3];
const dry = process.argv.includes("--dry");
if (!src || !mapFile) { console.error("用法: node scripts/css-audit/split-file.mjs <源文件> <映射.json> [--dry]"); process.exit(2); }

const MAP = JSON.parse(fs.readFileSync(data(mapFile), "utf8")).map((m) => ({ ...m, re: new RegExp(m.match) }));
const norm = (s) => String(s).replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim();
const UNVERIFIABLE = /prefers-reduced-motion\s*:\s*reduce|prefers-reduced-transparency\s*:\s*reduce/;

const root = postcss.parse(fs.readFileSync(REPO + src, "utf8"), { from: src });

// 分组成"注释 + 规则/at-rule"
const groups = [];
let pending = [];
root.each((n) => {
  if (n.type === "comment") { pending.push(n); return; }
  groups.push({ nodes: [...pending, n], node: n });
  pending = [];
});
const trailing = pending;

const classify = (node) => {
  const sels = [];
  if (node.type === "rule") sels.push(norm(node.selector));
  else if (node.type === "atrule") node.each((c) => { if (c.type === "rule") sels.push(norm(c.selector)); });
  if (!sels.length) return null;
  for (const m of MAP) if (sels.every((s) => m.re.test(s))) return m;
  return null;
};

const out = new Map();   // target -> 文本块
const keep = [];
const perTarget = {};

for (const g of groups) {
  const n = g.node;
  // 不可验证的媒体块：原地不动
  if (n.type === "atrule" && UNVERIFIABLE.test(n.params)) { keep.push(g); continue; }
  const hit = classify(n);
  if (!hit) { keep.push(g); continue; }
  const text = g.nodes.map((x) => x.toString().trimEnd()).join("\n");
  if (!out.has(hit.target)) out.set(hit.target, []);
  out.get(hit.target).push({ text, note: hit.note });
  perTarget[hit.target] = (perTarget[hit.target] || 0) + (n.type === "rule" ? 1 : 0);
}

const srcText = keep.map((g) => g.nodes.map((x) => x.toString().trimEnd()).join("\n")).join("\n\n") + (trailing.length ? "\n\n" + trailing.map((x) => x.toString().trimEnd()).join("\n") : "") + "\n";

console.log(`源文件 ${src}：共 ${groups.length} 组，搬走 ${groups.length - keep.length} 组，留下 ${keep.length} 组`);
for (const [target, items] of out) {
  const head = items[0].note ? `\n\n/* ── 以下规则自 \`${src}\` 按职责并入（260916 S2/S3，只搬家不改声明）：${items[0].note} ── */\n` : `\n\n/* ── 以下规则自 \`${src}\` 按职责并入（260916 S2/S3）── */\n`;
  const body = items.map((i) => i.text).join("\n\n");
  const cur = fs.readFileSync(REPO + target, "utf8").replace(/\s*$/, "");
  if (!dry) fs.writeFileSync(REPO + target, cur + head + body + "\n");
  console.log(`  → ${target.padEnd(34)} 并入 ${items.length} 组（规则 ${perTarget[target] || 0} 条）`);
}
if (!dry) fs.writeFileSync(REPO + src, srcText.replace(/\n{3,}/g, "\n\n"));
console.log(`  ↳ ${src} 剩余 ${srcText.split("\n").length - 1} 行${dry ? "（dry-run，未落盘）" : ""}`);
