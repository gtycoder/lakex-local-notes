/**
 * 目录行「打标签…」的文档标签选择弹层（261105 晚，用户验收反馈）。
 *
 * 语义：多选/取消 + 新建标签；保存调用 bridge.setNoteTags（单库写 tag_links(kind='note') + bump 关系版本，
 * 与桌面 set_note_tags 同语义）。**不写正文**（关系独立于正文 hash）。
 * 只给**文档行**用（分组/笔记本没有标签）；目录名称/顺序来自 bridge.listQuickNoteTags（设备本地视图）。
 * 版式复用移动端标签面板既有类名（.qn-tag-sheet__*），不新增 CSS。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { QuickNoteTag } from "../../core/quickNoteTags";
import { normalizeQuickNoteTag } from "../../core/quickNoteTags";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { bridge } from "../bridge";
import { MobileSheet } from "../ui/MobileSheet";
import { showToast } from "../ui/toastBus";
import type { NotebookTreeItem } from "./useNotebookTreeData";

export interface NoteTagsSheetProps {
  open: boolean;
  /** 目标文档；null = 不打开（overlay 载荷）。 */
  note: NotebookTreeItem | null;
  onClose: () => void;
}

export function NoteTagsSheet({ open, note, onClose }: NoteTagsSheetProps) {
  const [options, setOptions] = useState<QuickNoteTag[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const aliveRef = useRef(false);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const noteId = note?.id ?? null;
  useEffect(() => {
    if (!open || !noteId) return;
    aliveRef.current = true;
    setOptions(null);
    setSelected([]);
    setQuery("");
    setError(null);
    void Promise.all([bridge.listQuickNoteTags(), bridge.listNoteTagLinks()])
      .then(([directory, links]) => {
        if (!aliveRef.current) return;
        setOptions(directory);
        setSelected(links[noteId] ?? []);
      })
      .catch((reason) => { if (aliveRef.current) setError(getNativeErrorMessage(reason)); });
    return () => { aliveRef.current = false; };
  }, [open, noteId]);

  const toggle = useCallback((tagId: string): void => {
    setSelected((current) => (current.includes(tagId) ? current.filter((id) => id !== tagId) : [tagId, ...current]));
  }, []);

  const createAndSelect = useCallback(async (): Promise<void> => {
    let name = "";
    try { name = normalizeQuickNoteTag(query); } catch (reason) { setError(reason instanceof Error ? reason.message : "标签名无效"); return; }
    setBusy(true);
    setError(null);
    try {
      const created = await bridge.createQuickNoteTag(name);
      const directory = await bridge.listQuickNoteTags();
      if (!aliveRef.current) return;
      setOptions(directory);
      setSelected((current) => [created.id, ...current.filter((id) => id !== created.id)]);
      setQuery("");
    } catch (reason) {
      if (aliveRef.current) setError(getNativeErrorMessage(reason));
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [query]);

  const save = useCallback(async (): Promise<void> => {
    if (!noteId) return;
    setBusy(true);
    setError(null);
    try {
      await bridge.setNoteTags(noteId, selected);
      showToast("已保存标签");
      onClose();
    } catch (reason) {
      if (aliveRef.current) {
        const message = getNativeErrorMessage(reason);
        setError(message);
        showToast("保存标签失败：" + message, { type: "error" });
      }
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [noteId, selected, onClose]);

  const needle = query.trim().toLocaleLowerCase();
  const visible = (options ?? []).filter((option) => !needle || option.name.toLocaleLowerCase().includes(needle));
  let candidate = "";
  try { candidate = query.trim() ? normalizeQuickNoteTag(query) : ""; } catch { candidate = ""; }
  const exactExists = !!candidate && (options ?? []).some((option) => option.name === candidate);

  return (
    <MobileSheet
      open={open}
      title={note?.title ? "打标签 · " + note.title : "打标签"}
      titleClassName="mb-ellipsis"
      onClose={onClose}
      className="qn-tag-sheet"
      bodyClassName="qn-tag-sheet__body mb-sheet__body--form"
    >
      {error && <div className="qn-tag-sheet__error" role="alert">{error}</div>}
      <div className="qn-tag-sheet__input-row">
        <span className="mb-input qn-tag-sheet__input">
          <input
            value={query}
            aria-label="标签名"
            placeholder="输入标签名可筛选或新建…"
            onChange={(event) => { setQuery(event.target.value); setError(null); }}
          />
        </span>
        <button type="button" disabled={!candidate || exactExists || busy} onClick={() => void createAndSelect()}>
          {candidate && !exactExists ? "新建并选中" : "新建"}
        </button>
      </div>
      <div className="qn-tag-sheet__section"><span>选择标签（已选 {selected.length}）</span></div>
      {options === null && !error && <div className="qn-tag-sheet__empty">读取中…</div>}
      {options !== null && visible.length === 0 && <div className="qn-tag-sheet__empty">还没有标签：在上方输入名称新建</div>}
      <div className="qn-tag-sheet__list">
        {visible.map((option) => {
          const checked = selected.includes(option.id);
          return (
            <button
              type="button"
              key={option.id}
              className={"qn-tag-sheet__item" + (checked ? " is-selected" : "")}
              aria-pressed={checked}
              disabled={busy}
              onClick={() => toggle(option.id)}
            >
              <span className="mb-ellipsis">{option.name}</span>
              {checked && <Check size={17} />}
            </button>
          );
        })}
      </div>
      <div className="mb-sheet__foot">
        <button type="button" className="mb-btn mb-btn--secondary" disabled={busy} onClick={onClose}>取消</button>
        <button type="button" className="mb-btn mb-btn--primary" disabled={busy || options === null} onClick={() => void save()}>
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
    </MobileSheet>
  );
}
