/**
 * 工作区「文档树抽屉」的多选模式（261106 task-8）：状态 + 批量动作编排。
 *
 * 为什么不要塞进 NotebookWorkspace：工作区已经承载标签页/抽屉/浮层/同步/保存，多选的状态与
 * 三个批量动作（创建副本 / 移动… / 移入回收站）放这里，工作区只接线。
 *
 * 语义：
 * · 可选集合 = 当前可见行里的**文档**（笔记本/分组不可选，判据见 ./treeSelection）；
 * · 创建副本走 bridge.duplicateNotes（已实现的写域契约：逐条结果、降序归一化、部分失败不回滚）；
 * · 移动… / 移入回收站走 bridge.batchNotes（既有动作；回收站二次确认文案与列表页一致）；
 * · 成功 = toast + 退出选择 + 刷新目录；部分/全部失败 = toast 逐条原因 + **保留选择**（方便重试）；
 * · 返回键先退出选择（pushBackHandler），不关抽屉。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, FolderInput, Pin, Tag, Trash } from "lucide-react";
import { bridge } from "../bridge";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import type { NotebookTreeRow } from "./notebookTreeIndex";
import { selectableTreeIds } from "./treeSelection";
import { useSelectionMode } from "../ui/useSelectionMode";
import type { SelectionAction } from "../ui/SelectionActionBar";
import { pushBackHandler } from "../ui/backStack";
import { duplicateResultNotice } from "../ui/duplicateNotesResult";
import { addFavorites } from "../data/favorites";
import { confirmTrashDocs, moveParentFromSnapshot, moveTargetsFromSnapshot, runDocBatch, tagOptionsFromTags } from "../ui/docBatch";
import { showToast } from "../ui/toastBus";
import type { MoveTargetNode } from "../ui/MoveTargetTreeSheet";
import type { QuickNoteTagSummary } from "../../core/quickNoteTags";
import { toastActionError } from "../lib/actionError";

export interface TreeSelectionMoveSheet {
  open: boolean;
  nodes: MoveTargetNode[];
  currentParentId: string | null;
  excludedIds: string[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (parentId: string) => void;
}

export interface UseTreeSelectionOptions {
  /** 抽屉当前可见行（全选/可选集合都以它为准）。 */
  visibleRows: readonly NotebookTreeRow[];
  /** 重建目录（创建副本/移动/回收站成功后刷新）。 */
  loadTree: () => Promise<unknown>;
  /**
   * 创建副本前先落盘在途编辑（工作区统一保存屏障）。
   * 261107 设备复验发现：批量多选路径此前漏了这一步，副本会缺最后一次输入；与单条 duplicateDocument 对齐。
   */
  flushSaves?: () => Promise<void>;
}

