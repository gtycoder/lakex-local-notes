import { useCallback, useEffect } from "react";
import { parseLocalAssetUrl } from "../../core/assetUrl";
import InkPad, { type InkPadProps } from "../../features/ink/InkPad";
import { importInkImagePages, pickInkImageFiles } from "../../features/ink/inkImageImport";
import { importPdfPages, pickPdfFile, type PdfImportRasterPage } from "../../features/ink/pdfImport";
import { bridge } from "../bridge";
import { cancelPdfRender, pdfRenderAvailable, readRenderedPdfFileBytes, renderPdfPages, type PdfRenderPage } from "../native/pdfRender";
import { setStylusHandwritingEnabled } from "../native/stylusInput";
import "./inkPad.shared.css";
import "./inkPad.mobile.css";

export type MobileInkPadProps = Omit<InkPadProps, "variant"> & {
  /** 当前手写板 noteId：v2「导入图片 / 导入 PDF」需要它把资产落到本笔记目录。 */
  noteId?: string;
};

/**
 * 插件页尺寸 → 导入页尺寸（261102 T2 设备验收修复，纯函数便于单测）。
 * · width/height：**逻辑尺寸**（插件按 pt×96/72 返回，A4=794×1123，与桌面 793.33×1122.67 同口径）；
 * · pixelWidth/pixelHeight：**位图像素**（插件始终缩放到 maxWidth，如 1600×2264）；
 * · 旧 APK（无 pixel 字段）用 width/height 兜底 —— 旧 bug 是「width 当 pixelWidth」，这里不再重犯。
 */
export function pdfPageSizes(page: Pick<PdfRenderPage, "width" | "height" | "pixelWidth" | "pixelHeight">): Pick<PdfImportRasterPage, "width" | "height" | "pixelWidth" | "pixelHeight"> {
  return {
    width: page.width,
    height: page.height,
    pixelWidth: page.pixelWidth ?? page.width,
    pixelHeight: page.pixelHeight ?? page.height,
  };
}

export function MobileInkPad({ noteId, active = false, readOnly = false, ...props }: MobileInkPadProps) {
  useEffect(() => {
    if (!active || readOnly) return;
    void setStylusHandwritingEnabled(false);
    return () => { void setStylusHandwritingEnabled(true); };
  }, [active, readOnly]);

  // v2 图片页：移动端入口 = 全局预览面板里的「导入图片」（编辑态）。上传走 bridge 资产通道。
  const onImportImages = useCallback(async () => {
    if (!noteId) return null;
    const files = await pickInkImageFiles();
    if (files.length === 0) return null; // 用户取消
    return importInkImagePages(files, {
      upload: (input) => bridge.uploadResource(input, noteId),
    });
  }, [noteId]);

  /** 插件页 → InkPage 尺寸映射（见 pdfPageSizes）。 */
  const toImportPage = (page: PdfRenderPage, bytes: Uint8Array): PdfImportRasterPage => ({
    page: page.page,
    ...pdfPageSizes(page),
    bytes,
  });

  /**
   * v2 PDF 页：移动端入口 = 全局预览面板里的「导入 PDF」（编辑态）。
   * 原 PDF 先落到 note-assets/{noteId}（正文里要出现磁盘名），再让原生插件按
   * `{noteId, filename}` 逐页渲染到 cacheDir；JS 侧读回字节 → 上传成正式资产。
   * PDF 页数超过 300 时，第 300 页的 progress 里请求 cancel，让原生在页边界停下（截断导入）。
   */
  const onImportPdf = useCallback(async ({ onProgress, signal }: {
    onProgress: (done: number, total: number) => void;
    signal: AbortSignal;
  }) => {
    if (!noteId) return null;
    // 旧 APK / 浏览器没有 PdfRender 插件：给可见提示，不弹选择器、不落文件
    if (!pdfRenderAvailable()) {
      return { pages: [], pageCount: 0, importedPageCount: 0, truncated: false, cancelled: false, errors: ["当前版本不支持 PDF 导入（需要更新 App）"] };
    }
    const file = await pickPdfFile();
    if (!file) return null; // 用户取消选文件
    const bytes = new Uint8Array(await file.arrayBuffer());
    return importPdfPages(
      bytes,
      {
        savePdf: (input) => bridge.uploadResource(input, noteId),
        uploadPage: (input) => bridge.uploadResource(input, noteId),
        rasterize: async (input, options) => {
          if (signal.aborted) return { pageCount: 0, pages: [], cancelled: true };
          const ref = parseLocalAssetUrl(input.pdfUrl);
          if (!ref || ref.space !== "note") throw new Error("PDF 资产地址无效");
          let userAborted = false;
          const onAbort = () => {
            userAborted = true;
            void cancelPdfRender();
          };
          signal.addEventListener("abort", onAbort, { once: true });
          let limitStop = false;
          try {
            const result = await renderPdfPages(
              { noteId: ref.noteId, filename: ref.filename, maxWidth: 1600 },
              (progress) => {
                options.onProgress?.(progress.page, progress.pageCount);
                if (!userAborted && progress.page >= options.maxPages) {
                  limitStop = true;
                  void cancelPdfRender(); // 产品上限 300 页：页边界停下，后面的页不再渲染
                }
              },
            );
            const rendered = limitStop ? result.pages.slice(0, options.maxPages) : result.pages;
            const pages: PdfImportRasterPage[] = [];
            for (const page of rendered) {
              const pageBytes = await readRenderedPdfFileBytes(page.file);
              pages.push(toImportPage(page, pageBytes));
            }
            return { pageCount: result.pageCount, pages, cancelled: userAborted };
          } finally {
            signal.removeEventListener("abort", onAbort);
          }
        },
      },
      { fileName: file.name, onProgress, signal },
    );
  }, [noteId]);

  return (
    <InkPad
      {...props}
      active={active}
      readOnly={readOnly}
      variant="mobile"
      onImportImages={noteId ? onImportImages : undefined}
      onImportPdf={noteId ? onImportPdf : undefined}
    />
  );
}

export default MobileInkPad;
