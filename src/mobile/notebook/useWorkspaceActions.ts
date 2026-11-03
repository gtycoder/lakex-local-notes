import { useCallback } from "react";
import { FolderOpen, History, Info, Move, Pencil, SmilePlus, Star, Trash } from "lucide-react";
import { bridge } from "../bridge";
import { isFavorite, toggleFavorite } from "../data/favorites";
import { showToast } from "../ui/toastBus";
import type { MobileSheetItem } from "../ui/MobileSheetMenu";
import type { NotebookTreeItem } from "./useNotebookTreeData";
import type { WorkspaceOverlay, WorkspaceOverlayKind } from "./useWorkspaceOverlays";

/**
 * 工作区「目录动作与菜单组装」逻辑（261103 P11-②，原 NotebookWorkspace 内联代码逐字搬移，未改行为）：
 * 行菜单 items/onSelect、历史版本面板、新建文档/分组、新建清单分发、标签/笔记本/图标/属性等父子回调。
 * 没有 effect（纯回调；调用点不影响 effect 顺序），入参全部显式注入。
 */
export interface UseWorkspaceActionsOptions {
  tree: NotebookTreeItem[];
  title: string;
  notebookId: string;
  padTwoPane: boolean;
  /** 目录「新建」建到哪个节点下（overlay create 载荷）。 */
  createParent: string;
  /** 行菜单针对的节点（overlay menu 载荷）。 */
  menuFor: NotebookTreeItem | null;
  itemById: (id: string) => NotebookTreeItem | undefined;
  openOverlay: (overlay: WorkspaceOverlay) => void;
  closeOverlay: (kind: WorkspaceOverlayKind) => void;
  setRenamingId: (id: string | null) => void;
  setRenameValue: (value: string) => void;
  applyMove: (node: NotebookTreeItem, targetParentId: string) => Promise<void>;
  applyDelete: (node: NotebookTreeItem) => Promise<void>;
  applyIcon: (node: NotebookTreeItem, icon: string | null) => Promise<string | null>;
  loadHistory: (node: NotebookTreeItem) => Promise<void>;
  restoreHistoryVersion: (historyId: number) => Promise<boolean>;
  openTab: (id: string, options?: { enterEditor?: boolean }) => Promise<void>;
  loadTree: () => Promise<NotebookTreeItem[]>;
  switchNotebook: (id: string) => Promise<void>;
  expandGroup: (id: string) => void;
}

/** 「新建」清单 id → 文档 kind（清单与创建通道的唯一对应表；group 不走这里）。 */
const CREATE_MENU_KINDS: Record<string, "doc" | "usheet" | "bitable" | "board" | "ink"> = {
  note: "doc",
  usheet: "usheet",
  bitable: "bitable",
  board: "board",
  ink: "ink",
};

