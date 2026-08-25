/** 首页（小记/知识库切换 + 笔记本宫格）。Phase 1 基础版：真实 bridge 数据。 */
import { BookOpen, Feather, Plus, Search, Settings } from "lucide-react";
import type { POCNote } from "../bridge";
import type { TreeNode } from "../../lib/types";

export interface HomePageProps {
  tab: "quick" | "library";
  notebooks: TreeNode[];
  quickNotes: POCNote[];
  onTabChange: (tab: "quick" | "library") => void;
  onOpenNotebook: (id: string) => void;
  onOpenNote: (id: string) => void;
  onOpenDrawer: () => void;
  onCreateNote: () => void;
  onCreateNotebook: (title: string) => void;
}

export function HomePage(props: HomePageProps) {
  const { tab, notebooks, quickNotes, onTabChange, onOpenNotebook, onOpenNote, onOpenDrawer, onCreateNote, onCreateNotebook } = props;
  return (
    <div className="mobile-home">
      <header className="mobile-topbar">
        <button className="mobile-icon-btn" onClick={onOpenDrawer} aria-label="设置"><Settings size={20} /></button>
        <div className="mobile-home-tabs">
          <button className={tab === "quick" ? "mobile-htab active" : "mobile-htab"} onClick={() => onTabChange("quick")}>小记</button>
          <button className={tab === "library" ? "mobile-htab active" : "mobile-htab"} onClick={() => onTabChange("library")}>知识库</button>
        </div>
        <button className="mobile-icon-btn" aria-label="占位" style={{ opacity: 0 }}><Search size={20} /></button>
      </header>
      {tab === "quick" ? (
        <div className="mobile-scroll">
          <div className="mobile-quick-list">
            {quickNotes.length === 0 && <div className="mobile-empty">暂无小记</div>}
            {quickNotes.map((n) => (
              <div key={n.id} className="mobile-qcard" onClick={() => onOpenNote(n.id)}>
                <div className="mobile-qcard-text">{n.title}</div>
                <div className="mobile-qcard-meta">{new Date(n.updatedAt).toLocaleDateString("zh-CN")}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mobile-scroll">
          <div className="mobile-nb-grid">
            {notebooks.length === 0 && <div className="mobile-empty">暂无知识库</div>}
            {notebooks.map((nb) => (
              <div key={nb.id} className="mobile-nb-card" onClick={() => onOpenNotebook(nb.id)}>
                <div className="mobile-nb-cover"><BookOpen size={28} /></div>
                <div className="mobile-nb-name">{nb.title}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mobile-fab-col">
        <button className="mobile-fab" onClick={onCreateNote} aria-label="新建文档"><Plus size={24} /></button>
        <button className="mobile-fab mobile-fab-secondary" onClick={() => { const t = window.prompt("知识库名称"); if (t?.trim()) onCreateNotebook(t.trim()); }} aria-label="新建知识库"><Feather size={20} /></button>
      </div>
    </div>
  );
}
