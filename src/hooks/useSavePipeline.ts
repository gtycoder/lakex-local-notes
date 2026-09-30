import { useCallback, useRef, useState } from "react";
import { native } from "../lib/native";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { reportNativeActionError } from "../lib/nativeErrors";
import { SavePipelineCore } from "./savePipelineCore";
import type { NoteDocument } from "../lib/types";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * 显式保存结果（审计 F01）：调用者（关闭 / 淘汰 / 锁定）必须据此决定是否继续。
 * ok:false 表示这次 revision 没有持久化；blocked:true 特指文档已在回收站/被 purge（只读，无内容可存，允许关闭）。
 */
export type PersistOutcome = { ok: true } | { ok: false; blocked?: boolean };

// P1-3：放宽自动保存频率——保存落盘防抖 1s（人类打字节奏下无必要更频繁）；
// 草稿防抖 1.5s，略晚于保存且保存成功即清草稿定时器（见 persistTab 内 onDraftCleared 前 clearTimeout）。
// 草稿必须晚于保存：否则同一停顿点草稿与保存同时到点会双写一次草稿（无谓的写盘）。
// 草稿仅作"保存失败/崩溃"的崩溃兜底。
const SAVE_DEBOUNCE_MS = 1000;
const DRAFT_JOURNAL_DEBOUNCE_MS = 1500;

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
  /** 因文档已在回收站/被 purge 而丢弃保存时通知上层（旧实现静默 return：用户以为存了）。 */
  onBlockedSave?: (noteId: string) => void;
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
  const { onNoteSaved, onOpenTabsApplied, onDraftCleared, onError, onBlockedSave, getOpenTab, getEditorCaches } = options;
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const saveTimers = useRef<Map<string, number>>(new Map());
  const draftTimers = useRef<Map<string, number>>(new Map());
  const coreRef = useRef<SavePipelineCore | null>(null);
  if (coreRef.current === null) coreRef.current = new SavePipelineCore();
  const core = coreRef.current;

  const persistTab = useCallback((noteId: string, title: string, content: string): Promise<PersistOutcome> => {
    // 已在回收站/被他端 purge（标记 deleted）的文档不保存：避免把内容写回已回收的笔记。
    // 必须出声——静默丢弃会让用户以为已保存（编辑器此时已只读，这里是最后一道闸）。
    const openTab = getOpenTab(noteId);
    if (openTab?.deleted) { onBlockedSave?.(noteId); return Promise.resolve({ ok: false, blocked: true }); }
    // 审计 F02：body/title/caches/revision 是同一次不可变快照，**入队前绑定**。
    // 任务拿到 queue 执行权后不得再读 live revision / live editor——否则旧正文会被新 revision 认证成"最新"。
    const snapshot = {
      noteId,
      title,
      content,
      caches: getEditorCaches(noteId),
      revision: core.revision(noteId),
    };
    setSaveState("saving");
    return core.run(noteId, async (): Promise<PersistOutcome> => {
      try {
        const saved = await native.saveNote(snapshot.noteId, snapshot.title.trim() || "无标题", snapshot.content, snapshot.caches);
        onNoteSaved(saved);
        // ack 只认自己的 revision：期间有新编辑则不清 dirty、不清草稿、不覆盖正文（审计 F02）。
        if (core.revision(snapshot.noteId) === snapshot.revision) {
          // 无新编辑：安全覆盖 + 清除 dirty；同时更新 lastDigest（本机已保存，远端未变时无需重载）
          onOpenTabsApplied(saved);
          const draftTimer = draftTimers.current.get(snapshot.noteId);
          if (draftTimer !== undefined) { window.clearTimeout(draftTimer); draftTimers.current.delete(snapshot.noteId); }
          onDraftCleared(snapshot.noteId);
          setLastSavedAt(new Date().toISOString());
          setSaveState("saved");
        } else {
          // 期间有新编辑：不覆盖草稿、不清除 dirty（磁盘为旧内容，等待下一次保存）
          setSaveState("dirty");
        }
        return { ok: true };
      } catch (reason) {
        // 审计 F01：显式 save/flush 必须返回明确失败（不再把错误吞成 fulfilled 的成功）。
        // NotFound / 磁盘满 / DB 失败一视同仁：调用者据 ok:false 停下并提示真实原因。
        setSaveState("error"); onError(getNativeErrorMessage(reason));
        return { ok: false };
      }
    });
  }, [core, getOpenTab, getEditorCaches, onNoteSaved, onOpenTabsApplied, onDraftCleared, onError, onBlockedSave]);

  /** 防抖保存：SAVE_DEBOUNCE_MS（1s）无新输入后落盘。 */
  const scheduleSave = useCallback((noteId: string, content: string) => {
    setSaveState("dirty");
    const existing = saveTimers.current.get(noteId);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      saveTimers.current.delete(noteId);
      const tab = getOpenTab(noteId);
      if (tab) void persistTab(noteId, tab.title, content);
    }, SAVE_DEBOUNCE_MS);
    saveTimers.current.set(noteId, timer);
  }, [persistTab, getOpenTab]);

  /** 草稿防抖：1.5s 无新输入后写草稿（未保存内容兜底；晚于保存，正常路径由保存清草稿）。 */
  const scheduleDraftJournal = useCallback((noteId: string, title: string, content: string) => {
    const existing = draftTimers.current.get(noteId);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      draftTimers.current.delete(noteId);
      void native.saveDraftJournal({ noteId, title, content, updatedAt: new Date().toISOString() }).catch((error) => reportNativeActionError("保存草稿", error));
    }, DRAFT_JOURNAL_DEBOUNCE_MS);
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
