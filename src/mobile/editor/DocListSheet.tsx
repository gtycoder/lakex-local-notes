/**
 * 移动端快捷切换目录（对齐原型 ed-list / doc-list）：当前笔记本文档列表 → 点击切换。
 *
 * 261105 P1：按标签筛选文档（**只读**、设备本地）。标签关系读 noteTagReads.loadNoteTagIdsForNotes（tag_links kind=note），
 * 名称由标签目录解析；目录里没有的 id 不参与筛选（只给降级提示）。筛选不写任何正文/元数据。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, FolderInput, Tag, Trash } from "lucide-react";
import { MobileSheet } from "../ui/MobileSheet";
import { bridge } from "../bridge";
import { loadNoteTagIdsForNotes } from "../bridge/noteTagReads";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { collectDocTagFilterOptions, filterDocsByTag, type DocTagFilterView } from "../ui/docTagChips";
import { pushBackHandler } from "../ui/backStack";
import { showToast } from "../ui/toastBus";
import { useLongPress } from "../ui/useLongPress";
import { SelectionActionBar, type SelectionAction } from "../ui/SelectionActionBar";
import { SelectionCheckbox } from "../ui/SelectionCheckbox";
import { SelectionTopBar } from "../ui/SelectionTopBar";
import { useSelectionMode } from "../ui/useSelectionMode";
import { BatchTagPickerSheet } from "../ui/BatchTagPickerSheet";
import { confirmTrashDocs, moveParentFromSnapshot, moveTargetsFromSnapshot, runDocBatch, tagOptionsFromTags, type DocBatchPayload } from "../ui/docBatch";
import { duplicateResultNotice } from "../ui/duplicateNotesResult";
import { duplicateNoteTitle } from "../../core/duplicateNotes";
import { MoveTargetTreeSheet, type MoveTargetNode } from "../ui/MoveTargetTreeSheet";
import type { QuickNoteTagSummary } from "../../core/quickNoteTags";
import { toastActionError } from "../lib/actionError";
import { EmptyState } from "../ui/EmptyState";

export interface DocListItem {
  id: string;
  title: string;
}

export interface DocListSheetProps {
  open: boolean;
  documents: DocListItem[];
  activeId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}

/**
 * 多选模式（261106 task-82）：长按行或点「选择」进入；顶部栏（取消/已选 N/全选）+ 行复选框 + 底部操作条。
 * 动作 = 创建副本 / 移动 / 移入回收站 / 打标签（创建副本 = 261106 副本功能，与桌面多选第 1 项同一语义）。
 */
const DOC_SELECTION_ACTIONS: SelectionAction[] = [
  // 非破坏性动作排在最前（与桌面右键/浮条的顺序一致）。
  { id: "duplicate", label: "创建副本", icon: Copy },
  { id: "move", label: "移动", icon: FolderInput },
  { id: "trash", label: "移入回收站", icon: Trash, danger: true },
  { id: "tag", label: "打标签", icon: Tag },
];

