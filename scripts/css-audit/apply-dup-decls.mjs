// 把 plan-dup-decls.json 的删除落到磁盘（默认 dry-run；--write 才写）。判据与 build-spec/ab2 完全一致。
import fs from "node:fs";
import postcss from "postcss";
import { REPO, data } from "./paths.mjs";
const norm = (s) => String(s).replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim();
const inKf = (r) => { for (let p = r.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true; return false; };
const write = process.argv.includes("--write");
const planAll = JSON.parse(fs.readFileSync(data("plan-dup-decls.json"), "utf8"));
const byFile = {}; for (const e of planAll) (byFile[e.file] = byFile[e.file] || []).push(e);
let done = 0; const missed = [];
for (const [rel, entries] of Object.entries(byFile)) {
  const text = fs.readFileSync(REPO + rel, "utf8");
  const root = postcss.parse(text, { from: rel });
  const leaves = []; root.walkRules((r) => { if (!inKf(r)) leaves.push({ rule: r, sel: norm(r.selector), occ: 0 }); });
  { const bySel = new Map(); for (const l of leaves) { const n = bySel.get(l.sel) || 0; l.occ = n; bySel.set(l.sel, n + 1); } }
  const byKey = new Map(leaves.map((l) => [l.sel + "@@" + l.occ, l]));
  for (const e of entries) {
    const leaf = byKey.get(norm(e.selector) + "@@" + e.occ);
    if (!leaf) { missed.push(rel + ":" + e.line + " " + e.prop + " no-rule"); continue; }
    let hit = null; leaf.rule.walkDecls((d) => { if (hit) return; if (d.prop.toLowerCase() === e.prop.toLowerCase() && norm(d.value) === norm(e.value) && !!d.important === !!e.important) hit = d; });
    if (!hit) { missed.push(rel + ":" + e.line + " " + e.prop + " no-decl"); continue; }
    hit.remove(); done++;
  }
  root.walkRules((r) => { const ds = (r.nodes || []).filter((n) => n.type === "decl"); const subs = (r.nodes || []).filter((n) => n.type === "rule" || n.type === "atrule"); if (!ds.length && !subs.length) r.remove(); });
  // 清完声明留下的空 @media/@supports 壳（围栏的 emptyAtRules 会卡住）
  for (let pass = 0; pass < 3; pass++) { let n = 0; root.walkAtRules((a) => { if (/^(media|supports|starting-style|container|layer)$/i.test(a.name) && !(a.nodes || []).length) { a.remove(); n++; } }); if (!n) break; }
  if (write) fs.writeFileSync(REPO + rel, root.toString());
}
console.log((write ? "已落盘" : "dry-run") + "：删除 " + done + "/" + planAll.length + (missed.length ? "，未命中 " + missed.length + ": " + missed.slice(0, 8).join(" ; ") : "，全部命中"));
