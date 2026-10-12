/**
 * 死 CSS 审计（261012）：找出「选择器里的类名在全仓**产品代码**里没有任何引用」的规则。
 *
 * 为什么要它：CSS 随功能重构会留下**被取代的残留**（例如小记工具条改走内核 widget 后，旧的
 * `.quick-note-tool` / `.quick-note-composer-tools` 就再也没人挂）。这类残留不会被任何护栏发现
 * （`cssLayers` 只数声明数量、`ui-metrics` 只看令牌/颜色），只能靠全仓引用扫描。
 *
 * 口径（保守优先，宁可漏报不可误删）：
 *   1) 判据 = 类名以**词边界**出现在产品代码（src/**、electron/**、scripts/**、index.html）里；
 *      `scripts/css-audit/plans/**` 与 `*.json` 是审计数据/快照，不算引用。
 *   2) **动态拼接**一律保护：模板字符串与字符串拼接里 `前缀${…}` / `…${…}后缀` / `"a-" + x` 的片段，
 *      凡类名以该片段开头/结尾的都不报（例：`sync-toast-icon--${kind}` ⇒ `sync-toast-icon--error` 不报）。
 *      ⚠️ 这条不能省：串中间的拼接（``a b--${x}``）早期版本漏抓，导致 `sync-toast-icon--error` 被误判为死类。
 *   3) **内核/第三方命名空间**不报：`ne-` / `ant-` / `lakex-` / `plait-` / `univer-` / `b3-` / `fn__` ——
 *      这些类由 lakex / Univer / Drawnix / 思源 legacy 渲染，我们源码里本来就没有它们（例：`.lakex-material-trigger`）。
 *   4) **设计词表**不报：`src/styles/kit.css`（头部写明 = COMPONENTS.md 14 件、`P5 才逐屏迁移`）与
 *      `themes/` `fonts/` `kernel-theme.css` `compat.css` —— 暂未使用的原语/令牌是**迁移目标**，不是死代码。
 *   5) 移动端单独标注（`src/mobile/**`）：改动前先与移动端会话对齐。
 *
 * 用法：node scripts/css-audit/audit-dead-css.mjs [--all]
 *   --all  连「被动态模式保护 / 内核命名空间 / 设计词表」的也打印出来（默认只打印真候选）
 * 退出码恒为 0（审计报告，不是门禁）；判定仍需人工过一眼上面 5 条口径。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const SHOW_ALL = process.argv.includes("--all");

const SKIP_CSS = [
  /\/themes\//, /\/fonts\//, /kernel-theme\.css$/, /compat\.css$/, /^src\/styles\/index\.css$/,
  /\/kit\.css$/, /app\/vendor-board\.css$/, /app\/editor\.css$/, /styles\/feature\.css$/, /board\/boardEditor\.css$/,
];
const KERNEL_NS = /^(ne-|ant-|lakex-|plait-|univer-|b3-|fn__|ProseMirror)/;

const collect = (dir, pred, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|(^|\/)\.git$|dist|release|\.css-audit/.test(e.name)) collect(p, pred, out); }
    else if (pred(p)) out.push(p);
  }
  return out;
};

const cssFiles = collect(path.join(REPO, "src"), (f) => f.endsWith(".css"))
  .filter((f) => !SKIP_CSS.some((re) => re.test(f.replace(REPO, ""))));
const usage = [
  ...collect(path.join(REPO, "src"), (f) => /\.(ts|tsx|js|jsx|html)$/.test(f)),
  ...collect(path.join(REPO, "electron"), (f) => /\.(ts|tsx|js)$/.test(f)),
  ...collect(path.join(REPO, "scripts"), (f) => /\.(mjs|js|ts)$/.test(f) && !/css-audit\/plans\//.test(f)),
  path.join(REPO, "index.html"),
].filter((f) => fs.existsSync(f));
const corpus = usage.map((f) => fs.readFileSync(f, "utf8")).join("\n");

// —— 动态拼接片段（模板字符串 / 字符串拼接）——
const prefixes = new Set(), suffixes = new Set();
for (const tpl of corpus.matchAll(/`([^`]*)`/gs)) {
  for (const m of tpl[1].matchAll(/([A-Za-z][\w-]*)\$\{/g)) prefixes.add(m[1]);
  for (const m of tpl[1].matchAll(/\}\s*([A-Za-z][\w-]*)/g)) suffixes.add(m[1]);
}
for (const m of corpus.matchAll(/["']([A-Za-z][\w-]*)["']\s*\+/g)) prefixes.add(m[1]);
for (const m of corpus.matchAll(/\+\s*["']([A-Za-z][\w-]*)["']/g)) suffixes.add(m[1]);
const isDynamic = (cls) => [...prefixes].some((p) => p.length > 2 && cls.startsWith(p))
  || [...suffixes].some((s) => s.length > 2 && cls.endsWith(s));

// —— 提取规则里的类名 ——
const rules = [];
for (const f of cssFiles) {
  const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@(keyframes|font-face)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  let buf = "";
  for (const ch of src) {
    if (ch === "{") {
      const sel = buf.trim().replace(/\s+/g, " ");
      if (sel && !sel.startsWith("@")) {
        const classes = [...new Set([...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))];
        if (classes.length) rules.push({ file: f.replace(REPO + "/", ""), selector: sel, classes });
      }
      buf = "";
    } else if (ch === "}") buf = "";
    else buf += ch;
  }
}

const used = (cls) => {
  const re = new RegExp("(?<![\\w-])" + cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w-])");
  return re.test(corpus);
};

const seen = new Set(), candidates = [], excluded = [];
for (const r of rules) {
  for (const cls of r.classes) {
    if (seen.has(cls)) continue;
    seen.add(cls);
    if (used(cls)) continue;
    const mobile = r.file.startsWith("src/mobile/");
    if (KERNEL_NS.test(cls)) { excluded.push({ cls, why: "内核/第三方命名空间", ...r }); continue; }
    if (isDynamic(cls)) { excluded.push({ cls, why: "动态拼接模式", ...r }); continue; }
    candidates.push({ cls, mobile, ...r });
  }
}

console.log("死 CSS 审计（口径见文件头；候选仍需人工确认）");
console.log("  CSS 文件 " + cssFiles.length + " / 引用源 " + usage.length + " / 规则 " + rules.length + " / 类名 " + seen.size);
const desk = candidates.filter((c) => !c.mobile), mob = candidates.filter((c) => c.mobile);
console.log("  候选（桌面）= " + desk.length + "；候选（移动端，需与移动端会话对齐）= " + mob.length);
for (const [label, list] of [["桌面", desk], ["移动端", mob]]) {
  if (!list.length) continue;
  console.log("\n── " + label + " ──");
  for (const c of list) console.log("  ." + c.cls + "\n      " + c.file + " :: " + c.selector.slice(0, 120));
}
if (SHOW_ALL && excluded.length) {
  console.log("\n── 已按口径排除（--all）──");
  for (const e of excluded) console.log("  ." + e.cls + "  [" + e.why + "]  " + e.file);
}
console.log("\nΣ 排除 " + excluded.length + " 个零引用类名（内核命名空间 / 动态拼接 / 设计词表）。");
