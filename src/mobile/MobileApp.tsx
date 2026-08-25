/**
 * 移动端产品壳（Phase 1：替代 MobilePocApp 组装入口，§3.2 结构）。
 * - 路由栈：home（小记/知识库）→ notebook → document（viewer/editor）；Sheet/Drawer 作 overlay。
 * - 数据：直接走 bridge 真实端口（folders CRUD/notes/搜索/同步已就绪），不做 fixture。
 * - 复杂卡片（画板/思维导图/流程图）：viewer 只读渲染（§19.1），编辑入口置灰。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { bridge, type POCNote } from "./bridge";
import type { TreeNode } from "../lib/types";
import { HomePage } from "./home/HomePage";
import { NotebookPage } from "./notebook/NotebookPage";
import { DocumentPage } from "./document/DocumentPage";
import { CreateNotebookSheet } from "./settings/CreateNotebookSheet";
import { SearchSheet } from "./settings/SearchSheet";
import { SettingsDrawer } from "./settings/SettingsDrawer";
import { useBackHandler } from "./useBackHandler";
import { TrashPage } from "./trash/TrashPage";
import "lakex-editor-react-component/style.css";
import "./mobile.css";

export type Route =
  | { kind: "home"; tab: "quick" | "library" }
  | { kind: "notebook"; notebookId: string }
  | { kind: "document"; noteId: string; mode: "viewer" | "editor" }
  | { kind: "trash" };

export function MobileApp() {
  const [route, setRoute] = useState<Route>({ kind: "home", tab: "library" });
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [notes, setNotes] = useState<POCNote[]>([]);
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
        (window as unknown as Record<string, unknown>).lakeNative = {
          uploadResource: (input: { bytes: number[]; filename: string }, noteId: string) =>
            bridge.uploadResource(input, noteId),
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

  // 编辑保存（完成按钮/返回键共用）：saveNote 的 ON CONFLICT 同时更新 title+content+sync_state
  const saveEditing = useCallback(async () => {
    if (active && (draftTitle !== active.title || draft !== active.content)) {
      await bridge.saveNote(active.id, draftTitle, draft);
      setActive({ ...active, title: draftTitle, content: draft, updatedAt: new Date().toISOString() });
    }
  }, [active, draft, draftTitle]);

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
    onBackFromDocument: () => setRoute({ kind: "home", tab: "library" }),
    onBackFromNotebook: () => setRoute({ kind: "home", tab: "library" }),
    onBackFromTrash: () => setRoute({ kind: "home", tab: "library" }),
    onCloseDrawer: () => setDrawerOpen(false),
    onCloseSheets: () => { setCreateNbOpen(false); setSearchOpen(false); },
    onAppExit: () => {
      // 首页返回：交给系统退出（@capacitor/app 默认行为）
      void import("@capacitor/app").then(({ App }) => App.exitApp?.()).catch(() => undefined);
    },
  });

  if (phase === "booting") return <div className="poc-center">启动中…（加载 WASM SQLite）</div>;
  if (error) return <div className="poc-center poc-error">{error}</div>;

  return (
    <div className="mobile-app">
      <SettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onRefresh={refreshAll}
        onOpenTrash={() => { setDrawerOpen(false); setRoute({ kind: "trash" }); }}
      />
      {route.kind === "home" && (
        <HomePage
          tab={route.tab}
          notebooks={notebooks}
          quickNotes={quickNotes}
          onCreateQuickNote={async (text) => {
            await bridge.createQuickNote(text);
            await refreshAll();
            setToastMsg("已新建小记");
          }}
          onTabChange={(tab) => setRoute({ kind: "home", tab })}
          onOpenNotebook={(id) => setRoute({ kind: "notebook", notebookId: id })}
          onOpenNote={(id) => openDocument(id, "viewer")}
          onOpenDrawer={() => setDrawerOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
          onCreateNote={async () => {
            const n = await bridge.createNote("无标题文档");
            await refreshAll();
            openDocument(n.id, "editor");
          }}
          onCreateNotebook={() => setCreateNbOpen(true)}
        />
      )}
      {route.kind === "notebook" && (
        <NotebookPage
          notebookId={route.notebookId}
          onBack={() => setRoute({ kind: "home", tab: "library" })}
          onOpenNote={(id) => openDocument(id, "viewer")}
          onCreateNote={async () => {
            const n = await bridge.createNote("无标题文档", route.notebookId);
            await refreshAll();
            openDocument(n.id, "editor");
          }}
        />
      )}
      {route.kind === "trash" && (
        <TrashPage
          onBack={() => setRoute({ kind: "home", tab: "library" })}
          onChanged={refreshAll}
        />
      )}
      {route.kind === "document" && active && (
        <DocumentPage
          note={active}
          content={draft}
          title={draftTitle}
          editing={editing}
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
            setRoute({ kind: "home", tab: "library" });
          }}
          onDelete={async () => {
            if (active && window.confirm("移入回收站？")) {
              await bridge.trashNote(active.id);
              await refreshAll();
              setRoute({ kind: "home", tab: "library" });
            }
          }}
        />
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

  async function openDocument(id: string, mode: "viewer" | "editor") {
    const n = await bridge.readNote(id);
    if (!n) return;
    setActive(n);
    setDraft(n.content);
    setDraftTitle(n.title);
    setEditing(mode === "editor");
    setRoute({ kind: "document", noteId: id, mode });
  }
}
