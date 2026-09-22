// 生成「被后层严格压制」的可删声明清单（可判定子集）。
// 判定：把规则的选择器列表按顶层逗号拆成单个选择器；同一级联上下文里，
//   同一个单选择器 + 同一属性被声明多次 ⇒ 后者恒胜（同一选择器 ⇒ 特异性相同）。
//   某条声明只有在**它的规则里每个单选择器都已被更晚的同名单选择器声明压制**时，才可整条删（列表里其它部分不受影响）。
// 保守排除：同一文件同一规则同一次出现的重复声明（CSS fallback 惯用形态）；胜者值含 color-mix(/light-dark(。
// 不处理：简写压长写、不同 @media 条件之间、跨层"自愿认输"的搬家（这些必须逐条实测，见 README §七）。
//
// 用法：node scripts/css-audit/plan-dup-decls.mjs [--write] [--dbg=<substr>]
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import { REPO, data } from "./paths.mjs";

const norm = (s) => String(s).replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim();
const inKf = (r) => { for (let p = r.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true; return false; };
const ctxOf = (r) => { const chain = []; for (let p = r.parent; p; p = p.parent) { if (p.type === "root") break; if (p.type === "atrule") chain.unshift("@" + p.name + " " + norm(p.params)); } return chain.join(" && "); };
const splitSels = (sel) => { const out = []; let depth = 0, cur = ""; for (const ch of sel) { if (ch === "(" || ch === "[") depth++; else if (ch === ")" || ch === "]") depth--; if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((s) => norm(s)).filter(Boolean); };

const loadorder = JSON.parse(fs.readFileSync(data("loadorder.json"), "utf8"));
// 260923：入口已从 src/styles.css 改为 src/styles/index.css，且 import 带 layer(x) ⇒ **级联上下文必须含层**，
// 不能再用"文件顺序 = 级联顺序"（有了 @layer，层序优先于文件顺序）。TS 直接 import 的 CSS 不在入口 import 里
// ⇒ 它们是**未分层**的，优先级高于所有层。
const ENTRY = fs.existsSync(REPO + "src/styles/index.css") ? "src/styles/index.css" : "src/styles.css";
const entryText = fs.readFileSync(REPO + ENTRY, "utf8");
const ENTRY_DIR = ENTRY.slice(0, ENTRY.lastIndexOf("/"));   // src/styles
const imports = [...entryText.matchAll(/@import\s+"([^"]+)"\s*(?:layer\(([^)]+)\))?/g)]
  .map((m) => ({ rel: path.posix.normalize(ENTRY_DIR + "/" + m[1]), layer: m[2] || null }))
  .filter((i) => fs.existsSync(REPO + i.rel));
const inEntry = new Set(imports.map((i) => i.rel));
const order = [...imports, ...loadorder
  .filter((f) => !inEntry.has(f) && f !== ENTRY && /\.css$/.test(f) && fs.existsSync(REPO + f))
  .map((rel) => ({ rel, layer: null }))];

const entries = [];
for (let fi = 0; fi < order.length; fi++) {
  const rel = order[fi].rel;
  const layer = order[fi].layer;
  const root = postcss.parse(fs.readFileSync(REPO + rel, "utf8"), { from: rel });
  const bySel = new Map();
  root.walkRules((r) => {
    if (inKf(r)) return;
    const fullSel = norm(r.selector);
    const occ = bySel.get(fullSel) || 0; bySel.set(fullSel, occ + 1);
    const ctx = ctxOf(r);
    r.walkDecls((d) => {
      entries.push({ file: rel, layer, fi, fullSel, occ, ctx, indSels: splitSels(fullSel), prop: d.prop.toLowerCase(), value: norm(d.value), important: !!d.important, line: d.source.start.line });
    });
  });
}

// 单选择器 × 属性 的级联组
const groups = new Map();
// 级联组必须按【层】分组：同层内"后者胜"成立；跨层优先级不同，属需实测的 L2（README §七），不在此工具判定。
for (const e of entries) for (const s of new Set(e.indSels)) { const k = e.ctx + "\u0000" + (e.layer || "(unlayered)") + "\u0000" + s + "\u0000" + e.prop; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }

if (process.argv.some((a) => a.startsWith("--dbg="))) {
  const q = process.argv.find((a) => a.startsWith("--dbg=")).slice(6);
  for (const [k, list] of groups) if (k.includes(q)) { console.log("KEY " + k.replace(/\u0000/g, "  ||  ")); for (const e of list) console.log("   fi=" + e.fi + "  " + e.file + ":" + e.line + "  [" + e.fullSel + "]  = " + e.value.slice(0, 55)); }
  process.exit(0);
}

// 每个单选择器组里，谁被压
const dominated = new WeakSet();
for (const list of groups.values()) {
  if (list.length < 2) continue;
  const importants = list.filter((e) => e.important);
  const winner = importants.length ? importants[importants.length - 1] : list[list.length - 1];
  if (/color-mix\(|light-dark\(/.test(winner.value)) continue;      // fallback 形态，跳过
  for (const e of list) if (e !== winner) dominated.add(e);
}

// 一条声明只有在它所在规则的每个单选择器都被压时，才可整条删
const plan = []; const kept = [];
for (const e of entries) {
  const allDom = e.indSels.every((s) => {
    const list = groups.get(e.ctx + "\u0000" + (e.layer || "(unlayered)") + "\u0000" + s + "\u0000" + e.prop) || [];
    if (list.length < 2) return false;
    const importants = list.filter((x) => x.important);
    const winner = importants.length ? importants[importants.length - 1] : list[list.length - 1];
    return winner !== e && dominated.has(e);
  });
  if (!allDom) continue;
  // fallback：同规则内同 prop 还有别的声明，且本条的 value 更"基础" → 跳过（保守）
  const siblings = entries.filter((x) => x.file === e.file && x.fullSel === e.fullSel && x.occ === e.occ && x.prop === e.prop);
  if (siblings.length > 1 && siblings[siblings.length - 1] !== e) { kept.push(e); continue; }
  plan.push({ file: e.file, selector: e.fullSel, occ: e.occ, prop: e.prop, value: e.value, important: e.important, line: e.line, _ctx: e.ctx });
}

const byFile = {}; for (const p of plan) byFile[p.file] = (byFile[p.file] || 0) + 1;
console.log("候选删除声明数：" + plan.length + "（因 fallback 形态保留 " + kept.length + " 条）");
console.log("按文件："); for (const [f, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) console.log("  " + String(n).padStart(3) + "  " + f);
console.log("\n清单：");
for (const p of plan) console.log("  " + p.file + ":" + p.line + "  [" + p.selector + "]  {" + p.prop + "}" + (p._ctx ? "   " + p._ctx : ""));
if (process.argv.includes("--write")) { fs.writeFileSync(data("plan-dup-decls.json"), JSON.stringify(plan, null, 1)); console.log("\n已写 " + data("plan-dup-decls.json")); }