export function DocListSheet({ open, documents, activeId, onPick, onClose }: DocListSheetProps) {
  /** 当前列表的 tagIds（一次桥往返；列表可能上百篇，走批量读）。 */
  const [docTagIds, setDocTagIds] = useState<Record<string, string[]>>({});
  const [filterView, setFilterView] = useState<DocTagFilterView | null>(null);
  /** 目录不可用/桥异常时的降级提示（列表照常显示，只是不启用标签筛选）。 */
  const [tagError, setTagError] = useState<string | null>(null);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  /** P2-D：读取被截断（超过全库量级上限）时给可见提示，不再静默丢标签。 */
  const [truncated, setTruncated] = useState<{ requested: number; loaded: number } | null>(null);
  /** 批量移入回收站成功后本地先隐藏这些行（父级刷新前列表立即正确）。 */
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  /** 批量创建副本后本地追加新行（父级没有刷新通道，先把权威数据读回来补进列表；下次打开自动归位）。 */
  const [extraDocs, setExtraDocs] = useState<DocListItem[]>([]);

  // 依赖用 id 拼接：父组件每次渲染都可能给新数组，直接依赖 documents 会重复拉取。
  const idsKey = documents.map((doc) => doc.id).join("\u0000");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setActiveTagId(null);
    setTruncated(null);
    if (documents.length === 0) {
      setDocTagIds({});
      setFilterView(null);
      setTagError(null);
      return () => { alive = false; };
    }
    void Promise.all([loadNoteTagIdsForNotes(documents.map((doc) => doc.id)), bridge.listQuickNoteTags()])
      .then(([read, directory]) => {
        if (!alive) return;
        setDocTagIds(read.byNoteId);
        setFilterView(collectDocTagFilterOptions(
          documents.map((doc) => ({ id: doc.id, tagIds: read.byNoteId[doc.id] ?? [] })),
          directory,
        ));
        setTruncated(read.truncated ? { requested: read.requested, loaded: read.loaded } : null);
        setTagError(null);
      })
      .catch((reason) => {
        if (!alive) return;
        // 降级：标签目录/桥不可用时仍能正常切换文档，只是没有标签筛选项。
        setDocTagIds({});
        setFilterView(null);
        setTruncated(null);
        setTagError(getNativeErrorMessage(reason));
      });
    return () => { alive = false; };
  }, [open, idsKey]);

  // 列表数据 = 宿主给的本期列表 + 本会话内新建的副本（宿主刷新后 idsKey 变化即清空，避免重复行）。
  useEffect(() => { setExtraDocs([]); }, [idsKey]);
  const displayDocs = useMemo(() => {
    const known = new Set(documents.map((doc) => doc.id));
    return [...documents, ...extraDocs.filter((doc) => !known.has(doc.id))];
  }, [documents, extraDocs]);
  const visible = useMemo(
    () => filterDocsByTag(displayDocs, docTagIds, activeTagId).filter((doc) => !hiddenIds.includes(doc.id)),
    [displayDocs, docTagIds, activeTagId, hiddenIds],
  );

  // ── 多选（261106 task-82）：可见集合 = 当前筛选后的文档 ──────────────────────────
  const selection = useSelectionMode(visible.map((doc) => doc.id));
  const pressedId = useRef<string | null>(null);
  /** 长按进入多选后，抬手补发的那一次 click 要吞掉（否则会误开文档）。 */
  const suppressTap = useRef(false);
  const longPress = useLongPress(() => {
    const id = pressedId.current;
    if (!id) return;
    suppressTap.current = true;
    selection.enter(id);
  }, { moveCancelPx: 10 });

  // 选择态下返回键先退出多选（不关闭列表）。
  useEffect(() => {
    if (!open || !selection.active) return;
    return pushBackHandler(() => { selection.exit(); return true; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selection.active]);

  // 关闭时复位选择模式。
  useEffect(() => { if (!open && selection.active) selection.exit(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 批量操作（261106 task-82）：真调用 bridge.batchNotes；成功退出选择，部分失败保留选择并汇总。 */
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchTagOpen, setBatchTagOpen] = useState(false);
  const [batchTagOptions, setBatchTagOptions] = useState<QuickNoteTagSummary[]>([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveNodes, setMoveNodes] = useState<MoveTargetNode[]>([]);
  const [moveCurrentParentId, setMoveCurrentParentId] = useState<string | null>(null);
  const [moveExcludedIds, setMoveExcludedIds] = useState<string[]>([]);
  const applyBatch = async (payload: DocBatchPayload): Promise<void> => {
    if (selection.count === 0) { showToast("请先选择文档"); return; }
    setBatchBusy(true);
    setBatchError(null);
    const ids = [...selection.ids];
    try {
      const { text, detail, failed } = await runDocBatch(ids, payload);
      if (failed > 0) showToast(text, { type: "error" });
      else showToast(text);
      if (failed > 0) { setBatchError(detail); return; }
      if (payload.action === "trash") setHiddenIds((current) => [...current, ...ids]);
      setBatchTagOpen(false);
      setMoveOpen(false);
      selection.exit();
    } catch (error) {
      showToast("批量操作失败：" + (error as Error).message, { type: "error" });
    } finally {
      setBatchBusy(false);
    }
  };

  /**
   * 批量创建副本（261106）：调 bridge.duplicateNotes（与桌面 IPC 同契约/同结果）。
   *
   * 「刷新列表」在移动端没有父级刷新通道（documents 由宿主传入），所以把结果里的新 id 用一次只读
   * getHomeSnapshot 取回权威标题（读不到才回落 core 的 duplicateNoteTitle）补进本期列表，并同步复制
   * 源行的标签集合（副本的标签关系是同一集合）——按标签筛选时新行也能正确归位。
   */
  const appendDuplicatedDocs = async (created: ReadonlyArray<{ id: string; newId: string }>): Promise<void> => {
    const sourceById = new Map(displayDocs.map((doc) => [doc.id, doc]));
    const titleById = new Map<string, string>();
    try {
      const snapshot = await bridge.getHomeSnapshot();
      for (const note of snapshot.notes) titleById.set(note.id, note.title);
    } catch { /* 读不到就回落 core 生成的标题（列表仍要刷新） */ }
    const added: DocListItem[] = [];
    const tags: Record<string, string[]> = {};
    for (const item of created) {
      const sourceTitle = sourceById.get(item.id)?.title ?? "";
      added.push({ id: item.newId, title: titleById.get(item.newId) || duplicateNoteTitle(sourceTitle, new Date()) });
      tags[item.newId] = docTagIds[item.id] ?? [];
    }
    setExtraDocs((current) => [...current, ...added]);
    if (Object.keys(tags).length > 0) setDocTagIds((current) => ({ ...current, ...tags }));
  };

  /** 创建副本（批量）：成功 toast「已创建 N 个副本」并退出选择；部分/全部失败给逐条原因并保留选择。 */
  const applyDuplicate = async (): Promise<void> => {
    if (selection.count === 0) { showToast("请先选择文档"); return; }
    setBatchBusy(true);
    setBatchError(null);
    try {
      const result = await bridge.duplicateNotes({ ids: [...selection.ids] });
      const notice = duplicateResultNotice(result);
      const created = result.results.filter(
        (item): item is { id: string; ok: true; newId: string } => item.ok && typeof item.newId === "string",
      );
      if (created.length > 0) await appendDuplicatedDocs(created);
      if (notice.kind === "success") {
        showToast(notice.text);
        selection.exit();
        return;
      }
      setBatchError(notice.text);
      showToast(notice.text, { type: "error" });
    } catch (error) {
      toastActionError("创建副本", error);
    } finally {
      setBatchBusy(false);
    }
  };

  const openTagPicker = async (): Promise<void> => {
    setBatchError(null);
    try {
      const tags = await bridge.listQuickNoteTags();
      setBatchTagOptions(tagOptionsFromTags(tags));
      setBatchTagOpen(true);
    } catch (error) {
      showToast("标签目录暂不可用：" + (error as Error).message, { type: "error" });
    }
  };

  /** 移动到…：弹**笔记本选择**（v2 261107 只列笔记本），当前位置标注、自身/后代禁用。 */
  const openMovePicker = async (): Promise<void> => {
    setBatchError(null);
    try {
      const snapshot = await bridge.getHomeSnapshot();
      setMoveNodes(moveTargetsFromSnapshot(snapshot));
      setMoveCurrentParentId(moveParentFromSnapshot(snapshot, selection.ids));
      setMoveExcludedIds([...selection.ids]);
      setMoveOpen(true);
    } catch (error) {
      showToast("读取移动目标失败：" + (error as Error).message, { type: "error" });
    }
  };

  const runSelectionAction = (actionId: string): void => {
    if (selection.count === 0) { showToast("请先选择文档"); return; }
    if (actionId === "duplicate") { void applyDuplicate(); return; }
    if (actionId === "tag") { void openTagPicker(); return; }
    if (actionId === "move") { void openMovePicker(); return; }
    if (actionId === "trash") {
      void confirmTrashDocs(selection.count).then((ok) => { if (ok) void applyBatch({ action: "trash" }); });
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // MOB-11：scrim / 右滑关闭 / 返回栈 / 焦点与滚动锁统一由 MobileSheet 负责
  //（此前打开后按返回键会落到父层）；类名与 DOM 结构沿用原手写版（.mb-scrim + .mb-sheet，视觉不变）。
  return (
    <MobileSheet
      open={open}
      title={selection.active ? "选择文档" : "文档列表"}
      onClose={() => { if (selection.active) selection.exit(); else onClose(); }}
      footer={selection.active
        ? <SelectionActionBar actions={DOC_SELECTION_ACTIONS} onAction={runSelectionAction} />
        : undefined}
    >
      {selection.active ? (
        <SelectionTopBar
          count={selection.count}
          allSelected={selection.allSelected}
          onCancel={() => selection.exit()}
          onToggleAll={() => selection.toggleAll()}
        />
      ) : visible.length > 0 ? (
        <div className="mb-set-items">
          <div className="mb-set-item">
            <div className="mb-set-item__main">
              <div className="mb-set-item__desc">长按文档可多选</div>
            </div>
            <div className="mb-set-item__ctl">
              <button type="button" className="mb-btn mb-btn--secondary" aria-label="选择文档" onClick={() => selection.enter()}>
                选择
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {filterView && filterView.chips.length > 0 && (
        <div className="qn-tag-filter-bar" role="group" aria-label="按标签筛选文档">
          <button
            type="button"
            className={"qn-tag" + (activeTagId === null ? " is-selected" : "")}
            aria-pressed={activeTagId === null}
            onClick={() => setActiveTagId(null)}
          >
            <span>全部</span><span className="qn-tag__count">{documents.length}</span>
          </button>
          {filterView.chips.map((tag) => (
            <button
              type="button"
              key={tag.id}
              className={"qn-tag" + (activeTagId === tag.id ? " is-selected" : "")}
              aria-pressed={activeTagId === tag.id}
              onClick={() => setActiveTagId(activeTagId === tag.id ? null : tag.id)}
            >
              <span className="mb-ellipsis">{tag.name}</span><span className="qn-tag__count">{tag.count}</span>
            </button>
          ))}
        </div>
      )}
      {tagError && <p className="mb-form__desc">标签目录暂不可用，未启用按标签筛选（文档列表不受影响）。</p>}
      {!tagError && truncated && (
        <p className="mb-form__desc">列表过长：只读取了前 {truncated.loaded} / {truncated.requested} 篇的标签，按标签筛选只覆盖这些文档。</p>
      )}
      {!tagError && filterView && filterView.unresolvedTags > 0 && (
        <p className="mb-form__desc">有 {filterView.unresolvedTags} 个标签不在本机目录中（可能已在他端删除），未参与筛选。</p>
      )}
      {batchTagOpen && (
        <BatchTagPickerSheet
          open={batchTagOpen}
          options={batchTagOptions}
          count={selection.count}
          busy={batchBusy}
          error={batchError}
          onClose={() => setBatchTagOpen(false)}
          onConfirm={(tagIds) => { void applyBatch({ action: "tag-add", tagIds: [...tagIds] }); }}
        />
      )}
      <MoveTargetTreeSheet
        open={moveOpen}
        nodes={moveNodes}
        currentParentId={moveCurrentParentId}
        excludedIds={moveExcludedIds}
        busy={batchBusy}
        error={batchError}
        onClose={() => setMoveOpen(false)}
        onConfirm={(parentId) => { void applyBatch({ action: "move", parentId }); }}
      />
      {visible.length === 0 ? (
        <EmptyState inset>{activeTagId ? "该标签下暂无文档" : "暂无文档"}</EmptyState>
      ) : (
        visible.map((d) => {
          const checked = selection.active && selection.isSelected(d.id);
          return (
            <button
              key={d.id}
              className={"med-doc-item" + (d.id === activeId ? " med-active" : "") + (checked ? " is-selected" : "")}
              aria-pressed={selection.active ? checked : undefined}
              onTouchStart={(event) => { pressedId.current = d.id; longPress.onTouchStart(event); }}
              onTouchMove={longPress.onTouchMove}
              onTouchEnd={longPress.onTouchEnd}
              onTouchCancel={longPress.onTouchCancel}
              onClick={() => {
                if (suppressTap.current) { suppressTap.current = false; return; }
                if (selection.active) { selection.toggle(d.id); return; }
                onPick(d.id);
                onClose();
              }}
            >
              {selection.active && <SelectionCheckbox checked={checked} />}
              <span className="med-doc-item-title mb-ellipsis">{d.title || "无标题"}</span>
            </button>
          );
        })
      )}
    </MobileSheet>
  );
}
