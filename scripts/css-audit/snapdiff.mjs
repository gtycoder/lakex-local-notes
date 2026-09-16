// 对比两份整页计算值快照（stylesnap.mjs 产出的 snap/<tag>.json）
// 用法：node scripts/css-audit/snapdiff.mjs <A.json> <B.json>   （VERBOSE=1 打印具体元素）
// 对比两份整页计算值快照，逐元素指纹差异（0 = 完全一致）
import fs from "node:fs";
const A = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const B = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const verbose = process.env.VERBOSE === "1";
let total = 0, states = 0;
for (const name of Object.keys(A.states)) {
  const a = A.states[name], b = B.states[name];
  if (!b) { console.log(`${name}: MISSING in B`); total++; continue; }
  const bm = new Map(b.rows);
  const diffs = [];
  for (const [k, v] of a.rows) if (bm.get(k) !== v) diffs.push(k);
  const extra = b.rows.filter(([k]) => !new Map(a.rows).has(k)).map(([k]) => k);
  if (diffs.length || extra.length || a.n !== b.n) {
    states++; total += diffs.length + extra.length;
    console.log(`${name}: 元素 ${a.n} -> ${b.n} | 指纹不同 ${diffs.length}${extra.length ? ` | 新增 ${extra.length}` : ""}`);
    if (verbose) for (const d of diffs.slice(0, 25)) console.log(`    ~ ${d}`);
    if (verbose) for (const d of extra.slice(0, 10)) console.log(`    + ${d}`);
  } else {
    console.log(`${name}: OK (${a.n} els, 0 diff)`);
  }
}
console.log(`\n合计：${states} 个状态有差异，${total} 条指纹差异`);
