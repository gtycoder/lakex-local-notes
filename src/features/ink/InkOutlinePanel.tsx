/**
 * 手写板「大纲 / 页备注」面板（261104 十八批；二十批把书签换成正文页备注）。
 *
 * 一本 300 页的书靠底部缩略图横条翻页太慢：大纲只列「有批注 / 有备注」的页，一屏十几行、点一下直跳。
 * 页备注是**正文数据**（`page.note`，v4 起随正文同步）；大纲是纯派生（inkOutline）。
 *
 * 桌面专属控件，单独成文件：跨端样式护栏（crossEndClassCoverage）要求共享组件发出的类名两端都有样式，
 * 而移动端本轮没有大纲入口（移动端底部坞是定稿 7 键，不加第 8 个）。
 */
import { useEffect, useState } from "react";
import { ListTree, NotebookPen } from "lucide-react";
import type { InkPage } from "../../core/inkDoc.js";
import { MAX_PAGE_NOTE_CHARS } from "../../core/inkDoc.js";
import { INK_OUTLINE_MODE_LABELS, buildInkOutline, inkOutlineSummary, nextInkOutlineMode, type InkOutlineMode } from "./inkOutline.js";

export interface InkOutlinePanelProps {
  open: boolean;
  onToggle: () => void;
  pages: readonly InkPage[];
  currentPageId?: string;
  onJump: (pageId: string) => void;
  /** 保存当前页备注（空串 = 删除备注）；宿主负责提交正文并进撤销栈。 */
  onSaveNote: (text: string) => void;
}

export function InkOutlinePanel({ open, onToggle, pages, currentPageId, onJump, onSaveNote }: InkOutlinePanelProps) {
  const [mode, setMode] = useState<InkOutlineMode>("annotated");
  const current = pages.find((page) => page.id === currentPageId);
  const [noteDraft, setNoteDraft] = useState(current?.note ?? "");
  // 切页/换文档时把输入框同步成那一页的备注（不覆盖正在编辑的同一页）。
  useEffect(() => {
    setNoteDraft(current?.note ?? "");
  }, [current?.id, current?.note]);

  const outlinePages = pages.map((page) => ({
    id: page.id,
    strokeCount: page.strokes.length,
    hasBackgroundImage: Boolean(page.backgroundImage),
    ...(page.note ? { note: page.note } : {}),
  }));
  const entries = buildInkOutline(outlinePages, mode);
  const currentIndex = pages.findIndex((page) => page.id === currentPageId);
  const dirty = noteDraft.trim() !== (current?.note ?? "").trim();

  return (
    <div className="ink-outline" data-ink-outline>
      <button
        className={["ink-tool", open ? "is-active" : ""].join(" ")}
        onClick={onToggle}
        aria-label="大纲"
        title="大纲 / 页备注"
        aria-expanded={open}
      ><ListTree size={16} /></button>
      {open && (
        <div className="ink-outline__panel" role="dialog" aria-label="大纲" data-ink-outline-panel>
          <div className="ink-outline__head">
            <span>{inkOutlineSummary(entries)}</span>
            <button
              className="ink-outline__mode"
              onClick={() => setMode(nextInkOutlineMode(mode))}
              aria-label="切换显示范围"
              title="切换显示范围：只看批注 / 全部页 / 只看有备注"
            >{INK_OUTLINE_MODE_LABELS[mode]}</button>
          </div>
          <div className="ink-outline__note">
            <label className="ink-outline__note-label" htmlFor="ink-outline-note">
              <NotebookPen size={13} />第 {currentIndex >= 0 ? currentIndex + 1 : 1} 页备注
            </label>
            <div className="ink-outline__note-row">
              <input
                id="ink-outline-note"
                className="ink-outline__note-input"
                value={noteDraft}
                maxLength={MAX_PAGE_NOTE_CHARS}
                placeholder="给这一页写一句话说明"
                onChange={(event) => setNoteDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); onSaveNote(noteDraft.trim()); }
                  if (event.key === "Escape") setNoteDraft(current?.note ?? "");
                }}
              />
              <button
                className="ink-outline__note-save"
                onClick={() => onSaveNote(noteDraft.trim())}
                disabled={!dirty}
                title={dirty ? "保存备注（Enter）" : "没有改动"}
              >保存</button>
            </div>
          </div>
          <div className="ink-outline__list" role="list">
            {entries.length === 0 && (
              <p className="ink-outline__empty">
                {mode === "noted"
                  ? "还没有备注：在上面输入一句说明并保存，这一页就会出现在这里"
                  : "还没有批注或备注，翻页画几笔就会出现"}
              </p>
            )}
            {entries.map((entry) => (
              <button
                key={entry.pageId}
                role="listitem"
                className={["ink-outline__row", entry.pageId === currentPageId ? "is-current" : ""].join(" ")}
                onClick={() => onJump(entry.pageId)}
              >
                <span className="ink-outline__page">第 {entry.pageNumber} 页</span>
                <span className="ink-outline__meta">
                  {entry.strokeCount > 0 ? `${entry.strokeCount} 笔` : entry.hasBackgroundImage ? "页图" : "空白"}
                </span>
                {entry.note ? <span className="ink-outline__label">{entry.note}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default InkOutlinePanel;
