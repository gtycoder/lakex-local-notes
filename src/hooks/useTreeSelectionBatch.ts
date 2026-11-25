/**
 * 目录树多选 + 批量动作（261106 task-81/task-88/task-96）：
 *  选择语义（⌘ 切换 / Shift 区间 / 普通点击退出）+ 批量菜单/弹层 + 六个批量动作
 *  （创建副本 / 移动… / 导出…（含画板字节准备）/ 移入回收站 / 追加标签 / 置顶）+ 批量结果提示。
 *
 * D-04②（261125 审计终审批次）：从 components/app/Sidebar.tsx 纯搬家（零行为变化）。
 * 语义指针：笔记本不参与多选；切筛选/搜索/执行完即清空；失败项保留选中并就地显示原因；
 * 批量「移入回收站」= 删除（可恢复，走 batch_notes.trash + 同一套确认原语）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { BatchNotesRequestShape, QuickNoteTag, TreeNode } from "../lib/types";
import type { TreeIndex } from "../core/treeIndex";
import {
  EMPTY_TREE_SELECTION,
  TREE_SELECTION_MAX,
  clearTreeSelection,
  isSelectableTreeNode,
  plainClickSelection,
  pruneTreeSelection,
  rangeTreeSelection,
  selectAllVisible,
  selectableVisibleOrder,
  toggleTreeSelection,
  treeSelectionActions,
  type TreeSelectionState,
} from "../core/treeSelection";
import { currentParentOf } from "../core/moveTreeModel";
import { setPinnedTreeIds } from "../features/sidebar/pinnedTree";
import type { TagSelection } from "../features/tags/tagsModel";
import { readBoardBytes } from "../features/board/boardExport";
import { renderBoardSnapshotBytes } from "../features/board/boardSnapshot";
import { batchNotesResultNotice } from "../components/app/batchNotesFeedback";
import { duplicateNotesResultNotice } from "../components/app/duplicateNotesFeedback";
import { useConfirm } from "./useConfirm";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { native } from "../lib/native";

/** 批量结果的原因摘要：去重、最多两档（导出/批量操作共用）。 */
function summarizeReasons(reasons: ReadonlyArray<string | undefined>): string {
  const unique = [...new Set(reasons.map((reason) => (reason ?? "").trim() || "未知原因"))];
  return unique.slice(0, 2).join("；") + (unique.length > 2 ? "…" : "");
}

export interface UseTreeSelectionBatchOptions {
  nodes: TreeNode[];
  nodeById: Map<string, TreeNode>;
  /** 显示用索引（标签筛选已收窄 visibleIds）：多选区间/全选以它的可见顺序为准。 */
  displayIndex: TreeIndex;
  /** 名称筛选词（已小写化）：变化即清空多选。 */
  query: string;
  /** 标签筛选（可选）：selection/visibleIds 变化即清空多选（不依赖对象引用本身）。 */
  tagSelection?: TagSelection;
  tagVisibleIds?: ReadonlySet<string>;
  onRefreshTree: () => void | Promise<void>;
  onTagsChanged?: () => void;
  /** 创建副本前先 flush 涉及的 dirty 标签（App 注入）。 */
  onBeforeDuplicate?: (ids: readonly string[]) => Promise<void> | void;
  onSelect: (id: string) => void;
  /** 行点击后把该行记为「当前上下文」（右键/新建的锚点行）。 */
  setContextId: Dispatch<SetStateAction<string | null>>;
  /** 点击笔记本/分组行 = 展开/收起（分区里传分区自己的切换）。 */
  toggleNode: (id: string) => void;
  /** 置顶集（设备本地；批量置顶/取消置顶的判据）。 */
  pinnedSet: ReadonlySet<string>;
  /** 置顶写入后重读置顶集。 */
  refreshPinnedState: () => void;
}

