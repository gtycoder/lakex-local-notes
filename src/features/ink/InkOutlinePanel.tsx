/**
 * 手写板「大纲 / 书签」面板（261104 十八批）。
 *
 * 一本 300 页的书靠底部缩略图横条翻页太慢：大纲只列「有批注的页 + 书签」，一屏十几行、点一下直跳。
 * 书签是**设备本地数据**（inkBookmarks，不进正文）；大纲是纯派生（inkOutline）。
 *
 * 桌面专属控件，单独成文件：跨端样式护栏（crossEndClassCoverage）要求共享组件发出的类名两端都有样式，
 * 而移动端本轮没有大纲入口（移动端底部坞是定稿 7 键，不加第 8 个）。
 */
import { useState } from "react";
import { Bookmark, ListTree } from "lucide-react";
import type { InkPage } from "../../core/inkDoc.js";
import type { InkBookmark } from "./inkBookmarks.js";
import { buildInkOutline, inkOutlineSummary, type InkOutlineMode } from "./inkOutline.js";

export interface InkOutlineProps {
  open: boolean;
  onToggle: () => void;
  pages: readonly InkPage[];
  currentPageId?: string;
  bookmarks: readonly InkBookmark[];
  onJump: (pageId: string) => void;
  onToggleBookmark: () => void;
}

export function InkOutlinePanel({ open, onToggle, pages, currentPageId, bookmarks, onJump, onToggleBookmark }: InkOutlineProps) {
  const [mode, setMode] = useState<InkOutlineMode>("annotated");
  const outlinePages = pages.map((page) => ({
    id: page.id,
    strokeCount: page.strokes.length,
    hasBackgroundImage: Boolean(page.backgroundImage),
  }));
  const entries = buildInkOutline(outlinePages, bookmarks, mode);
  const currentIndex = pages.findIndex((page) => page.id === currentPageId);
  const currentBookmarked = bookmarks.some((item) => item.pageId === currentPageId);

  return (
    <div className="ink-outline" data-ink-outline>
      <button
        className={["ink-tool", open ? "is-active" : ""].join(" ")}
        onClick={onToggle}
        aria-label="大纲"
        title="大纲 / 书签"
        aria-expanded={open}
      ><ListTree size={16} /></button>
      {open && (
        <div className="ink-outline__panel" role="dialog" aria-label="大纲" data-ink-outline-panel>
          <div className="ink-outline__head">
            <span>{inkOutlineSummary(entries)}</span>
            <button
              className="ink-outline__mode"
              onClick={() => setMode(mode === "annotated" ? "all" : "annotated")}
            >{mode === "annotated" ? "显示全部页" : "只看批注"}</button>
          </div>
          <div className="ink-outline__current">
            <span>第 {currentIndex >= 0 ? currentIndex + 1 : 1} 页</span>
            <button
              className={["ink-outline__bookmark", currentBookmarked ? "is-active" : ""].join(" ")}
              onClick={onToggleBookmark}
              aria-pressed={currentBookmarked}
            ><Bookmark size={14} />{currentBookmarked ? "取消书签" : "加书签"}</button>
          </div>
          <div className="ink-outline__list" role="list">
            {entries.length === 0 && <p className="ink-outline__empty">还没有批注或书签，翻页画几笔就会出现</p>}
            {entries.map((entry) => (
              <button
                key={entry.pageId}
                role="listitem"
                className={["ink-outline__row", entry.pageId === currentPageId ? "is-current" : ""].join(" ")}
                onClick={() => onJump(entry.pageId)}
              >
                <span className="ink-outline__page">第 {entry.pageNumber} 页</span>
                <span className="ink-outline__meta">
                  {entry.bookmarked ? <Bookmark size={12} aria-label="已加书签" /> : null}
                  {entry.strokeCount > 0 ? `${entry.strokeCount} 笔` : entry.hasBackgroundImage ? "页图" : "空白"}
                </span>
                {entry.label ? <span className="ink-outline__label">{entry.label}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default InkOutlinePanel;