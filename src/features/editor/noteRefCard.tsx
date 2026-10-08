/**
 * 「文档引用」卡的 **React 部分**（R2，261008 用户定稿）；纯逻辑见 `noteRef.ts`。
 *
 * 形态（261008 二改：用户要求「模仿内核链接的样式」）：卡片 = 类型图标 + 展示名（主色、hover 下划线），
 * **悬停出浮层**，四个动作与内核链接一致 —— **访问 / 编辑（改展示名称 + 换文档）/ 复制 / 取消链接**。
 * - 访问 = 打开引用的文档标签页；
 * - 编辑 = 弹窗改「展示名称」与「目标文档」（换文档复用同一个选择器）；
 * - 复制 = 把 `lake-note://<id>` 写入剪贴板（与"复制链接"同义）；
 * - 取消链接 = 清掉引用（`noteId` 置空），**保留展示名**并渲染成纯文本（与内核"取消链接"语义一致）。
 *
 * 只存引用元数据、**不内嵌渲染**目标正文（内核只渲染 Lake 正文；表格/多维表/画板正文是各自的 JSON）。
 * 浮层走 `Overlay` 的 `HoverPopover`（锚点与表面共享悬停区 + 开/关延时），定位走 `usePopoverPosition`。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Check, Copy, Pencil, SquareArrowOutUpRight, Unlink } from "lucide-react";
import { Menu, Popover } from "../../components/ui/Overlay";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import type { NoteSummary } from "../../lib/types";
import {
  NOTE_REF_CARD_META, appendNoteRefCard, isNoteRefGone, findNoteRef, noteKindLabel, noteRefHost, noteRefUrl, parseNoteRef,
  type NoteRefValue,
} from "./noteRef";
import "./noteRefCard.css";

export { NOTE_REF_CARD_NAME, NOTE_REF_SLASH_ITEM, NOTE_REF_MAIN_SEARCH, noteRefUrl, parseNoteRef, setNoteRefHost, isNoteRefGone, findNoteRef, noteKindLabel, withNoteRefSlashItem } from "./noteRef";

/** 选文档浮层：只列**未失效**的库内文档（按标题过滤）。表面/行/输入框全部复用 kit 原语。 */
function NoteRefPicker({ onPick, onClose, surfaceRef, style }: { onPick: (note: NoteSummary) => void; onClose: () => void; surfaceRef?: (el: HTMLElement | null) => void; style?: { left: number; top: number } }) {
  const [query, setQuery] = useState("");
  const notes = useMemo(() => {
    const all = (noteRefHost()?.listNotes() ?? []).filter((n) => !isNoteRefGone(n.id));
    const q = query.trim().toLowerCase();
    return (q ? all.filter((n) => (n.title || "").toLowerCase().includes(q)) : all).slice(0, 200);
  }, [query]);
  return (
    <Popover open onDismiss={onClose} label="选择要引用的文档" surfaceRef={surfaceRef} style={style ?? undefined}>
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
    </Popover>
  );
}

/** 编辑浮层（**锚定在卡片旁**，不是全局弹窗；对齐内核链接的「编辑」）：改**展示名称** + **换文档**。 */
function NoteRefEditPopover({ value, anchor, onSave, onClose }: { value: NoteRefValue; anchor: HTMLElement | null; onSave: (next: NoteRefValue) => void; onClose: () => void }) {
  const [name, setName] = useState(value.title ?? "");
  const [picking, setPicking] = useState(false);
  const pos = usePopoverPosition({ open: !picking, anchor, gap: 6 });
  const target = findNoteRef(parseNoteRef(value));
  return (
    <>
      <Popover open={!picking} onDismiss={onClose} label="编辑文档引用" surfaceRef={pos.surfaceRef} style={pos.style ?? undefined}>
        <div className="ln-dialog__body">
          {/* 复刻内核链接编辑：字段名在上、控件在下（截图为「文本 / 链接」+ 只留「确定」） */}
          <label className="ne-note-ref-edit__label">文本
            <input className="ln-input__field" value={name} autoFocus placeholder="显示在文档里的名称"
              onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="ne-note-ref-edit__label">链接
            <button type="button" className="ln-btn" onClick={() => setPicking(true)}>
              {target ? `${target.title || "无标题"} · ${noteKindLabel(target.kind)}` : "选择文档…"}
            </button>
          </label>
        </div>
        <div className="ln-dialog__actions">
          <button type="button" className="ln-btn" disabled={!parseNoteRef(value)}
            onClick={() => onSave({ noteId: parseNoteRef(value) ?? "", title: name.trim() })}>确定</button>
        </div>
      </Popover>
      {picking && (
        <NoteRefPicker onClose={() => setPicking(false)}
          onPick={(note) => { onSave({ noteId: note.id, title: name.trim() || note.title }); setPicking(false); }} />
      )}
    </>
  );
}

