/**
 * 样式「重复/漏用原语」审计（260930 大统一用出来的两把尺子之一）：找出「长得像某个 kit 原语、却自己写了一套」的规则。
 *
 * 做法：以 kit.css 里的 `.ln-*` 基类为「原语签名」，与其它文件里每条规则的声明做加权相似度：
 *   同名同值 = 1.0；同名且都是长度类（宽高/内距/圆角/字号/gap） = 0.45；其余 0。
 * 得分 ≥ 阈值即报出 —— 这些就是「本该复用原语」的候选。
 *
 * 用法（在仓库根跑）：node scripts/css-audit/audit-lookalike.mjs [阈值=0.62] [原语最小声明数=7]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const THRESHOLD = Number(process.argv[2] ?? 0.6);
/** 只把「整件控件级」的原语当签名（声明太少的只是文本工具类，会命中一切）。 */
const MIN_PRIM_DECLS = Number(process.argv[3] ?? 4);
const SCAN_DIRS = ["src/styles", "src/features", "src/components", "src/mobile"];
const SKIP = [/node_modules/, /vendor/, /\.test\./, /fonts\//];
const LENGTHY = /^-?\d*\.?\d+(px|em|rem|%)?$|^var\(--lake-(space|radius|font|size)/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (SKIP.some((re) => re.test(p))) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".css")) out.push(p);
  }
  return out;
}

function parseRules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const stack = [];
  let buf = "";
  for (const ch of src) {
    if (ch === "{") { stack.push(buf.trim()); buf = ""; }
    else if (ch === "}") {
      const head = stack.pop() ?? "";
      const body = buf.trim(); buf = "";
      if (!head.startsWith("@") && body && head) {
        const decls = new Map();
        for (const d of body.split(";")) {
          const i = d.indexOf(":");
          if (i < 0) continue;
          decls.set(d.slice(0, i).trim(), d.slice(i + 1).replace(/\s+/g, " ").trim());
        }
        if (decls.size) rules.push({ selector: head, decls });
      }
    } else buf += ch;
  }
  return rules;
}

const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)))
  .map((f) => ({ rel: path.relative(ROOT, f), rules: parseRules(readFileSync(f, "utf8")) }));

/** 原语签名：kit.css 里最外层 `.ln-xxx { ... }`（只取基类，不带状态/变体）。 */
const kit = files.find((f) => f.rel.endsWith("styles/kit.css"));
const primitives = kit.rules
  .filter((r) => /^\.ln-[a-z0-9_-]+$/.test(r.selector) && r.decls.size >= MIN_PRIM_DECLS)
  .map((r) => ({ name: r.selector, decls: r.decls }));

const score = (prim, cand) => {
  let hit = 0;
  for (const [prop, val] of prim.decls) {
    const other = cand.decls.get(prop);
    if (other === undefined) continue;
    if (other === val) hit += 1;
    else if (LENGTHY.test(val) && LENGTHY.test(other)) hit += 0.45;
  }
  return hit / prim.decls.size;
};

const report = [];
for (const f of files) {
  if (f.rel.endsWith("styles/kit.css")) continue;
  for (const rule of f.rules) {
    if (rule.decls.size < 3) continue;
    if (/\bln-[a-z0-9_-]+/.test(rule.selector) && !/\.ln-/.test(rule.selector.split(" ").pop())) continue; // 已复用原语的组合规则跳过
    for (const prim of primitives) {
      const s = score(prim, rule);
      if (s >= THRESHOLD) report.push({ score: s, prim: prim.name, ...f, rule });
    }
  }
}

report.sort((a, b) => b.score - a.score);
console.log(`原语 ${primitives.length} 个；阈值 ${THRESHOLD}；命中 ${report.length} 条\n`);
let lastPrim = null;
for (const r of report) {
  if (r.prim !== lastPrim) { console.log(`\n### ${r.prim}`); lastPrim = r.prim; }
  console.log(`  ${r.score.toFixed(2)}  ${r.rel}  →  ${r.rule.selector.replace(/\s+/g, " ")}`);
}
