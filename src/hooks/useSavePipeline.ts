import { useCallback, useRef, useState } from "react";
import { native } from "../lib/native";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { reportNativeActionError } from "../lib/nativeErrors";
import { SavePipelineCore } from "./savePipelineCore";
import { isSaveConflict, type NoteDocument, type SaveNoteConflict } from "../lib/types";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * 显式保存结果（审计 F01）：调用者（关闭 / 淘汰 / 锁定）必须据此决定是否继续。
 * ok:false 表示这次 revision 没有持久化；blocked:true 特指文档已在回收站/被 purge（只读，无内容可存，允许关闭）；
 * externalChanged（Batch4-D）特指磁盘正文被外部/他端改过 ⇒ 没写盘，等用户在三选项里决定。
 */
export type PersistOutcome =
  | { ok: true }
  | { ok: false; blocked?: boolean; externalChanged?: { diskHash: string } };

/** 保存时显式指定 baseHash（「覆盖磁盘」= 用户明确选择，带上冲突时看到的 diskHash 再试一次）。 */
export interface PersistTabOptions {
  baseHash?: string;
}

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
  /**
   * 保存成功即刷新磁盘基线（**与 revision 无关**）。
   * 261110 事故：保存期间用户又编辑 ⇒ revision 前进 ⇒ 旧实现跳过 onOpenTabsApplied（连带不刷 baseHash），
   * 但磁盘其实已被这次保存写过 ⇒ 下一笔保存拿旧基线，把"自己上一笔的写入"判成外部改动（灯亮 + 三选项误弹）。
   */
  onBaseHashRefreshed?: (saved: NoteDocument) => void;
  /** 保存成功后清除本地草稿（deleteDraftJournal + draftEntries 过滤）。 */
  onDraftCleared: (noteId: string) => void;
  /** 保存失败提示（NOT_FOUND 自动忽略，不触发）。 */
  onError: (message: string) => void;
  /** 因文档已在回收站/被 purge 而丢弃保存时通知上层（旧实现静默 return：用户以为存了）。 */
  onBlockedSave?: (noteId: string) => void;
  /** 读取 openTabs 当前快照（含 deleted 标记，用于拦截写回回收站）。 */
  getOpenTab: (noteId: string) => { title: string; content: string; deleted?: boolean; baseHash?: string } | undefined;
  /** 从编辑器实例生成派生缓存（markdown/plain；无实例返回空）。 */
  getEditorCaches: (noteId: string) => { markdown: string | null; plain: string | null };
  /** 捕获契约（审计 §6.1）：按需从编辑器取当前 text/lake 正文；无实例/失败返回 undefined。 */
  captureContent: (noteId: string) => string | undefined;
}

/**
 * 保存管线：串行队列 + 防抖定时器 + revision 竞态保护。
 * 每篇笔记的编辑 revision——保存请求发出后若有新编辑（revision 增长），
 * 旧响应不得覆盖最新草稿/清除 dirty（审计 #7）。
 */
