/**
 * 桌面 PDF 栅格化模块的静态契约（不在 node 里跑 unpdf：浏览器 canvas 才能渲染）。
 *
 * 守的是「懒加载 + cMap + WebP」三件事：
 *  · unpdf 只能动态 import（含 pdf.js serverless 构建 ~1.5MB，绝不能进入口 chunk）；
 *  · cMapUrl 指向 public/vendor/pdfjs/cmaps（中文非嵌入字体 PDF 依赖它）；
 *  · PNG → WebP(0.8) 再上传（文字页体积约 1/10）。
 * 真实渲染由桌面运行时执行（Electron/Chromium 的 DOMCanvasFactory），设备/桌面验收见任务报告。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const RASTER = read("./pdfRasterDesktop.ts");
const INK_PAD = read("./InkPad.tsx");
const DESKTOP_HOST = read("./DesktopInkPad.tsx");
const MOBILE_HOST = read("../../mobile/ink/MobileInkPad.tsx");

describe("桌面 PDF 栅格化（pdfRasterDesktop）静态契约", () => {
  it("unpdf 只能动态 import（懒 chunk）；没有顶层 import", () => {
    expect(RASTER).toContain('await import("unpdf")');
    expect(RASTER).not.toMatch(/^import\s+.*from\s+"unpdf"/m);
    expect(RASTER).not.toMatch(/^import\s+"unpdf"/m);
    // 只有桌面宿主引它（移动端构建不含 unpdf）
    expect(DESKTOP_HOST).toContain("renderPdfPagesDesktop");
    expect(MOBILE_HOST).not.toContain("unpdf");
    expect(MOBILE_HOST).not.toContain("renderPdfPagesDesktop");
    expect(INK_PAD).not.toContain("unpdf");
  });

  it("cMapUrl 指向 public/vendor/pdfjs/cmaps（中文非嵌入字体的前提）", () => {
    expect(RASTER).toContain('new URL("vendor/pdfjs/cmaps/", document.baseURI).href');
    expect(RASTER).toContain("cMapPacked: true");
    expect(RASTER).toContain("useSystemFonts: true");
  });

  it("PNG → WebP(0.8) 且默认渲染宽 1600、最多 500 页（上限取 pdfImport 的单一来源）", () => {
    expect(RASTER).toContain("WEBP_QUALITY = 0.8");
    expect(RASTER).toContain('canvas.toBlob(resolve, "image/webp", WEBP_QUALITY)');
    expect(RASTER).toContain("DEFAULT_MAX_WIDTH = 1600");
    expect(RASTER).toContain("width: maxWidth");
    expect(RASTER).toContain("Math.min(pageCount, Math.max(1, Math.floor(options.maxPages ?? INK_PDF_MAX_PAGES)))");
    expect(RASTER).toContain('import { INK_PDF_MAX_PAGES } from "./pdfImport.js"');
    // 页逻辑尺寸 = pt × 4/3
    expect(RASTER).toContain("CSS_PX_PER_PT = 4 / 3");
    expect(RASTER).toContain("viewport.width * CSS_PX_PER_PT");
  });

  it("取消：逐页检查 AbortSignal；加密/损坏给可读文案", () => {
    expect(RASTER).toContain("options.signal?.aborted");
    expect(RASTER).toContain("已加密");
    expect(RASTER).toContain("无法打开 PDF");
  });
});
