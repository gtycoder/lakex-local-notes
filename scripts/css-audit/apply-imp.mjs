// 把"去掉多余的 !important"计划落到源文件。
//   用法：node scripts/css-audit/apply-imp.mjs [计划文件=plan-imp.json]
// 定位键 = 整条规则的选择器文本 + 该文本在文件里的出现序号 + 属性 + 值（三处都对上才动，避免误伤同名规则）。
// 带守恒断言：只允许"声明去掉 important 标记"，条数必须一条不多一条不少；对不上就 exit 3 不落盘。
import fs from "node:fs";
import postcss from "postcss";
import { REPO, data } from "./paths.mjs";

const planFile = data(process.argv[2] || "plan-imp.json");
const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
const norm = (s) => String(s).replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim();
const inKf = (r) => { for (let p = r.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true; return false; };
const countDecls = (root) => { let n = 0, imp = 0; root.walkDecls((d) => { n++; if (d.important) imp++; }); return { n, imp }; };

let totalDone = 0;
const missed = [];
const touched = [];

for (const rel of [...new Set(plan.map((e) => e.file))]) {
  const entries = plan.filter((e) => e.file === rel);
  const file = REPO + rel;
  const before = fs.readFileSync(file, "utf8");
  const root = postcss.parse(before, { from: file });

  const leaves = [];
  root.walkRules((r) => { if (!inKf(r)) leaves.push({ rule: r, sel: norm(r.selector) }); });
  const bySel = new Map();
  for (const l of leaves) { const n = bySel.get(l.sel) || 0; l.occ = n; bySel.set(l.sel, n + 1); }
  const byKey = new Map(leaves.map((l) => [l.sel + "@@" + l.occ, l]));

  let done = 0;
  for (const e of entries) {
    const leaf = byKey.get(norm(e.selector) + "@@" + e.occ);
    if (!leaf) { missed.push(`${rel}:${e.line} ${e.prop} 找不到规则（选择器+序号）`); continue; }
    let hit = null;
    leaf.rule.walkDecls((d) => {
      if (hit) return;
      if (d.prop.toLowerCase() === e.prop.toLowerCase() && norm(d.value) === norm(e.value) && !!d.important === !!e.important) hit = d;
    });
    if (!hit) { missed.push(`${rel}:${e.line} ${e.prop} 找不到声明（属性+值+important 标记）`); continue; }
    if (e.dropImportant) hit.important = false; else hit.remove();
    done++;
  }

  const stat = countDecls(root);
  if (stat.n !== countDecls(postcss.parse(before)).n) {
    console.error(`✗ ${rel}: 声明条数变了（这是"去掉 important"，不该增删声明）——未落盘`);
    process.exit(3);
  }
  const after = root.toString();
  fs.writeFileSync(file, after);
  touched.push({ rel, done, important: `${countDecls(postcss.parse(before)).imp} → ${stat.imp}` });
  totalDone += done;
}

console.log(`计划 ${plan.length} 条，落盘 ${totalDone} 条，未命中 ${missed.length} 条`);
for (const t of touched) console.log(`  ${t.rel.padEnd(42)} ${String(t.done).padStart(3)} 条   !important: ${t.important}`);
if (missed.length) { for (const m of missed) console.error("  ✗ " + m); process.exit(3); }
