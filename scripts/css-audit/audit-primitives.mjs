/**
 * 样式「重复/漏用原语」审计（260930 大统一用出来的两把尺子之一）：
 * 找出「同一套视觉/几何被写在多个（不同选择器 / 不同文件）规则里」的地方 ——
 * 这类重复就是「本该有正式原语、却散落在各处」的信号。
 *
 * 用法（在仓库根跑）：node scripts/css-audit/audit-primitives.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCAN_DIRS = ["src/styles", "src/features", "src/components", "src/mobile"];
/** vendor / 生成物不参与（它们本来就带冗余，见 AGENTS §3#18）。 */
const SKIP = [/node_modules/, /vendor/, /\.test\./, /fonts\//];

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

const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

/** 极简 CSS 解析：取叶子规则的「选择器 + 声明集」。 */
function parseRules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const stack = [];
  let buf = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      stack.push(buf.trim());
      buf = "";
    } else if (ch === "}") {
      const head = stack.pop() ?? "";
      const body = buf.trim();
      buf = "";
      const at = head.startsWith("@");
      // 只取叶子规则（at-rule 的 body 已由内部循环单独解析）
      if (!at && body && head) {
        const decls = body.split(";").map((d) => d.trim()).filter(Boolean);
        if (decls.length) rules.push({ selector: head, decls });
      }
    } else buf += ch;
  }
  return rules;
}

/** 归一化声明：排序 + 去掉只在写法上不同的空格差异。 */
const normDecl = (d) => d.replace(/\s+/g, " ").replace(/\s*:\s*/, ": ").trim();
const sig = (decls) => decls.map(normDecl).sort().join("; ");

/** 每个「选择器的最后一个类名」= 该规则的“身份”，用来避免把同一家族的不同状态当成重复。 */
const lastClass = (sel) => {
  const m = sel.match(/(?:\.[A-Za-z0-9_-]+|#[A-Za-z0-9_-]+)(?![\s\S]*\.[A-Za-z0-9_-]+(?=[^)]*$))/);
  const all = sel.match(/\.[A-Za-z0-9_-]+/g);
  return all ? all[all.length - 1].slice(1) : sel.trim();
};

const byBody = new Map();
for (const file of files) {
  const rel = path.relative(ROOT, file);
  for (const { selector, decls } of parseRules(readFileSync(file, "utf8"))) {
    if (decls.length < 3) continue;              // 太小的规则不构成「一套样式」
    const key = sig(decls);
    if (!byBody.has(key)) byBody.set(key, []);
    byBody.get(key).push({ rel, selector, identity: lastClass(selector), n: decls.length });
  }
}

const groups = [...byBody.entries()]
  .map(([key, hits]) => {
    const filesSet = new Set(hits.map((h) => h.rel));
    const identities = new Set(hits.map((h) => h.identity));
    return { key, hits, files: filesSet.size, identities: identities.size };
  })
  // 只关心「跨不同类名」的重复（同一个类名的不同状态不算）
  .filter((g) => g.identities >= 2 && g.hits.length >= 2)
  .sort((a, b) => b.identities - a.identities || b.hits.length - a.hits.length || b.key.length - a.key.length);

console.log(`扫描 ${files.length} 个 CSS 文件，规则体重复族 ${groups.length} 组\n`);
for (const g of groups.slice(0, 40)) {
  console.log(`── 身份 ${g.identities} 个 / 出现 ${g.hits.length} 次 / 跨 ${g.files} 文件 / ${g.key.split("; ").length} 条声明`);
  for (const h of g.hits) console.log(`   ${h.rel}  →  ${h.selector}`);
  console.log(`   声明：${g.key.length > 300 ? g.key.slice(0, 300) + "…" : g.key}`);
  console.log();
}
