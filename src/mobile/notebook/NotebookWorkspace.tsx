/**
 * 第二层工作区（精仿思源移动端）：点笔记本进入 → 文档层(main) + 底部胶囊栏 + 左目录抽屉 + 右大纲抽屉 + 全屏tab列表。
 * 参考 siyuan-master app/src/mobile/dock/MobileFiles.ts / MobileOutline.ts / MobileTabs.ts，
 * 骨架 .mobile-topbar/.mobile-bottom-bar/.side-panel(.side-panel--right)/.side-mask/.model。
 * 多 tab 的「顶部 tab 条」是桌面版；移动端是底部胶囊栏 #toolbarTabs 弹全屏列表（子代理已核对源码）。
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import { Book } from "lucide-react";
import { MobileNodeIconGlyph } from "../ui/NodeIconGlyph";
import { bridge } from "../bridge";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { showToast } from "../ui/toastBus";
import { useNotebookTabs } from "./useNotebookTabs";
import { useNotebookTreeData } from "./useNotebookTreeData";
import { useNotebookTreeActions } from "./useNotebookTreeActions";
import { isTreeVisibleForOverlay, useWorkspaceOverlays } from "./useWorkspaceOverlays";
import { NotebookTreeList } from "./NotebookTreeList";
import { useFormFactor } from "../pad/useFormFactor";
import { WorkspaceCapsule } from "./WorkspaceCapsule";
import { WorkspaceTopBar } from "./WorkspaceTopBar";
import { WorkspaceOutlinePanel, WorkspaceTreePanel } from "./WorkspacePanels";
import { NotePaneHost } from "./NotePaneHost";
import { WorkspaceOverlayHost } from "./WorkspaceOverlayHost";
import { WorkspaceDrawers } from "./WorkspaceDrawers";
import {
  createPadShellState,
  isPadDocked,
  isPadPanelOpen,
  isPadPanelPinned,
  padEscapeTarget,
  padPinnedPrefs,
  padShellReducer,
} from "./shellModel";
import { readPadPanelPrefs, writePadPanelPrefs } from "../pad/padPanelPrefs";
import { usePadShortcuts } from "../pad/usePadShortcuts";
import { useTreeDrag } from "./useTreeDrag";
import { useWorkspaceChrome } from "./useWorkspaceChrome";
import { useWorkspaceSession } from "./useWorkspaceSession";
import { useWorkspaceAssemble } from "./useWorkspaceAssemble";
import { useWorkspaceSync } from "./useWorkspaceSync";
import { useWorkspaceActions } from "./useWorkspaceActions";
import { useTreeSelection } from "./useTreeSelection";
import { isTreeRowSelectable } from "./treeSelection";
import { MoveTargetTreeSheet } from "../ui/MoveTargetTreeSheet";
import { BatchTagPickerSheet } from "../ui/BatchTagPickerSheet";
import { NameSheet } from "../ui/NameSheet";
import { claimMissingBodyNotice, MISSING_DOC_OPEN_HINT } from "../data/missingBodyMessages";
export type { NotebookTreeItem } from "./useNotebookTreeData";
export type { PadPanelMode } from "./shellModel";
import type { TreeNode } from "../../lib/types";
import { mobileAccentVars } from "../../core/mobileAccent";
import { toastActionError } from "../lib/actionError";

/** 缺正文提示去重（模块级 = 整个 App 会话；每篇只提示一次，连点不刷屏）。 */
const missingBodyNotifiedThisSession = new Set<string>();

export interface NotebookWorkspaceProps {
  notebookId: string;
  initialNoteId?: string | null;
  /** 打开时直接进入编辑态（首页/搜索"新建文档"用） */
  initialMode?: "viewer" | "editor";
  onBack: () => void;
  /** 全部笔记本（切换笔记本用） */
  notebooks: TreeNode[];
  /** 切换到另一个笔记本 */
  onSwitchNotebook: (id: string) => void;

  /** 当前活动文档变化（MobileApp 的定时快照要用） */
  onActiveNoteChange?: (id: string | null) => void;
  /** Android 硬件返回键必须走工作区自己的可等待保存流程，不能由父层直接卸载。 */
  onRegisterBackHandler?: (handler: (() => Promise<void>) | null) => void;
}

