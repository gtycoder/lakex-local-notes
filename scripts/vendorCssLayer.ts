import type { Plugin } from "vite";

/**
 * 第三方 CSS 自动入层（261021，架构护栏）。
 *
 * 背景：桌面设计系统全部在 `@layer vendor, legacy, tokens, kit, shell, feature, overlay, a11y` 里，
 * 而 **JS import 出来的 CSS 无法带 @layer** ⇒ 第三方包（Univer、内核、未来任何依赖）的 base/reset
 * 会以「未分层」身份进入文档，未分层普通声明压过**所有**分层声明（261021 实测：设置面板 × 偏移、
 * 全站字体从 MiSans 变系统栈）。靠人记住"别 import 全局 CSS"不可靠，所以在构建层兜底：
 *
 *   凡是从 JS 引入的第三方 CSS（id 在 node_modules/ 或仓库 vendor/ 下），自动包一层 `@layer vendor`；
 *   层序声明在 src/styles/index.css（vendor 排最底）⇒ 第三方样式天然压不过我们的任何一层。
 *
 * 两个刻意例外：
 *   ① 内核 CSS（vendor/lakex-doc-react/**）：视觉基线定在 `layer(legacy)`，由 src/styles/index.css
 *      以 `@import … layer(legacy)` 引入 —— 这里跳过，不重复入层（改层序会牵动编辑器视觉，需单独立项）；
 *   ② src/** 下的自有 CSS：它们由组件 import 是有意为之（作用域类名、随功能 chunk 加载），保持原样；
 *      护栏是 `cssLayers.test.ts`：自有组件 CSS 不得出现裸标签选择器。
 */
const VENDOR_CSS = /[\\/](?:node_modules|vendor)[\\/].*\.css$/;

/** 该模块是否需要自动包 @layer vendor（导出给单测）。 */
export function shouldWrapVendorCss(id: string): boolean {
  const file = id.split("?")[0];
  if (!file.endsWith(".css")) return false;
  if (!VENDOR_CSS.test(file)) return false;
  if (file.includes("/src/")) return false; // src/vendor/*：自有样式（例如 drawnix 移植），由入口显式分层
  if (/[\\/]vendor[\\/]lakex-doc-react[\\/]/.test(file)) return false; // 内核 CSS：入口以 layer(legacy) 引入
  return true;
}

/** 包一层 vendor 层（导出给单测）。已经自己分层的第三方 CSS 不动。 */
export function wrapVendorCss(code: string): string | null {
  if (/@layer\b/.test(code)) return null;
  return `@layer vendor {\n${code}\n}\n`;
}

export function vendorCssLayerPlugin(): Plugin {
  return {
    name: "lake:vendor-css-layer",
    enforce: "pre",
    transform(code, id) {
      if (!shouldWrapVendorCss(id)) return null;
      const wrapped = wrapVendorCss(code);
      return wrapped === null ? null : { code: wrapped, map: null };
    },
  };
}
