// @vitest-environment jsdom
/**
 * 移动端 PDF 页尺寸映射（261102 T2 设备验收修复）。
 *
 * 复现的 bug：插件只在 page.width > maxWidth 时缩放 ⇒ A4 595pt 的页图只有 595px；
 * 且 JS 把 width（当时是像素）当 pixelWidth 写进 InkPage ⇒ 两端同一 PDF 页尺寸不一致。
 * 现在：插件始终缩放到 maxWidth 并分开给「逻辑尺寸 / 位图像素」，这里钉住映射与三处源码口径。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pdfPageSizes } from "./mobilePdfImport";

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("PDF 页尺寸映射：逻辑尺寸 vs 位图像素", () => {
  it("逻辑尺寸用 width/height，位图尺寸用 pixelWidth/pixelHeight（不再把 width 当 pixelWidth）", () => {
    // A4：插件给逻辑 794×1123（pt×4/3）+ 位图 1600×2264（始终缩放到 maxWidth）
    expect(pdfPageSizes({ width: 794, height: 1123, pixelWidth: 1600, pixelHeight: 2264 })).toEqual({
      width: 794,
      height: 1123,
      pixelWidth: 1600,
      pixelHeight: 2264,
    });
  });

  it("旧 APK 没有 pixel 字段：回落 width/height（不崩，也不假装是像素）", () => {
    expect(pdfPageSizes({ width: 595, height: 842 })).toEqual({
      width: 595,
      height: 842,
      pixelWidth: 595,
      pixelHeight: 842,
    });
  });

  it("静态护栏：Kotlin 始终缩放到 maxWidth + 输出两套尺寸（无「只缩不放」旧分支）", () => {
    const kt = read("../../../android/app/src/main/java/com/lakexlocalnotes/android/PdfRenderPlugin.kt");
    expect(kt).toContain("LOGICAL_PX_PER_PT");
    expect(kt).toMatch(/val pixelWidth = maxWidth/);
    expect(kt).toMatch(/val pixelHeight = Math\.round\(/);
    expect(kt).toMatch(/Math\.round\(pageWidth \* LOGICAL_PX_PER_PT\)/);
    expect(kt).toContain('item.put("pixelWidth", pixelWidth)');
    expect(kt).toContain('item.put("pixelHeight", pixelHeight)');
    expect(kt).not.toMatch(/if \(page\.width > maxWidth\)/); // 旧「只缩不放」的 scale
  });

  it("静态护栏：TS 类型暴露 pixelWidth/pixelHeight，MobileInkPad 走统一映射", () => {
    const ts = read("../native/pdfRender.ts");
    expect(ts).toMatch(/pixelWidth\?: number/);
    expect(ts).toMatch(/pixelHeight\?: number/);
    const src = read("./mobilePdfImport.ts");
    // P7：改成流式交付，映射对象从 progress 事件来（同一份 pdfPageSizes，不另写尺寸映射）
    expect(src).toContain("pdfPageSizes(progress)");
    expect(src).not.toContain("pixelWidth: page.width");
    expect(src).not.toContain("pixelHeight: page.height");
    // MobileInkPad 不再持有 PDF 适配器（改调共享模块，同一实现）
    expect(read("./MobileInkPad.tsx")).toContain("importPdfPagesToAssets");
  });
});
