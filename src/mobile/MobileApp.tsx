/**
 * 移动端产品壳（Phase 1：替代 MobilePocApp 组装入口，§3.2 结构）。
 * - 路由栈：home（小记/知识库）→ notebook → document（viewer/editor）；Sheet/Drawer 作 overlay。
 * - 数据：直接走 bridge 真实端口（folders CRUD/notes/搜索/同步已就绪），不做 fixture。
 * - 复杂卡片（画板/思维导图/流程图）：viewer 只读渲染（§19.1），编辑入口置灰。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "./bridge";
import type { POCNoteSummary } from "./noteRepository";
import { isGoneNote } from "../core/syncDecisions";
import type { TreeNode } from "../lib/types";
import { HomePage } from "./home/HomePage";
import { NotebookWorkspace } from "./notebook/NotebookWorkspace";
import { CreateNotebookSheet } from "./settings/CreateNotebookSheet";
import { SearchSheet } from "./settings/SearchSheet";
import { SettingsDrawer } from "./settings/SettingsDrawer";
import { useBackHandler } from "./useBackHandler";
import { Toasts } from "./ui/Toasts";
import { ConfirmHost, confirmMobile } from "./ui/ConfirmDialog";
import { showToast } from "./ui/toastBus";
import "./mobile.css";

export type Route =
  | { kind: "home"; tab: "quick" | "library" }
  | { kind: "notebook"; notebookId: string; initialNoteId?: string | null; initialMode?: "viewer" | "editor" };

export function MobileApp() {
  const [route, setRoute] = useState<Route>({ kind: "home", tab: "library" });
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [notes, setNotes] = useState<POCNoteSummary[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<"booting" | "ready">("booting");
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createNbOpen, setCreateNbOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickNotes, setQuickNotes] = useState<Array<{ id: string; previewText: string; imageCount: number; updatedAt: string; firstImage: string | null }>>([]);

  const refreshAll = useCallback(async () => {
    const [nodes, ns, qn] = await Promise.all([bridge.listTreeNodes(), bridge.listNotes(), bridge.listQuickNotes()]);
    setTreeNodes(nodes);
    setNotes(ns);
    setQuickNotes(qn);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await bridge.init();
        // lakeNative 调试/测试契约（对齐桌面端）：供 CDP 驱动与真机调试直接调用 bridge 端口
        (window as unknown as Record<string, unknown>).lakeNative = {
          uploadResource: (input: { bytes: Uint8Array; filename: string }, noteId: string) =>
            bridge.uploadResource(input, noteId),
          syncNow: () => bridge.syncNow(),
          testS3Connection: () => bridge.testS3Connection(),
          listTreeNodes: () => bridge.listTreeNodes(),
          listNotes: () => bridge.listNotes(),
          listQuickNotes: () => bridge.listQuickNotes(),
          listOrphanAssets: () => bridge.listOrphanAssets(),
          cleanOrphanAssets: () => bridge.cleanOrphanAssets(),
          deleteOrphanAsset: (id: number) => bridge.deleteOrphanAsset(id),
          gcDeepCleanup: () => bridge.gcDeepCleanup(),
          listNoteHistory: (noteId: string) => bridge.listNoteHistory(noteId),
          restoreHistory: (historyId: number) => bridge.restoreHistory(historyId),
          cleanupHistory: () => bridge.cleanupHistory(),
          getHistorySettings: () => bridge.getHistorySettings(),
          getDiagnostics: () => bridge.getDiagnostics(),
          saveHistorySettings: (s: import("./bridge").HistoryMobileSettings) => bridge.saveHistorySettings(s),
          snapshotNote: (id: string) => bridge.snapshotNote(id),
          createQuickNote: (text: string) => bridge.createQuickNote(text),
          deleteQuickNote: (id: string) => bridge.deleteQuickNote(id),
          saveQuickNote: (id: string, text: string) => bridge.saveQuickNote(id, text),
          saveQuickNoteWithImages: (id: string, text: string, images: Array<{ filename: string; mimeType: string; width: number | null; height: number | null; bytes: Uint8Array }>) =>
            bridge.saveQuickNoteWithImages(id, text, images),
          getQuickNoteImage: (id: string, filename: string) => bridge.getQuickNoteImage(id, filename),
          listQuickNoteTrash: () => bridge.listQuickNoteTrash(),
          restoreQuickNote: (id: string) => bridge.restoreQuickNote(id),
          purgeQuickNote: (id: string) => bridge.purgeQuickNote(id),
          listTrashTree: () => bridge.listTrashTree(),
          getS3Settings: () => bridge.getS3Settings(),
          saveS3Settings: (cfg: import("../lib/types").S3Settings) => bridge.saveS3Settings(cfg),
          createNote: (title: string, parentId: string | null) => bridge.createNote(title, parentId),
          saveNote: (id: string, title: string, content: string, parentId: string | null) => bridge.saveNote(id, title, content, parentId),
          trashNote: (id: string) => bridge.trashNote(id),
          restoreNote: (id: string) => bridge.restoreNote(id),
          listTrashed: () => bridge.listTrashed(),
          restoreTreeItem: (id: string, kind: "folder" | "note") => bridge.restoreTreeItem(id, kind),
          purgeTreeItem: (id: string, kind: "folder" | "note") => bridge.purgeTreeItem(id, kind),
          createGroup: (parentId: string, title: string) => bridge.createGroup(parentId, title),
          renameTreeNode: (id: string, title: string) => bridge.renameTreeNode(id, title),
          setNodeIcon: (id: string, icon: string | null) => bridge.setNodeIcon(id, icon),
          reorderSiblings: (parentId: string | null, orderedIds: string[]) => bridge.reorderSiblings(parentId, orderedIds),
          moveTreeNodeOrdered: (id: string, parentId: string | null, orderedIds: string[]) => bridge.moveTreeNodeOrdered(id, parentId, orderedIds),
          createNotebook: (input: { title: string; icon: string | null }) => bridge.createNotebook(input),
          searchNotes: (q: string) => bridge.searchNotes(q),
        };
        await refreshAll();
        setPhase("ready");
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [refreshAll]);

  // 定时自动快照：按历史设置 snapshotIntervalMinutes（0=关）周期给当前打开笔记留档
  // （当前活动文档由工作区经 onActiveNoteChange 上报到 activeIdRef）
  useEffect(() => {
    let timer: number | null = null;
    void bridge.getHistorySettings().then((cfg) => {
      if (cfg.snapshotIntervalMinutes <= 0) return;
      timer = window.setInterval(() => {
        const id = activeIdRef.current;
        if (id) void bridge.snapshotNote(id);
      }, Math.max(1, cfg.snapshotIntervalMinutes) * 60 * 1000);
    });
    return () => { if (timer != null) window.clearInterval(timer); };
  }, []);

  const notebooks = useMemo(() => treeNodes.filter((n) => n.nodeType === "notebook"), [treeNodes]);
  // 笔记本 → 直接文档数（首页列表行 .counter；与 listNotebookTree 的归属口径一致：parent 为笔记本）
  const docCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of notes) { if (n.parentId) m[n.parentId] = (m[n.parentId] ?? 0) + 1; }
    return m;
  }, [notes]);

  // B1：Android 返回键（浮层返回栈 → Sheet→Drawer→笔记本→首页→系统；编辑态由工作区自己注册）
  useBackHandler({
    route,
    drawerOpen,
    createNbOpen,
    searchOpen,
    onBackFromNotebook: () => setRoute({ kind: "home", tab: "library" }),
    onCloseDrawer: () => setDrawerOpen(false),
    onCloseSheets: () => { setCreateNbOpen(false); setSearchOpen(false); },
    onAppExit: () => {
      // 首页返回：交给系统退出（@capacitor/app 默认行为）
      void import("@capacitor/app").then(({ App }) => App.exitApp?.()).catch(() => undefined);
    },
  });

  /** 打开文档：一律进第二层工作区（此前"首页/搜索→DocumentPage、笔记本→NotebookWorkspace"两套壳，形态不一致）。
   *  ① 先按 AGENTS §3 #16 判定"已进回收站/被他端 purge"；② 再向上解析归属笔记本（note 的父可以是 note/group）。 */
  const openNote = useCallback(async (id: string, mode: "viewer" | "editor" = "viewer") => {
    const st = await bridge.noteGoneState(id);
    if (!st) { showToast("文档不存在", { type: "error" }); return; }
    if (isGoneNote({ parentId: st.parentId, syncState: st.syncState })) {
      showToast("该文档已在回收站，请到 设置-回收站 查看", { type: "error" });
      return;
    }
    const parentOfNote = new Map(notes.map((n) => [n.id, n.parentId] as const));
    const nodeById = new Map(treeNodes.map((n) => [n.id, n] as const));
    let cur: string | null = st.parentId;
    let notebookId: string | null = null;
    for (let hops = 0; cur && hops < 64; hops++) {
      const node = nodeById.get(cur);
      if (node) { if (node.nodeType === "notebook") { notebookId = node.id; break; } cur = node.parentId; continue; }
      cur = parentOfNote.get(cur) ?? null;
    }
    if (!notebookId) { showToast("未找到该文档所属笔记本（可在数据体检中修复）", { type: "error" }); return; }
    await refreshAll();
    setRoute({ kind: "notebook", notebookId, initialNoteId: id, initialMode: mode });
  }, [notes, treeNodes, refreshAll]);

  // 新建文档：归属指定父节点（home → 兜底笔记本；工作区 → 当前笔记本），随后进入工作区编辑态
  const createNoteInParent = useCallback(async (parentId: string | null) => {
    const n = await bridge.createNote("无标题文档", parentId);
    await openNote(n.id, "editor");
  }, [openNote]);

  if (phase === "booting") return <div className="poc-center">启动中…（加载 WASM SQLite）</div>;
  if (error) return <div className="poc-center poc-error">{error}</div>;

  return (
    <div className="mobile-app">
      <SettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onRefresh={refreshAll}
      />
      {route.kind === "home" && (
        <HomePage
          tab={route.tab}
          notebooks={notebooks}
          notes={notes}
          quickNotes={quickNotes}
          docCounts={docCounts}
          onTabChange={(tab) => setRoute({ kind: "home", tab })}
          onOpenNotebook={(id) => setRoute({ kind: "notebook", notebookId: id })}
          onOpenNote={(id) => void openNote(id, "viewer")}
          onOpenDrawer={() => setDrawerOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
          onCreateNotebook={() => setCreateNbOpen(true)}
          onQuickNotesChanged={refreshAll}
        />
      )}
      {route.kind === "notebook" && (
        <NotebookWorkspace
          key={route.notebookId}
          notebookId={route.notebookId}
          initialNoteId={route.initialNoteId ?? null}
          initialMode={route.initialMode}
          onBack={() => setRoute({ kind: "home", tab: "library" })}
          notebooks={notebooks}
          onSwitchNotebook={(id) => setRoute({ kind: "notebook", notebookId: id })}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenSettings={() => setDrawerOpen(true)}
          onCreateNote={() => void createNoteInParent(route.notebookId)}
          onActiveNoteChange={(id) => { activeIdRef.current = id; }}
        />
      )}
      <CreateNotebookSheet
        open={createNbOpen}
        onClose={() => setCreateNbOpen(false)}
        onCreate={async (input) => {
          await bridge.createNotebook(input);
          await refreshAll();
          showToast("已新建知识库");
        }}
      />
      <SearchSheet
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenNote={(id) => void openNote(id, "viewer")}
      />
      <Toasts />
      <ConfirmHost />
    </div>
  );

}