/**
 * 卡片本体（编辑态 / 阅读态共用）：**点击卡片打开动作菜单**（可点、可靠 —— 悬停浮层在内核树里点不到）；
 * 正文用内核自己的 `.ne-link` 类渲染 ⇒ **样式直接复刻链接**。`mode === "view"` 时只给读操作。
 */
function NoteRefCard({ value, update, mode }: { value: NoteRefValue | null; update: (next: NoteRefValue) => void; mode: "edit" | "view" }) {
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const rootRef = useCallback((el: HTMLElement | null) => { anchorRef.current = el; setAnchor(el); }, []);
  const pos = usePopoverPosition({ open: menuOpen, anchor, gap: 6 });
  const noteId = parseNoteRef(value);
  const note = findNoteRef(noteId);
  const gone = isNoteRefGone(noteId);
  const title = note?.title ?? value?.title ?? "";
  const readonly = mode === "view";

  const copyRef = () => {
    if (!noteId) return;
    void navigator.clipboard?.writeText(noteRefUrl(noteId));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  /** 动作菜单：与内核链接那套一致（访问 / 编辑 / 复制 / 取消链接）。 */
  const actionsMenu = (
    <Menu open={menuOpen} onDismiss={() => setMenuOpen(false)} className="ne-note-ref-actions" label="文档引用操作"
      surfaceRef={pos.surfaceRef} style={pos.style ?? undefined}>
      {noteId && !gone && (
        <button type="button" className="ln-iconbtn ln-iconbtn--compact" title="访问" aria-label="访问"
          onClick={() => { setMenuOpen(false); noteRefHost()?.openNote(noteId); }}><SquareArrowOutUpRight size={14} /></button>
      )}
      {!readonly && (
        <button type="button" className="ln-iconbtn ln-iconbtn--compact" title="编辑（改展示名称 / 换文档）" aria-label="编辑"
          onClick={() => { setMenuOpen(false); setEditing(true); }}><Pencil size={14} /></button>
      )}
      {noteId && (
        <button type="button" className="ln-iconbtn ln-iconbtn--compact" title={`复制引用（${noteRefUrl(noteId)}）`} aria-label="复制"
          onClick={copyRef}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
      )}
      {!readonly && noteId && (
        <button type="button" className="ln-iconbtn ln-iconbtn--compact" title="取消链接（保留展示名）" aria-label="取消链接"
          onClick={() => { setMenuOpen(false); update({ noteId: "", title }); }}><Unlink size={14} /></button>
      )}
    </Menu>
  );

  // 空引用：先出「选择文档…」；已经"取消链接"过（有展示名无引用）⇒ 纯文本 + 点开菜单重新引用
  if (!noteId) {
    return (
      <div className="ne-note-ref ne-note-ref--plain" ref={rootRef}>
        {value?.title
          ? <span className="ne-note-ref__plain ln-ellipsis" onClick={() => setMenuOpen(true)}>{value.title}</span>
          : <button type="button" className="ln-btn" onClick={() => setPicking(true)}>选择文档…</button>}
        {actionsMenu}
        {picking && <NoteRefPicker onClose={() => setPicking(false)} onPick={(n) => { update({ noteId: n.id, title: n.title }); setPicking(false); }} />}
        {editing && <NoteRefEditPopover value={value ?? {}} anchor={anchor} onClose={() => setEditing(false)} onSave={(nextValue) => { update(nextValue); setEditing(false); }} />}
      </div>
    );
  }

  return (
    <div className="ne-note-ref" ref={rootRef} data-gone={gone ? "true" : undefined} onClick={() => setMenuOpen(true)}>
      {gone
        ? <span className="ne-note-ref__title ne-note-ref__title--gone" title="目标文档已删除或不可用">文档已删除{title ? `：${title}` : ""}</span>
        : <span className="ne-note-ref__title ln-ellipsis" title={`点击操作：${title || noteId}`}><span className="ne-link">{title || "无标题"}</span></span>}
      <span className="ne-note-ref__kind">{gone ? "失效" : noteKindLabel(note?.kind)}</span>
      {actionsMenu}
      {editing && <NoteRefEditPopover value={value ?? {}} anchor={anchor} onClose={() => setEditing(false)} onSave={(nextValue) => { update(nextValue); setEditing(false); }} />}
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