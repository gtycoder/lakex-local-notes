import { useCallback, useRef, useState } from "react";
import { native } from "../lib/native";
import { getNativeErrorCode, getNativeErrorMessage } from "../lib/nativeErrors";
import { SavePipelineCore } from "./savePipelineCore";
import type { NoteDocument } from "../lib/types";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/** 保存管线依赖（V5 Phase 4：App 只抽 hook 不重写——外部状态经回调注入，管线可单测）。 */
export interface SavePipelineOptions {
  /** 保存成功后的 App 侧状态应用（notes/treeNodes/sync/pendingSummary 更新）。 */
  onNoteSaved: (saved: NoteDocument) => void;
  /** 无新编辑时更新 openTabs（title/content/dirty/lastDigest）。 */
  onOpenTabsApplied: (saved: NoteDocument) => void;
  /** 保存成功后清除本地草稿（deleteDraftJournal + draftEntries 过滤）。 */
  onDraftCleared: (noteId: string) => void;
  /** 保存失败提示（NOT_FOUND 自动忽略，不触发）。 */
  onError: (message: string) => void;
  /** 读取 openTabs 当前快照（含 deleted 标记，用于拦截写回回收站）。 */
  getOpenTab: (noteId: string) => { title: string; content: string; deleted?: boolean } | undefined;
  /** 从编辑器实例生成派生缓存（markdown/plain；无实例返回空）。 */
  getEditorCaches: (noteId: string) => { markdown: string | null; plain: string | null };
}

/**
 * 保存管线：串行队列 + 防抖定时器 + revision 竞态保护。
 * 每篇笔记的编辑 revision——保存请求发出后若有新编辑（revision 增长），
 * 旧响应不得覆盖最新草稿/清除 dirty（审计 #7）。
 */
export function useSavePipeline(options: SavePipelineOptions) {
  const { onNoteSaved, onOpenTabsApplied, onDraftCleared, onError, getOpenTab, getEditorCaches } = options;
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const saveTimers = useRef<Map<string, number>>(new Map());
  const draftTimers = useRef<Map<string, number>>(new Map());
  const coreRef = useRef<SavePipelineCore | null>(null);
  if (coreRef.current === null) coreRef.current = new SavePipelineCore();
  const core = coreRef.current;

  const persistTab = useCallback((noteId: string, title: string, content: string) => {
    return core.run(noteId, async () => {
      // 远端已删除（标记 deleted）的文档不再保存：避免把内容写回已回收的笔记。
      const openTab = getOpenTab(noteId);
      if (openTab?.deleted) return;
      // 审计 #7：保存时快照当前 revision；响应返回后仅当期间无新编辑才覆盖草稿/清除 dirty
      const revision = core.revision(noteId);
      setSaveState("saving");
      try {
        // M1：保存时由 Lake 内核生成 markdown/纯文本缓存，随正文同批落库
        const caches = getEditorCaches(noteId);
        const saved = await native.saveNote(noteId, title.trim() || "无标题", content, caches);
        onNoteSaved(saved);
        if (core.revision(noteId) === revision) {
          // 无新编辑：安全覆盖 + 清除 dirty；同时更新 lastDigest（本机已保存，远端未变时无需重载）
          onOpenTabsApplied(saved);
          const draftTimer = draftTimers.current.get(noteId);
          if (draftTimer !== undefined) { window.clearTimeout(draftTimer); draftTimers.current.delete(noteId); }
          onDraftCleared(noteId);
          setLastSavedAt(new Date().toISOString());
          setSaveState("saved");
        } else {
          // 期间有新编辑：不覆盖草稿、不清除 dirty（磁盘为旧内容，等待下一次保存）
          setSaveState("dirty");
        }
        return saved;
      } catch (reason) {
        if (getNativeErrorCode(reason) === "NOT_FOUND") return;
        setSaveState("error"); onError(getNativeErrorMessage(reason));
      }
    });
  }, [getOpenTab, getEditorCaches, onNoteSaved, onOpenTabsApplied, onDraftCleared, onError]);

  /** 防抖保存：800ms 无新输入后落盘。 */
  const scheduleSave = useCallback((noteId: string, content: string) => {
    setSaveState("dirty");
    const existing = saveTimers.current.get(noteId);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      saveTimers.current.delete(noteId);
      const tab = getOpenTab(noteId);
      if (tab) void persistTab(noteId, tab.title, content);
    }, 800);
    saveTimers.current.set(noteId, timer);
  }, [persistTab, getOpenTab]);

  /** 草稿防抖：450ms 无新输入后写草稿（未保存内容兜底）。 */
  const scheduleDraftJournal = useCallback((noteId: string, title: string, content: string) => {
    const existing = draftTimers.current.get(noteId);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      draftTimers.current.delete(noteId);
      void native.saveDraftJournal({ noteId, title, content, updatedAt: new Date().toISOString() }).catch(() => undefined);
    }, 450);
    draftTimers.current.set(noteId, timer);
  }, []);

  const bumpRevision = useCallback((noteId: string) => {
    core.bump(noteId);
  }, [core]);

  const resetRevision = useCallback((noteId: string, revision = 0) => {
    core.reset(noteId, revision);
  }, [core]);

  /** 关闭/删除笔记：取消挂起保存定时器并清理 revision。 */
  const clearNote = useCallback((noteId: string) => {
    const timer = saveTimers.current.get(noteId);
    if (timer) { window.clearTimeout(timer); saveTimers.current.delete(noteId); }
    core.clear(noteId);
  }, [core]);

  /** 卸载/关窗前清空全部定时器（beforeunload 与 unmount 共用）。 */
  const flushTimers = useCallback(() => {
    saveTimers.current.forEach((timer) => window.clearTimeout(timer));
    saveTimers.current.clear();
    draftTimers.current.forEach((timer) => window.clearTimeout(timer));
    draftTimers.current.clear();
  }, []);

  return {
    saveState, setSaveState, lastSavedAt, setLastSavedAt,
    persistTab, scheduleSave, scheduleDraftJournal,
    bumpRevision, resetRevision, clearNote, flushTimers,
    saveTimers, draftTimers,
  };
}
