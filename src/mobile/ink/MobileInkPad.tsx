import { useCallback, useEffect } from "react";
import InkPad, { type InkPadProps } from "../../features/ink/InkPad";
import { importInkImagePages, pickInkImageFiles } from "../../features/ink/inkImageImport";
import { pickPdfFile } from "../../features/ink/pdfImport";
import type { InkPage } from "../../core/inkDoc";
import { bridge } from "../bridge";
import { setStylusHandwritingEnabled } from "../native/stylusInput";
import { importPdfPagesToAssets } from "./mobilePdfImport";
import "./inkPad.shared.css";
import "./inkPad.mobile.css";

export type MobileInkPadProps = Omit<InkPadProps, "variant"> & {
  /** 当前手写板 noteId：v2「导入图片 / 导入 PDF」需要它把资产落到本笔记目录。 */
  noteId?: string;
};

export function MobileInkPad({ noteId, active = false, readOnly = false, ...props }: MobileInkPadProps) {
  useEffect(() => {
    if (!active || readOnly) return;
    void setStylusHandwritingEnabled(false);
    return () => { void setStylusHandwritingEnabled(true); };
  }, [active, readOnly]);

  // v2 图片页：移动端入口 = 编辑态工具坞「插入」菜单。上传走 bridge 资产通道。
  const onImportImages = useCallback(async () => {
    if (!noteId) return null;
    const files = await pickInkImageFiles();
    if (files.length === 0) return null; // 用户取消
    return importInkImagePages(files, {
      upload: (input) => bridge.uploadResource(input, noteId),
    });
  }, [noteId]);

  /**
   * v2 PDF 页：移动端入口 = 编辑态工具坞「插入」菜单。
   * 适配器与「系统分享 PDF → 自动导入」共用 src/mobile/ink/mobilePdfImport.ts（同一实现，不复制）。
   * InkPad 把返回的 pages 走可撤销提交；编辑态这里不直接 saveNote。
   */
  const onImportPdf = useCallback(async ({ onProgress, onPagesReady, signal }: {
    onProgress: (done: number, total: number, phase?: "raster" | "upload") => void;
    onPagesReady?: (pages: InkPage[]) => void;
    signal: AbortSignal;
  }) => {
    if (!noteId) return null;
    const file = await pickPdfFile();
    if (!file) return null; // 用户取消选文件
    const bytes = new Uint8Array(await file.arrayBuffer());
    return importPdfPagesToAssets({ noteId, bytes, filename: file.name, onProgress, onPagesReady, signal });
  }, [noteId]);

  /** v4 页内贴图（移动端）：从相册/文件选一张图 → 上传资产 → 返回 URL 与原图尺寸（落点由 InkPad 决定）。 */
  const onInsertPageImage = useCallback(async () => {
    if (!noteId) return null;
    const files = await pickInkImageFiles();
    const file = files[0];
    if (!file) return null; // 用户取消
    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploaded = await bridge.uploadResource({ bytes, filename: file.name }, noteId);
    let naturalWidth: number | undefined;
    let naturalHeight: number | undefined;
    try {
      const bitmap = await createImageBitmap(file);
      naturalWidth = bitmap.width;
      naturalHeight = bitmap.height;
      bitmap.close?.();
    } catch { /* 读不到尺寸就按 4:3 估（placeInkPageImage 内部兜底） */ }
    return { url: uploaded.url, naturalWidth, naturalHeight };
  }, [noteId]);

  return (
    <InkPad
      {...props}
      noteId={noteId}
      active={active}
      readOnly={readOnly}
      variant="mobile"
      onImportImages={noteId ? onImportImages : undefined}
      onImportPdf={noteId ? onImportPdf : undefined}
      onInsertPageImage={noteId ? onInsertPageImage : undefined}
    />
  );
}

export default MobileInkPad;
