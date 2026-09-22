// L3 安全筛选（260923）：在"跨全部状态零命中"的基础上，再要求【选择器里的每个 class/id 令牌在应用代码里都没有生产者】。
// 为什么必须加这一步：当前 42 态矩阵**覆盖不足**（未开"大纲增强"、无多维表、编辑器内部态），
// 实测 .outline-sidebar / .bt-* / .ln-* / quick-notes 内部类 在 42 态全零命中，却是活功能 ⇒ 直接按 L3 删会误伤。
// 260923 实测结论：真正的约束是"代码生产者"——1112 零命中里 1099 个类名在应用代码中都有生产者
// （含动态模板串，故用“前缀”保守判定）⇒ 本仓并无可证死代码；补状态矩阵也不增加安全产出。
// 用法：node scripts/css-audit/l3-plan.mjs [--write]
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import { REPO, data } from "./paths.mjs";

const fp = JSON.parse(fs.readFileSync(data("fingerprints-all.json"), "utf8"));
const files = JSON.parse(fs.readFileSync(data("loadorder.css.json"), "utf8"));
const sels = JSON.parse(fs.readFileSync(data("allselectors.json"), "utf8"));
const states = Object.keys(fp);

// 1) 零命中（任意状态都没命中；排除含 :: 的伪元素）
const hit = new Map();
for (const s of sels) {
  let any = false;
  for (const st of states) { const v = fp[st][s]; if (Array.isArray(v) && v.length) { any = true; break; } }
  hit.set(s, any);
}
const zero = sels.filter((s) => !s.includes("::") && hit.get(s) === false);

// 2) 代码令牌集（粗粒度：出现的标识符即视为"有生产者"；宁可多留）
const CODE_DIRS = ["src", "electron", "scripts", "docs"];
const SKIP = /[\\/](node_modules|dist|dist-mobile|dist-electron|\.css-audit)([\\/]|$)/;
const tok = new Set();
const walk = (dir) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (SKIP.test(p)) continue;
    if (ent.isDirectory()) { walk(p); continue; }
    if (!/\.(tsx?|jsx?|mjs|md|html)$/.test(ent.name)) continue;
    const txt = fs.readFileSync(p, "utf8");
    for (const m of txt.matchAll(/[A-Za-z_][A-Za-z0-9_-]*/g)) tok.add(m[0]);
  }
};
for (const d of CODE_DIRS) { const p = REPO + d; if (fs.existsSync(p)) walk(p); }
console.log("代码令牌 =", tok.size);

// 3) 选择器 → class 令牌；全部无生产者才安全
const classToks = (s) => [...s.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1]);
// 动态类名保守判定：TSX 里常见 \`outline-item__level--\${d}\` ⇒ 代码令牌是"前缀"（outline-item__level--）。
// 只要代码里存在 c 的前缀令牌（≥4 字符），就视为可能的生产者 ⇒ 保留。宁可多留，不可误删。
const tokArr = [...tok];
const hasProducer = (c) => tok.has(c) || tokArr.some((t) => t.length >= 4 && c.startsWith(t));
const safeSel = new Set();
const skippedByCode = new Set();
for (const s of zero) {
  const cs = classToks(s);
  if (!cs.length) continue;                       // 纯元素/伪类选择器：不判
  if (cs.every((c) => !hasProducer(c))) safeSel.add(s); else skippedByCode.add(s);
}
console.log("零命中 =", zero.length, " 安全（类名无生产者） =", safeSel.size, " 被代码引用保留 =", skippedByCode.size);

// 4) 映射到规则：整条规则的每个单选择器都安全 ⇒ 可整条删
const inKf = (r) => { for (let p = r.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true; return false; };
const norm = (s) => String(s).replace(/\s+/g, " ").trim();
const byFile = {}; const whole = []; const partial = [];
for (const rel of files) {
  const root = postcss.parse(fs.readFileSync(REPO + rel, "utf8"), { from: rel });
  root.walkRules((r) => {
    if (inKf(r)) return;
    const subs = r.selector.split(",").map(norm).filter(Boolean);
    const safeSubs = subs.filter((s) => safeSel.has(s));
    if (!safeSubs.length) return;
    const nDecls = r.nodes.filter((n) => n.type === "decl").length;
    if (safeSubs.length === subs.length) {
      byFile[rel] = byFile[rel] || { rules: 0, decls: 0 };
      byFile[rel].rules++; byFile[rel].decls += nDecls;
      whole.push({ file: rel, selector: r.selector, decls: nDecls, line: r.source.start.line });
    } else partial.push({ file: rel, selector: r.selector, safeSubs, line: r.source.start.line });
  });
}
console.log("\n可整条删的规则：");
for (const [f, v] of Object.entries(byFile).sort((a, b) => b[1].decls - a[1].decls)) console.log("  " + f + "  规则 " + v.rules + "  声明 " + v.decls);
console.log("\n可整条删规则总声明 =", Object.values(byFile).reduce((n, v) => n + v.decls, 0));
console.log("混合规则（含安全子选择器，需局部删）=", partial.length);
console.log("\n样例（前 25 条整条删）：");
for (const w of whole.slice(0, 25)) console.log("  " + w.file + ":" + w.line + "  " + w.selector);
if (process.argv.includes("--write")) { fs.writeFileSync(data("l3-safe-plan.json"), JSON.stringify({ whole, partial, byFile, safeSel: [...safeSel] }, null, 1)); console.log("\n已写 " + data("l3-safe-plan.json")); }
