#!/usr/bin/env node
/**
 * 未分层「全局 reset」护栏（261021 事故）。
 *
 * 背景：桌面样式全部在 @layer 里；**未分层普通声明压过所有分层声明**。
 * 只要某个 chunk 把第三方/全局 CSS 以 JS import 的身份带进文档（Vite 会把它产出为独立、
 * 不带 @layer 的 chunk CSS），antd/kernel 的 base 就会改写我们的按钮/输入框/字体 ——
 * 261021 的现场是设置面板关闭钮 × 从右上角跑到标题后面、全站字体从 MiSans 变系统栈。
 *
 * 判据（只认构建产物，不认源码怎么写；源码侧另有 src/styles/cssLayers.test.ts）：
 *   ① dist/assets/*.css 里出现「未分层 + 裸标签选择器 + reset 类属性」的规则；
 *   ② 内核 antd banner 出现在一个完全没有 @layer 的 CSS 文件里。
 * 用法：node scripts/css-audit/audit-vendor-css.mjs（npm run check:bundle 已串联）
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ASSETS = path.join(ROOT, "dist", "assets");

const RESET_TAGS = new Set([
  "html", "body", "*", "button", "input", "select", "optgroup", "textarea",
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "dl", "dt", "dd", "li",
  "a", "img", "table", "thead", "tbody", "tr", "td", "th", "form", "label",
  "fieldset", "legend", "hr", "pre", "code", "blockquote", "figure", "figcaption",
]);
const RESET_PROPS = /(?:^|;)\s*(?:margin(?:-\w+)?|padding(?:-\w+)?|font(?:-\w+)?|line-height|box-sizing|color)\s*:/i;

/** 逐规则扫描：返回「未分层 + 裸标签选择器 + reset 属性」的命中。 */
function scanUnlayeredGlobal(raw) {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const hits = [];
  let buf = "";
  const stack = [];
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") {
      // 声明型 at-rule（@layer a,b; / @import …;）会以 ";" 收尾，取最后一个分号之后才是选择器
      const prelude = buf.slice(buf.lastIndexOf(";") + 1).trim().replace(/\s+/g, " ");
      buf = "";
      const inLayer = stack.some((f) => f.kind === "layer");
      if (/^@layer\b/i.test(prelude)) stack.push({ kind: "layer" });
      else if (prelude.startsWith("@")) stack.push({ kind: "at" });
      else stack.push({ kind: "rule", sel: prelude, inLayer, body: "" });
      continue;
    }
    if (ch === "}") {
      const frame = stack.pop();
      if (frame && frame.kind === "rule" && !frame.inLayer && RESET_PROPS.test(frame.body)) {
        for (const rawSel of frame.sel.split(",")) {
          const sel = rawSel.trim();
          if (!sel || sel.startsWith(":root") || sel.includes("%")) continue;
          const head = sel.split(/[\s>+~]+/)[0];
          if (RESET_TAGS.has(head)) hits.push(sel.replace(/\s+/g, " ").slice(0, 120));
        }
      }
      buf = "";
      continue;
    }
    const top = stack[stack.length - 1];
    if (top && top.kind === "rule") top.body += ch;
    else buf += ch;
  }
  return hits;
}

if (!fs.existsSync(ASSETS)) {
  console.error("[audit-vendor-css] dist/assets 不存在 —— 先跑一次 npx vite build（本检查只认构建产物）");
  process.exit(1);
}

const files = fs.readdirSync(ASSETS).filter((f) => f.endsWith(".css"));
const problems = [];
for (const file of files) {
  const css = fs.readFileSync(path.join(ASSETS, file), "utf8");
  const hits = scanUnlayeredGlobal(css);
  if (hits.length) {
    problems.push({ file, kind: "未分层全局 reset", detail: [...new Set(hits)].slice(0, 6) });
  }
  if (css.includes("antd v4.24.13") && !css.includes("@layer")) {
    problems.push({ file, kind: "内核 antd 样式整份未分层", detail: ["该文件没有任何 @layer ⇒ 会压过整个设计系统"] });
  }
}

if (problems.length) {
  console.error("[audit-vendor-css] 失败：发现未分层全局 CSS（会压过全部 @layer 规则）：");
  for (const p of problems) console.error(`  - ${p.file} · ${p.kind}: ${p.detail.join(" | ")}`);
  console.error("\n修法：第三方/全局 CSS 只能由 src/styles/index.css 以 @import ... layer(legacy) 引入；组件/懒 chunk 禁止 JS import 它。");
  process.exit(1);
}
console.log(`[audit-vendor-css] OK：${files.length} 个产物 CSS 文件均无未分层全局 reset`);
