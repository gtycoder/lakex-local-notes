/**
 * 多文档选择气泡：快捷组 + 按笔记本（内联展开勾选）。
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
  refsForNotebook,
  refsForQuickGroup,
  selectableNotebooks,
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
  // 锚点 = 整张输入卡：气泡在输入卡下方**居中**展开（261110 用户点单）。
  const { surfaceRef, style } = usePopoverPosition({ open, anchor, gap: 8, align: "center", margin: 10 });
  const [quickNotes, setQuickNotes] = useState<QuickNoteListSummary[]>([]);
  const [expandedNotebook, setExpandedNotebook] = useState<string | null>(null);
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

  const docsOfNotebook = expandedNotebook ? documentsOfNotebook(treeNodes, expandedNotebook) : [];

  return (
    <Popover open={open} onDismiss={onDismiss} label="选择文档" className="aiw-picker" style={style ?? undefined} surfaceRef={surfaceRef}>
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
      <p className="aiw-picker__label">按笔记本选择</p>
      {notebooks.map((notebook) => {
        const expanded = expandedNotebook === notebook.id;
        const refs = refsForNotebook(treeNodes, notebook.id);
        return (
          <div key={notebook.id} className="aiw-picker__group">
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
            {expanded && (
              <div className="aiw-picker__docs">
                {refs.length === 0 && <p className="aiw-picker__empty">这个笔记本里还没有文档</p>}
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
            )}
          </div>
        );
      })}
    </Popover>
  );
}
