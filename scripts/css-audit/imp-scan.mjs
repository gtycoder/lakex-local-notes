// 统计我们自己的样式里的 !important，并标出"同一(容器+选择器文本+属性)里的最后一条"（这些最可能是多余的）
import postcss from "postcss";
import fs from "node:fs";
import { REPO, data } from "./paths.mjs";
const FILES = JSON.parse(fs.readFileSync(data("loadorder.css.json"), "utf8")).filter((f) => f.endsWith(".css"));
const norm = (s) => s.replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim();
const inKf = (r) => { for (let p = r.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true; return false; };
const occ = [];
for (const rel of FILES) {
  const root = postcss.parse(fs.readFileSync(REPO + rel, "utf8"), { from: rel });
  root.walkRules((r) => {
    if (inKf(r)) return;
    const chain = []; for (let p = r.parent; p && p.type === "atrule"; p = p.parent) chain.unshift("@" + p.name + " " + p.params);
    const container = chain.join(" >> ") || "root";
    r.walkDecls((d) => occ.push({ file: rel, sel: norm(r.selector), container, prop: d.prop, important: !!d.important, line: d.source.start.line, value: norm(d.value) }));
  });
}
const imp = occ.filter((o) => o.important);
console.log(`!important 总数：${imp.length}`);
const byFile = new Map();
for (const o of imp) byFile.set(o.file, (byFile.get(o.file) || 0) + 1);
for (const [f, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${f}: ${n}`);
// 同(容器,选择器,属性)组里，非 important 的竞争对手
const groups = new Map();
for (const o of occ) { const k = o.container + "||" + o.sel + "||" + o.prop; const a = groups.get(k) || []; a.push(o); groups.set(k, a); }
let lastNoRival = 0, hasRival = 0;
const cands = [];
for (const o of imp) {
  const list = groups.get(o.container + "||" + o.sel + "||" + o.prop) || [];
  const rival = list.filter((p) => p !== o && !p.important);   // 去掉 !important 后仍可能压过它的（同选择器文本 ⇒ 同特异性，只看先后）
  const later = rival.filter((p) => (occ.indexOf(p) > occ.indexOf(o)));
  if (!later.length) { lastNoRival++; cands.push(o); } else hasRival++;
}
console.log(`\n其中"同选择器文本下没有任何更晚的非 important 竞争者"的：${lastNoRival} 条（去掉 !important 后仍是它赢 ⇒ 可能纯属多余）`);
console.log(`同选择器文本下存在更晚非 important 声明的（去掉 important 会被反超）：${hasRival} 条`);
for (const c of cands.slice(0, 30)) console.log(`   ${c.file}:${c.line}  ${c.sel.slice(0, 54)}  {${c.prop}: ${c.value.slice(0, 36)}}`);
fs.writeFileSync(data("imp-cands.json"), JSON.stringify(cands, null, 1));
