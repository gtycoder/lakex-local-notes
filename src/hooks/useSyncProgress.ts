import { useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { isDesktop, native } from "../lib/native";
import { reportNativeActionError } from "../lib/nativeErrors";
import { planTabReload } from "../core/planTabReload";
import { createRequestVersion } from "../core/requestVersion";
import type { NoteDigest, NoteSummary, SyncStatus, TreeNode } from "../lib/types";
import type { NoticeState, OpenTab } from "../desktop/desktopTypes";
import type { QuickNotesWorkspaceHandle } from "../components/app/QuickNotesWorkspace";

export interface UseSyncProgressOptions {
  setSync: Dispatch<SetStateAction<SyncStatus>>;
  setCloudEnabled: Dispatch<SetStateAction<boolean>>;
  setNotes: Dispatch<SetStateAction<NoteSummary[]>>;
  setTreeNodes: Dispatch<SetStateAction<TreeNode[]>>;
  setOpenTabs: Dispatch<SetStateAction<OpenTab[]>>;
  setConflictSnapshotNotice: Dispatch<SetStateAction<Array<{ noteId: string; title: string }>>>;
  setHistoryNoteId: Dispatch<SetStateAction<string | null>>;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  setNotice: Dispatch<SetStateAction<NoticeState | null>>;
  setTrashOpen: Dispatch<SetStateAction<boolean>>;
  showNoticeWithAction: (text: string, action: NoticeState["action"]) => void;
  quickNotesRef: MutableRefObject<QuickNotesWorkspaceHandle | null>;
  openTabsRef: MutableRefObject<OpenTab[]>;
}

/** 同步进度 → 状态/冲突合并/tab 重载/删除标记/合并提示（从 App.tsx onSyncProgress 抽出，逐字搬移）。 */
export function useSyncProgress({
  setSync, setCloudEnabled, setNotes, setTreeNodes, setOpenTabs,
  setConflictSnapshotNotice, setHistoryNoteId, setHistoryOpen, setNotice, setTrashOpen,
  showNoticeWithAction, quickNotesRef, openTabsRef,
}: UseSyncProgressOptions) {
  // 审计 F03：全库同步是一整轮任务，用它自己的 run id 取消——不再与"按文档 reload"共用一个 guard。
  const syncRunRef = useRef(createRequestVersion());
  useEffect(() => {
    if (!isDesktop()) return;
    // 首拉/大库的渐进展示（261026）：引擎按块把正文/行落库，列表也要跟着长出来，
    // 否则要等整轮结束才看得到文档。节流 2.5s，done 分支仍走下面完整刷新。
    let lastProgressiveRefreshAt = 0;
    const refreshListsProgressively = () => {
      const now = Date.now();
      if (now - lastProgressiveRefreshAt < 2500) return;
      lastProgressiveRefreshAt = now;
      void native.listNoteSummaries().then((items) => setNotes(items)).catch(() => undefined);
      void native.listTreeNodes().then(setTreeNodes).catch(() => undefined);
      void quickNotesRef.current?.refresh();
    };
    return native.onSyncProgress((progress) => {
      const message = progress.message || (progress.phase === "done" ? "同步完成" : "同步中...");
      setSync((current) => ({ ...current, phase: progress.error ? "error" : progress.phase === "done" ? "success" : "syncing", message }));
      if (progress.phase !== "done" && !progress.error) refreshListsProgressively();
      if (progress.phase === "done" && !progress.error) {
        void native.getSyncStatus().then((status) => {
          setSync((current) => ({ ...current, phase: "success", message: "同步完成", lastSyncedAt: status.lastSyncedAt, pendingChanges: 0 }));
        }).catch((error) => reportNativeActionError("同步后刷新", error));
        void native.getSyncSettings().then((cfg) => setCloudEnabled(cfg.enabled)).catch((error) => reportNativeActionError("同步后刷新", error));
        // 锁状态等元数据可能随同步变化，刷新摘要与树
        void native.listNoteSummaries().then((items) => setNotes(items)).catch((error) => reportNativeActionError("同步后刷新", error));
        void native.listTreeNodes().then(setTreeNodes).catch((error) => reportNativeActionError("同步后刷新", error));
        void quickNotesRef.current?.refresh();
        // 同步下载会更新磁盘上的 .lake；已打开且无本地未保存修改的 tab 需要重载正文，
        // 否则用户看不到另一端的最新内容（P0：自动同步后打开文档不刷新）。
        // 若本地改动被远端覆盖（已存历史），即使 tab 是 dirty 也要强制重载为远端内容。
        // 优化：先做轻量 digest 比对（只读 DB 行、不读正文文件），未变化的 tab 跳过全量
        // readNote，避免每次同步都把所有打开文档重新读盘（历史快照恢复后上传卡顿的诱因之一）。
        const supersededList = progress.supersededNotes ?? [];
        if (supersededList.length > 0) {
          // 留档提示不自动消失（原 12s 定时器已删）：用户想回看时随时悬停云按钮可见。
          // 合并去重（本会话累计，上限 10 条），重启后从 lastResult 恢复（见 bootstrap）。
          setConflictSnapshotNotice((prev) => {
            const seen = new Set(prev.map((p) => p.noteId));
            const merged = [...prev];
            for (const item of supersededList) {
              if (seen.has(item.id)) continue;
              seen.add(item.id);
              merged.push({ noteId: item.id, title: item.title });
            }
            return merged.slice(-10);
          });
        }
        const supersededIds = new Set(supersededList.map((n) => n.id));
        // 渲染进程日志经主进程 console-message 转发落盘；[sync-tab] 前缀便于 grep。
        const tabRefreshStart = performance.now();
        const reloadVersion = syncRunRef.current.next();
        const tabsAtSync = openTabsRef.current.slice();
        console.log("[sync-tab] refresh start", JSON.stringify({ open: tabsAtSync.length, superseded: supersededList.length }));
        void (async () => {
          const deletedIds: string[] = [];
          let reloaded = 0;
          let skipped = 0;
          for (const tab of tabsAtSync) {
            if (!syncRunRef.current.isCurrent(reloadVersion)) return;
            const superseded = supersededIds.has(tab.noteId);
            if (!superseded && tab.dirty) { skipped += 1; continue; }
            const tabT0 = performance.now();
            let digest: NoteDigest | null = null;
            try { digest = await native.getNoteDigest(tab.noteId); } catch { continue; }
            if (!syncRunRef.current.isCurrent(reloadVersion)) return;
            const digestMs = Math.round(performance.now() - tabT0);
            // 远端已删除（软删/墓碑/purge）：标记 tab 提示用户，保留正文供复制/从回收站恢复。
            // 前置检查同时让 TS 收窄 digest 非空（reload 分支无需非空断言）。
            if (!digest || digest.deleted) {
              deletedIds.push(tab.noteId);
              console.log("[sync-tab] tab", JSON.stringify({ noteId: tab.noteId, action: "deleted", digestMs, superseded }));
              continue;
            }
            // V5 Phase 4：digest 阶段决策收敛到纯函数 planTabReload（unchanged-skip / reload）。
            const plan = planTabReload({
              digest,
              lastDigest: tab.lastDigest ?? null,
              tabDirty: tab.dirty,
              superseded,
            });
            // deleted 分支由上方前置检查处理（digest 非空非 deleted 时 plan 不返回 deleted），此处兜底防御。
            if (plan.action === "deleted") continue;
            if (plan.action === "skip") {
              skipped += 1;
              console.log("[sync-tab] tab", JSON.stringify({ noteId: tab.noteId, action: plan.reason === "dirty-pending" ? "skip-dirty" : "skip-unchanged", digestMs }));
              continue; // 正文/元数据未变化，无需重载
            }
            try {
              const readT0 = performance.now();
              const fresh = await native.readNote(tab.noteId);
              if (!syncRunRef.current.isCurrent(reloadVersion)) return;
              const readMs = Math.round(performance.now() - readT0);
              // 正文或标题任一变化才重载（标题变化不重建 Lake 实例，只更新标签文案）。
              if (fresh && (superseded || fresh.content !== tab.content || fresh.title !== tab.title)) {
                // W-3：tabsAtSync 是同步开始时的快照，异步期间用户可能已开始输入——
                // 快照时 clean 的 tab 现在变 dirty（或 content 与快照不一致，含已落盘的防抖保存）。
                // 此时重载会覆盖正在输入/刚保存的正文（reloadKey remount 清 contentCache）。
                // superseded 例外：远端已覆盖且引擎已留档历史快照，按设计强制重载。
                const liveTab = openTabsRef.current.find((t) => t.noteId === tab.noteId);
                if (!superseded && liveTab && (liveTab.dirty || liveTab.content !== tab.content)) {
                  skipped += 1;
                  console.log("[sync-tab] tab", JSON.stringify({ noteId: tab.noteId, action: "skip-edited-during-sync", digestMs, readMs }));
                  continue;
                }
                reloaded += 1;
                console.log("[sync-tab] tab", JSON.stringify({ noteId: tab.noteId, action: superseded ? "reload-superseded" : "reload", digestMs, readMs, title: fresh.title }));
                setOpenTabs((tabs) => tabs.map((t) => t.noteId === tab.noteId
                  ? { ...t, title: fresh.title, content: fresh.content, dirty: false, reloadKey: (t.reloadKey ?? 0) + 1, lastDigest: { title: digest.title, updatedAt: digest.updatedAt } }
                  : t));
              } else {
                skipped += 1;
                console.log("[sync-tab] tab", JSON.stringify({ noteId: tab.noteId, action: "skip-content-equal", digestMs, readMs }));
              }
            } catch { /* 读取失败（已删除等）则跳过 */ }
          }
          if (!syncRunRef.current.isCurrent(reloadVersion)) return;
          console.log("[sync-tab] refresh done", JSON.stringify({ totalMs: Math.round(performance.now() - tabRefreshStart), open: openTabsRef.current.length, reloaded, deleted: deletedIds.length, skipped }));
          if (deletedIds.length > 0) {
            const deletedSet = new Set(deletedIds);
            setOpenTabs((tabs) => tabs.map((t) => deletedSet.has(t.noteId) ? { ...t, deleted: true } : t));
          }
          // 合并提示：冲突覆盖 → 点击查看历史；仅远端删除 → 点击查看回收站。
          if (supersededList.length > 0 || deletedIds.length > 0) {
            const parts: string[] = [];
            if (supersededList.length > 0) parts.push(`远端修改已覆盖本地 ${supersededList.length} 篇（已存历史）`);
            if (deletedIds.length > 0) parts.push(`${deletedIds.length} 个打开的文档已被删除（已移入回收站）`);
            const action: NoticeState["action"] = supersededList.length > 0
              ? { label: "查看历史", onClick: () => { setHistoryNoteId(supersededList[0].id); setHistoryOpen(true); setNotice(null); } }
              : { label: "查看回收站", onClick: () => { setTrashOpen(true); setNotice(null); } };
            showNoticeWithAction(parts.join("；"), action);
          }
        })();
      }
    });  }, []);
}
