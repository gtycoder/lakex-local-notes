import { useCallback } from "react";
import { native } from "../../lib/native";
import InkPad from "./InkPad";
import type { EditorHostProps } from "../editor/editorHost";
import { importInkImagePages, pickInkImageFiles } from "./inkImageImport";
import { importPdfPages, pickPdfFile } from "./pdfImport";
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

  const onImportPdf = useCallback(async ({ onProgress, signal }: {
    onProgress: (done: number, total: number) => void;
    signal: AbortSignal;
  }) => {
    const file = await pickPdfFile();
    if (!file) return null; // 用户取消
    const bytes = new Uint8Array(await file.arrayBuffer());
    return importPdfPages(
      bytes,
      {
        savePdf: upload,
        uploadPage: upload,
        rasterize: (input, options) => renderPdfPagesDesktop(input.bytes, options),
      },
      { fileName: file.name, onProgress, signal },
    );
  }, [upload]);

  return (
    <InkPad
      {...props}
      variant="desktop"
      active={focused ?? visible}
      paneVisible={visible}
      pane={pane}
      onEditorCapture={onCapture}
      onImportImages={onImportImages}
      onImportPdf={onImportPdf}
    />
  );
}

export default DesktopInkPad;
