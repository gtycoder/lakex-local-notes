/**
 * 知识库展示（首页第二块）：
 * - view="shelf"：书架 —— 3:4 白卡宫格（图标 emoji + 名称，名称带「序号-」前缀）；
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
  /** 书架视图是否给名称加「序号-」前缀（按排列顺序显示序号，非排序依据） */
  namePrefix?: boolean;
  onOpenNotebook: (id: string) => void;
}

export function NotebookGrid(props: NotebookGridProps) {
  const { notebooks, docCounts, view, namePrefix, onOpenNotebook } = props;

  if (notebooks.length === 0) return <div className="mobile-empty">暂无知识库</div>;

  // 书架视图：白卡（点开即进）
  if (view === "shelf") {
    return (
      <div className="nb-shelf">
        {notebooks.map((nb, i) => {
          const label = namePrefix ? `${String(i + 1).padStart(2, "0")}-${nb.title}` : nb.title;
          return (
            <div key={nb.id} className="nb-shelf-card" role="button" tabIndex={0} onClick={() => onOpenNotebook(nb.id)}>
              <div className="nb-shelf-cover">
                {nb.icon ? <span className="nb-shelf-emoji">{nb.icon}</span> : <BookOpen size={28} className="nb-shelf-line" />}
              </div>
              <div className="nb-shelf-name">{label}</div>
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
