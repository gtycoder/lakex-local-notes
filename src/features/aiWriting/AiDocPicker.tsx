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
  refsForNotebook,
  refsForQuickGroup,
  selectableDocuments,
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
  const { surfaceRef, style } = usePopoverPosition({ open, anchor, gap: 6, align: "start", margin: 10 });
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

  const docsOfNotebook = expandedNotebook ? selectableDocuments(treeNodes).filter((node) => node.parentId === expandedNotebook) : [];

  return (
    <Popover open={open} onDismiss={onDismiss} label="选择文档" className="aiw-picker" style={style ?? undefined} surfaceRef={surfaceRef}>
      <p className="aiw-picker__label">快捷选择文档组</p>
      {AI_WRITING_QUICK_GROUPS.map((group) => (
        <button
          key={group.id}
          type="button"
          className="aiw-picker__row"
          onClick={() => {
            const refs = refsForQuickGroup(group, treeNodes, quickNotes);
            onReplace(refs);
            onDismiss();
          }}
        >
          <FileText size={14} className="aiw-picker__icon" aria-hidden="true" />
          <span className="aiw-picker__text">{group.label}</span>
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
              className={"aiw-picker__row" + (expanded ? " is-open" : "")}
              onClick={() => setExpandedNotebook(expanded ? null : notebook.id)}
              aria-expanded={expanded}
            >
              <FileText size={14} className="aiw-picker__icon" aria-hidden="true" />
              <span className="aiw-picker__text">{notebook.title}</span>
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
                    <label key={node.id} className={"aiw-picker__doc" + (checked ? " is-checked" : "")}>
                      <input type="checkbox" checked={checked} onChange={() => onToggle(ref)} />
                      <span className="aiw-picker__doc-name ln-ellipsis">{node.title}</span>
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
