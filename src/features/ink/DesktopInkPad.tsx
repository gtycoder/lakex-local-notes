import { useCallback } from "react";
import { parseLocalAssetUrl } from "../../core/assetUrl.js";
import type { InkPage } from "../../core/inkDoc.js";
import { native } from "../../lib/native";
import InkPad from "./InkPad";
import type { EditorHostProps } from "../editor/editorHost";
import { importInkImagePages, pickInkImageFiles } from "./inkImageImport";
import { importPdfPages, pickPdfFile } from "./pdfImport";
import { rasterizeInkSvgToPng } from "./inkSvgRasterize";
import { renderPdfPagesDesktop } from "./pdfRasterDesktop";
import "./inkPad.shared.css";
import "./inkPad.desktop.css";

/**
 * DT-06：桌面手写板宿主 = 「契约词表（visible/focused/pane/readOnly/onChange/onDirty/onCapture）
 * → InkPad 内部词表（active/paneVisible/onEditorCapture）」的**唯一适配层**。
 * InkPad 由桌面/移动端共用（MobileInkPad 也包它），所以内核侧不改名，只在这一层翻译。
 *
 * v2 图片/PDF 页：桌面入口都在工具条（编辑态）。上传走既有 IPC 资产通道
 * （native.uploadResource），与画板/文档图片同一条落盘/声明/同步/GC 管线；
 * PDF 栅格化走 unpdf（动态 import，懒 chunk，不进主 bundle）。
 */
export type DesktopInkPadProps = EditorHostProps;

export function DesktopInkPad({ visible, focused, pane, onCapture, noteId, ...props }: DesktopInkPadProps) {
  const upload = useCallback((input: { bytes: Uint8Array; filename: string }) => native.uploadResource(input, noteId), [noteId]);

  const onImportImages = useCallback(async () => {
    const files = await pickInkImageFiles();
    if (files.length === 0) return null; // 用户取消
    return importInkImagePages(files, { upload });
  }, [upload]);

  const onImportPdf = useCallback(async ({ onProgress, onPagesReady, signal }: {
    onProgress: (done: number, total: number) => void;
    onPagesReady?: (pages: InkPage[]) => void;
    signal: AbortSignal;
  }) => {
    const file = await pickPdfFile();
    if (!file) return null; // 用户取消
    const bytes = new Uint8Array(await file.arrayBuffer());
    return importPdfPages(
      bytes,
      {
        uploadPage: upload,
        rasterize: (input, options) => renderPdfPagesDesktop(input.bytes, options),
        // P7：失败/取消时删掉本轮已上传的页图（cleanNoteOrphans 只删未被正文/历史引用的文件）
        deleteAssets: async (urls) => {
          const filenames = urls.flatMap((url) => {
            const ref = parseLocalAssetUrl(url);
            return ref && ref.space === "note" && ref.noteId === noteId ? [ref.filename] : [];
          });
          if (filenames.length > 0) await native.cleanNoteOrphans(noteId, filenames);
        },
      },
      { fileName: file.name, onProgress, onPagesReady, signal },
    );
  }, [upload]);

  /**
   * 单页导出（工具栏一个按钮 → 选格式）：PDF / SVG 由主进程直接产文件，PNG 由渲染层把主进程给的
   * 自包含 SVG 栅格化后再回传落盘（主进程没有 SVG 栅格化能力，也不为此引依赖）。
   */
  const onExportPage = useCallback(async (input: { pageIds: string[]; format: "pdf" | "png" | "svg" }) => {
    const dir = await native.pickExportDir();
    if (!dir) return null; // 用户取消
    if (input.format === "pdf") return native.exportNote(noteId, "pdf", dir, { pageIds: input.pageIds });
    if (input.format === "svg") return native.exportInkPageSvg(noteId, input.pageIds, dir);
    const page = await native.readInkPageSvg(noteId, input.pageIds);
    const bytes = await rasterizeInkSvgToPng(page.svg, page.width, page.height);
    return native.saveInkPagePng(dir, page.title, bytes);
  }, [noteId]);

  return (
    <InkPad
      {...props}
      noteId={noteId}
      variant="desktop"
      active={focused ?? visible}
      paneVisible={visible}
      pane={pane}
      onEditorCapture={onCapture}
      onImportImages={onImportImages}
      onImportPdf={onImportPdf}
      onExportPage={onExportPage}
    />
  );
}

export default DesktopInkPad;
