import { useCallback, useEffect, useState } from "react";
import InkPad, { type InkPadProps } from "../../features/ink/InkPad";
import { importInkImagePages, pickInkImageFiles, probeInkImageFile } from "../../features/ink/inkImageImport";
import { pickPdfFile } from "../../features/ink/pdfImport";
import { inkPageImageSourceError } from "../../features/ink/inkPageImages";
import type { InkPage } from "../../core/inkDoc";
import { bridge } from "../bridge";
import { showToast } from "../ui/toastBus";
import { MobilePageTabButton, MobilePageTabSheet, type MobilePageTabState } from "./MobilePageTab";
import { setStylusHandwritingEnabled } from "../native/stylusInput";
import { importPdfPagesToAssets } from "./mobilePdfImport";
// 移动端自有样式层（不引桌面样式，见 mobileIndependence 门禁）。inkPad.shared.css 是**两端同构的副本**：
// 261104 二十五批补上 v4 文字块/贴图规则（此前漏同步 ⇒ 移动端文字框是无定位的默认 textarea），
// 并加 inkSharedCssParity.test 把「两份类名集合必须一致」钉死，防止再次漂移。
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

  /**
   * v4 页内贴图（移动端）：从相册/文件选一张图 → **先验源图**（像素尺寸）→ 上传资产 → 返回 URL 与原图尺寸。
   * 只有 1×1 的占位图/损坏图会拒绝并说明（否则插进来是一条看不见的框，用户报「贴图无法展示，仅有边框」）。
   */
  const onInsertPageImage = useCallback(async () => {
    if (!noteId) return null;
    const files = await pickInkImageFiles();
    const file = files[0];
    if (!file) return null; // 用户取消
    const probe = await probeInkImageFile(file);
    const sourceError = inkPageImageSourceError(probe);
    if (sourceError) throw new Error(sourceError);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploaded = await bridge.uploadResource({ bytes, filename: file.name }, noteId);
    return { url: uploaded.url, naturalWidth: probe!.pixelWidth, naturalHeight: probe!.pixelHeight };
  }, [noteId]);

  const notifyTransient = useCallback((text: string, kind: "info" | "error") => {
    showToast(text, { type: kind });
  }, []);

  // 页签 Sheet 的宿主状态：入口在顶部导航里，Sheet 渲染在 InkPad 之外（胶囊是横向滚动容器，
  // 弹层留在里面会撑大 scrollWidth 且可能被裁）。
  const [pageTab, setPageTab] = useState<MobilePageTabState | null>(null);

  return (
    <>
      <InkPad
        {...props}
        noteId={noteId}
        active={active}
        readOnly={readOnly}
        variant="mobile"
        onImportImages={noteId ? onImportImages : undefined}
        onImportPdf={noteId ? onImportPdf : undefined}
        onInsertPageImage={noteId ? onInsertPageImage : undefined}
        // 瞬时失败/完成走移动端 toast 气泡（与「已移入回收站」同一条原语）：不占编辑空间、不挤动页面尺寸；
        // 用户 261104 反馈：这条报错以前是板内横幅，会占掉一块画布。
        onTransientMessage={notifyTransient}
        renderPageTab={(state) => <MobilePageTabButton state={state} onOpen={setPageTab} />}
      />
      {/* 页签 Sheet 必须是 InkPad 的**兄弟节点**：入口在顶部横向滚动的胶囊里，弹层留在里面会撑大 scrollWidth */}
      <MobilePageTabSheet state={pageTab} open={pageTab !== null} onClose={() => setPageTab(null)} />
    </>
  );
}

export default MobileInkPad;
