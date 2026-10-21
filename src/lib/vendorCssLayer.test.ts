import { describe, expect, it } from "vitest";
import { shouldWrapVendorCss, wrapVendorCss } from "../../scripts/vendorCssLayer";

/**
 * 第三方 CSS 自动入层（261021 架构护栏）。
 * 目标：任何 JS import 的第三方 CSS 都会进 @layer vendor（层序最低），
 * 即使它带全局 reset 也压不过设计系统。
 */
describe("vendor CSS 自动入 @layer vendor", () => {
  it("node_modules 的 JS import CSS 需要包层", () => {
    expect(shouldWrapVendorCss("/repo/node_modules/@univerjs/preset-sheets-core/lib/index.css")).toBe(true);
    expect(shouldWrapVendorCss("/repo/node_modules/pkg/a.css?direct")).toBe(true);
  });

  it("内核 vendor CSS 不重复入层（入口已 layer(legacy) 引入、视觉基线在该层）", () => {
    expect(shouldWrapVendorCss("/repo/vendor/lakex-doc-react/dist/style.css")).toBe(false);
  });

  it("src 自有 CSS 不动（作用域类名按层围栏管，见 cssLayers.test.ts）", () => {
    expect(shouldWrapVendorCss("/repo/src/features/bitable/bitableEditor.css")).toBe(false);
    expect(shouldWrapVendorCss("/repo/src/vendor/drawnix-react-text.css")).toBe(false);
  });

  it("非 CSS 文件不动；已经自己分层的第三方 CSS 不重复包", () => {
    expect(shouldWrapVendorCss("/repo/node_modules/pkg/index.js")).toBe(false);
    expect(wrapVendorCss("@layer x{ body{margin:0} }")).toBeNull();
    expect(wrapVendorCss("body{margin:0}")).toContain("@layer vendor {");
  });
});
