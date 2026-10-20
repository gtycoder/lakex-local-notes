import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { native } from "../lib/native";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { reportNativeActionError } from "../lib/nativeErrors";
import type { NoteSummary, S3Settings, SyncPendingSummary, SyncStatus, TreeNode, WorkspaceSnapshot } from "../lib/types";
import type { DraftJournalEntry } from "../lib/types";

export interface UseBootstrapOptions {
  setWorkspace: Dispatch<SetStateAction<WorkspaceSnapshot | null>>;
  setNotes: Dispatch<SetStateAction<NoteSummary[]>>;
  setSync: Dispatch<SetStateAction<SyncStatus>>;
  setCloudEnabled: Dispatch<SetStateAction<boolean>>;
  setS3Settings: Dispatch<SetStateAction<S3Settings | null>>;
  setCloudConfigured: Dispatch<SetStateAction<boolean>>;
  setConflictSnapshotNotice: Dispatch<SetStateAction<Array<{ noteId: string; title: string }>>>;
  setPendingSummary: Dispatch<SetStateAction<SyncPendingSummary>>;
  setDraftEntries: Dispatch<SetStateAction<DraftJournalEntry[]>>;
  setTreeNodes: Dispatch<SetStateAction<TreeNode[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
  openNote: (id: string) => Promise<boolean>;
}

/** 启动 bootstrap（从 App.tsx 抽出，逐字搬移）：初始化工作区/同步/S3/草稿/树 → 打开 lastOpenedNoteId（含 fallback）。 */
export function useBootstrap({
  setWorkspace, setNotes, setSync, setCloudEnabled, setS3Settings, setCloudConfigured,
  setConflictSnapshotNotice, setPendingSummary, setDraftEntries, setTreeNodes, setError, openNote,
}: UseBootstrapOptions) {
  useEffect(() => {
    // 启动速度优先：不加人为最短展示；桌面 boot 窗口负责遮住真实加载时间。
    void native.bootstrap().then(async (snapshot) => {
      setWorkspace(snapshot); setNotes(snapshot.notes); setSync(snapshot.sync);
      void native.getSyncSettings().then((cfg) => setCloudEnabled(cfg.enabled)).catch((error) => reportNativeActionError("启动读取", error));
      void native.getS3Settings().then((cfg) => { setS3Settings(cfg); setCloudConfigured(Boolean(cfg)); }).catch((error) => reportNativeActionError("启动读取", error));
      void native.getSyncStatus().then((info) => {
        const superseded = info.lastResult?.supersededNotes ?? [];
        if (superseded.length > 0) setConflictSnapshotNotice(superseded.map((item) => ({ noteId: item.id, title: item.title })));
      }).catch((error) => reportNativeActionError("启动读取", error));
      void native.getSyncPendingSummary().then(setPendingSummary).catch((error) => reportNativeActionError("启动读取", error));
      void native.listDraftJournals().then((entries) => {
        // 启动时不展示已经被删除的文档草稿：删除文档是明确的用户操作，草稿不应绕过回收站重新出现。
        const liveIds = new Set(snapshot.notes.map((note) => note.id));
        const orphaned = entries.filter((entry) => !liveIds.has(entry.noteId));
        setDraftEntries(entries.filter((entry) => liveIds.has(entry.noteId)));
        void Promise.all(orphaned.map((entry) => native.deleteDraftJournal(entry.noteId).catch((error) => reportNativeActionError("删除孤儿草稿", error))));
      }).catch((error) => reportNativeActionError("启动读取", error));
      setTreeNodes(await native.listTreeNodes());
      const id = snapshot.lastOpenedNoteId ?? snapshot.notes[0]?.id;
      if (id) {
        const opened = await openNote(id);
        if (!opened) {
          // lastOpenedNoteId 可能指向已 purge 的旧文档；启动不能停在错误页，
          // 回退到第一个仍存在的文档，若资料库为空则保持空状态。
          setError(null);
          const fallback = snapshot.notes.find((note) => note.id !== id)?.id;
          if (fallback) await openNote(fallback);
        }
      }
    }).catch((reason) => setError(getNativeErrorMessage(reason)));  }, []);
}
