/** 首页（小记/知识库切换 + 笔记本宫格）。Phase 1 基础版：真实 bridge 数据。 */
import { Feather, Plus, Search, Settings, Trash2 } from "lucide-react";
import type { TreeNode } from "../../lib/types";
import { NotebookGrid } from "./NotebookGrid";

export interface MobileQuickNote {
  id: string;
  previewText: string;
  imageCount: number;
  updatedAt: string;
}

export interface HomePageProps {
  tab: "quick" | "library";
  notebooks: TreeNode[];
  quickNotes: MobileQuickNote[];
  onCreateQuickNote: (text: string) => void;
  onTabChange: (tab: "quick" | "library") => void;
  onOpenNotebook: (id: string) => void;
  onReorderNotebooks: (orderedIds: string[]) => Promise<void>;
  onOpenNote: (id: string) => void;
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
  onCreateNote: () => void;
  onCreateNotebook: () => void;
  /** 小记 tab：打开小记回收站（B：小记全同步闭环的 UI 入口） */
  onOpenQuickTrash: () => void;
}

export function HomePage(props: HomePageProps) {
  const { tab, notebooks, quickNotes, onCreateQuickNote, onTabChange, onOpenNotebook, onReorderNotebooks, onOpenNote, onOpenDrawer, onOpenSearch, onCreateNote, onCreateNotebook, onOpenQuickTrash } = props;
  return (
    <div className="mobile-home">
      <header className="mobile-topbar">
        <button className="mobile-icon-btn" onClick={onOpenDrawer} aria-label="设置"><Settings size={20} /></button>
        <div className="mobile-home-tabs">
          <button className={tab === "quick" ? "mobile-htab active" : "mobile-htab"} onClick={() => onTabChange("quick")}>小记</button>
          <button className={tab === "library" ? "mobile-htab active" : "mobile-htab"} onClick={() => onTabChange("library")}>知识库</button>
        </div>
        <button className="mobile-icon-btn" onClick={onOpenSearch} aria-label="搜索"><Search size={20} /></button>
        {tab === "quick" && <button className="mobile-icon-btn" onClick={onOpenQuickTrash} aria-label="小记回收站" title="小记回收站"><Trash2 size={18} /></button>}
      </header>
      {tab === "quick" ? (
        <div className="mobile-scroll">
          <div className="mobile-quick-list">
            {quickNotes.length === 0 && <div className="mobile-empty">暂无小记，点右下新建</div>}
            {quickNotes.map((n) => (
              <div key={n.id} className="mobile-qcard">
                <div className="mobile-qcard-text">{n.previewText || (n.imageCount > 0 ? "[图片]" : "（空白小记）")}</div>
                <div className="mobile-qcard-meta">{new Date(n.updatedAt).toLocaleDateString("zh-CN")}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mobile-scroll">
          <NotebookGrid
            notebooks={notebooks}
            onOpenNotebook={onOpenNotebook}
            onReorder={onReorderNotebooks}
          />
        </div>
      )}
      <div className="mobile-fab-col">
        {tab === "quick" ? (
          <button className="mobile-fab" onClick={() => { const t = window.prompt("小记内容"); if (t?.trim()) onCreateQuickNote(t.trim()); }} aria-label="新建小记"><Plus size={24} /></button>
        ) : (
          <>
            <button className="mobile-fab" onClick={onCreateNote} aria-label="新建文档"><Plus size={24} /></button>
            <button className="mobile-fab mobile-fab-secondary" onClick={onCreateNotebook} aria-label="新建知识库"><Feather size={20} /></button>
          </>
        )}
      </div>
    </div>
  );
}
