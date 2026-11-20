/**
 * 移动端「文档引用」的两个底部 Sheet（261120 用户点单）。
 *
 * 背景（用户点单三条）：① 旧实现直接复用桌面的锚定 Popover（`.ln-input` / `.ln-row` / `.ln-btn`），
 * 手机上又小又旧、与移动端设计语言割裂；② 打开即 focus 搜索框 ⇒ 默认拉起软键盘，且只能"先筛选"；
 * ③ 点击后编辑区会滚动（焦点/键盘/浮层几何叠加）。
 *
 * 现在：打开 = **直接列出全部文档**（不聚焦任何输入）；弹层 = `MobileSheet`（头部可上下拖动调整高度，
 * 261117 全站统一手势）；搜索框/列表/字段/底栏按钮全部走 `mb-*` 原语。选完只回填（与桌面同语义），
 * 编辑走第二个 Sheet（文本 + 链接）。
 *
 * 移动端 UI 层纪律：不引桌面样式层、不写颜色字面量（只用 --lake-* / mb-* 令牌）、不改内核产物。
 */
import { useEffect, useMemo, useState } from "react";
import { MobilePortal } from "../ui/MobilePortal";
import { MobileSheet } from "../ui/MobileSheet";
import { SheetFooter } from "../ui/SheetFooter";
import { isNoteRefGone, noteKindLabel, noteRefHost, parseNoteRef, findNoteRef } from "../../features/editor/noteRef";
import type { NoteSummary } from "../../lib/types";
import type { NoteRefEditorProps, NoteRefPickerProps } from "../../features/editor/noteRefMobileUi";

/** 与桌面同一上限（桌面 NoteRefPicker 也是 slice(0,200)）：2 万篇时不能把所有行都塞进 DOM。 */
const MAX_ROWS = 200;

/** 选文档：打开即全部文档；搜索框**不自动聚焦**（用户 261120：不许默认拉起键盘）。 */
export function NoteRefPickerSheet({ open, onPick, onClose }: NoteRefPickerProps) {
  const [query, setQuery] = useState("");
  // 每次重新打开都回到「全部文档」的初始态（不沿用上次的筛选词）。
  useEffect(() => { if (open) setQuery(""); }, [open]);
  const { notes, truncated } = useMemo(() => {
    const all = (noteRefHost()?.listNotes() ?? []).filter((n) => !isNoteRefGone(n.id));
    const q = query.trim().toLowerCase();
    const matched = q ? all.filter((n) => (n.title || "").toLowerCase().includes(q)) : all;
    return { notes: matched.slice(0, MAX_ROWS), truncated: matched.length > MAX_ROWS };
  }, [query, open]);
  // 卡片由内核 React 树渲染（正文区可能带 transform 祖先）⇒ 弹层必须 portal 到 body
  //（统一走 MobilePortal 原语，见其头注释）。
  return (
    <MobilePortal>
    <MobileSheet
      open={open}
      title="选择文档"
      onClose={onClose}
      className="mb-sheet--note-ref"
      bodyClassName="mb-sheet__body--form"
    >
      <span className="mb-input mb-note-ref__search">
        <input
          value={query}
          aria-label="搜索文档"
          placeholder="搜索文档标题"
          onChange={(event) => setQuery(event.target.value)}
        />
      </span>
      {notes.length === 0 ? (
        <p className="mb-empty mb-empty--inset">{query.trim() ? "没有匹配的文档" : "还没有文档"}</p>
      ) : (
        <div className="mb-list mb-note-ref__list">
          {notes.map((note) => (
            <button
              key={note.id}
              type="button"
              className="mb-row mb-note-ref__item"
              onClick={() => onPick(note)}
            >
              <span className="mb-row__title mb-ellipsis">{note.title || "无标题"}</span>
              <span className="mb-row__meta">{noteKindLabel(note.kind)}</span>
            </button>
          ))}
        </div>
      )}
      {truncated && <p className="mb-form__desc">只列出前 {MAX_ROWS} 篇，继续输入标题可以缩小范围。</p>}
    </MobileSheet>
    </MobilePortal>
  );
}

/** 编辑「文本 / 链接」：桌面是锚定 `.ne-link-editor` 浮层，移动端换成底部 Sheet（同一份字段语义）。 */
export function NoteRefEditorSheet({ open, value, onSave, onClose }: NoteRefEditorProps) {
  const [name, setName] = useState(value.title ?? "");
  const [picked, setPicked] = useState<{ noteId: string; title: string; kind?: string } | null>(null);
  const [picking, setPicking] = useState(false);
  // Sheet 常驻挂载：每次**打开**都按卡片当前值重建表单，不沿用上一次的输入。
  // 依赖只看 open（不跟 value.title）：编辑期间宿主会随每次输入重渲染，跟 title 会在打字时把
  // picked/picking 一起重置（选文档 Sheet 被顶掉）。
  useEffect(() => {
    if (!open) return;
    setName(value.title ?? "");
    setPicked(null);
    setPicking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const existing = findNoteRef(parseNoteRef(value));
  const refId = picked?.noteId ?? parseNoteRef(value);
  const targetTitle = picked ? picked.title : (existing?.title ?? value.title ?? "");
  const targetKind = picked ? picked.kind : existing?.kind;
  const targetLabel = refId ? `${targetTitle || "无标题"}（${noteKindLabel(targetKind)}）` : "";
  const hasRef = Boolean(refId);
  const applyPick = (note: NoteSummary) => {
    const title = note.title || "无标题";
    setPicked({ noteId: note.id, title, kind: note.kind });
    // 只回填、不落库；文本为空时用目标标题预填，用户已写过的文本不覆盖。
    setName((prev) => (prev.trim() === "" ? title : prev));
    setPicking(false);
  };
  return (
    <MobilePortal>
      <MobileSheet
        open={open}
        title="文档引用"
        onClose={() => { if (!picking) onClose(); }}
        bodyClassName="mb-sheet__body--form"
        footer={<SheetFooter
          cancel={{ label: "取消", onClick: onClose }}
          confirm={{ label: "确定", disabled: !hasRef, onClick: () => onSave({ noteId: refId ?? "", title: name.trim() || targetTitle }) }}
        />}
      >
        <div className="mb-set-items">
          <div className="mb-set-item mb-set-item--field">
            <div className="mb-set-item__main"><div className="mb-set-name">文本</div></div>
            <div className="mb-set-item__ctl">
              <span className="mb-input">
                <input value={name} aria-label="文本" placeholder="添加描述" onChange={(event) => setName(event.target.value)} />
              </span>
            </div>
          </div>
          <div className="mb-set-item mb-set-item--field">
            <div className="mb-set-item__main"><div className="mb-set-name">链接</div></div>
            <div className="mb-set-item__ctl">
              <button type="button" className="mb-input mb-note-ref__link" aria-label="选择文档" onClick={() => setPicking(true)}>
                <span className={hasRef ? "mb-ellipsis" : "mb-ellipsis mb-note-ref__placeholder"}>{targetLabel || "选择文档…"}</span>
              </button>
            </div>
          </div>
        </div>
      </MobileSheet>
      {/* 选文档 Sheet 叠在编辑 Sheet 之上（与 DocListSheet → BatchTagPickerSheet 同一嵌套姿势）。 */}
      <NoteRefPickerSheet open={open && picking} onPick={applyPick} onClose={() => setPicking(false)} />
    </MobilePortal>
  );
}
