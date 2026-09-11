/**
 * 知识库展示（首页第二块）：
 * - view="shelf"：书架 —— 3:4 简约书卡（序号角标 + 图标/emoji + 名称 + 文档数）；
 * - view="list" ：列表行（.b3-list--mobile 行 = 图标 + 名称 + .counter 文档数 + 右箭头）。
 * 排序：**不提供移动端重排**（知识库顺序 = 桌面/同步的 sort_order，见 HANDOFF/AGENTS 同步语义——
 *       移动端不写 sort_order，展示的就是共享目录顺序 = 桌面端顺序）。长按拖动重排已移除，点击直接进入。
 */
import type { TreeNode } from "../../lib/types";
import type { LibraryView } from "./HomePage";
import { BookOpen, ChevronRight } from "lucide-react";

export interface NotebookGridProps {
  notebooks: TreeNode[];
  /** 每个笔记本下的文档数（.counter 展示） */
  docCounts: Record<string, number>;
  /** 布局：shelf=书架宫格 / list=列表行 */
  view: LibraryView;
  onOpenNotebook: (id: string) => void;
}

export function NotebookGrid(props: NotebookGridProps) {
  const { notebooks, docCounts, view, onOpenNotebook } = props;

  if (notebooks.length === 0) return <div className="mobile-empty">暂无知识库</div>;

  // 书架视图：简约书卡（序号角标 + 图标 + 名称 + 文档数）
  if (view === "shelf") {
    return (
      <div className="nb-shelf">
        {notebooks.map((nb, i) => {
          const count = docCounts[nb.id] ?? 0;
          return (
            <div key={nb.id} className="nb-shelf-card" role="button" tabIndex={0} onClick={() => onOpenNotebook(nb.id)}>
              <div className="nb-shelf-cover">
                <span className="nb-shelf-index">{String(i + 1).padStart(2, "0")}</span>
                <span className="nb-shelf-glyph">
                  {nb.icon ? <span className="nb-shelf-emoji">{nb.icon}</span> : <BookOpen size={26} strokeWidth={1.75} className="nb-shelf-line" />}
                </span>
              </div>
              <div className="nb-shelf-name">{nb.title || "未命名"}</div>
              <div className="nb-shelf-count">{count} 篇</div>
            </div>
          );
        })}
      </div>
    );
  }

  // 列表视图：静态行（数据顺序 = 共享 sort_order = 桌面端顺序）
  return (
    <div className="b3-list b3-list--mobile mobile-nb-list">
      {notebooks.map((nb) => (
        <div key={nb.id} className="b3-list-item mobile-nb-row" role="button" tabIndex={0} onClick={() => onOpenNotebook(nb.id)}>
          <span className="b3-list-item__graphic">
            {nb.icon ? <span className="ln-node-emoji">{nb.icon}</span> : <BookOpen size={18} />}
          </span>
          <span className="b3-list-item__text">{nb.title}</span>
          <span className="counter">{docCounts[nb.id] ?? 0}</span>
          <span className="b3-list-item__arrow"><ChevronRight size={16} /></span>
        </div>
      ))}
    </div>
  );
}
