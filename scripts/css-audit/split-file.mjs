// 按选择器把某个样式文件里的规则**整块搬到**别的文件（只搬家，不改任何声明）。
// 用途：第二档「按职责归并样式层」的 S2/S3（HANDOFF §2.48 / docs/CSS-LAYERS-BRIEF-260916.md）。
//
// 用法：node scripts/css-audit/split-file.mjs <源文件> <映射.json> [--dry] [--prepend]
//   映射.json：[{ "match": "<正则>", "target": "src/styles/shell.css", "note": "..." }, ...]
//   未匹配任何条的规则**留在源文件**；注释跟随其后的规则一起搬；目标文件按映射顺序追加到末尾。
//   `--prepend`：改为插到目标文件**开头**（紧跟在文件头注释之后）。跨层合并时用它：
//   插在开头能保留"这批规则仍然输给目标文件原有规则"的关系（原来的相对关系就是"早的那个输"）。
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
const prepend = process.argv.includes("--prepend");
if (!src || !mapFile) { console.error("用法: node scripts/css-audit/split-file.mjs <源文件> <映射.json> [--dry]"); process.exit(2); }

const MAP = JSON.parse(fs.readFileSync(data(mapFile), "utf8")).map((m) => ({ ...m, re: new RegExp(m.match) }));
const norm = (s) => String(s).replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim();
// 一条媒体块能不能搬，取决于**它在当前状态矩阵里是否可观测**：用 cond-eval.json（每个状态 × 每个条件的真值）查——
// 只要有任意状态满足它的全部条件，搬运就可验证；一个都不满足 ⇒ 原地不动（证不了就不动）。
// 260916：矩阵补了 reduced-motion / reduced-transparency 状态后，原来"不可搬"的那几个块自动变成可搬。
const CONDS = (() => { try { return JSON.parse(fs.readFileSync(data("cond-eval.json"), "utf8")); } catch (e) { return null; } })();
const CONDS_N = CONDS ? Object.keys(CONDS).length : 0;
const observable = (params) => {
  const key = String(params).replace(/\s+/g, " ").trim();
  if (!CONDS) return { ok: false, why: "没有 cond-eval.json（先跑 cond-eval.mjs）" };
  const sample = CONDS[Object.keys(CONDS)[0]] || {};
  if (!Object.prototype.hasOwnProperty.call(sample, key)) return { ok: false, why: `条件不在 cond-eval 里（${key}）` };
  const n = Object.values(CONDS).filter((st) => st[key] === true).length;
  return { ok: n > 0, why: `矩阵 ${n}/${CONDS_N} 个状态满足该条件` };
};

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
  // 超长行（>1000 字符）= 第三方逐字节搬来的压缩块（例：styles.css L420 的 drawnix 画板 CSS，与 vendor 文件完全一致）。
  // 这类块**原地不动**：拆它既会破坏"与 vendor 逐字节相同"的性质，也会产生无法复核的巨diff。
  if (n.source && n.source.start.line === n.source.end.line && n.toString().length > 1000) {
    keep.push(g);
    console.log(`  ⚠ 超长块原地不动：L${n.source.start.line}（${n.toString().length} 字符，${n.type} ${String(n.selector || n.name || "").slice(0, 40)}）`);
    continue;
  }
  // 媒体/支持块：只有"矩阵里可观测"的才搬（见上面 observable 的说明）
  if (n.type === "atrule" && /^(media|supports)$/i.test(n.name)) {
    const ob = observable(n.params);
    if (!ob.ok) { keep.push(g); console.log(`  ⚠ 媒体块原地不动（${ob.why}）：@${n.name} ${n.params.trim().slice(0, 60)}`); continue; }
  }
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
  let next;
  if (prepend) {
    // 跳过目标文件开头的注释块（含首个非注释行之前的所有注释）
    const lines = cur.split("\n");
    let i = 0;
    if (lines[0] && lines[0].trim().startsWith("/*")) {
      let closed = lines[0].includes("*/");
      i = 1;
      while (!closed && i < lines.length) { if (lines[i].includes("*/")) closed = true; i++; }
    }
    next = [...lines.slice(0, i), head.trimStart(), body, "", ...lines.slice(i)].join("\n");
  } else {
    next = cur + head + body + "\n";
  }
  if (!dry) fs.writeFileSync(REPO + target, next);
  console.log(`  → ${target.padEnd(34)} 并入 ${items.length} 组（规则 ${perTarget[target] || 0} 条）${prepend ? " [插在开头]" : ""}`);
}
if (!dry) fs.writeFileSync(REPO + src, srcText.replace(/\n{3,}/g, "\n\n"));
console.log(`  ↳ ${src} 剩余 ${srcText.split("\n").length - 1} 行${dry ? "（dry-run，未落盘）" : ""}`);