export function useSavePipeline(options: SavePipelineOptions) {
  const { onNoteSaved, onOpenTabsApplied, onBaseHashRefreshed, onDraftCleared, onError, onBlockedSave, getOpenTab, getEditorCaches, captureContent } = options;
  /**
   * 保存状态**按文档**记录（260930：不能做成全局单值——后台文档保存会污染当前文档的状态栏，
   * 表现为当前文档底栏在「保存中 ⇄ 待保存」之间闪）。状态栏只读活动文档那一条。
   */
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  /** 保存**真的被拒绝**（catch 里的 path）的文档集合：退出闸据此允许丢弃未保存内容（261114 用户裁决）。
   *  只记「请求失败」；外部改动冲突（saveConflicts）是等用户决策的拦截，不在此列（仍阻塞退出）。 */
  const failedSavesRef = useRef<Set<string>>(new Set());
  const saveTimers = useRef<Map<string, number>>(new Map());
  const draftTimers = useRef<Map<string, number>>(new Map());
  /**
   * Batch4-D：外部改动冲突（按文档）。存在期间**暂停自动保存**（否则会反复弹窗/反复被拦），
   * 直到用户选择「另存副本 / 覆盖磁盘 / 放弃并载入磁盘版」后再恢复。
   */
  const [saveConflicts, setSaveConflicts] = useState<Record<string, SaveNoteConflict>>({});
  const conflictsRef = useRef<Record<string, SaveNoteConflict>>({});
  const recordConflict = useCallback((conflict: SaveNoteConflict) => {
    conflictsRef.current = { ...conflictsRef.current, [conflict.noteId]: conflict };
    setSaveConflicts(conflictsRef.current);
  }, []);
  /** 用户已处理（或关闭文档）：解除暂停，让下一次编辑重新走自动保存。 */
  const clearSaveConflict = useCallback((noteId: string) => {
    if (!conflictsRef.current[noteId]) return;
    const next = { ...conflictsRef.current };
    delete next[noteId];
    conflictsRef.current = next;
    setSaveConflicts(next);
  }, []);
  const coreRef = useRef<SavePipelineCore | null>(null);
  if (coreRef.current === null) coreRef.current = new SavePipelineCore();
  const core = coreRef.current;

  /** 写某文档的保存状态；值未变返回原对象（不触发无谓 render）。 */
  const markSaveState = useCallback((noteId: string, state: SaveState) => {
    setSaveStates((prev) => (prev[noteId] === state ? prev : { ...prev, [noteId]: state }));
  }, []);

  const persistTab = useCallback((noteId: string, title?: string, content?: string, options?: PersistTabOptions): Promise<PersistOutcome> => {
    // 已在回收站/被他端 purge（标记 deleted）的文档不保存：避免把内容写回已回收的笔记。
    // 必须出声——静默丢弃会让用户以为已保存（编辑器此时已只读，这里是最后一道闸）。
    const openTab = getOpenTab(noteId);
    if (openTab?.deleted) { onBlockedSave?.(noteId); return Promise.resolve({ ok: false, blocked: true }); }
    // 审计 F02：body/title/caches/revision 是同一次不可变快照，**入队前绑定**。
    // 任务拿到 queue 执行权后不得再读 live revision / live editor——否则旧正文会被新 revision 认证成"最新"。
    // 捕获契约（审计 §6.1）：正文不在每次按键序列化，而是在这里按需 capture
    //（显式 content > 编辑器实时 capture > tab 最后已提交版本）。
    const snapshot = {
      noteId,
      title: title ?? openTab?.title ?? "无标题",
      content: content ?? captureContent(noteId) ?? openTab?.content ?? "",
      caches: getEditorCaches(noteId),
      revision: core.revision(noteId),
      // Batch4-D：带打开/上次保存时的正文 hash 做版本守卫；显式 options 优先（「覆盖磁盘」重试用）。
      baseHash: options?.baseHash ?? openTab?.baseHash,
    };
    markSaveState(noteId, "saving");
    return core.run(noteId, async (): Promise<PersistOutcome> => {
      try {
        // 261110：baseHash = **磁盘基线**，必须在任务真正执行时取最新（入队前绑定的快照可能已被
        // 前一笔成功保存刷新）。正文/标题/revision 仍用入队快照（审计 F02 不可动摇）。
        const queuedBaseHash = options?.baseHash ?? getOpenTab(noteId)?.baseHash ?? snapshot.baseHash;
        const saved = await native.saveNote(snapshot.noteId, snapshot.title.trim() || "无标题", snapshot.content, snapshot.caches, queuedBaseHash);
        // Batch4-D：磁盘正文被外部/他端改过 ⇒ 主进程没写盘。挂起该文档的自动保存并交 UI 三选项确认。
        if (isSaveConflict(saved)) {
          recordConflict(saved);
          markSaveState(snapshot.noteId, "error");
          // 审计：谁在什么时候被拦下（渲染层 console 由主进程统一落盘，scope=renderer）。
          console.info(
            "[save-conflict] 检测到外部改动，已拦截写入" +
            " noteId=" + snapshot.noteId + " diskHash=" + saved.diskHash.slice(0, 12) + " baseHash=" + (queuedBaseHash ?? "none").slice(0, 12),
          );
          return { ok: false, externalChanged: { diskHash: saved.diskHash } };
        }
        failedSavesRef.current.delete(snapshot.noteId);
        onNoteSaved(saved);
        // 261110：baseHash 刷新**不受 revision 门控**——磁盘基线变了就是变了，与"有没有新编辑"无关。
        onBaseHashRefreshed?.(saved);
        // ack 只认自己的 revision：期间有新编辑则不清 dirty、不清草稿、不覆盖正文（审计 F02）。
        if (core.revision(snapshot.noteId) === snapshot.revision) {
          // 无新编辑：安全覆盖 + 清除 dirty；同时更新 lastDigest（本机已保存，远端未变时无需重载）
          onOpenTabsApplied(saved);
          const draftTimer = draftTimers.current.get(snapshot.noteId);
          if (draftTimer !== undefined) { window.clearTimeout(draftTimer); draftTimers.current.delete(snapshot.noteId); }
          onDraftCleared(snapshot.noteId);
          markSaveState(snapshot.noteId, "saved");
        } else {
          // 期间有新编辑：不覆盖草稿、不清除 dirty（磁盘为旧内容，等待下一次保存）
          markSaveState(snapshot.noteId, "dirty");
        }
        return { ok: true };
      } catch (reason) {
        failedSavesRef.current.add(snapshot.noteId);
        // 审计 F01：显式 save/flush 必须返回明确失败（不再把错误吞成 fulfilled 的成功）。
        // NotFound / 磁盘满 / DB 失败一视同仁：调用者据 ok:false 停下并提示真实原因。
        markSaveState(snapshot.noteId, "error"); onError(getNativeErrorMessage(reason));
        return { ok: false };
      }
    });
  }, [core, getOpenTab, getEditorCaches, captureContent, onNoteSaved, onOpenTabsApplied, onDraftCleared, onError, onBlockedSave, markSaveState, recordConflict]);

  /** 防抖保存：SAVE_DEBOUNCE_MS（1s）无新输入后落盘。 */
  const scheduleSave = useCallback((noteId: string, content?: string) => {
    markSaveState(noteId, "dirty");
    // Batch4-D：存在未处理的保存冲突 ⇒ **暂停自动保存**（继续跑只会反复被拦/反复弹窗）；
    // 用户在三选项里选完（clearSaveConflict）后，下一次编辑自动恢复。
    if (conflictsRef.current[noteId]) return;
    const existing = saveTimers.current.get(noteId);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      saveTimers.current.delete(noteId);
      const tab = getOpenTab(noteId);
      if (tab) void persistTab(noteId, undefined, content);
    }, SAVE_DEBOUNCE_MS);
    saveTimers.current.set(noteId, timer);
  }, [persistTab, getOpenTab, markSaveState]);

  /** 草稿防抖：1.5s 无新输入后写草稿（未保存内容兜底；晚于保存，正常路径由保存清草稿）。 */
  const scheduleDraftJournal = useCallback((noteId: string, content?: string) => {
    const existing = draftTimers.current.get(noteId);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      draftTimers.current.delete(noteId);
      const tab = getOpenTab(noteId);
      // 捕获契约：草稿也按需 capture（显式 content > 编辑器实时 > tab 最后已提交版本）。
      const body = content ?? captureContent(noteId) ?? tab?.content ?? "";
      void native.saveDraftJournal({ noteId, title: tab?.title ?? "无标题", content: body, updatedAt: new Date().toISOString() }).catch((error) => reportNativeActionError("保存草稿", error));
    }, DRAFT_JOURNAL_DEBOUNCE_MS);
    draftTimers.current.set(noteId, timer);
  }, [captureContent, getOpenTab]);

  const bumpRevision = useCallback((noteId: string) => {
    core.bump(noteId);
  }, [core]);

  const resetRevision = useCallback((noteId: string, revision = 0) => {
    core.reset(noteId, revision);
  }, [core]);

  /** 关闭/删除笔记：取消挂起保存定时器、清理 revision 与该文档的未处理冲突。 */
  const clearNote = useCallback((noteId: string) => {
    failedSavesRef.current.delete(noteId);
    const timer = saveTimers.current.get(noteId);
    if (timer) { window.clearTimeout(timer); saveTimers.current.delete(noteId); }
    core.clear(noteId);
    if (conflictsRef.current[noteId]) {
      const next = { ...conflictsRef.current };
      delete next[noteId];
      conflictsRef.current = next;
      setSaveConflicts(next);
    }
  }, [core]);

  /** 卸载/关窗前清空全部定时器（beforeunload 与 unmount 共用）。 */
  const flushTimers = useCallback(() => {
    saveTimers.current.forEach((timer) => window.clearTimeout(timer));
    saveTimers.current.clear();
    draftTimers.current.forEach((timer) => window.clearTimeout(timer));
    draftTimers.current.clear();
  }, []);

  return {
    /** 每个文档各自的保存状态（状态栏只取活动文档那一条）。 */
    saveStates,
    /** 写某文档的保存状态（供标签切换/草稿恢复等外部入口使用）。 */
    setSaveState: markSaveState,
    persistTab, scheduleSave, scheduleDraftJournal,
    bumpRevision, resetRevision, clearNote, flushTimers,
    saveTimers, draftTimers,
    /** 保存被拒（catch）的文档集合；退出闸用它允许丢弃（不阻塞退出）。 */
    failedSavesRef,
    /** Batch4-D：按文档挂起的外部改动冲突（UI 据此弹三选项；存在期间自动保存已暂停）。 */
    saveConflicts,
    /** 用户已处理冲突：解除暂停（之后的下一次编辑重新自动保存）。 */
    clearSaveConflict,
  };
}
