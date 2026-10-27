import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { native } from "../lib/native";
import { getNativeErrorMessage, reportNativeActionError } from "../lib/nativeErrors";
import { cleanLakeMarkdown } from "../core/markdownClean";
import { stripAssetAccessToken } from "../lib/assetPort";
import { patchNoteById, summaryOf, type DesktopWorkspace, type OpenTab } from "../desktop/desktopTypes";
import type { PersistOutcome } from "./useSavePipeline";
import { flushDirtyBeforeLifecycle } from "../core/lifecycleFlush";
import { flushPendingLockedTextCommits } from "../features/editor/lockedTextFlush";
import type { NoteDocument, NoteSummary, S3Settings, TreeNode } from "../lib/types";
import type { LakeEditorInstance } from "../features/editor/lakeRuntime";

export interface UseDesktopHandlersOptions {
  setS3Settings: Dispatch<SetStateAction<S3Settings | null>>;
  setCloudConfigured: Dispatch<SetStateAction<boolean>>;
  setCloudEnabled: Dispatch<SetStateAction<boolean>>;
  editorsRef: MutableRefObject<Map<string, LakeEditorInstance>>;
  activeNoteId: string | null;
  notes: NoteSummary[];
  openTabsRef: MutableRefObject<OpenTab[]>;
  persistTab: (noteId: string, title?: string, content?: string) => Promise<PersistOutcome>;
  setNotes: Dispatch<SetStateAction<NoteSummary[]>>;
  setTreeNodes: Dispatch<SetStateAction<TreeNode[]>>;
  setDesktopWorkspace: Dispatch<SetStateAction<DesktopWorkspace>>;
  openNote: (id: string) => Promise<boolean>;
  setError: Dispatch<SetStateAction<string | null>>;
}

/** S3/同步设置回调、编辑器就绪、锁定切换、小记转换（从 App.tsx 抽出，逐字搬移）。 */
export function useDesktopHandlers({
  setS3Settings, setCloudConfigured, setCloudEnabled, editorsRef,
  activeNoteId, notes, openTabsRef, persistTab, setNotes, setTreeNodes,
  setDesktopWorkspace, openNote, setError,
}: UseDesktopHandlersOptions) {
  const handleS3SettingsChanged = useCallback((next: S3Settings) => {
    setS3Settings(next);
    setCloudConfigured(true);
  }, [setS3Settings, setCloudConfigured]);
  const handleSyncSettingsChanged = useCallback((next: { enabled: boolean }) => {
    setCloudEnabled(next.enabled);
  }, [setCloudEnabled]);

  /** 编辑器实例就绪回调：注册到 map，销毁时移除；就绪时补写文本缓存（存量文档首次打开即有缓存） */
  const handleEditorReady = useCallback((noteId: string, editor: LakeEditorInstance | null) => {
    if (editor) {
      editorsRef.current.set(noteId, editor);
      try {
        if (typeof editor.getDocument === "function") {
          const markdown = cleanLakeMarkdown(stripAssetAccessToken(editor.getDocument("text/markdown")));
          const plain = stripAssetAccessToken(editor.getDocument("text/plain"));
          void native.updateNoteCaches(noteId, markdown, plain).catch((error) => reportNativeActionError("更新正文缓存", error));
        }
      } catch {
        // 锁定态 Viewer 不暴露 getDocument("text/markdown")：由主进程从磁盘 .lake 兜底补齐缓存
        void native.ensureNoteCaches(noteId).catch((error) => reportNativeActionError("补齐正文缓存", error));
      }
    } else {
      editorsRef.current.delete(noteId);
    }
  }, [editorsRef]);

  async function toggleNoteLock(targetNoteId?: string | null) {
    // 目录栏右键可锁**任意文档**（含未打开的）；不传 = 顶栏那一处，作用于当前活动文档。
    const tabId = targetNoteId ?? activeNoteId;
    if (!tabId) return;
    const summary = notes.find((n) => n.id === tabId);
    if (!summary) return;
    const next = !summary.isEditLocked;
    const tab = openTabsRef.current.find((t) => t.noteId === tabId);
    if (next && tab) {
      // 审计 F01：锁定前必须确认该 revision 已持久化；失败则留在可编辑状态（错误已由保存管线提示）。
      // 加密文本卡：先把防抖窗口里的明文补写成密文（否则锁前后一段会静默丢失，评审 B1）。
      const flushedCard = await flushPendingLockedTextCommits();
      const { proceed } = await flushDirtyBeforeLifecycle(
        flushedCard ? { ...tab, dirty: true } : tab,
        () => persistTab(tabId),
      );
      if (!proceed) return;
    }
    // 锁定态 Viewer 无法用内核生成文本缓存；锁定前确保 md/text 缓存存在（已有则跳过）
    if (next) {
      try {
        const caches = await native.readNoteCaches(tabId);
        if (!caches.markdown || !caches.plain) {
          await native.ensureNoteCaches(tabId);
        }
      } catch { /* 缓存兜底失败不阻断锁定 */ }
    }
    try {
      const updated = await native.setNoteEditLocked(tabId, next);
      setNotes(patchNoteById(tabId, { isEditLocked: updated.isEditLocked, editLockedAt: updated.editLockedAt }));
    } catch (reason) {
      setError(getNativeErrorMessage(reason));
    }
  }

  async function handleQuickNoteConverted(note: NoteDocument) {
    setNotes((items) => [summaryOf(note), ...items.filter((item) => item.id !== note.id)]);
    try { setTreeNodes(await native.listTreeNodes()); }
    catch (reason) { setError(getNativeErrorMessage(reason)); }
    setDesktopWorkspace("library");
    await openNote(note.id);
  }

  return { handleS3SettingsChanged, handleSyncSettingsChanged, handleEditorReady, toggleNoteLock, handleQuickNoteConverted };
}
