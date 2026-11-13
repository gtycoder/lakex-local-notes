import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { native } from "../lib/native";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { reportNativeActionError } from "../lib/nativeErrors";
import type { NoteSummary, S3Settings, SyncPendingSummary, SyncStatus, TreeNode, WorkspaceSnapshot } from "../lib/types";
import type { DraftJournalEntry } from "../lib/types";
import { isDiaryEntryNode } from "../core/diary.js";
import { loadSettings } from "../lib/settings";
import { clearTabSession, readTabSession, restoreTabSessionForLimit, sanitizeTabSession } from "../desktop/tabSession";
import { prefetchEditorKernelNow } from "../features/editor/kernelPrefetch";
import { readSafeModeStatus } from "./useSafeModeStatus";

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
  /**
   * 批量恢复上次标签（DT-15，= useTabLifecycle.restoreTabs）：有界并发读 + 一次 setOpenTabs。
   * 缺省（未注入）时退回逐篇 openNote 的旧行为。
   */
  restoreTabs?: (ids: string[], activeId: string | null) => Promise<number>;
}

/** 启动 bootstrap（从 App.tsx 抽出）：初始化工作区/同步/S3/草稿/树 → 恢复上次标签；**没有标签就保持空态**（261114 用户裁决，不再冷启动硬开文档）。 */
export function useBootstrap({
  setWorkspace, setNotes, setSync, setCloudEnabled, setS3Settings, setCloudConfigured,
  setConflictSnapshotNotice, setPendingSummary, setDraftEntries, setTreeNodes, setError, openNote, restoreTabs,
}: UseBootstrapOptions) {
  useEffect(() => {
    // 标签会话必须在任何异步/渲染落盘之前同步读走：App 的会话写入 effect 可能在恢复完成前先把 [] 写回去。
    const settings = loadSettings();
    const clearOnExit = settings.clearTabsOnExit === true;
    const savedSession = clearOnExit ? null : readTabSession();
    // 清会话与恢复标签**共用同一判据**（P2-C）：只有 inactive 才按原逻辑走；
    // unknown（IPC 失败）与 active（安全模式）都既不恢复也不清（见下方 await readSafeModeStatus()）。
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
      const treeNodes = await native.listTreeNodes();
      setTreeNodes(treeNodes);
      // 恢复上次打开的标签（261027）：先过滤已删除/已 purge 的文档，再按 maxOpenTabs 截断（DT-15：
      // 会话按打开顺序存，只恢复最近 N 个——先全开再逐次淘汰会静默丢标签且线性拉长首屏）。
      // P2-C：判据收敛到 readSafeModeStatus（fail-closed）——
      //   inactive ⇒ 原逻辑（clearTabsOnExit ? 清档 : 恢复标签）；
      //   active / unknown ⇒ **既不恢复也不清**（会话保留，等下次正常启动；不清是防止把用户原会话抹掉）。
      const safeModeStatus = await readSafeModeStatus();
      if (safeModeStatus === "inactive" && clearOnExit) clearTabSession();
      const liveIds = new Set(snapshot.notes.map((note) => note.id));
      const sanitized = savedSession && safeModeStatus === "inactive" ? sanitizeTabSession(savedSession, liveIds) : null;
      // 261110 用户定稿：**日记空间的 tab 不自动恢复**（旧会话可能还存着日记 id ⇒ 这里按目录判据再滤一次）。
      const restored = sanitized
        ? (() => {
          const ids = sanitized.ids.filter((id) => !isDiaryEntryNode(treeNodes, id));
          if (ids.length === 0) return null;
          const activeId = sanitized.activeId && ids.includes(sanitized.activeId) ? sanitized.activeId : ids[ids.length - 1];
          return { ids, activeId };
        })()
        : null;
      const planned = restored ? restoreTabSessionForLimit(restored, settings.maxOpenTabs) : null;
      if (planned) {
        // 261111：恢复标签 = 本次启动必然要挂 EditorTab ⇒ 在恢复流程一开始就与正文读取并行预取内核 chunk。
        prefetchEditorKernelNow();
        if (restoreTabs) {
          // 一次 setOpenTabs 恢复整批（有界并发读正文）。
          const opened = await restoreTabs(planned.ids, planned.activeId);
          if (opened > 0) return;
        } else {
          // 兼容未注入 restoreTabs 的调用方：逐篇打开（旧行为）。
          let opened = 0;
          for (const id of planned.ids) { if (await openNote(id)) opened += 1; }
          if (opened > 0) {
            if (planned.activeId) await openNote(planned.activeId);
            return;
          }
        }
      }
      // 261114 用户裁决：**没有可恢复的标签就保持空态，不硬开一篇文档**（原「冷启动落点」= lastOpenedNoteId /
      // 最近更新文档 / 多维表兜底，已删除）。理由：① 启动不该替用户决定看哪篇；② 落点判断在回收站/孤儿行/
      // 缺正文等边界上很容易打开一篇「不该打开」的文档（261113 现场）；③ 首篇编辑器 chunk 预热按需进行。
    }).catch((reason) => setError(getNativeErrorMessage(reason)));  }, []);
}
