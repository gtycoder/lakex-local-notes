import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { native } from "../lib/native";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { reportNativeActionError } from "../lib/nativeErrors";
import type { NoteSummary, S3Settings, SyncPendingSummary, SyncStatus, TreeNode, WorkspaceSnapshot } from "../lib/types";
import type { DraftJournalEntry } from "../lib/types";
import { chooseColdStartNoteId } from "../core/coldStartNote.js";

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
  /** 一次性提示（缺正文文档跳过等；不阻塞启动）。 */
  showNotice: (text: string) => void;
}

/** 启动 bootstrap（从 App.tsx 抽出，逐字搬移）：初始化工作区/同步/S3/草稿/树 → 打开 lastOpenedNoteId（含 fallback）。 */
export function useBootstrap({
  setWorkspace, setNotes, setSync, setCloudEnabled, setS3Settings, setCloudConfigured,
  setConflictSnapshotNotice, setPendingSummary, setDraftEntries, setTreeNodes, setError, openNote, showNotice,
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
      // 冷启动落点：Lake 文档优先、其次多维表（用户 261022 定）——别把首开成本高的表格/画板钉在启动交互上。
      const id = chooseColdStartNoteId(snapshot.notes, snapshot.lastOpenedNoteId);
      if (id) {
        // 手动删过正文文件时不要一启动就弹 ENOENT：跳过缺正文的文档（最多试 8 个候选），
        // 汇总成一次提示；都打不开则保持空态，不停在错误页。
        const recent = snapshot.notes
          .map((note) => note.id)
          .filter((noteId) => noteId !== id)
          .slice(0, 8);
        let opened = false;
        let missing = 0;
        for (const candidate of [id, ...recent]) {
          const isMissing = await native.noteBodyMissing(candidate).catch(() => false);
          if (isMissing) { missing += 1; continue; }
          if (await openNote(candidate)) { opened = true; break; }
        }
        if (!opened) setError(null);
        if (missing > 0) showNotice(`有 ${missing} 篇文档的正文文件缺失，已跳过；可在目录中删除或从历史恢复。`);
      }
    }).catch((reason) => setError(getNativeErrorMessage(reason)));  }, []);
}
