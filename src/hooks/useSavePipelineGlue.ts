import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { native } from "../lib/native";
import { reportNativeActionError } from "../lib/nativeErrors";
import { patchNoteById, patchTabById, readEditorDocumentCaches, summaryOf, type OpenTab } from "../desktop/desktopTypes";
import { stripAssetAccessToken } from "../lib/assetPort";
import type { DraftJournalEntry, NoteDocument, NoteSummary, SyncStatus, TreeNode } from "../lib/types";
import type { LakeEditorInstance } from "../features/editor/lakeRuntime";

export interface UseSavePipelineGlueOptions {
  setNotes: Dispatch<SetStateAction<NoteSummary[]>>;
  setTreeNodes: Dispatch<SetStateAction<TreeNode[]>>;
  setSync: Dispatch<SetStateAction<SyncStatus>>;
  setOpenTabs: Dispatch<SetStateAction<OpenTab[]>>;
  setDraftEntries: Dispatch<SetStateAction<DraftJournalEntry[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
  openTabsRef: MutableRefObject<OpenTab[]>;
  editorsRef: MutableRefObject<Map<string, LakeEditorInstance>>;
}

/** useSavePipeline 的输入回调（从 App.tsx 抽出，逐字搬移）。 */
export function useSavePipelineGlue({
  setNotes, setTreeNodes, setSync, setOpenTabs, setDraftEntries, setError, openTabsRef, editorsRef,
}: UseSavePipelineGlueOptions) {
  const handleNoteSaved = useCallback((saved: NoteDocument) => {
    setNotes(patchNoteById(saved.id, summaryOf(saved)));
    setTreeNodes((items) => items.map((item) => item.noteFileId === saved.id || item.id === saved.id ? { ...item, title: saved.title, updatedAt: saved.updatedAt, syncState: saved.syncState, isDirty: saved.isDirty } : item));
    setSync((current) => ({
      ...current,
      pendingChanges: saved.isDirty ? Math.max(1, current.pendingChanges) : current.pendingChanges,
    }));
  }, [setNotes, setTreeNodes, setSync]);
  const handleOpenTabsApplied = useCallback((saved: NoteDocument) => {
    setOpenTabs(patchTabById(saved.id, { title: saved.title, content: saved.content, dirty: false, lastDigest: { title: saved.title, updatedAt: saved.updatedAt } }));
  }, [setOpenTabs]);
  const handleDraftCleared = useCallback((noteId: string) => {
    void native.deleteDraftJournal(noteId).catch((error) => reportNativeActionError("保存后清草稿", error));
    setDraftEntries((entries) => entries.filter((entry) => entry.noteId !== noteId));
  }, [setDraftEntries]);
  const handleSaveError = useCallback((message: string) => setError(message), [setError]);
  const handleGetOpenTab = useCallback((noteId: string) => openTabsRef.current.find((t) => t.noteId === noteId), [openTabsRef]);
  const handleGetEditorCaches = useCallback((noteId: string) => {
    return readEditorDocumentCaches(editorsRef.current.get(noteId)) ?? { markdown: null, plain: null };
  }, [editorsRef]);
  /** 捕获契约：按需取当前 text/lake 正文（doc 走 Lake 实例；sheet/board 不在此注册，返回 undefined 由调用方兜底）。 */
  // 审计 F15：Sheet/Board 注册的按需序列化（优先级高于 Lake 实例的 getDocument）。
  const capturesRef = useRef<Map<string, () => string | null>>(new Map());
  const handleCaptureReady = useCallback((noteId: string, capture: (() => string | null) | null) => {
    if (capture) capturesRef.current.set(noteId, capture); else capturesRef.current.delete(noteId);
  }, []);
  const handleCaptureContent = useCallback((noteId: string): string | undefined => {
    const registered = capturesRef.current.get(noteId);
    if (registered) {
      try { const body = registered(); if (typeof body === "string") return body; } catch { /* 回退到 Lake 实例 */ }
    }
    const editor = editorsRef.current.get(noteId);
    if (!editor || typeof editor.getDocument !== "function") return undefined;
    try { return stripAssetAccessToken(editor.getDocument("text/lake")); } catch { return undefined; }
  }, [editorsRef]);

  return { handleNoteSaved, handleOpenTabsApplied, handleDraftCleared, handleSaveError, handleGetOpenTab, handleGetEditorCaches, handleCaptureContent, handleCaptureReady };
}
