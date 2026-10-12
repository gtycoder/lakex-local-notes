/**
 * 知识库展示（首页第二块）：
 * - view="shelf"：书架 —— 3:4 简约书卡（序号角标 + 图标/emoji + 名称 + 文档数）；
 * - view="list" ：列表行（图标 + 名称 + 计数 + 右箭头；行原语 = .mb-list-item）。
 * 排序：**不提供移动端重排**（知识库顺序 = 桌面/同步的 sort_order，见 HANDOFF/AGENTS 同步语义——
 *       移动端不写 sort_order，展示的就是共享目录顺序 = 桌面端顺序）。长按拖动重排已移除，点击直接进入。
 */
import type { TreeNode } from "../../lib/types";
import type { LibraryView } from "./HomePage";
import { Book, ChevronRight } from "lucide-react";

/** 更新时间（仿语雀：今天/昨天 HH:mm，更早 MM-DD）。 */
function fmtUpdated(iso: string | undefined): string {
  try {
    if (!iso) return "";
    const d = new Date(iso); const now = new Date();
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`;
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } catch { return ""; }
}

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
        {notebooks.map((nb) => {
          const count = docCounts[nb.id] ?? 0;
          return (
            <div key={nb.id} className="nb-shelf-card" role="button" tabIndex={0} onClick={() => onOpenNotebook(nb.id)}>
              <div className="nb-shelf-cover">
                <span className="nb-shelf-glyph">
                  {nb.icon ? <span className="nb-shelf-emoji">{nb.icon}</span> : <Book size={26} strokeWidth={1.75} className="nb-shelf-line" />}
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

  // 列表视图：仿语雀排布（图标块 + 标题 + 副标题「共 N 篇文档 · 更新时间」）
  return (
    <div className="nb-list">
      {notebooks.map((nb) => {
        const count = docCounts[nb.id] ?? 0;
        const updated = fmtUpdated(nb.updatedAt);
        return (
          <div key={nb.id} className="nb-row" role="button" tabIndex={0} onClick={() => onOpenNotebook(nb.id)}>
            <span className="nb-row__tile">
              {nb.icon ? <span className="nb-row__emoji">{nb.icon}</span> : <Book size={20} strokeWidth={1.9} />}
            </span>
            <span className="nb-row__main">
              <span className="nb-row__title">{nb.title || "未命名"}</span>
              <span className="nb-row__sub">共 {count} 篇文档{updated ? ` · ${updated}` : ""}</span>
            </span>
            <span className="nb-row__arrow"><ChevronRight size={16} /></span>
          </div>
        );
      })}
    </div>
  );
}
