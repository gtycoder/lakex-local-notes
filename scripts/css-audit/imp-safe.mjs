// 判定"去掉 !important 是否仍然赢"：对每条 !important 的每个子选择器，逐状态找"重叠的竞争声明"
import postcss from "postcss";
import fs from "node:fs";
import { REPO, data } from "./paths.mjs";
const FILES = JSON.parse(fs.readFileSync(data("loadorder.css.json"), "utf8")).filter((f) => f.endsWith(".css"));
const FP = JSON.parse(fs.readFileSync(data("fingerprints-all.json"), "utf8"));
const CONDS = JSON.parse(fs.readFileSync(data("cond-eval.json"), "utf8"));
const STATES = Object.keys(FP);
const norm = (s) => s.replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim();
const inKf = (r) => { for (let p = r.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true; return false; };
const spec = (sel) => {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const cls = (sel.match(/\.[\w-]+/g) || []).length + (sel.match(/\[[^\]]+\]/g) || []).length;
  const pcs = (sel.match(/:(?!:)[\w-]+(\([^)]*\))?/g) || []).length;
  const pes = (sel.match(/::[\w-]+/g) || []).length;
  const el = (sel.replace(/::?[\w-]+(\([^)]*\))?/g, " ").match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return ids * 10000 + (cls + pcs + pes) * 100 + el;
};
const decls = [];
let seq = 0;
for (const rel of FILES) {
  const root = postcss.parse(fs.readFileSync(REPO + rel, "utf8"), { from: rel });
  root.walkRules((r) => {
    if (inKf(r)) return;
    const conditions = []; for (let p = r.parent; p && p.type === "atrule"; p = p.parent) if (p.name === "media") conditions.push(p.params.replace(/\s+/g, " ").trim());
    const sels = norm(r.selector).split(",").map((s) => s.trim()).filter(Boolean);
    r.walkDecls((d) => decls.push({ file: rel, line: d.source.start.line, conditions, sels, prop: d.prop, important: !!d.important, value: norm(d.value), seq: seq++, id: decls.length }));
  });
}
const byProp = new Map();
for (const d of decls) { const a = byProp.get(d.prop) || []; a.push(d); byProp.set(d.prop, a); }
const applies = (d, state) => d.conditions.every((c) => (CONDS[state] && CONDS[state][c]) === true);
const setOf = (state, sel) => { const v = FP[state][sel]; return v && v.length ? new Set(v) : null; };
const intersects = (a, b) => { if (!a || !b) return false; const [x, y] = a.size < b.size ? [a, b] : [b, a]; for (const v of x) if (y.has(v)) return true; return false; };

const safe = [], risky = [];
for (const d of decls) {
  if (!d.important) continue;
  if (d.sels.some((s) => /::?(view-transition|selection|before|after|marker|placeholder|backdrop|first-|last-|nth-|hover|focus|active|disabled|checked|placeholder-shown)/.test(s))) { risky.push({ d, why: "伪类/伪元素选择器，采样覆盖不到" }); continue; }
  let bad = null;
  for (const s of d.sels) {
    const specD = spec(s);
    for (const state of STATES) {
      if (!applies(d, state)) continue;
      const elsD = setOf(state, s);
      if (!elsD) continue;
      for (const c of byProp.get(d.prop) || []) {
        if (c === d) continue;
        if (!applies(c, state)) continue;
        for (const cs of c.sels) {
          const elsC = setOf(state, cs);
          // 保守：竞争者的选择器在**任何**状态下都没命中过，且带伪类/属性选择器 ⇒ 可能在未采样状态里命中，按"会重叠"处理
          const neverMatched = STATES.every((st) => !setOf(st, cs));
          const stateful = /[:\[]/.test(cs);
          if (!intersects(elsD, elsC) && !(neverMatched && stateful)) continue;
          const specC = spec(cs);
          const laterOrMoreSpecific = specC > specD || (specC === specD && c.seq > d.seq);
          // 去掉 D 的 !important 之后：C 若仍是 !important ⇒ C 一定赢 D ⇒ 危险；
          // 但若 C 现在（双方都 important 时）就已经压过 D，说明 D 本来就是死声明，去掉 flag 依旧不影响 ⇒ 安全。
          const riskyHere = c.important ? !laterOrMoreSpecific : laterOrMoreSpecific;
          if (riskyHere) { bad = { c, cs, state, specC, specD, cImportant: c.important }; break; }
        }
        if (bad) break;
      }
      if (bad) break;
    }
    if (bad) break;
  }
  if (bad) risky.push({ d, why: `被 ${bad.c.file}:${bad.c.line} {${bad.c.prop}} 竞争（important=${bad.cImportant}, spec ${bad.specC} vs ${bad.specD}, ${bad.state}）` });
  else safe.push(d);
}
console.log(`!important 共 ${decls.filter((d) => d.important).length}；判定"去掉仍赢（安全）"：${safe.length}；保留：${risky.length}`);
const byFile = new Map();
for (const d of safe) byFile.set(d.file, (byFile.get(d.file) || 0) + 1);
for (const [f, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${f}: ${n}`);
fs.writeFileSync(data("imp-safe.json"), JSON.stringify(safe.map((d) => ({ file: d.file, line: d.line, selector: d.sels.join(","), prop: d.prop, value: d.value, important: true })), null, 1));
fs.writeFileSync(data("imp-risky.json"), JSON.stringify(risky.map((r) => ({ file: r.d.file, line: r.d.line, selector: r.d.sels.join(","), prop: r.d.prop, why: r.why })), null, 1));
