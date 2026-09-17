// 构造 ab2 'spec' 模式用的整份样式文本：
//   · src/styles.css 那张表 = app/*.css 按 @import 顺序拼接（含可选删除）——绕开 README §七 的内联陷阱；
//   · 其余含删除的文件各自一整份。
// 用法：node scripts/css-audit/build-spec-dup.mjs --mode=baseline|dedup
import fs from "node:fs";
import postcss from "postcss";
import { REPO, data } from "./paths.mjs";

const norm = (s) => String(s).replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim();
const inKf = (r) => { for (let p = r.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true; return false; };

function applyPlan(text, rel, entries) {
  if (!entries || !entries.length) return { text, done: 0, missed: [] };
  const root = postcss.parse(text, { from: rel });
  const leaves = []; root.walkRules((r) => { if (!inKf(r)) leaves.push({ rule: r, sel: norm(r.selector), occ: 0 }); });
  { const bySel = new Map(); for (const l of leaves) { const n = bySel.get(l.sel) || 0; l.occ = n; bySel.set(l.sel, n + 1); } }
  const byKey = new Map(leaves.map((l) => [l.sel + "@@" + l.occ, l]));
  let done = 0; const missed = [];
  for (const e of entries) {
    const leaf = byKey.get(norm(e.selector) + "@@" + e.occ);
    if (!leaf) { missed.push(e.line + " " + e.prop + " no-rule"); continue; }
    let hit = null; leaf.rule.walkDecls((d) => { if (hit) return; if (d.prop.toLowerCase() === e.prop.toLowerCase() && norm(d.value) === norm(e.value) && !!d.important === !!e.important) hit = d; });
    if (!hit) { missed.push(e.line + " " + e.prop + " no-decl"); continue; }
    hit.remove(); done++;
  }
  root.walkRules((r) => { const ds = (r.nodes || []).filter((n) => n.type === "decl"); const subs = (r.nodes || []).filter((n) => n.type === "rule" || n.type === "atrule"); if (!ds.length && !subs.length) r.remove(); });
  return { text: root.toString(), done, missed };
}

const mode = (process.argv.find((a) => a.startsWith("--mode=")) || "--mode=dedup").slice(7);
const planAll = mode === "baseline" ? [] : JSON.parse(fs.readFileSync(data("plan-dup-decls.json"), "utf8"));
const loadorder = JSON.parse(fs.readFileSync(data("loadorder.json"), "utf8"));
const appFiles = [...fs.readFileSync(REPO + "src/styles.css", "utf8").matchAll(/@import\s+"([^"]+)"/g)].map((m) => "src/" + m[1].replace(/^\.\//, ""));

let done = 0; const missed = [];
const parts = [];
for (const rel of appFiles) {
  const r = applyPlan(fs.readFileSync(REPO + rel, "utf8"), rel, planAll.filter((e) => e.file === rel));
  done += r.done; missed.push(...r.missed.map((m) => rel + " " + m));
  parts.push("/* ==== " + rel + " ==== */\n" + r.text);
}
const spec = [{ file: "src/styles.css", text: parts.join("\n") }];
for (const rel of loadorder) {
  if (rel === "src/styles.css" || appFiles.includes(rel)) continue;
  const entries = planAll.filter((e) => e.file === rel);
  if (!entries.length) continue;
  const r = applyPlan(fs.readFileSync(REPO + rel, "utf8"), rel, entries);
  done += r.done; missed.push(...r.missed.map((m) => rel + " " + m));
  spec.push({ file: rel, text: r.text });
}
const out = data(mode === "baseline" ? "spec-baseline.json" : "spec-dedup.json");
fs.writeFileSync(out, JSON.stringify(spec, null, 1));
console.log(mode + ": 注入表 " + spec.length + " 张（src/styles.css = app/* 拼接 " + appFiles.length + " 份），应用删除 " + done + "/" + planAll.length + (missed.length ? "，未命中 " + missed.length + ": " + missed.slice(0, 6).join(" ; ") : ""));
console.log("→ " + out);
