/**
 * 知识库展示（首页第二块）：
 * - view="shelf"：书架 —— 3:4 简约书卡（序号角标 + 图标/emoji + 名称 + 文档数）；
 * - view="list" ：列表行（图标 + 名称 + 计数 + 右箭头；行原语 = .mb-list-item）。
 * 排序：**不提供移动端重排**（知识库顺序 = 桌面/同步的 sort_order，见 HANDOFF/AGENTS 同步语义——
 *       移动端不写 sort_order，展示的就是共享目录顺序 = 桌面端顺序）。长按拖动重排已移除，点击直接进入。
 */
import { useRef } from "react";
import type { TreeNode } from "../../lib/types";
import type { LibraryView } from "./HomePage";
import { Book, ChevronRight } from "lucide-react";
import { useLongPress } from "../ui/useLongPress";
import { MobileNodeIconGlyph } from "../ui/NodeIconGlyph";
import { formatListTime } from "../../core/dateFormat";

/** 更新时间（仿语雀：今天/昨天 HH:mm，更早 MM-DD）。 */
function fmtUpdated(iso: string | undefined): string {
  try {
    if (!iso) return "";
    return formatListTime(new Date(iso), new Date());
  } catch { return ""; }
}

export interface NotebookGridProps {
  notebooks: TreeNode[];
  /** 每个笔记本下的文档数（.counter 展示） */
  docCounts: Record<string, number>;
  /** 布局：shelf=书架宫格 / list=列表行 */
  view: LibraryView;
  onOpenNotebook: (id: string) => void;
  /** 长按笔记本（书卡 / 列表行）→ 打开编辑菜单（重命名 / 设置图标 / 删除笔记本）。用户 261014 定：笔记本编辑走这里。 */
  onLongPressNotebook?: (nb: TreeNode) => void;
  /** 就地重命名（与目录树行同语义）：正在改的 id + 值 + 回调。 */
  renamingId?: string | null;
  renameValue?: string;
  onRenameChange?: (value: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
}

export function NotebookGrid(props: NotebookGridProps) {
  const {
    notebooks, docCounts, view, onOpenNotebook, onLongPressNotebook,
    renamingId = null, renameValue = "", onRenameChange, onRenameCommit, onRenameCancel,
  } = props;
  /** 长按目标是"当前按下的那张卡"（hook 只能挂一次 ⇒ 用 ref 传目标）。 */
  const pressed = useRef<TreeNode | null>(null);
  /** 长按过的那一次要吞掉随后的 click（否则长按开菜单的同时又进了笔记本）。 */
  const suppressClick = useRef(false);
  const longPress = useLongPress(() => {
    const nb = pressed.current;
    if (!nb) return;
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 400);
    onLongPressNotebook?.(nb);
  });
  const pressProps = (nb: TreeNode) => ({
    onTouchStart: (e: React.TouchEvent) => { pressed.current = nb; longPress.onTouchStart(e); },
    onTouchMove: longPress.onTouchMove,
    onTouchEnd: longPress.onTouchEnd,
    onTouchCancel: longPress.onTouchCancel,
  });
  const openNotebook = (nb: TreeNode) => { if (suppressClick.current) return; onOpenNotebook(nb.id); };
  /** 就地重命名输入框（两个视图共用同一份，避免两套）。 */
  const renameInput = (className: string) => (
    <input
      className={"mb-input " + className}
      autoFocus
      value={renameValue}
      onChange={(e) => onRenameChange?.(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => onRenameCommit?.()}
      onKeyDown={(e) => { if (e.key === "Enter") onRenameCommit?.(); if (e.key === "Escape") onRenameCancel?.(); }}
    />
  );

  if (notebooks.length === 0) return <div className="mb-empty">暂无知识库</div>;

  // 书架视图：简约书卡（序号角标 + 图标 + 名称 + 文档数）
  if (view === "shelf") {
    return (
      <div className="nb-shelf">
        {notebooks.map((nb) => {
          const count = docCounts[nb.id] ?? 0;
          return (
            <div key={nb.id} className="nb-shelf-card" role="button" tabIndex={0} data-prevent-swipe
              onClick={() => openNotebook(nb)} {...pressProps(nb)}>
              <div className="nb-shelf-cover">
                <span className="nb-shelf-glyph">
                  {nb.icon ? <span className="nb-shelf-emoji"><MobileNodeIconGlyph value={nb.icon} /></span> : <Book size={26} strokeWidth={1.75} className="nb-shelf-line" />}
                </span>
              </div>
              {renamingId === nb.id
                ? renameInput("nb-shelf-name")
                : <div className="nb-shelf-name">{nb.title || "未命名"}</div>}
              <div className="nb-shelf-count">{count} 篇</div>
            </div>
          );
        })}
      </div>
    );
  }

  // 列表视图：仿语雀排布（图标块 + 标题 + 副标题「N 篇 · 更新时间」）
  // 261013 A 批：计数的**单位与措辞**与书架视图统一为「N 篇」（此前一处「N 篇」、一处「共 N 篇文档」）。
  return (
    <div className="nb-list">
      {notebooks.map((nb) => {
        const count = docCounts[nb.id] ?? 0;
        const updated = fmtUpdated(nb.updatedAt);
        return (
          <div key={nb.id} className="nb-row" role="button" tabIndex={0} data-prevent-swipe
            onClick={() => openNotebook(nb)} {...pressProps(nb)}>
            <span className="nb-row__tile">
              {nb.icon ? <span className="nb-row__emoji"><MobileNodeIconGlyph value={nb.icon} /></span> : <Book size={20} strokeWidth={1.9} />}
            </span>
            <span className="nb-row__main">
              {renamingId === nb.id
                ? renameInput("nb-row__title")
                : <span className="nb-row__title">{nb.title || "未命名"}</span>}
              <span className="nb-row__sub">{count} 篇{updated ? `，${updated}` : ""}</span>
            </span>
            <span className="nb-row__arrow"><ChevronRight size={16} /></span>
          </div>
        );
      })}
    </div>
  );
}
