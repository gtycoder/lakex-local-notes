// 计划过滤器：**剔掉"测试矩阵里永远不会生效"的声明**。
// 动机（260916 第七轮踩到）：`@media (prefers-reduced-motion: reduce)` 里的 12 条
// `animation/transition: none !important` 被判成"安全"，但那个条件在 27 个状态里**一次都没成立**——
// 测试根本覆盖不到它们。删掉在真机（用户开了"减弱动态效果"）可能让运动契约失效。
// 口径：某条的媒体条件在**零个**测试状态里为真 ⇒ 不可证 ⇒ 不动。
// 用法：node scripts/css-audit/filter-plan.mjs <输入计划> <输出计划>
import fs from "node:fs";
import postcss from "postcss";
import { REPO, data } from "./paths.mjs";

const inFile = data(process.argv[2] || "plan-imp.json");
const outFile = data(process.argv[3] || "plan-imp.json");
const plan = JSON.parse(fs.readFileSync(inFile, "utf8"));
const CONDS = JSON.parse(fs.readFileSync(data("cond-eval.json"), "utf8"));
const norm = (s) => String(s).replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim();
const inKf = (r) => { for (let p = r.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true; return false; };

const lost = [];
const kept = [];
for (const e of plan) {
  const root = postcss.parse(fs.readFileSync(REPO + e.file, "utf8"), { from: e.file });
  const leaves = [];
  root.walkRules((r) => { if (!inKf(r)) leaves.push({ rule: r, sel: norm(r.selector) }); });
  const bySel = new Map();
  for (const l of leaves) { const n = bySel.get(l.sel) || 0; l.occ = n; bySel.set(l.sel, n + 1); }
  const leaf = leaves.find((l) => l.sel === norm(e.selector) && l.occ === e.occ);
  let conds = [];
  if (leaf) { for (let p = leaf.rule.parent; p && p.type === "atrule"; p = p.parent) if (p.name === "media") conds.push(p.params.replace(/\s+/g, " ").trim()); }
  const applicable = conds.length === 0 || Object.values(CONDS).some((st) => conds.every((c) => st[c] === true));
  if (applicable) kept.push(e); else lost.push({ e, conds });
}

fs.writeFileSync(outFile, JSON.stringify(kept, null, 1));
console.log(`输入 ${plan.length} 条 → 保留 ${kept.length} 条，剔除 ${lost.length} 条（媒体条件在测试矩阵里从未成立）`);
for (const { e, conds } of lost) console.log(`  – ${e.file}:${e.line}  @${conds.join(" / @")}  {${e.prop}}`);
const byFile = {}; for (const e of kept) byFile[e.file] = (byFile[e.file] || 0) + 1;
console.log(JSON.stringify(byFile, null, 1));
