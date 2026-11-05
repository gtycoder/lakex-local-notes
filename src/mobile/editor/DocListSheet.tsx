/**
 * 移动端快捷切换目录（对齐原型 ed-list / doc-list）：当前笔记本文档列表 → 点击切换。
 *
 * 261105 P1：按标签筛选文档（**只读**、设备本地）。标签关系读 noteTagReads.loadNoteTagIdsForNotes（tag_links kind=note），
 * 名称由标签目录解析；目录里没有的 id 不参与筛选（只给降级提示）。筛选不写任何正文/元数据。
 */
import { useEffect, useMemo, useState } from "react";
import { MobileSheet } from "../ui/MobileSheet";
import { bridge } from "../bridge";
import { loadNoteTagIdsForNotes } from "../bridge/noteTagReads";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { collectDocTagFilterOptions, filterDocsByTag, type DocTagFilterView } from "../ui/docTagChips";

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

export function DocListSheet({ open, documents, activeId, onPick, onClose }: DocListSheetProps) {
  /** 当前列表的 tagIds（一次桥往返；列表可能上百篇，走批量读）。 */
  const [docTagIds, setDocTagIds] = useState<Record<string, string[]>>({});
  const [filterView, setFilterView] = useState<DocTagFilterView | null>(null);
  /** 目录不可用/桥异常时的降级提示（列表照常显示，只是不启用标签筛选）。 */
  const [tagError, setTagError] = useState<string | null>(null);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);

  // 依赖用 id 拼接：父组件每次渲染都可能给新数组，直接依赖 documents 会重复拉取。
  const idsKey = documents.map((doc) => doc.id).join("\u0000");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setActiveTagId(null);
    if (documents.length === 0) {
      setDocTagIds({});
      setFilterView(null);
      setTagError(null);
      return () => { alive = false; };
    }
    void Promise.all([loadNoteTagIdsForNotes(documents.map((doc) => doc.id)), bridge.listQuickNoteTags()])
      .then(([tagIds, directory]) => {
        if (!alive) return;
        setDocTagIds(tagIds);
        setFilterView(collectDocTagFilterOptions(
          documents.map((doc) => ({ id: doc.id, tagIds: tagIds[doc.id] ?? [] })),
          directory,
        ));
        setTagError(null);
      })
      .catch((reason) => {
        if (!alive) return;
        // 降级：标签目录/桥不可用时仍能正常切换文档，只是没有标签筛选项。
        setDocTagIds({});
        setFilterView(null);
        setTagError(getNativeErrorMessage(reason));
      });
    return () => { alive = false; };
  }, [open, idsKey]);

  const visible = useMemo(() => filterDocsByTag(documents, docTagIds, activeTagId), [documents, docTagIds, activeTagId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // MOB-11：scrim / 右滑关闭 / 返回栈 / 焦点与滚动锁统一由 MobileSheet 负责
  //（此前打开后按返回键会落到父层）；类名与 DOM 结构沿用原手写版（.mb-scrim + .mb-sheet，视觉不变）。
  return (
    <MobileSheet open={open} title="文档列表" onClose={onClose}>
      {filterView && filterView.chips.length > 0 && (
        <div className="qn-tag-filter-bar" role="group" aria-label="按标签筛选文档">
          <button
            type="button"
            className={"qn-tag" + (activeTagId === null ? " is-selected" : "")}
            onClick={() => setActiveTagId(null)}
          >
            <span>全部</span><span className="qn-tag__count">{documents.length}</span>
          </button>
          {filterView.chips.map((tag) => (
            <button
              type="button"
              key={tag.id}
              className={"qn-tag" + (activeTagId === tag.id ? " is-selected" : "")}
              onClick={() => setActiveTagId(activeTagId === tag.id ? null : tag.id)}
            >
              <span className="mb-ellipsis">{tag.name}</span><span className="qn-tag__count">{tag.count}</span>
            </button>
          ))}
        </div>
      )}
      {tagError && <p className="mb-form__desc">标签目录暂不可用，未启用按标签筛选（文档列表不受影响）。</p>}
      {!tagError && filterView && filterView.unresolvedTags > 0 && (
        <p className="mb-form__desc">有 {filterView.unresolvedTags} 个标签不在本机目录中（可能已在他端删除），未参与筛选。</p>
      )}
      {visible.length === 0 ? (
        <p className="mb-empty mb-empty--inset">{activeTagId ? "该标签下暂无文档" : "暂无文档"}</p>
      ) : (
        visible.map((d) => (
          <button
            key={d.id}
            className={"med-doc-item" + (d.id === activeId ? " med-active" : "")}
            onClick={() => { onPick(d.id); onClose(); }}
          >
            <span className="med-doc-item-title mb-ellipsis">{d.title || "无标题"}</span>
          </button>
        ))
      )}
    </MobileSheet>
  );
}
