/**
 * 移动端产品壳（Phase 1：替代 MobilePocApp 组装入口，§3.2 结构）。
 * - 路由栈：home（小记/知识库）→ notebook → document（viewer/editor）；Sheet/Drawer 作 overlay。
 * - 数据：直接走 bridge 真实端口（folders CRUD/notes/搜索/同步已就绪），不做 fixture。
 * - 复杂卡片（画板/思维导图/流程图）：viewer 只读渲染（§19.1），编辑入口置灰。
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { bridge, type POCNote, type POCNoteSummary } from "./bridge";
import type { TreeNode } from "../lib/types";
import { HomePage } from "./home/HomePage";
import { NotebookWorkspace } from "./notebook/NotebookWorkspace";
const DocumentPage = lazy(() => import("./document/DocumentPage").then(({ DocumentPage: Page }) => ({ default: Page })));
import { CreateNotebookSheet } from "./settings/CreateNotebookSheet";
import { SearchSheet } from "./settings/SearchSheet";
import { SettingsDrawer } from "./settings/SettingsDrawer";
import { useBackHandler } from "./useBackHandler";
import "./mobile.css";

export type Route =
  | { kind: "home"; tab: "quick" | "library" }
  | { kind: "notebook"; notebookId: string }
  | { kind: "document"; noteId: string; mode: "viewer" | "editor" };

export function MobileApp() {
  const [route, setRoute] = useState<Route>({ kind: "home", tab: "library" });
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [notes, setNotes] = useState<POCNoteSummary[]>([]);
  const [active, setActive] = useState<POCNote | null>(null);
  const [draft, setDraft] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [editing, setEditing] = useState(false);
  const [phase, setPhase] = useState<"booting" | "ready">("booting");
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [createNbOpen, setCreateNbOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickNotes, setQuickNotes] = useState<Array<{ id: string; previewText: string; imageCount: number; updatedAt: string }>>([]);
  // P2-2：文档来源（home 或 notebookId）——返回时回到来源页，而非总是首页
  const [documentOrigin, setDocumentOrigin] = useState<string | null>(null);

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

  useEffect(() => {
    if (!toastMsg) return;
    const t = window.setTimeout(() => setToastMsg(null), 1600);
    return () => window.clearTimeout(t);
  }, [toastMsg]);

  const notebooks = useMemo(() => treeNodes.filter((n) => n.nodeType === "notebook"), [treeNodes]);
  const notebookChildren = useCallback((id: string) => treeNodes.filter((n) => n.parentId === id), [treeNodes]);
  // 当前笔记本文档列表（快捷切换目录：当前来源笔记本下的文档）
  const notebookDocuments = useMemo(() => {
    const nbId = documentOrigin;
    if (!nbId) return [];
    return notes
      .filter((n) => n.parentId === nbId)
      .map((n) => ({ id: n.id, title: n.title }))
      .sort((a, b) => a.title.localeCompare(b.title, "zh"));
  }, [notes, documentOrigin]);

  // 编辑保存（完成按钮/返回键共用）：saveNote 的 ON CONFLICT 同时更新 title+content+sync_state
  const saveEditing = useCallback(async () => {
    if (active && (draftTitle !== active.title || draft !== active.content)) {
      await bridge.saveNote(active.id, draftTitle, draft);
      setActive({ ...active, title: draftTitle, content: draft, updatedAt: new Date().toISOString() });
    }
  }, [active, draft, draftTitle]);

  const backFromDocument = useCallback(() => {
    setEditing(false);
    if (documentOrigin) setRoute({ kind: "notebook", notebookId: documentOrigin });
    else setRoute({ kind: "home", tab: "library" });
  }, [documentOrigin]);

  // B1：Android 返回键（Sheet→Drawer→退出编辑→文档→笔记本→首页→系统）
  const exitEdit = useCallback(() => {
    void saveEditing().then(() => {
      setEditing(false);
      if (active) setRoute({ kind: "document", noteId: active.id, mode: "viewer" });
    });
  }, [saveEditing, active]);
  useBackHandler({
    route,
    editing,
    drawerOpen,
    createNbOpen,
    searchOpen,
    onExitEdit: exitEdit,
    onBackFromDocument: backFromDocument,
    onBackFromNotebook: () => setRoute({ kind: "home", tab: "library" }),
    onCloseDrawer: () => setDrawerOpen(false),
    onCloseSheets: () => { setCreateNbOpen(false); setSearchOpen(false); },
    onAppExit: () => {
      // 首页返回：交给系统退出（@capacitor/app 默认行为）
      void import("@capacitor/app").then(({ App }) => App.exitApp?.()).catch(() => undefined);
    },
  });

  // 新建文档：归属指定父节点（home → 个人笔记本；notebook → 当前笔记本），刷新列表并进入编辑
  const createNoteInParent = useCallback(async (parentId: string | null) => {
    const n = await bridge.createNote("无标题文档", parentId);
    await refreshAll();
    openDocument(n.id, "editor", parentId);
  }, [refreshAll]);

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
          quickNotes={quickNotes}
          onTabChange={(tab) => setRoute({ kind: "home", tab })}
          onOpenNotebook={(id) => setRoute({ kind: "notebook", notebookId: id })}
          onReorderNotebooks={async (orderedIds) => {
            // 根层笔记本重排：单事务更新 sort_order（reorderSiblings），同步后传播
            await bridge.reorderSiblings(null, orderedIds);
            await refreshAll();
            setToastMsg("已调整笔记本顺序（同步后传播）");
          }}
          onOpenNote={(id) => openDocument(id, "viewer")}
          onOpenDrawer={() => setDrawerOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
          onCreateNote={() => void createNoteInParent(null)} // 无默认笔记本：bridge 兜底（存在的笔记本/自动建"未分类"）
          onCreateNotebook={() => setCreateNbOpen(true)}
          onQuickNotesChanged={refreshAll}
        />
      )}
      {route.kind === "notebook" && (
        <NotebookWorkspace
          notebookId={route.notebookId}
          initialNoteId={null}
          onBack={() => setRoute({ kind: "home", tab: "library" })}
        />
      )}
      {route.kind === "document" && active && (
        <Suspense fallback={<div className="poc-center">打开文档中…</div>}>
          <DocumentPage
          note={active}
          content={draft}
          title={draftTitle}
          editing={editing}
          documents={notebookDocuments}
          onOpenDocument={(id) => { void openDocument(id, "viewer", documentOrigin); }}
          onTitleChange={setDraftTitle}
          onContentChange={(c) => setDraft(c)}
          onToggleEdit={async () => {
            if (editing) await saveEditing();
            setEditing((v) => !v);
          }}
          onBack={async () => {
            if (editing) await saveEditing();
            setEditing(false);
            await refreshAll();
            backFromDocument();
          }}
          onDelete={async () => {
            if (active && window.confirm("移入回收站？")) {
              await bridge.trashNote(active.id);
              await refreshAll();
              setRoute({ kind: "home", tab: "library" });
            }
          }}
          />
        </Suspense>
      )}
      <CreateNotebookSheet
        open={createNbOpen}
        onClose={() => setCreateNbOpen(false)}
        onCreate={async (input) => {
          await bridge.createNotebook(input);
          await refreshAll();
          setToastMsg("已新建知识库");
        }}
      />
      <SearchSheet
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenNote={(id) => openDocument(id, "viewer")}
      />
      {toastMsg && <div className="mobile-toast">{toastMsg}</div>}
    </div>
  );

  async function openDocument(id: string, mode: "viewer" | "editor", origin: string | null = null) {
    const n = await bridge.readNote(id);
    if (!n) return;
    setActive(n);
    setDraft(n.content);
    setDraftTitle(n.title);
    setEditing(mode === "editor");
    setDocumentOrigin(origin);
    setRoute({ kind: "document", noteId: id, mode });
  }
}
