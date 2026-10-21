/**
 * 未分层「全局 reset」扫描器（261021）。
 *
 * 单一来源：两处消费者 ——
 *   ① 产物护栏 `scripts/css-audit/audit-vendor-css.mjs`（Node 24 直接 import 本 .ts，靠类型擦除运行）；
 *   ② dev 运行时探针 `src/lib/cssLayerProbe.ts`（扫注入的 <style> 文本）。
 *
 * 判据（为什么是这个组合）：
 *   「未分层」+「裸标签选择器」+「reset 类属性」= 一张第三方 base/reset 表最危险的形态：
 *   未分层普通声明压过**所有** @layer 规则，且裸标签选择器命中全文档 ⇒ 一行 import 改全站。
 * 261021 的现场：antd base 的 `body{font-family}` / `input,button,…{margin:0}`（未分层）
 * 把设置面板 × 的 `margin-left:auto` 归零、全站字体从 MiSans 变系统栈。
 *
 * 注意：只对「规则选择器」判定；@keyframes / @font-face 里的选择器不参与。
 */

/** 裸标签/通配选择器：命中即「全文档广播」。 */
export const GLOBAL_TAGS: ReadonlySet<string> = new Set([
  "html", "body", "*", "button", "input", "select", "optgroup", "textarea",
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "dl", "dt", "dd", "li",
  "a", "img", "table", "thead", "tbody", "tr", "td", "th", "form", "label",
  "fieldset", "legend", "hr", "pre", "code", "blockquote", "figure", "figcaption",
]);

/** reset 类属性：只有这些才说明它是"base/reset"而不是某个具体组件的排版。 */
const RESET_PROPS = /(?:^|;)\s*(?:margin(?:-\w+)?|padding(?:-\w+)?|font(?:-\w+)?|line-height|box-sizing|color)\s*:/i;

/** 从压缩 CSS 的规则体里取第一个选择器头（去伪类/属性等，只留 tag 名）。 */
function selectorHead(selector: string): string {
  const first = selector.trim().split(",")[0].trim();
  if (!first) return "";
  // 只看第一个复合选择器：必须"tag 开头 + 无 class/id"才算全局广播
  // （button:hover / input[type] 算；button.ln-btn / .bt-grid button 不算 —— 它们有作用域）
  const compound = first.split(/[\s>+~]+/)[0];
  const tag = compound.match(/^([a-zA-Z*][\w-]*)/);
  if (!tag) return "";
  const rest = compound.slice(tag[0].length);
  if (rest.includes(".") || rest.includes("#")) return "";
  return tag[1].toLowerCase();
}

/**
 * 扫描一段 CSS 文本，返回「未分层 + 裸标签 + reset」的规则选择器（去重、按出现顺序）。
 * 纯函数、不依赖 DOM —— 产物审计与运行时探针共用。
 */
export function scanUnlayeredGlobalRules(raw: string): string[] {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const hits: string[] = [];
  let buf = "";
  const stack: { kind: "layer" | "at" | "rule"; sel?: string; inLayer?: boolean; body?: string }[] = [];
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") {
      // 声明型 at-rule（`@layer a,b;` / `@import …;`）以分号收尾，取最后一个分号之后才是选择器
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
      if (frame && frame.kind === "rule" && !frame.inLayer && RESET_PROPS.test(frame.body ?? "")) {
        for (const rawSel of (frame.sel ?? "").split(",")) {
          const sel = rawSel.trim();
          if (!sel || sel.startsWith(":root") || sel.includes("%")) continue; // :root 不铺元素；% 是 keyframes 帧
          if (!GLOBAL_TAGS.has(selectorHead(sel))) continue;
          const normalized = sel.replace(/\s+/g, " ");
          if (!hits.includes(normalized)) hits.push(normalized);
        }
      }
      buf = "";
      continue;
    }
    const top = stack[stack.length - 1];
    if (top && top.kind === "rule") top.body = (top.body ?? "") + ch;
    else buf += ch;
  }
  return hits;
}
