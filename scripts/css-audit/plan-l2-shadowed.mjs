// L2 分析（260923）：整条规则被【更高层 + 相同选择器 + 属性覆盖】完全压制 ⇒ 可整条删。
// 只判"相同 @media 上下文 + 相同单选择器 + 高层声明了本规则的全部属性"，且双方都不含 !important（保守）。
// 相对顺序：层内 = 文件顺序（入口 @import 顺序），跨层 = layer 序（legacy<tokens<kit<shell<feature<overlay<a11y）。
// 用法：node scripts/css-audit/plan-l2-shadowed.mjs [--write]
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import { REPO, data } from "./paths.mjs";

const ENTRY = "src/styles/index.css";
const text = fs.readFileSync(REPO + ENTRY, "utf8");
const LAYERS = {};
[...text.matchAll(/@layer\s+([^;{]+);/g)].forEach((m) => m[1].split(",").map((s) => s.trim()).filter(Boolean).forEach((n, i) => (LAYERS[n] = i)));
const ENTRY_DIR = ENTRY.slice(0, ENTRY.lastIndexOf("/"));
const imports = [...text.matchAll(/@import\s+"([^"]+)"\s*(?:layer\(([^)]+)\))?/g)]
  .map((m) => ({ rel: path.posix.normalize(ENTRY_DIR + "/" + m[1]), layer: m[2] || null }))
  .filter((i) => fs.existsSync(REPO + i.rel));
console.log("层序:", JSON.stringify(LAYERS), " 入口 import:", imports.length);

const inKf = (r) => { for (let p = r.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true; return false; };
const norm = (s) => String(s).replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim();
const ctxOf = (r) => { const c = []; for (let p = r.parent; p; p = p.parent) { if (p.type === "root") break; if (p.type === "atrule") c.unshift("@" + p.name + " " + norm(p.params)); } return c.join(" && "); };
const splitSels = (sel) => { const out = []; let d = 0, cur = ""; for (const ch of sel) { if (ch === "(" || ch === "[") d++; else if (ch === ")" || ch === "]") d--; if (ch === "," && d === 0) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map(norm).filter(Boolean); };

const rules = [];
imports.forEach((imp, fi) => {
  if (imp.layer === null) return;                     // 未分层 = 最高，不参与被压制判定
  const li = LAYERS[imp.layer];
  if (li === undefined) return;
  const root = postcss.parse(fs.readFileSync(REPO + imp.rel, "utf8"), { from: imp.rel });
  root.walkRules((r) => {
    if (inKf(r)) return;
    const decls = r.nodes.filter((n) => n.type === "decl");
    if (!decls.length) return;
    if (decls.some((d) => d.important)) return;       // 保守：含 !important 不判
    const props = new Set(decls.map((d) => d.prop.toLowerCase()));
    if (!props.size) return;
    rules.push({ file: imp.rel, layer: imp.layer, li, fi, ctx: ctxOf(r), sels: splitSels(r.selector), props, n: decls.length, line: r.source.start.line, selector: r.selector });
  });
});
console.log("分层规则数:", rules.length);

// 索引：ctx || sel || prop -> 规则列表（带 li/fi）
const idx = new Map();
for (const r of rules) for (const s of r.sels) for (const p of r.props) { const k = r.ctx + "\u0000" + s + "\u0000" + p; if (!idx.has(k)) idx.set(k, []); idx.get(k).push(r); }
const later = (a, b) => a.li !== b.li ? a.li > b.li : a.fi > b.fi;   // a 比 b 更晚/更高

// 规则 R 是否被完全压制：每个单选择器 s，每个属性 p，都存在更晚的规则声明了 p
const candidates = [];
for (const R of rules) {
  const fully = R.sels.every((s) => [...R.props].every((p) => (idx.get(R.ctx + "\u0000" + s + "\u0000" + p) || []).some((o) => o !== R && later(o, R))));
  if (fully) candidates.push(R);
}
const byFile = {};
for (const c of candidates) { byFile[c.file] = byFile[c.file] || { rules: 0, decls: 0 }; byFile[c.file].rules++; byFile[c.file].decls += c.n; }
console.log("\n整条被完全压制的规则：", candidates.length, " 声明:", candidates.reduce((n, c) => n + c.n, 0));
for (const [f, v] of Object.entries(byFile).sort((a, b) => b[1].decls - a[1].decls)) console.log("  " + f + "  规则 " + v.rules + "  声明 " + v.decls);
console.log("\n样例（前 20）：");
for (const c of candidates.slice(0, 20)) console.log("  " + c.file + ":" + c.line + "  [" + c.layer + "]  " + c.selector.slice(0, 90) + (c.ctx ? "   " + c.ctx : ""));
if (process.argv.includes("--write")) { fs.writeFileSync(data("plan-l2-shadowed.json"), JSON.stringify(candidates.map((c) => ({ file: c.file, line: c.line, selector: c.selector, layer: c.layer, decls: c.n })), null, 1)); console.log("\n已写 " + data("plan-l2-shadowed.json")); }

// 删规则后可能留下"只剩注释/空白"的 @media 壳 —— 逐层剪掉（cssLayers.test.ts 有"无空壳"围栏）。
const isBlankBody = (body) => body.replace(/\/\*[\s\S]*?\*\//g, "").trim() === "";
function pruneEmptyAtRules(txt) {
  for (;;) {
    const root = postcss.parse(txt);
    const ranges = [];
    root.walkAtRules((at) => {
      if (!/^(media|supports|container|layer|starting-style)$/i.test(at.name)) return;
      const s = at.toString();
      const body = s.slice(s.indexOf("{") + 1, s.lastIndexOf("}"));
      if (body.includes("{") || !isBlankBody(body)) return;
      let st = at.source.start.offset;
      const nl = txt.lastIndexOf("\n", st - 1);
      if (nl >= 0 && !txt.slice(nl + 1, st).trim()) st = nl + 1;
      let en = at.source.end.offset + 1;
      if (txt[en] === "\n") en++;
      ranges.push([st, en]);
    });
    if (!ranges.length) return txt;
    for (const [s, e2] of ranges.sort((a, b) => b[0] - a[0])) txt = txt.slice(0, s) + txt.slice(e2);
  }
}

if (process.argv.includes("--apply")) {
  const byF = new Map();
  for (const c of candidates) { if (!byF.has(c.file)) byF.set(c.file, []); byF.get(c.file).push(c); }
  for (const [rel, list] of byF) {
    const txt = fs.readFileSync(REPO + rel, "utf8");
    const root = postcss.parse(txt, { from: rel });
    const keys = new Set(list.map((c) => c.line + "|" + c.selector));
    const ranges = [];
    root.walkRules((r) => {
      if (inKf(r)) return;
      if (!keys.has(r.source.start.line + "|" + r.selector)) return;
      let s = r.source.start.offset;
      const nl = txt.lastIndexOf("\n", s - 1);
      if (nl >= 0 && !txt.slice(nl + 1, s).trim()) s = nl + 1;   // 连同行首缩进一起删
      let e2 = r.source.end.offset + 1;
      if (txt[e2] === "\n") e2++;
      ranges.push([s, e2]);
    });
    ranges.sort((a, b) => b[0] - a[0]);
    let out = txt;
    for (const [s, e2] of ranges) out = out.slice(0, s) + out.slice(e2);
    out = pruneEmptyAtRules(out);
    fs.writeFileSync(REPO + rel, out);
    console.log("  applied " + rel + "：删规则 " + ranges.length + " / 计划 " + list.length);
  }
}
