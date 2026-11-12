/**
 * 历史快照的**只读 Lake viewer**（doc 快照）—— 同一实例复用，切快照只 setDocument。
 *
 * 261112 R1：实现已收口到 src/features/preview/useReadOnlyKernelViewer（全仓 3 处
 * createLakeDocument("viewer") 包装的唯一来源，见 docs/audit-261112/02-preview-unification.md §3.4）。
 * 本文件只保留「历史快照」这一侧的对外契约，签名/默认语义与收口前**完全一致**：
 * - 同一 noteId 复用实例（切快照只换正文，不重建内核 —— 历史面板就是一条条点着看的）；
 * - 换文档 / 宿主消失 / 卸载才销毁；
 * - 正文一律经 addAssetAccessToken 注入渲染层令牌（绝不写回正文）。
 */
import type { LakeEditorPrefs } from "../../features/editor/lakeRuntime";
import { useReadOnlyKernelViewer } from "../../features/preview/useReadOnlyKernelViewer";

export interface UseHistorySnapshotViewerOptions {
  hostRef: React.RefObject<HTMLElement | null>;
  noteId: string | null;
  /** 要显示的 doc 快照正文；null = 不显示（非 doc 预览 / 未选中快照）。 */
  body: string | null;
  prefs?: Partial<LakeEditorPrefs>;
  onError?: (message: string) => void;
}

export function useHistorySnapshotViewer({ hostRef, noteId, body, prefs, onError }: UseHistorySnapshotViewerOptions): void {
  useReadOnlyKernelViewer({
    hostRef,
    /** 内容身份 = 文档 id：切快照（同文档不同版本）只 setDocument。 */
    key: noteId,
    body,
    noteId,
    prefs,
    /** 滚动容器 = 宿主节点（滚动本身仍交调用方容器：.trash-preview-viewer / .history-preview-viewer）。 */
    scrollNode: () => hostRef.current,
    onError,
  });
}
