import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { native } from "../lib/native";
import { reportNativeActionError } from "../lib/nativeErrors";
import { patchNoteById, patchTabById, readEditorDocumentCaches, summaryOf, type OpenTab } from "../desktop/desktopTypes";
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
    setTreeNodes((items) => items.map((item) => item.noteFileId === saved.id || item.id === saved.id ? { ...item, title: saved.title, updatedAt: saved.updatedAt, syncState: saved.syncState } : item));
    setSync((current) => ({
      ...current,
      pendingChanges: saved.syncState === "synced" ? current.pendingChanges : Math.max(1, current.pendingChanges),
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

  return { handleNoteSaved, handleOpenTabsApplied, handleDraftCleared, handleSaveError, handleGetOpenTab, handleGetEditorCaches };
}
