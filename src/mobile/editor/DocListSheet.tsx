/**
 * 移动端快捷切换目录（对齐原型 ed-list / doc-list）：当前笔记本文档列表 → 点击切换。
 *
 * 261105 P1：按标签筛选文档（**只读**、设备本地）。标签关系读 noteTagReads.loadNoteTagIdsForNotes（tag_links kind=note），
 * 名称由标签目录解析；目录里没有的 id 不参与筛选（只给降级提示）。筛选不写任何正文/元数据。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { FolderInput, Tag, Trash } from "lucide-react";
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
import { summarizeBatchResult } from "../ui/batchNotesResult";
import { confirmMobile } from "../ui/ConfirmDialog";
import type { QuickNoteTag, QuickNoteTagSummary } from "../../core/quickNoteTags";

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
 * 动作 = 移动 / 移入回收站 / 打标签（桥接 batchNotes 待 task-80 落地后接入，本阶段先占位提示）。
 */
const DOC_SELECTION_ACTIONS: SelectionAction[] = [
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

  const visible = useMemo(
    () => filterDocsByTag(documents, docTagIds, activeTagId).filter((doc) => !hiddenIds.includes(doc.id)),
    [documents, docTagIds, activeTagId, hiddenIds],
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
  const [moveTargets, setMoveTargets] = useState<Array<{ id: string; title: string; depth: number }>>([]);
  const applyBatch = async (payload: { action: "trash" | "tag-add" | "move"; tagIds?: string[]; parentId?: string | null }): Promise<void> => {
    if (selection.count === 0) { showToast("请先选择文档"); return; }
    setBatchBusy(true);
    setBatchError(null);
    const ids = [...selection.ids];
    try {
      const result = await bridge.batchNotes({ ...payload, ids, space: "lake" });
      const verb = payload.action === "trash" ? "已移入回收站" : payload.action === "move" ? "已移动" : "已加标签";
      const summary = summarizeBatchResult(result, verb);
      if (result.summary.failed > 0) showToast(summary, { type: "error" });
      else showToast(summary);
      if (result.summary.failed > 0) { setBatchError(summarizeBatchResult(result, "")); return; }
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

  const openTagPicker = async (): Promise<void> => {
    setBatchError(null);
    try {
      const tags = await bridge.listQuickNoteTags();
      setBatchTagOptions(tags.map((tag: QuickNoteTag) => ({ ...tag, count: 0 })));
      setBatchTagOpen(true);
    } catch (error) {
      showToast("标签目录暂不可用：" + (error as Error).message, { type: "error" });
    }
  };

  const openMovePicker = async (): Promise<void> => {
    setBatchError(null);
    try {
      const snapshot = await bridge.getHomeSnapshot();
      const nodes = snapshot.treeNodes.filter((node) => node.nodeType === "notebook" || node.nodeType === "group");
      const depthOf = (node: { id: string; parentId: string | null }): number => {
        let depth = 0; let cur = node.parentId;
        for (let hops = 0; cur && hops < 32; hops += 1) {
          const parent = nodes.find((item) => item.id === cur);
          if (!parent) break;
          depth += 1; cur = parent.parentId;
        }
        return depth;
      };
      setMoveTargets(nodes.map((node) => ({ id: node.id, title: node.title || "未命名", depth: depthOf(node) })));
      setMoveOpen(true);
    } catch (error) {
      showToast("读取移动目标失败：" + (error as Error).message, { type: "error" });
    }
  };

  const runSelectionAction = (actionId: string): void => {
    if (selection.count === 0) { showToast("请先选择文档"); return; }
    if (actionId === "tag") { void openTagPicker(); return; }
    if (actionId === "move") { void openMovePicker(); return; }
    if (actionId === "trash") {
      void confirmMobile({
        title: "移入回收站？",
        body: "将把选中的 " + selection.count + " 篇文档移入回收站（可恢复，不会彻底删除）。",
        confirmText: "移入回收站",
        danger: true,
      }).then((ok) => { if (ok) void applyBatch({ action: "trash" }); });
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
      {moveOpen && (
        <MobileSheet open title="移动到…" onClose={() => setMoveOpen(false)} bodyClassName="mb-sheet__body--form" footer={<div className="mb-sheet__foot">
          <button type="button" className="mb-btn mb-btn--secondary" disabled={batchBusy} onClick={() => setMoveOpen(false)}>取消</button>
        </div>}>
          {batchError && <div className="qn-tag-sheet__error" role="alert">{batchError}</div>}
          <div className="mb-set-items">
            {moveTargets.map((target) => (
              <button
                key={target.id}
                type="button"
                className="mb-set-item"
                disabled={batchBusy}
                style={{ paddingLeft: 16 + target.depth * 16 }}
                onClick={() => void applyBatch({ action: "move", parentId: target.id })}
              >
                <span className="mb-set-item__main"><span className="mb-set-name">{target.title}</span></span>
              </button>
            ))}
          </div>
        </MobileSheet>
      )}
      {visible.length === 0 ? (
        <p className="mb-empty mb-empty--inset">{activeTagId ? "该标签下暂无文档" : "暂无文档"}</p>
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