export function useTreeSelectionBatch(options: UseTreeSelectionBatchOptions) {
  const {
    nodes, nodeById, displayIndex, query, tagSelection, tagVisibleIds,
    onRefreshTree, onTagsChanged, onBeforeDuplicate, onSelect,
    setContextId, toggleNode, pinnedSet, refreshPinnedState,
  } = options;

  /** 目录树多选（261106 task-81）：设备本地视图，笔记本不参与；切筛选/搜索/执行完即清空。 */
  const [selection, setSelection] = useState<TreeSelectionState>(EMPTY_TREE_SELECTION);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  /** 提示行右侧动作（导出后的「打开所在文件夹」）。 */
  const [batchNoticeAction, setBatchNoticeAction] = useState<{ label: string; onClick(): void } | null>(null);
  /** 多选态右键菜单（恰好四项：创建副本/移动…/导出…/移入回收站；未多选时用旧菜单）。 */
  const [batchMenu, setBatchMenu] = useState<{ x: number; y: number } | null>(null);
  const [batchDialogError, setBatchDialogError] = useState<string | null>(null);
  /** 「移动到…」树形弹层：记录本次要移动的 id 快照与当前父级（弹层打开期间不随选择变化）。 */
  const [moveDialog, setMoveDialog] = useState<{ ids: string[]; currentParentId: string | null } | null>(null);
  /** 批量「添加标签…」：只追加，可现场新建；id 快照与标签目录在打开时现读。 */
  const [tagDialog, setTagDialog] = useState<{ ids: string[] } | null>(null);
  const [tagCatalog, setTagCatalog] = useState<{ loading: boolean; error: string | null; tags: QuickNoteTag[] }>({ loading: false, error: null, tags: [] });
  /** 批量「移入回收站」二次确认（与删除同一套确认原语）。 */
  const { confirm, confirmElement } = useConfirm();

  // ---- 目录树多选（261106 task-81，用户定稿 A 方案）----
  // 可见可多选行（DFS 顺序；笔记本跳过）：Shift 区间与「全选」都以它为准。
  const visibleSelectableOrder = useMemo(() => selectableVisibleOrder(displayIndex), [displayIndex]);
  const selectedIdSet = useMemo(() => new Set(selection.ids), [selection.ids]);
  const selectionActions = useMemo(() => treeSelectionActions(nodeById, selection), [nodeById, selection]);
  /** 「创建副本」可用判据（261106）：选区里**全是文档**才成立 ⇒ 分组/笔记本/混选时菜单项禁用并给原因。 */
  const selectionAllNotes = useMemo(
    () => selection.ids.length > 0 && selection.ids.every((id) => nodeById.get(id)?.nodeType === "note"),
    [nodeById, selection.ids],
  );
  const selectionAllPinned = selection.ids.length > 0 && selection.ids.every((id) => pinnedSet.has(id));

  // 可见集合变化（筛选/搜索/删除/移动）⇒ 剔除已不可选的 id（不改变选择顺序）。
  useEffect(() => {
    setSelection((state) => (state.ids.length === 0 ? state : pruneTreeSelection(state, visibleSelectableOrder)));
  }, [visibleSelectableOrder]);

  // 切换笔记本/筛选/搜索 ⇒ 清空多选（用户定稿）。只依赖真正会变的两个值，
  // 不依赖 tagFilter 对象本身（App 每次渲染都会新建那个对象）。
  useEffect(() => {
    setSelection(EMPTY_TREE_SELECTION);
    setBatchNotice(null);
  }, [query, tagSelection, tagVisibleIds]);

  // 批量结果提示自动消失（4s）：批量进行中不消失（进度提示要一直可见）；下一次选择/清空也会清。
  useEffect(() => {
    if (!batchNotice || batchBusy) return;
    const timer = window.setTimeout(() => { setBatchNotice(null); setBatchNoticeAction(null); }, 4000);
    return () => window.clearTimeout(timer);
  }, [batchNotice, batchBusy]);

  /** 261108：批量创建副本的进度（只接受当前请求 id，避免旧请求串台）。 */
  const duplicateRequestIdRef = useRef<string | null>(null);
  useEffect(() => {
    try {
      if (typeof native.onDuplicateProgress !== "function") return;
      return native.onDuplicateProgress((progress) => {
        if (!duplicateRequestIdRef.current || progress.requestId !== duplicateRequestIdRef.current) return;
        setBatchNotice("正在创建副本 " + progress.done + "/" + progress.total + "…");
      });
    } catch {
      // 非 Electron 宿主（测试/Web shim）没有原生进度通道：静默跳过。
      return;
    }
  }, []);

  // 选择被清空 ⇒ 多选右键菜单一起收起（Esc/点空白/操作完成）
  useEffect(() => {
    if (selection.ids.length === 0) setBatchMenu(null);
  }, [selection.ids.length]);

  // Esc 清空多选（只在有多选时挂监听；重命名输入/浮层已经 preventDefault 的 Esc 不抢）。
  useEffect(() => {
    if (selection.ids.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setSelection(EMPTY_TREE_SELECTION);
      setBatchNotice(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection.ids.length]);

  /**
   * 目录行点击：
   *  · ⌘/Ctrl = 切换该行（笔记本不参与）；
   *  · Shift = 以锚点为界按**可见顺序**取区间（可见顺序里本就没有笔记本 ⇒ 自动跳过）；
   *  · 普通点击 = 退出多选（记下锚点，方便紧接着 Shift），并保持原有单行行为。
   */
  const handleRowClick = useCallback((event: React.MouseEvent, node: TreeNode, toggleExpand: (id: string) => void = toggleNode) => {
    setBatchNotice(null);
    // 笔记本在多选语义里是「不可选」：带 ⌘/Shift 点它直接忽略（避免多选途中的一次误触把笔记本收起）。
    if (!isSelectableTreeNode(node) && (event.metaKey || event.ctrlKey || event.shiftKey)) {
      setContextId(node.id);
      return;
    }
    if (isSelectableTreeNode(node) && (event.metaKey || event.ctrlKey)) {
      setSelection((state) => toggleTreeSelection(state, node.id));
      setContextId(node.id);
      return;
    }
    if (isSelectableTreeNode(node) && event.shiftKey) {
      setSelection((state) => rangeTreeSelection(state, visibleSelectableOrder, node.id));
      setContextId(node.id);
      return;
    }
    setSelection(isSelectableTreeNode(node) ? plainClickSelection(node.id) : clearTreeSelection());
    setContextId(node.id);
    if (node.nodeType === "note") onSelect(node.id);
    else toggleExpand(node.id);
  }, [visibleSelectableOrder, onSelect, toggleNode]);

  /** 批量执行（桌面 batch_notes）：成功 ⇒ 刷新 + 清空；失败 ⇒ 失败项保持选中 + 可见提示。 */
  const runBatch = useCallback(async (request: BatchNotesRequestShape) => {
    if (batchBusy) return;
    setBatchBusy(true);
    setBatchDialogError(null);
    try {
      const result = await native.batchNotes(request);
      const notice = batchNotesResultNotice(result, request.action);
      setBatchNotice(notice.text);
      if (result.ok) {
        setSelection(EMPTY_TREE_SELECTION);
        setMoveDialog(null);
        setTagDialog(null);
        await onRefreshTree();
        if (request.action === "tag-add") onTagsChanged?.();
      } else {
        const failed = new Set(notice.failedIds);
        if (failed.size > 0) setSelection((state) => ({ ...state, ids: state.ids.filter((id) => failed.has(id)) }));
        // 弹层不关：把原因就地显示，方便改目标/换标签重试
        setBatchDialogError(notice.text);
      }
    } catch (error) {
      const message = getNativeErrorMessage(error) || "批量操作失败";
      setBatchNotice(message);
      setBatchDialogError(message);
    } finally {
      setBatchBusy(false);
    }
  }, [batchBusy, onRefreshTree, onTagsChanged]);

  /** 批量「移入回收站」（删除 = 移入回收站；可在回收站恢复）：二次确认后走 batch_notes.trash。 */
  const trashSelected = useCallback(async () => {
    const ids = [...selection.ids];
    if (ids.length === 0) return;
    const ok = await confirm({
      title: "删除 " + ids.length + " 项？",
      body: "删除后可在回收站恢复；文档的历史快照会保留。",
      confirmText: "删除",
    });
    if (!ok) return;
    await runBatch({ action: "trash", ids });
  }, [confirm, runBatch, selection.ids]);

  /**
   * 批量导出（261106 task-88；task-96 接入画板）：
   *  ① 先 pickExportDir（取消 ⇒ 静默返回）；
   *  ② 对选中项里（含分组展开后）的**画板**串行收集字节：已打开的画板走 readBoardBytes（含未保存编辑），
   *     否则 readNote 正文 + renderBoardSnapshotBytes 离屏渲染；进度「正在准备画板 N/M」可取消（中止后续）；
   *  ③ exportNotesBatch({ ids, dirPath, boardImages })——主进程把字节内嵌成 PDF；缺字节的画板由主进程 skipped。
   */
  const exportSelected = useCallback(async () => {
    const ids = [...selection.ids];
    if (ids.length === 0) return;
    setBatchNotice("正在导出 " + ids.length + " 项…");
    setBatchNoticeAction(null);
    setBatchBusy(true);
    const prepFailures = new Map<string, string>();
    try {
      const dirPath = await native.pickExportDir();
      if (!dirPath) { setBatchNotice(null); return; } // 用户取消目录 ⇒ 无副作用、不提示失败

      // 选中项 + 分组/笔记本展开后的画板（分组交给主进程展开导出，这里只为画板先收字节）
      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      const childrenByParent = new Map<string | null, TreeNode[]>();
      for (const node of nodes) {
        const siblings = childrenByParent.get(node.parentId) ?? [];
        siblings.push(node);
        childrenByParent.set(node.parentId, siblings);
      }
      const boardIds: string[] = [];
      const collect = (id: string, depth: number) => {
        if (depth > 32) return;
        const node = nodeById.get(id);
        if (!node) return;
        if (node.nodeType === "note") {
          if ((node.kind ?? "doc") === "board" && !boardIds.includes(node.id)) boardIds.push(node.id);
          return;
        }
        for (const child of childrenByParent.get(node.id) ?? []) collect(child.id, depth + 1);
      };
      for (const id of ids) collect(id, 0);

      const controller = new AbortController();
      const boardImages: Record<string, { bytes: Uint8Array; format: "png" | "svg" }> = {};
      if (boardIds.length > 0) {
        setBatchNoticeAction({ label: "取消", onClick: () => controller.abort() });
        for (let index = 0; index < boardIds.length; index += 1) {
          if (controller.signal.aborted) break;
          const boardId = boardIds[index];
          setBatchNotice("正在准备画板 " + (index + 1) + "/" + boardIds.length + "…");
          let bytes: Uint8Array | null = null;
          try {
            const opened = await readBoardBytes(boardId);
            bytes = opened?.bytes ?? null;
          } catch { bytes = null; }
          if (!bytes) {
            try {
              const doc = await native.readNote(boardId);
              const snapshot = await renderBoardSnapshotBytes(doc.content);
              bytes = snapshot?.bytes ?? null;
            } catch { bytes = null; }
          }
          if (bytes && bytes.byteLength > 0) boardImages[boardId] = { bytes, format: "png" };
          else prepFailures.set(boardId, "画板快照失败/超时");
        }
        if (controller.signal.aborted) {
          setBatchNotice(null);
          setBatchNoticeAction(null);
          return; // 取消准备阶段 ⇒ 不导出
        }
      }
      setBatchNotice("正在导出 " + ids.length + " 项…");
      setBatchNoticeAction(null);

      const result = await native.exportNotesBatch(
        Object.keys(boardImages).length > 0 ? { ids, dirPath, boardImages } : { ids, dirPath },
      );
      if (result.cancelled) { setBatchNotice(null); return; }
      const failed = result.results.filter((entry) => !entry.ok && !entry.skipped);
      const skipped = result.results.filter((entry) => entry.skipped || (!entry.ok && !!entry.reason));
      const parts: string[] = ["导出 " + result.summary.done + " 项"];
      if (result.summary.failed > 0) parts.push("失败 " + result.summary.failed + "（" + summarizeReasons(failed.map((entry) => entry.reason)) + "）");
      if (result.summary.skipped > 0) {
        const reasons = skipped.map((entry) => prepFailures.get(entry.id) ?? entry.reason);
        parts.push("跳过 " + result.summary.skipped + "（" + summarizeReasons(reasons) + "）");
      }
      setBatchNotice(parts.join("，"));
      if (result.dirPath) {
        const path = result.dirPath;
        setBatchNoticeAction({
          label: "打开所在文件夹",
          onClick: () => { setBatchNotice(null); setBatchNoticeAction(null); void native.openExportDir(path); },
        });
      }
    } catch (error) {
      setBatchNotice("导出失败：" + (getNativeErrorMessage(error) || "未知原因"));
    } finally {
      setBatchBusy(false);
    }
  }, [selection.ids, nodes]);

  /**
   * 「创建副本」（261106；桌面 IPC duplicate_notes，移动端同形）：单条右键与多选右键/浮动条共用这一条通路。
   * 主进程逐条复制（部分失败不回滚其它条）：成功 ⇒ 刷新目录树（副本紧邻原笔记下方）+「已创建 N 个副本」；
   * 有失败 ⇒ 失败项保留选中（单条右键时选区本就为空，不凭空拉出多选条）并给逐条原因文案。
   */
  const runDuplicate = useCallback(async (ids: readonly string[]) => {
    if (ids.length === 0 || batchBusy) return;
    const requestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "dup-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    duplicateRequestIdRef.current = requestId;
    setBatchBusy(true);
    setBatchNotice("正在创建副本 0/" + ids.length + "…");
    setBatchNoticeAction({ label: "取消", onClick: () => {
      setBatchNotice("正在取消创建副本…");
      setBatchNoticeAction(null);
      void native.cancelDuplicateNotes?.(requestId);
    } });
    try {
      // 先落盘未保存编辑（261106 用户确认）：复制读的是磁盘正文，不 flush 会漏掉最后一次输入。
      await onBeforeDuplicate?.([...ids]);
      const result = await native.duplicateNotes({ ids: [...ids], requestId });
      const notice = duplicateNotesResultNotice(result);
      setBatchNotice(notice.text);
      if (result.ok) {
        setSelection(EMPTY_TREE_SELECTION);
        await onRefreshTree();
      } else {
        const failed = new Set(notice.failedIds);
        if (failed.size > 0) {
          setSelection((state) => (state.ids.length === 0 ? state : { ...state, ids: state.ids.filter((id) => failed.has(id)) }));
        }
      }
    } catch (error) {
      setBatchNotice("创建副本失败：" + (getNativeErrorMessage(error) || "未知原因"));
    } finally {
      duplicateRequestIdRef.current = null;
      setBatchBusy(false);
      setBatchNoticeAction(null);
    }
  }, [batchBusy, onRefreshTree, onBeforeDuplicate]);

  /** 单条右键「创建副本」（只在 note 行出现；笔记本/分组没有这个入口）。 */
  const duplicateOne = useCallback((node: TreeNode) => {
    if (node.nodeType !== "note") return;
    void runDuplicate([node.id]);
  }, [runDuplicate]);

  /** 多选「创建副本」（菜单/浮动条；选区里全是文档时才可点）。 */
  const duplicateSelected = useCallback(() => {
    void runDuplicate(selection.ids.filter((id) => nodeById.get(id)?.nodeType === "note"));
  }, [nodeById, runDuplicate, selection.ids]);

  /** 批量置顶/取消置顶（菜单；全选中已置顶时给「取消置顶」）。 */
  const pinSelected = useCallback(() => {
    if (selection.ids.length === 0) return;
    const ids = [...selection.ids];
    const allPinned = ids.every((id) => pinnedSet.has(id));
    setPinnedTreeIds(ids, !allPinned);
    refreshPinnedState();
    setSelection(EMPTY_TREE_SELECTION);
    setBatchNotice((allPinned ? "已取消置顶 " : "已置顶 ") + ids.length + " 项");
  }, [selection.ids, pinnedSet, refreshPinnedState]);

  /** 打开「移动到…」树形弹层（多选 = 当前选择；单条 = 右键那一行）。 */
  const openMoveForIds = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return;
    setBatchDialogError(null);
    setMoveDialog({ ids: [...ids], currentParentId: currentParentOf(nodes, ids) });
  }, [nodes]);
  const openMoveDialog = useCallback(() => { openMoveForIds(selection.ids); }, [openMoveForIds, selection.ids]);
  const openMoveForNode = useCallback((node: TreeNode) => { openMoveForIds([node.id]); }, [openMoveForIds]);

  /** 批量追加标签：打开时现读标签目录；新建由弹层调用 createQuickNoteTag，不提供移除/改名/图标编辑。 */
  const openBatchTagDialog = useCallback(() => {
    if (selection.ids.length === 0) return;
    setBatchDialogError(null);
    setTagDialog({ ids: [...selection.ids] });
    setTagCatalog({ loading: true, error: null, tags: [] });
    void native.listQuickNoteTags()
      .then((tags) => setTagCatalog({ loading: false, error: null, tags: Array.isArray(tags) ? tags : [] }))
      .catch((error) => setTagCatalog({ loading: false, error: getNativeErrorMessage(error), tags: [] }));
  }, [selection.ids]);

  const confirmBatchTag = useCallback((tagIds: string[]) => {
    const ids = tagDialog?.ids ?? [];
    if (ids.length === 0 || tagIds.length === 0) return;
    void runBatch({ action: "tag-add", ids, tagIds });
  }, [tagDialog, runBatch]);

  const createBatchTag = useCallback(async (name: string): Promise<QuickNoteTag> => {
    const created = await native.createQuickNoteTag(name);
    setTagCatalog((current) => current.tags.some((tag) => tag.id === created.id) ? current : { ...current, tags: [...current.tags, created] });
    return created;
  }, []);

  const selectAllVisibleRows = useCallback(() => {
    if (visibleSelectableOrder.length > TREE_SELECTION_MAX) {
      setBatchNotice("单次最多 " + TREE_SELECTION_MAX + " 项，已选前 " + TREE_SELECTION_MAX + " 项");
    }
    setSelection((state) => selectAllVisible(state, visibleSelectableOrder));
  }, [visibleSelectableOrder]);

  const cancelSelection = useCallback(() => {
    setSelection(EMPTY_TREE_SELECTION);
    setBatchNotice(null);
  }, []);

  return {
    selection, setSelection, selectedIdSet, selectionActions, selectionAllNotes, selectionAllPinned,
    batchBusy, batchNotice, setBatchNotice, batchNoticeAction, batchMenu, setBatchMenu,
    batchDialogError, setBatchDialogError,
    moveDialog, setMoveDialog, tagDialog, setTagDialog, tagCatalog,
    confirmElement,
    handleRowClick, runBatch, trashSelected, exportSelected,
    runDuplicate, duplicateOne, duplicateSelected, pinSelected,
    openMoveForIds, openMoveDialog, openMoveForNode,
    openBatchTagDialog, confirmBatchTag, createBatchTag,
    selectAllVisibleRows, cancelSelection,
  };
}
