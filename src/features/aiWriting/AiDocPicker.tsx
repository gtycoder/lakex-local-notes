/**
 * 多文档选择气泡：快捷组 + 按笔记本（**右侧展开**该本内的文档并勾选）。
 *
 * 用户 261111 点单：笔记本内的文档不再**内联**展开把下面的行挤走，而是在气泡**右侧**开一列
 * （左侧永远是「快捷组 + 笔记本列表」的稳定布局）。
 *
 * 选择结果落成具体引用（AiWritingDocRef[]），chip 显示数量；发送时才读正文。
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { Popover } from "../../components/ui/Overlay";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { native } from "../../lib/native";
import type { QuickNoteListSummary, TreeNode } from "../../lib/types";
import type { AiWritingDocRef } from "../../core/aiWriting";
import {
  AI_WRITING_QUICK_GROUPS,
  docRefKey,
  documentsOfNotebook,
  notebookSelectionState,
  refsForNotebook,
  refsForQuickGroup,
  selectableNotebooks,
  toggleNotebookRefs,
} from "./aiWritingDocs";

export interface AiDocPickerProps {
  open: boolean;
  anchor: HTMLElement | null;
  treeNodes: readonly TreeNode[];
  selected: readonly AiWritingDocRef[];
  onToggle: (ref: AiWritingDocRef) => void;
  onReplace: (refs: AiWritingDocRef[]) => void;
  onDismiss: () => void;
}

export function AiDocPicker({ open, anchor, treeNodes, selected, onToggle, onReplace, onDismiss }: AiDocPickerProps) {
  const [quickNotes, setQuickNotes] = useState<QuickNoteListSummary[]>([]);
  const [expandedNotebook, setExpandedNotebook] = useState<string | null>(null);
  /**
   * 锚点 = 「选择文档」按钮本身（同提示词库：用户 261111 报居中对齐整张卡会让弹层和按钮错位）。
   * 宽度按「是否展开右侧文档列」给固定值：右侧那列一出现表面就变宽，先把宽度交给 hook（它会重测并重新夹视口）。
   */
  const { surfaceRef, style } = usePopoverPosition({ open, anchor, gap: 6, margin: 10, width: expandedNotebook ? 560 : 320 });
  const notebooks = useMemo(() => selectableNotebooks(treeNodes), [treeNodes]);
  const selectedKeys = useMemo(() => new Set(selected.map(docRefKey)), [selected]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void native.listQuickNotes()
      .then((items) => { if (alive) setQuickNotes(items); })
      .catch(() => { if (alive) setQuickNotes([]); });
    return () => { alive = false; };
  }, [open]);

  // 关闭气泡即收起右侧文档列（下次打开回到「列表」布局，不记忆上次展开）。
  useEffect(() => { if (!open) setExpandedNotebook(null); }, [open]);

  const expandedNode = expandedNotebook ? notebooks.find((node) => node.id === expandedNotebook) ?? null : null;
  const docsOfNotebook = expandedNotebook ? documentsOfNotebook(treeNodes, expandedNotebook) : [];

  return (
    <Popover open={open} onDismiss={onDismiss} label="选择文档" className="aiw-picker" style={style ?? undefined} surfaceRef={surfaceRef}>
      {/* 左列：「快捷组 + 笔记本列表」——**布局稳定**，展开文档不会把这里的行挤走。 */}
      <div className="aiw-picker__list">
      <p className="aiw-picker__label">快捷选择文档组</p>
      {AI_WRITING_QUICK_GROUPS.map((group) => (
        <button
          key={group.id}
          type="button"
          className="ln-row aiw-picker__row"
          onClick={() => {
            const refs = refsForQuickGroup(group, treeNodes, quickNotes);
            onReplace(refs);
            onDismiss();
          }}
        >
          <FileText size={14} className="ln-row__icon" aria-hidden="true" />
          <span className="ln-ellipsis aiw-picker__text">{group.label}</span>
        </button>
      ))}
      <p className="aiw-picker__label">按笔记本选择（可整本勾选，支持多本）</p>
      {notebooks.map((notebook) => {
        const expanded = expandedNotebook === notebook.id;
        const refs = refsForNotebook(treeNodes, notebook.id);
        /** 三态：整本已选 = 实勾；选了其中部分文档 = 半选（用户 261111：能整本选、能多本一起选）。 */
        const state = notebookSelectionState(selected, refs);
        return (
          <div key={notebook.id} className="aiw-picker__group">
            <div className="aiw-picker__grouprow">
              <input
                type="checkbox"
                className="aiw-picker__check"
                checked={state === "all"}
                ref={(el) => { if (el) el.indeterminate = state === "some"; }}
                aria-label={"选择整个笔记本：" + notebook.title}
                disabled={refs.length === 0}
                onChange={() => onReplace(toggleNotebookRefs(selected, refs))}
              />
              <button
                type="button"
                className={"ln-row aiw-picker__row" + (expanded ? " is-selected" : "")}
                onClick={() => setExpandedNotebook(expanded ? null : notebook.id)}
                aria-expanded={expanded}
              >
                <FileText size={14} className="ln-row__icon" aria-hidden="true" />
                <span className="ln-ellipsis aiw-picker__text">{notebook.title}</span>
                <span className="aiw-picker__count">{refs.length}</span>
                {expanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
              </button>
            </div>
          </div>
        );
      })}
      </div>
      {/* 右列：当前笔记本里的文档（用户 261111：在**后边/右侧**展开，不内联挤行）。 */}
      {expandedNode && (
        <div className="aiw-picker__side">
          <div className="aiw-picker__side-head">
            <span className="ln-ellipsis aiw-picker__side-title">{expandedNode.title}</span>
            <span className="aiw-picker__count">{docsOfNotebook.length} 篇</span>
          </div>
          <div className="aiw-picker__docs">
            {docsOfNotebook.length === 0 && <p className="aiw-picker__empty">这个笔记本里还没有文档</p>}
            {docsOfNotebook.map((node) => {
              const ref: AiWritingDocRef = { kind: "note", id: node.noteFileId ?? node.id, title: node.title };
              const checked = selectedKeys.has(docRefKey(ref));
              return (
                <label key={node.id} className="ln-row">
                  <input type="checkbox" checked={checked} onChange={() => onToggle(ref)} />
                  <span className="ln-ellipsis">{node.title}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </Popover>
  );
}