export function useWorkspaceActions(options: UseWorkspaceActionsOptions) {
  const {
    tree,
    title,
    notebookId,
    padTwoPane,
    createParent,
    menuFor,
    itemById,
    openOverlay,
    closeOverlay,
    setRenamingId,
    setRenameValue,
    applyMove,
    applyDelete,
    applyIcon,
    loadHistory,
    restoreHistoryVersion,
    openTab,
    loadTree,
    switchNotebook,
    expandGroup,
  } = options;

  /** 历史版本面板 =「开面板」（overlay owner）+「读快照」（actions）两步；节点由调用方传，不在 hook 里存。 */
  const openHistorySheet = useCallback((node: NotebookTreeItem) => {
    openOverlay({ kind: "history", node });
    void loadHistory(node);
  }, [loadHistory, openOverlay]);

  /** 恢复历史版本：真的成功才收面板（失败保留面板让用户重试）。 */
  const applyRestoreHistory = useCallback(async (historyId: number) => {
    if (await restoreHistoryVersion(historyId)) closeOverlay("history");
  }, [closeOverlay, restoreHistoryVersion]);

  /**
   * 行内 ＋ / 抽屉「新建」→ 建子节点（同一条创建管线：建库 → 刷新目录 → 收抽屉 → 打开标签）。
   * 文档/手写板建完停在阅读态；表格/数据表/画板建完直接进编辑态。
   * createParent 理论上总是当前节点；空串兜底回当前笔记本，避免建出 parent_id="" 的孤儿。
   */
  const createChildDocument = useCallback(async (kind: "doc" | "usheet" | "bitable" | "board" | "ink", parentId: string) => {
    try {
      const pid = parentId || notebookId;
      const n = kind === "doc" ? await bridge.createNote("无标题文档", pid)
        : kind === "usheet" ? await bridge.createUsheet("无标题表格", pid)
          : kind === "bitable" ? await bridge.createBitable("无标题多维表", pid)
            : kind === "board" ? await bridge.createBoard("无标题画板", pid)
              : await bridge.createInk("无标题手写板", pid);
      await loadTree();
      closeOverlay("sidebar");
      // 手写板沿用 remote ink 批的行为：建完停在阅读态（与文档一致），需要时再点顶栏「编辑」
      await openTab(n.id, { enterEditor: kind === "usheet" || kind === "bitable" || kind === "board" });
    } catch { showToast("新建失败", { type: "error" }); }
  }, [closeOverlay, loadTree, openTab, notebookId]);

  /** 行内 ＋ → 新建分组：在该节点下建子分组并展开父节点。 */
  const createChildGroup = useCallback(async (parentId: string) => {
    try {
      await bridge.createGroup(parentId || notebookId, "新建分组");
      await loadTree();
      expandGroup(parentId || notebookId);
    } catch { showToast("新建失败", { type: "error" }); }
  }, [loadTree, notebookId]);

  /** 目录树长按菜单（思源 .b3-menu--sheet 口径）：移动到… 用子层下钻，删除走危险项 + 确认框 */
  const treeMenuItems = (node: NotebookTreeItem): MobileSheetItem[] => {
    const groups = tree.filter((x) => x.kind === "group" && x.id !== node.id);
    return [
      // 261019 用户点单：**菜单里不再放「新建文档 / 新建分组」** —— 行内 ＋（新建子项）与抽屉工具栏「新建」
      // 已经提供同一份创建清单，菜单只保留「对这一行本身的动作」，不再重复创建入口。
      ...(node.kind === "note" ? [
        { id: "rename", label: "重命名", icon: Pencil },
      ] : [{ id: "rename", label: "重命名", icon: Pencil }]),
      { id: "icon", label: "设置图标", icon: SmilePlus },
      // 「常用」：只对文档开放（分组/笔记本没有卡片入口）；仅本机，不同步（用户 261019 点单）
      ...(node.kind === "note" ? [
        { id: "favorite", label: isFavorite(node.id) ? "取消常用" : "设为常用", icon: Star },
      ] : []),
      {
        id: "move", label: "移动到…", icon: Move,
        children: [
          { id: "__root", label: title, icon: FolderOpen, note: "笔记本根目录" },
          ...groups.map((g) => ({ id: g.id, label: g.title, icon: FolderOpen })),
        ],
      },
      ...(node.kind === "note" ? [
        { id: "history", label: "历史版本", icon: History },
        { id: "info", label: "属性", icon: Info },
      ] : []),
      { id: "delete", label: node.kind === "note" ? "移入回收站" : "删除分组", icon: Trash, danger: true },
    ];
  };
  // 菜单是针对 menuFor 这个节点打开的（sheet 传进来的 item 就是它的根项），所以直接读 menuFor
  const onTreeMenuSelect = (_item: MobileSheetItem, path: MobileSheetItem[]) => {
    const node = menuFor;
    closeOverlay("menu");
    if (!node) return;
    const root = path[0]?.id;
    if (root === "move") { void applyMove(node, path[1]?.id === "__root" ? notebookId : String(path[1]?.id)); return; }
    // 互斥（MOB-02）：开行菜单时目录抽屉已经被收掉；重命名是**行内编辑**，必须把抽屉重新拉出来，
    // 否则输入框在关着的抽屉里（看不见的输入框 + autoFocus 抢焦点）。
    if (root === "rename") { if (!padTwoPane) openOverlay({ kind: "sidebar" }); setRenamingId(node.id); setRenameValue(node.title); return; }
    if (root === "icon") { openOverlay({ kind: "icon", node }); return; }
    if (root === "favorite") { const on = toggleFavorite(node.id); showToast(on ? "已设为常用" : "已取消常用"); return; }
    if (root === "history") { openHistorySheet(node); return; }
    if (root === "info") { openOverlay({ kind: "info", node }); return; }
    if (root === "delete") { void applyDelete(node); }
  };

  // ---- P9-5b 浮层/面板接线（原为 NotebookWorkspace 内联箭头）----
  const tabIconOf = useCallback((id: string) => itemById(id)?.icon ?? null, [itemById]);
  const selectCreateItem = useCallback((it: MobileSheetItem) => {
    closeOverlay("create");
    // 复用目录树的同一份创建通道（行内 ＋ / 抽屉「新建」同源），不新造第二条；作用域 = 本次打开它的那个节点
    const kind = CREATE_MENU_KINDS[it.id];
    if (kind) void createChildDocument(kind, createParent);
    else if (it.id === "group") void createChildGroup(createParent);
  }, [closeOverlay, createChildDocument, createChildGroup, createParent]);
  const handleOpenTabFromList = useCallback((id: string) => {
    void openTab(id);
    closeOverlay("tabs");
  }, [closeOverlay, openTab]);
  const handleSwitchNotebookItem = useCallback((it: MobileSheetItem) => {
    closeOverlay("notebookSwitch");
    if (it.id !== notebookId) void switchNotebook(it.id);
  }, [closeOverlay, notebookId, switchNotebook]);
  const handlePickIcon = useCallback((target: NotebookTreeItem, icon: string | null) => {
    void applyIcon(target, icon).then((next) => {
      // 面板开着时把选中的图标同步回 overlay 的载荷（否则 picker 仍显示旧值）
      if (next !== null) openOverlay({ kind: "icon", node: { ...target, icon: next } });
    });
  }, [applyIcon, openOverlay]);
  const openHistoryFromInfo = useCallback((node: NotebookTreeItem) => {
    closeOverlay("info");
    openHistorySheet(node);
  }, [closeOverlay, openHistorySheet]);

  return {
    openHistorySheet,
    applyRestoreHistory,
    createChildDocument,
    createChildGroup,
    treeMenuItems,
    onTreeMenuSelect,
    tabIconOf,
    selectCreateItem,
    handleOpenTabFromList,
    handleSwitchNotebookItem,
    handlePickIcon,
    openHistoryFromInfo,
  };
}