export function NotebookWorkspace(props: NotebookWorkspaceProps) {
  const { notebookId, initialNoteId, initialMode, onBack, notebooks, onSwitchNotebook, onActiveNoteChange, onRegisterBackHandler } = props;
  const {
    tree,
    setTree,
    title,
    notebookIcon: nbIcon,
    expanded,
    toggleGroup,
    expandGroup,
    childrenOf,
    itemById,
    visibleRows,
    firstNote,
    loadTree,
  } = useNotebookTreeData(notebookId);
  /**
   * 文档树多选模式（261106 task-8）：**唯一入口 = 抽屉页头的「选择」按钮**（长按文档行仍是拖拽排序，
   * 不能为批量入口抢走既有能力）。状态 + 批量动作（创建副本 / 移动… / 移入回收站）全在 hook 里；
   * 工作区只接线（行渲染、页头入口、底部条、返回键由 hook 自己注册）。
   */
  // 批量「创建副本」也要先过统一保存屏障；session hook 在本调用之后，用 ref 取最新实现（避免调换 hook 顺序）。
  const flushSavesRef = useRef<(() => Promise<void>) | null>(null);
  const treeSelection = useTreeSelection({
    visibleRows,
    loadTree,
    flushSaves: () => flushSavesRef.current?.() ?? Promise.resolve(),
  });
  const selection = treeSelection.selection;
  const editorsRef = useRef<Map<string, LakeEditorInstance | null>>(new Map());
  /** 实例内正文（usheet / board）的同步 capture：完成/关标签前现取最新 body，绕过防抖。 */
  const liveBodyCapturesRef = useRef<Map<string, () => string | null>>(new Map());
  const reportReadError = useCallback((reason: unknown) => {
    toastActionError("打开文档", reason);
  }, []);
  const reportReadMissing = useCallback((id: string) => {
    // 每篇每会话只提示一次（连点同一篇不刷屏）；文案与资源管理入口共用单一来源。
    if (!claimMissingBodyNotice(missingBodyNotifiedThisSession, id)) return;
    showToast(MISSING_DOC_OPEN_HINT, { type: "error" });
  }, []);
  const dropTabResources = useCallback((id: string) => {
    editorsRef.current.delete(id);
    liveBodyCapturesRef.current.delete(id);
  }, []);
  const getTabTitle = useCallback((id: string) => itemById(id)?.title, [itemById]);
  const {
    tabs,
    tabsRef: tabsStateRef,
    savedTabIds,
    savedTabActiveId,
    active,
    activeId,
    mountedIds,
    freshId,
    openTab,
    restore,
    loadTabBody,
    removeTab,
    clearTabs,
    updateTab,
  } = useNotebookTabs({
    notebookId,
    initialNoteId,
    getTitle: getTabTitle,
    readBody: (id) => bridge.readNote(id),
    onReadError: reportReadError,
    onMissing: reportReadMissing,
    onDrop: dropTabResources,
  });

  /**
   * 工作区浮层**唯一 owner**（MOB-02）：目录抽屉 / 大纲 / 查找条 / 标签全屏 / 切换笔记本 / 新建 /
   * 行菜单 / 属性 / 图标 / 历史版本都只是 `overlay` 的一个值；打开一个自动收掉其它的（互斥只在 owner 里）。
   * 下面这些布尔与节点是**派生值**（不是状态），只为让 JSX 与既有类名分支保持原样。
   */
  const { overlay, open: openOverlay, close: closeOverlay, toggle: toggleOverlay } = useWorkspaceOverlays();
  const overlayKind = overlay?.kind ?? null;
  // 261102 pad：expanded = **更宽的移动端外壳**（胶囊/工具栏与手机完全一致），只有「树/大纲」是
  // 悬浮覆盖 + 可固定（十四批用户口径：桌面式工具栏不适合触屏）。
  const formFactor = useFormFactor();
  const padTwoPane = formFactor === "expanded";
  // 树/大纲默认收起、默认**悬浮**（不占布局）；固定 = 停靠进布局、可编辑区随之收窄。
  // 固定偏好**持久化**（设备本地 localStorage，不进正文/不进 S3）；冷启时曾固定的面板按固定态打开。
  // P4：状态收敛到纯 reducer（notebook/shellModel.ts）——closed/floating/pinned × 两侧，
  // 所有开合/固定/收起/手势/Esc 都只派发 action；组件只读 selector。行为由 shellModel.test 表驱动锁死。
  const [padPanelPrefs] = useState(readPadPanelPrefs);
  const [padShell, dispatchPadShell] = useReducer(padShellReducer, padPanelPrefs, createPadShellState);
  const padTreeOpen = isPadPanelOpen(padShell, "left");
  const padOutlineOpen = isPadPanelOpen(padShell, "right");
  const padTreePinned = isPadPanelPinned(padShell, "left");
  const padOutlinePinned = isPadPanelPinned(padShell, "right");
  const padDocked = padTwoPane && isPadDocked(padShell);
  /**
   * 目录抽屉/树是否可见（单一派生 = isTreeVisibleForOverlay）：
   * - 手机：sidebar 打开；**行操作菜单（⋯，kind="menu"）打开期间也保持**（用户 261105 验收修正）；
   * - 平板：树面板自身的悬浮/固定态；行菜单打开期间同样保持。
   * 「新建 / 重命名」已按用户要求恢复原样（不再借用 create 撑开抽屉），见 useWorkspaceActions。
   */
  const treeVisible = isTreeVisibleForOverlay(overlayKind, { padTwoPane, padTreeOpen });
  const sidebarOpen = !padTwoPane && treeVisible;
  // 只记 pinned（开合不记：冷启按 pinned 直接停靠展开）。
  useEffect(() => { writePadPanelPrefs(padPinnedPrefs(padShell)); }, [padShell]);
  const openPadTree = useCallback((open: boolean) => dispatchPadShell({ type: "setOpen", side: "left", open }), []);
  const openPadOutline = useCallback((open: boolean) => dispatchPadShell({ type: "setOpen", side: "right", open }), []);
  const togglePadTree = useCallback(() => dispatchPadShell({ type: "toggle", side: "left" }), []);
  const togglePadOutline = useCallback(() => dispatchPadShell({ type: "toggle", side: "right" }), []);
  const closePadTree = useCallback(() => dispatchPadShell({ type: "setOpen", side: "left", open: false }), []);
  const closePadOutline = useCallback(() => dispatchPadShell({ type: "setOpen", side: "right", open: false }), []);
  const togglePadTreePin = useCallback(() => dispatchPadShell({ type: "togglePin", side: "left" }), []);
  const togglePadOutlinePin = useCallback(() => dispatchPadShell({ type: "togglePin", side: "right" }), []);
  const closePadFloating = useCallback(() => dispatchPadShell({ type: "closeFloating" }), []);
  const outlineOpen = overlayKind === "outline";
  const findOpen = overlayKind === "find";
  const tabsOpen = overlayKind === "tabs";
  const notebookSwitchOpen = overlayKind === "notebookSwitch";
  const createOpen = overlayKind === "create";
  const menuFor = overlay?.kind === "menu" ? overlay.node : null;
  const infoFor = overlay?.kind === "info" ? overlay.node : null;
  const iconFor = overlay?.kind === "icon" ? overlay.node : null;
  const historyFor = overlay?.kind === "history" ? overlay.node : null;
  const noteTagsFor = overlay?.kind === "noteTags" ? overlay.node : null;
  /** 目录「新建」建到哪个节点下：抽屉工具栏 ＋ = 笔记本根，行内 ＋ = 该行节点（复用同一个面板）。 */
  const createParent = overlay?.kind === "create" ? overlay.parentId : notebookId;
  /** 文档内查找条：只对 Lake 文档（doc）开放；切文档时自动收起（查找条绑定当前正文）。 */
  useEffect(() => { closeOverlay("find"); }, [activeId, closeOverlay]);



  const {
    bodyRef,
    outlineAvailable,
    chromeHiddenNow,
    capsuleInEdit,
    capsuleHidden,
    setSubpageFullscreen,
    bodyClickClosesFloating,
    openSidebar,
    openOutline,
  } = useWorkspaceChrome({
    active,
    activeId,
    padTwoPane,
    padTreeOpen,
    padTreePinned,
    padOutlineOpen,
    padOutlinePinned,
    sidebarOpen,
    outlineOpen,
    tabsOpen,
    notebookSwitchOpen,
    openPadTree,
    openOverlay,
    openPadOutline,
    closePadOutline,
    closePadFloating,
    closeOverlay,
  });

  // 261103 P11-②：初次进入/再次指定文档/活动页懒读 → useWorkspaceAssemble（三个 effect 顺序与依赖逐字保留）。
  useWorkspaceAssemble({
    tree,
    firstNote,
    savedTabIds,
    savedTabActiveId,
    initialNoteId,
    initialMode,
    restore,
    openTab,
    active,
    loadTabBody,
  });

  const {
    scheduleAutoSave,
    toggleEdit,
    handleBack,
    switchNotebook,
    closeTab,
    closeAllTabs,
    discardTab,
    handlePaneBodyChange,
    persistBitableNow,
    handlePaneCapture,
    handleEditorInstance,
    flushAllTabs,
  } = useWorkspaceSession({
    tabsRef: tabsStateRef,
    active,
    updateTab,
    removeTab,
    clearTabs,
    closeOverlay,
    onBack,
    onSwitchNotebook,
    notebookId,
    onRegisterBackHandler,
    editorsRef,
    liveBodyCapturesRef,
  });
  // 批量「创建副本」的保存屏障（ref 在 useTreeSelection 之后才拿得到，两处同源）。
  flushSavesRef.current = flushAllTabs;

  const {
    renamingId,
    setRenamingId,
    renameValue,
    setRenameValue,
    historyList,
    applyRename,
    applyIcon,
    applyDelete,
    applyMove,
    loadHistory,
    restoreHistory: restoreHistoryVersion,
    deleteHistory,
  } = useNotebookTreeActions({ tree, loadTree, discardTab });

  /**
   * 「关闭行菜单后抽屉仍在」（用户 261105 验收）：菜单是抽屉之上的临时层，dismiss 后回到目录树本身。
   * 手机 = 重新打开左抽屉；平板 = 确保悬浮树打开。只服务「关掉菜单」这一处，不参与新建/重命名。
   */
  const closeMenuToTree = useCallback(() => {
    if (padTwoPane) openPadTree(true);
    else openOverlay({ kind: "sidebar" });
  }, [padTwoPane, openPadTree, openOverlay]);

  // 261103 P11-②：行菜单 / 历史版本 / 新建 / 标签与图标回调 → useWorkspaceActions（无 effect，纯回调）。
  const {
    applyRestoreHistory,
    createChildDocument,
    treeMenuItems,
    onTreeMenuSelect,
    tabIconOf,
    selectCreateItem,
    createNameSheet,
    handleOpenTabFromList,
    handleSwitchNotebookItem,
    handlePickIcon,
    openHistoryFromInfo,
  } = useWorkspaceActions({
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
    // 创建副本前先过统一保存屏障（否则复制到的是上一次落盘的正文）。
    flushSaves: flushAllTabs,
  });

  // 261103 P11-②：浮层返回栈 / 手动同步 / 活动文档上报 → useWorkspaceSync（effect 顺序逐字保留）。
  const { runSync } = useWorkspaceSync({
    overlayKind,
    closeOverlay,
    loadTree,
    tabsRef: tabsStateRef,
    activeId,
    loadTabBody,
    openTab,
    onActiveNoteChange,
  });



  // ---- 目录树长按拖拽（计时/阈值/反馈/落点/FLIP 全在 useLongPress + useTreeDrag）----
  // 261106 task-8 用户定稿：长按**仍是拖拽排序**（文档/分组同前），多选入口只走页头「选择」。
  const { drag, longPress, setPressedNode } = useTreeDrag({ tree, setTree, expandGroup, loadTree });

  // 抽屉/悬浮树被收起（点遮罩、胶囊、手势）⇒ 退出多选：否则选择态会悬空（底部条已不可见）。
  useEffect(() => {
    if (!selection.active) return;
    if (padTwoPane ? !padTreeOpen : !sidebarOpen) selection.exit();
  }, [selection.active, selection.exit, padTwoPane, padTreeOpen, sidebarOpen]);


  /**
   * 目录树 = 抽屉与平板悬浮左栏**共用同一份**（同一套 props / 虚拟化 / 拖拽 / 长按）。
   * 平板里点开文档后**收起左栏**（覆盖层会盖住刚打开的正文）；手机抽屉同理。
   */
  const treeList = (
    <NotebookTreeList
      rows={visibleRows}
      expanded={expanded}
      hasChildren={(id) => childrenOf(id).length > 0}
      activeId={activeId}
      drag={drag}
      longPress={longPress}
      onPressRow={setPressedNode}
      onActivate={(item) => {
        // 选择态：可选行（文档）的点击由行自己切成勾选；分组行保留展开/折叠。
        if (selection.active && !isTreeRowSelectable(item)) {
          if (childrenOf(item.id).length > 0) toggleGroup(item.id);
          return;
        }
        // 与原实现同序：有子节点先展开/折叠；没有子的文档才打开。
        if (childrenOf(item.id).length > 0) { toggleGroup(item.id); return; }
        if (item.kind === "note") {
          if (padTwoPane) closePadTree(); else openSidebar(false);
          void openTab(item.id);
        }
      }}
      onOpenMenu={(item) => openOverlay({ kind: "menu", node: item })}
      onOpenCreate={(item) => openOverlay({ kind: "create", parentId: item.id })}
      selection={{
        active: selection.active,
        isSelected: selection.isSelected,
        canSelect: (item) => isTreeRowSelectable(item),
        onToggle: (item) => selection.toggle(item.id),
      }}
    />
  );

  // 平板外接键盘：⌘/Ctrl+F 查找、N 新建文档、Esc 关浮层（手机不挂）。
  usePadShortcuts(padTwoPane, {
    find: () => { if (active && (active.kind ?? "doc") === "doc") toggleOverlay("find"); },
    newNote: () => { void createChildDocument("doc", notebookId); },
    // Esc 逐层收：先收浮层，再收悬浮树/大纲（它们不是 overlay owner 的值，要单独处理）。
    // 逐层收；**没东西可关时必须 return false**，否则 hook 会 preventDefault，
    // 上一层（MobileApp 的 Esc）永远收不到（261103 评审 W2）。顺序单一来源 = padEscapeTarget。
    escape: () => {
      // 261106 task-8：选择态先退出选择（不收起树/浮层，Esc 逐层收）。
      if (selection.active) { selection.exit(); return true; }
      const target = padEscapeTarget(padShell, !!overlayKind);
      if (target === "overlay") { closeOverlay(); return true; }
      if (target === "left") { closePadTree(); return true; }
      if (target === "right") { closePadOutline(); return true; }
      return false;
    },
  });


  // v2（261107）：笔记本动态主色 —— 稳定映射到固定 5 色板，只写外壳 CSS 变量（不碰正文/同步）。
  const accentVars = useMemo(() => mobileAccentVars(notebookId), [notebookId]);

  return (
    <div
      className={"mobile-workspace" + (capsuleInEdit ? " mobile-workspace--capsule-edit" : "")}
      style={accentVars as CSSProperties}
    >
      <WorkspaceTopBar
        padTwoPane={padTwoPane}
        chromeHidden={chromeHiddenNow}
        title={title}
        active={active ?? null}
        activeId={activeId}
        tabs={tabs}
        findOpen={findOpen}
        onBack={handleBack}
        onOpenTab={(id) => { void openTab(id); }}
        onCloseTab={(id) => { void closeTab(id); }}
        onOpenTree={openPadTree}
        onToggleFind={() => toggleOverlay("find")}
        onToggleEdit={toggleEdit}
        onSync={() => void runSync()}
        onRename={(id, nextTitle) => {
          updateTab(id, { title: nextTitle });
          scheduleAutoSave(id, nextTitle, tabs.find((x) => x.id === id)?.content ?? "");
        }}
      />

      <div className={"mobile-workspace-main" + (padDocked ? " pad-main--docked" : "")}>
        {/* 平板（expanded）：悬浮左目录（覆盖层，不占布局）；手机不渲染这段（padTwoPane=false） */}
        {/* 261103 P1：面板**常驻 DOM**（与手机抽屉同构）——开合只切 class，
            滚动/展开/重命名状态不再因收起而丢、手势也不再「关闭态没有 DOM」。 */}
        {padTwoPane && (
          <WorkspaceTreePanel
            open={treeVisible}
            pinned={padTreePinned}
            title={title}
            nbIcon={nbIcon ? <MobileNodeIconGlyph value={nbIcon} /> : <Book size={16} />}
            list={treeList}
            onNew={() => openOverlay({ kind: "create", parentId: notebookId })}
            onTogglePin={togglePadTreePin}
            onClose={closePadTree}
            selecting={selection.active}
            selectionCount={selection.count}
            selectionAllSelected={selection.allSelected}
            canSelect={treeSelection.selectableCount > 0}
            onEnterSelect={() => selection.enter()}
            onCancelSelect={() => selection.exit()}
            onToggleAllSelect={() => selection.toggleAll()}
            selectionActions={treeSelection.actions}
            onSelectionAction={treeSelection.runAction}
          />
        )}

        {/* 文档层（正文） */}
        <section
          className="mobile-workspace-body"
          ref={bodyRef}
          // 悬浮树/大纲没有遮罩 ⇒ 点正文就收起（否则 280/240 宽会一直盖在正文上）。
          // ⚠️ 必须用 onClick 而不是 onPointerDown：横向手势也是从正文起手的，pointerdown 会先把面板收掉，
          // 随后同一手势又被判成"拉开另一侧"（261103 实测：滑走左栏 → 右大纲自己弹出来）。
          onClick={bodyClickClosesFloating}
        >
        <NotePaneHost
          tabs={tabs}
          active={active}
          activeId={activeId}
          freshId={freshId}
          mountedIds={mountedIds}
          findOpen={findOpen}
          onBodyChange={handlePaneBodyChange}
          onPersistBitableNow={persistBitableNow}
          onCapture={handlePaneCapture}
          onEditorInstance={handleEditorInstance}
          onFullscreenChange={setSubpageFullscreen}
          onCloseFind={() => closeOverlay("find")}
        />
        </section>

        {/* 平板：右侧大纲悬浮覆盖层（手机仍是 .side-panel--right 抽屉；rail 只在 expanded 渲染） */}
        {padTwoPane && (
          <WorkspaceOutlinePanel
            open={padOutlineOpen}
            pinned={padOutlinePinned}
            onTogglePin={togglePadOutlinePin}
            editor={activeId ? (editorsRef.current.get(activeId) ?? null) : null}
            onClose={closePadOutline}
          />
        )}
      </div>

      {/* 底部胶囊栏（思源 #mobileBottomBar：纯图标）——只放阅读相关（文档树/标签/大纲/更多）；
          编辑与同步在顶栏右侧，避免打字时误触（用户 260909）。编辑态整条下滑淡出而不是卸载。
          十四批（用户点单）：平板**也挂同一套胶囊**（文档树/标签页/大纲/切换笔记本），和手机一模一样；
          平板顶栏只保留「返回 + 文档页签 + 查找/编辑/同步」。 */}
      <WorkspaceCapsule
        hidden={capsuleHidden}
        aboveDock={capsuleInEdit}
        aboveSheet={active?.kind === "usheet"}
        treeActive={!!(padTwoPane ? padTreeOpen : sidebarOpen)}
        tabsActive={tabsOpen}
        outlineActive={!!(padTwoPane ? padOutlineOpen : outlineOpen)}
        outlineAvailable={outlineAvailable}
        tabCount={tabs.length}
        title={title}
        onTree={() => (padTwoPane ? togglePadTree() : openSidebar(!sidebarOpen))}
        onTabs={() => openOverlay({ kind: "tabs" })}
        onOutline={() => (padTwoPane ? togglePadOutline() : openOutline(!outlineOpen))}
        onSwitchNotebook={() => openOverlay({ kind: "notebookSwitch" })}
      />

      {/* P9-5b：浮层宿主（新建/标签列表/切换笔记本/行菜单/属性/图标/历史）。互斥仍由 useWorkspaceOverlays 保证 ⇒ 同一时刻只渲染一个。 */}
      <WorkspaceOverlayHost
        createOpen={createOpen}
        onCreateSelect={selectCreateItem}
        onCloseCreate={() => closeOverlay("create")}
        tabsOpen={tabsOpen}
        tabs={tabs}
        activeId={activeId}
        tabIconOf={tabIconOf}
        onOpenTab={handleOpenTabFromList}
        onCloseTab={(id) => { void closeTab(id); }}
        onCloseAllTabs={() => void closeAllTabs()}
        onCloseTabs={() => closeOverlay("tabs")}
        onOpenDocPicker={() => openSidebar(true)}
        notebookSwitchOpen={notebookSwitchOpen}
        notebooks={notebooks}
        notebookId={notebookId}
        onSwitchNotebook={handleSwitchNotebookItem}
        onCloseNotebookSwitch={() => closeOverlay("notebookSwitch")}
        menuFor={menuFor}
        treeMenuItemsFor={treeMenuItems}
        onTreeMenuSelect={onTreeMenuSelect}
        onCloseMenu={closeMenuToTree}
        infoFor={infoFor}
        onCloseInfo={() => closeOverlay("info")}
        onOpenHistoryFromInfo={openHistoryFromInfo}
        iconFor={iconFor}
        onPickIcon={handlePickIcon}
        onCloseIcon={() => closeOverlay("icon")}
        noteTagsFor={noteTagsFor}
        onCloseNoteTags={() => closeOverlay("noteTags")}
        historyFor={historyFor}
        historyList={historyList}
        onRestoreHistory={(id) => void applyRestoreHistory(id)}
        onDeleteHistory={(id) => void deleteHistory(id)}
        onCloseHistory={() => closeOverlay("history")}
      />

      {/* v2（261107）：新建 / 重命名统一走弹窗（NameSheet），目录行与抽屉头只做展示。 */}
      <NameSheet
        open={createNameSheet.open}
        title={createNameSheet.title}
        placeholder="名称"
        confirmText="创建"
        onSubmit={createNameSheet.onSubmit}
        onClose={createNameSheet.onClose}
      />
      <NameSheet
        open={renamingId !== null}
        title="重命名"
        initialValue={renameValue}
        placeholder="名称"
        onSubmit={(value) => { setRenameValue(value); void applyRename(value); }}
        onClose={() => setRenamingId(null)}
      />

      {/* 选择模式的「移动到…」目录树弹窗（与文档列表多选同一份 MoveTargetTreeSheet）。 */}
      <MoveTargetTreeSheet {...treeSelection.moveSheet} />
      {/* v2（261107）：文档批量打标签（只追加；目录 = 小记标签库，跨端同一份目录）。 */}
      <BatchTagPickerSheet
        open={treeSelection.tagSheet.open}
        options={treeSelection.tagSheet.options}
        count={treeSelection.tagSheet.count}
        busy={treeSelection.tagSheet.busy}
        error={treeSelection.tagSheet.error}
        onClose={treeSelection.tagSheet.onClose}
        onConfirm={(tagIds) => treeSelection.tagSheet.onConfirm(tagIds)}
      />

      {!padTwoPane && (
        <WorkspaceDrawers
          sidebarOpen={sidebarOpen}
          outlineOpen={outlineOpen}
          title={title}
          nbIcon={nbIcon}
          notebookId={notebookId}
          treeList={treeList}
          onOpenSidebar={openSidebar}
          onOpenCreate={() => openOverlay({ kind: "create", parentId: notebookId })}
          editor={activeId ? (editorsRef.current.get(activeId) ?? null) : null}
          onCloseOutline={() => closeOverlay("outline")}
          selecting={selection.active}
          selectionCount={selection.count}
          selectionAllSelected={selection.allSelected}
          canSelect={treeSelection.selectableCount > 0}
          onEnterSelect={() => selection.enter()}
          onCancelSelect={() => selection.exit()}
          onToggleAllSelect={() => selection.toggleAll()}
          selectionActions={treeSelection.actions}
          onSelectionAction={treeSelection.runAction}
        />
      )}
    </div>
  );
}
