import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { native } from "../lib/native";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { cleanLakeMarkdown } from "../core/markdownClean";
import { stripAssetAccessToken } from "../lib/assetPort";
import { patchNoteById, summaryOf, type DesktopWorkspace, type OpenTab } from "../desktop/desktopTypes";
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
  persistTab: (noteId: string, title: string, content: string) => Promise<unknown>;
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
          void native.updateNoteCaches(noteId, markdown, plain);
        }
      } catch {
        // 锁定态 Viewer 不暴露 getDocument("text/markdown")：由主进程从磁盘 .lake 兜底补齐缓存
        void native.ensureNoteCaches(noteId);
      }
    } else {
      editorsRef.current.delete(noteId);
    }
  }, [editorsRef]);

  async function toggleNoteLock() {
    const tabId = activeNoteId;
    if (!tabId) return;
    const summary = notes.find((n) => n.id === tabId);
    if (!summary) return;
    const next = !summary.isLocked;
    const tab = openTabsRef.current.find((t) => t.noteId === tabId);
    if (next && tab?.dirty) await persistTab(tabId, tab.title, tab.content);
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
      const updated = await native.setNoteLocked(tabId, next);
      setNotes(patchNoteById(tabId, { isLocked: updated.isLocked, lockedAt: updated.lockedAt }));
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
