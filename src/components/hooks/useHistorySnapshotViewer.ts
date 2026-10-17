/**
 * 历史快照的**只读 Lake viewer**（doc 快照）—— 同一实例复用，切快照只 `setDocument`。
 *
 * 为什么要复用：重建整个内核的代价很实在（仓里 `EditorTab.tsx` 的注释就点过"关闭重开尤其明显"），
 * 而历史面板的用法恰恰是"一条条点着看"。对同一实例重复 `setDocument` 是本仓既有用法
 * （见 `features/editor/LakeEditor.tsx` 与 `EditorTab.tsx` 的 reload 路径）。
 *
 * 只在三种情况销毁重建：宿主 DOM 换了（切到非 doc 预览再切回来）、换了文档、组件卸载。
 */
import { useEffect, useRef } from "react";
import { createLakeDocument, destroyLakeEditor, type LakeEditorInstance, type LakeEditorPrefs } from "../../features/editor/lakeRuntime";
import { addAssetAccessToken } from "../../lib/assetPort";

export interface UseHistorySnapshotViewerOptions {
  hostRef: React.RefObject<HTMLElement | null>;
  noteId: string | null;
  /** 要显示的 doc 快照正文；null = 不显示（非 doc 预览 / 未选中快照）。 */
  body: string | null;
  prefs?: Partial<LakeEditorPrefs>;
  onError?: (message: string) => void;
}

export function useHistorySnapshotViewer({ hostRef, noteId, body, prefs, onError }: UseHistorySnapshotViewerOptions): void {
  const viewerRef = useRef<LakeEditorInstance | null>(null);
  /** viewer 当前挂在哪个宿主节点 / 哪个文档上（不一致就重建）。 */
  const hostNodeRef = useRef<HTMLElement | null>(null);
  const noteRef = useRef<string | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const teardown = () => {
    if (viewerRef.current) {
      try { destroyLakeEditor(viewerRef.current); } catch { /* ignore */ }
    }
    viewerRef.current = null;
    hostNodeRef.current = null;
    noteRef.current = null;
  };

  // 卸载清理
  useEffect(() => teardown, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !noteId || body === null) {
      // 离开 doc 预览（切非 doc / 关面板）：立刻销毁，别把内核挂在没人看的节点上
      teardown();
      return;
    }
    if (viewerRef.current && (hostNodeRef.current !== host || noteRef.current !== noteId)) teardown();
    try {
      if (!viewerRef.current) {
        viewerRef.current = createLakeDocument(host, "viewer", () => {}, false, noteId, host, prefsRef.current);
        hostNodeRef.current = host;
        noteRef.current = noteId;
      }
      // 复用同一实例：切快照只换正文
      viewerRef.current.setDocument("text/lake", addAssetAccessToken(body));
      viewerRef.current.requestCardHydration?.();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      errorRef.current?.(message);
    }
  }, [hostRef, noteId, body]);
}