export function useTreeSelection(options: UseTreeSelectionOptions) {
  const { visibleRows, loadTree } = options;
  const selectableIds = useMemo(() => selectableTreeIds(visibleRows), [visibleRows]);
  const selection = useSelectionMode(selectableIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveNodes, setMoveNodes] = useState<MoveTargetNode[]>([]);
  const [moveCurrentParentId, setMoveCurrentParentId] = useState<string | null>(null);
  const [moveExcludedIds, setMoveExcludedIds] = useState<string[]>([]);
  const selectedIds = selection.ids;
  // v2（261107）：打标签 —— 目录用 bridge.listQuickNoteTags（目录单一来源），只追加。
  const [tagOpen, setTagOpen] = useState(false);
  const [tagOptions, setTagOptions] = useState<QuickNoteTagSummary[]>([]);
  /** 同一时刻只跑一个批量动作（底部条按钮也按 busy 置灰，双保险）。 */
  const busyRef = useRef(false);
  const withBusy = useCallback(async (task: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try { await task(); } finally { busyRef.current = false; setBusy(false); }
  }, []);

  /** 底部操作条：置顶 / 创建副本 / 移动 / 打标签 / 移入回收站（非破坏性在前，危险动作殿后）。 */
  const actions: SelectionAction[] = useMemo(() => [
    { id: "pin", label: "置顶", icon: Pin, ariaPressed: false, disabled: busy },
    { id: "duplicate", label: "创建副本", icon: Copy, ariaPressed: false, disabled: busy },
    { id: "move", label: "移动", icon: FolderInput, ariaPressed: false, disabled: busy },
    { id: "tag", label: "打标签", icon: Tag, ariaPressed: false, disabled: busy },
    { id: "trash", label: "删除", icon: Trash, danger: true, ariaPressed: false, disabled: busy },
  ], [busy]);

  // 选择态下返回键先退出选择（不关抽屉、不退工作区）；注册在浮层返回处理之后 ⇒ 栈顶优先。
  useEffect(() => {
    if (!selection.active) return;
    return pushBackHandler(() => { selection.exit(); return true; });
  }, [selection.active, selection.exit]);

  const applyDuplicate = useCallback(() => withBusy(async () => {
    if (selectedIds.length === 0) { showToast("请先选择文档"); return; }
    // 先过统一保存屏障：复制读的是磁盘正文，不 flush 会漏掉最后一次输入（与单条入口一致）。
    try {
      await options.flushSaves?.();
    } catch (err) {
      showToast("保存失败，未创建副本：" + getNativeErrorMessage(err), { type: "error" });
      return;
    }
    try {
      const result = await bridge.duplicateNotes({ ids: [...selectedIds] });
      const notice = duplicateResultNotice(result);
      // 部分成功也要刷新目录（已创建的副本本来已在库里，不刷新会让树与数据库不一致）。
      if (result.summary.done > 0) await loadTree();
      if (notice.kind === "success") { showToast(notice.text); selection.exit(); return; }
      setError(notice.text);
      showToast(notice.text, { type: "error" });
    } catch (err) {
      toastActionError("创建副本", err);
    }
  }), [withBusy, selectedIds, loadTree, selection.exit, options.flushSaves]);

  /** 移动到…：弹目标选择（v2 只列笔记本；与文档列表多选同一份 MoveTargetTreeSheet）。 */
  const openMovePicker = useCallback(async () => {
    if (selectedIds.length === 0) { showToast("请先选择文档"); return; }
    setError(null);
    try {
      const snapshot = await bridge.getHomeSnapshot();
      setMoveNodes(moveTargetsFromSnapshot(snapshot));
      setMoveCurrentParentId(moveParentFromSnapshot(snapshot, selectedIds));
      setMoveExcludedIds([...selectedIds]);
      setMoveOpen(true);
    } catch (err) {
      toastActionError("读取移动目标", err);
    }
  }, [selectedIds]);

  const applyMove = useCallback((parentId: string) => withBusy(async () => {
    if (selectedIds.length === 0) return;
    try {
      const { text, detail, failed } = await runDocBatch(selectedIds, { action: "move", parentId });
      if (failed > 0) {
        setError(detail);
        showToast(text, { type: "error" });
        return;
      }
      showToast(text);
      setMoveOpen(false);
      selection.exit();
      await loadTree();
    } catch (err) {
      toastActionError("移动", err);
    }
  }), [withBusy, selectedIds, selection.exit, loadTree]);

  /** 打标签（只追加）：成功退出选择；失败保留选择方便重试。 */
  const applyTag = useCallback((tagIds: readonly string[]) => withBusy(async () => {
    if (selectedIds.length === 0 || tagIds.length === 0) return;
    try {
      const { text, detail, failed } = await runDocBatch(selectedIds, { action: "tag-add", tagIds: [...tagIds] });
      if (failed > 0) {
        setError(detail);
        showToast(text, { type: "error" });
        return;
      }
      showToast(text);
      setTagOpen(false);
      selection.exit();
      await loadTree();
    } catch (err) {
      toastActionError("打标签", err);
    }
  }), [withBusy, selectedIds, selection.exit, loadTree]);

  const applyTrash = useCallback(() => withBusy(async () => {
    if (selectedIds.length === 0) return;
    try {
      const { text, failed } = await runDocBatch(selectedIds, { action: "trash" });
      if (failed > 0) {
        showToast(text, { type: "error" });
        return;
      }
      showToast(text);
      selection.exit();
      await loadTree();
    } catch (err) {
      toastActionError("移入回收站", err);
    }
  }), [withBusy, selectedIds, selection.exit, loadTree]);

  /** 底部条动作分发（底部条只认 id，具体动作/确认都在这里）。 */
  const runAction = useCallback((actionId: string): void => {
    if (selectedIds.length === 0) { showToast("请先选择文档"); return; }
    if (actionId === "pin") {
      // 置顶 = 设备本地偏好（不同步、不写正文），批量只追加；失败面只有 localStorage 写入，不触网。
      const added = addFavorites(selectedIds);
      showToast(added > 0 ? "已置顶 " + added + " 篇文档" : "所选文档已在置顶");
      selection.exit();
      return;
    }
    if (actionId === "duplicate") { void applyDuplicate(); return; }
    if (actionId === "move") { void openMovePicker(); return; }
    if (actionId === "tag") {
      void (async () => {
        setError(null);
        try {
          const tags = await bridge.listQuickNoteTags();
          setTagOptions(tagOptionsFromTags(tags));
          setTagOpen(true);
        } catch (err) {
          toastActionError("读取标签", err);
        }
      })();
      return;
    }
    if (actionId === "trash") {
      void confirmTrashDocs(selectedIds.length).then((ok) => { if (ok) void applyTrash(); });
    }
  }, [selectedIds, applyDuplicate, openMovePicker, applyTrash]);

  const moveSheet: TreeSelectionMoveSheet = {
    open: moveOpen,
    nodes: moveNodes,
    currentParentId: moveCurrentParentId,
    excludedIds: moveExcludedIds,
    busy,
    error,
    onClose: () => { if (!busy) setMoveOpen(false); },
    onConfirm: (parentId: string) => { void applyMove(parentId); },
  };

  const tagSheet = {
    open: tagOpen,
    options: tagOptions,
    count: selectedIds.length,
    busy,
    error,
    onClose: () => { if (!busy) setTagOpen(false); },
    onConfirm: (tagIds: readonly string[]) => applyTag(tagIds),
  };

  return { selection, actions, runAction, busy, error, selectableCount: selectableIds.length, moveSheet, tagSheet };
}
