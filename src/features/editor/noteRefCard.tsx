/**
 * 「文档引用」卡的 **React 部分**（R2，261008 用户定稿）；纯逻辑见 `noteRef.ts`。
 *
 * 形态：区块卡（`cardType: "block"`），只存引用元数据（noteId + 标题快照），点击打开目标文档标签页，
 * 目标失效时显示「文档已删除」占位。**不内嵌渲染**目标正文（内核只渲染 Lake 正文；表格/多维表/画板
 * 正文是各自的 JSON，没有通道）。
 */
import { useMemo, useState } from "react";
import { Dialog } from "../../components/ui/Overlay";
import type { NoteSummary } from "../../lib/types";
import {
  NOTE_REF_CARD_META, appendNoteRefCard, isNoteRefGone, findNoteRef, noteKindLabel, noteRefHost, parseNoteRef,
  type NoteRefValue,
} from "./noteRef";
import "./noteRefCard.css";

export { NOTE_REF_CARD_NAME, NOTE_REF_SLASH_ITEM, NOTE_REF_MAIN_SEARCH, noteRefUrl, parseNoteRef, setNoteRefHost, isNoteRefGone, findNoteRef, noteKindLabel, withNoteRefSlashItem } from "./noteRef";

/** 选文档浮层：只列**未失效**的库内文档（按标题过滤）。表面/行/输入框全部复用 kit 原语。 */
function NoteRefPicker({ onPick, onClose }: { onPick: (note: NoteSummary) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const notes = useMemo(() => {
    const all = (noteRefHost()?.listNotes() ?? []).filter((n) => !isNoteRefGone(n.id));
    const q = query.trim().toLowerCase();
    return (q ? all.filter((n) => (n.title || "").toLowerCase().includes(q)) : all).slice(0, 200);
    // query 变化即重算；宿主内容由调用方保证是最新（App 每次 notes 变化都会重注册）
  }, [query]);
  return (
    <Dialog open onDismiss={onClose} label="选择要引用的文档">
      <header className="ln-dialog__head"><h3 className="ln-dialog__title">选择要引用的文档</h3></header>
      <div className="ln-dialog__body">
        <input className="ln-input__field ne-note-ref-dialog__search" autoFocus value={query} placeholder="搜索标题…"
          aria-label="搜索标题" onChange={(e) => setQuery(e.target.value)} />
        {notes.length === 0
          ? <p className="ln-empty"><small>没有匹配的文档</small></p>
          : (
            <ul className="ln-list ne-note-ref-dialog__list">
              {notes.map((note) => (
                <li key={note.id}>
                  <button type="button" className="ln-row ne-note-ref-dialog__item" onClick={() => onPick(note)}>
                    <span className="ln-ellipsis">{note.title || "无标题"}</span>
                    <span className="ne-note-ref__kind">{noteKindLabel(note.kind)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
      <div className="ln-dialog__actions">
        <button type="button" className="ln-btn" onClick={onClose}>取消</button>
      </div>
    </Dialog>
  );
}

/**
 * 卡片本体（编辑态 / 阅读态共用）：`mode === "edit"` 时多一个「更换」入口。
 * 点标题 = 打开目标文档（引用卡的主动作）；交互元素都 stopPropagation，免得内核把点击当成"选中卡片"。
 */
function NoteRefCard({ value, update, mode }: { value: NoteRefValue | null; update: (next: NoteRefValue) => void; mode: "edit" | "view" }) {
  const [picking, setPicking] = useState(false);
  const noteId = parseNoteRef(value);
  const note = findNoteRef(noteId);
  const gone = isNoteRefGone(noteId);
  const title = note?.title ?? value?.title ?? "";
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  if (!noteId) {
    return (
      <div className="ne-note-ref ne-note-ref--empty">
        <button type="button" className="ln-btn" onMouseDown={stop} onClick={() => setPicking(true)}>选择文档…</button>
        {picking && <NoteRefPicker onPick={(n) => { update({ noteId: n.id, title: n.title }); setPicking(false); }} onClose={() => setPicking(false)} />}
      </div>
    );
  }
  return (
    <div className="ne-note-ref" data-gone={gone ? "true" : undefined}>
      {gone
        ? <span className="ne-note-ref__title ne-note-ref__title--gone" title="目标文档已删除或不可用">文档已删除{title ? `：${title}` : ""}</span>
        : (
          <button type="button" className="ne-note-ref__title ln-ellipsis" title={`打开：${title || noteId}`}
            onMouseDown={stop} onClick={() => noteRefHost()?.openNote(noteId)}>{title || "无标题"}</button>
        )}
      <span className="ne-note-ref__kind">{gone ? "失效" : noteKindLabel(note?.kind)}</span>
      {mode === "edit" && (
        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="更换引用的文档" title="更换引用的文档"
          onMouseDown={stop} onClick={() => setPicking(true)}>换</button>
      )}
      {picking && <NoteRefPicker onPick={(n) => { update({ noteId: n.id, title: n.title }); setPicking(false); }} onClose={() => setPicking(false)} />}
    </div>
  );
}

/** 内核注册用的完整卡片描述（组件 + 与 React 无关的 meta）。 */
export const noteRefCardConfig = {
  ...NOTE_REF_CARD_META,
  editorComponent: (props: { cardValue: NoteRefValue; updateCardValue: (v: NoteRefValue) => void }) =>
    <NoteRefCard value={props.cardValue} update={props.updateCardValue} mode="edit" />,
  viewerComponent: (props: { cardValue: NoteRefValue; updateCardValue: (v: NoteRefValue) => void }) =>
    <NoteRefCard value={props.cardValue} update={props.updateCardValue} mode="view" />,
};

/** 把本卡追加进内核的 `customCard.cards`（幂等；必须在 prepareCustomCards 之前调用）。 */
export function registerNoteRefCard(config: Record<string, unknown>): void {
  appendNoteRefCard(config, noteRefCardConfig);
}
