/** 首页（小记/知识库切换 + 笔记本宫格）。小记 tab：composer 新建/编辑 + 卡片（含图片缩略图）。 */
import { useState } from "react";
import { Plus, Search, Settings } from "lucide-react";
import type { TreeNode } from "../../lib/types";
import { NotebookGrid } from "./NotebookGrid";
import { QuickNoteComposer } from "./QuickNoteComposer";
import { bridge } from "../bridge";
import { useHorizontalSwipe } from "../useHorizontalSwipe";
import { localAssetHttpUrl } from "../../core/assetUrl.js";

export interface MobileQuickNote {
  id: string;
  previewText: string;
  imageCount: number;
  updatedAt: string;
  /** 首图文件名（listQuickNotes 一次返回，卡片不再逐条 readQuickNote） */
  firstImage: string | null;
}

export interface HomePageProps {
  tab: "quick" | "library";
  notebooks: TreeNode[];
  quickNotes: MobileQuickNote[];
  onTabChange: (tab: "quick" | "library") => void;
  onOpenNotebook: (id: string) => void;
  onReorderNotebooks: (orderedIds: string[]) => Promise<void>;
  onOpenNote: (id: string) => void;
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
  onCreateNote: () => void;
  onCreateNotebook: () => void;
  /** 小记列表变化（composer 保存/编辑后刷新） */
  onQuickNotesChanged: () => Promise<void>;
}

type ComposerState = { mode: "new" } | { mode: "edit"; id: string } | null;

export function HomePage(props: HomePageProps) {
  const {
    tab, notebooks, quickNotes, onTabChange, onOpenNotebook, onReorderNotebooks, onOpenNote,
    onOpenDrawer, onOpenSearch, onCreateNote, onCreateNotebook, onQuickNotesChanged,
  } = props;
  const [composer, setComposer] = useState<ComposerState>(null);
  const [editNote, setEditNote] = useState<{ id: string; text: string; images: import("../../core/quickNoteModel.js").StoredQuickNoteImage[] } | null>(null);

  // 左右横滑切换小记 ↔ 知识库（左滑→知识库，右滑→小记）
  useHorizontalSwipe((dir) => {
    if (dir === "left" && tab === "quick") onTabChange("library");
    else if (dir === "right" && tab === "library") onTabChange("quick");
  });

  const openEdit = async (id: string): Promise<void> => {
    try {
      const full = await bridge.readQuickNote(id);
      if (!full) return;
      setEditNote({ id, text: full.content.text, images: full.content.images });
      setComposer({ mode: "edit", id });
    } catch { /* 读取失败忽略 */ }
  };

  const closeComposer = (): void => {
    setComposer(null);
    setEditNote(null);
  };

  return (
    <div className="mobile-home">
      <header className="mobile-topbar">
        <button className="mobile-icon-btn" onClick={onOpenDrawer} aria-label="设置"><Settings size={20} /></button>
        <div className="mobile-home-tabs">
          <button className={tab === "quick" ? "mobile-htab active" : "mobile-htab"} onClick={() => onTabChange("quick")}>小记</button>
          <button className={tab === "library" ? "mobile-htab active" : "mobile-htab"} onClick={() => onTabChange("library")}>知识库</button>
        </div>
        <button className="mobile-icon-btn" onClick={onOpenSearch} aria-label="搜索"><Search size={20} /></button>
      </header>
      {tab === "quick" ? (
        composer !== null ? (
          <div className="mobile-scroll">
            <QuickNoteComposer
              editNote={editNote}
              onSaved={async () => { closeComposer(); await onQuickNotesChanged(); }}
              onCancel={closeComposer}
            />
          </div>
        ) : (
          <div className="mobile-scroll">
            <div className="mobile-quick-list">
              {quickNotes.length === 0 && <div className="mobile-empty">暂无小记，点右下新建</div>}
              {quickNotes.map((n) => (
                <QuickNoteCard key={n.id} note={n} onEdit={() => void openEdit(n.id)} />
              ))}
            </div>
          </div>
        )
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
          composer !== null
            ? null
            : <button className="mobile-fab" onClick={() => { setEditNote(null); setComposer({ mode: "new" }); }} aria-label="新建小记"><Plus size={24} /></button>
        ) : (
          <>
            <button className="mobile-fab" onClick={onCreateNotebook} aria-label="新建知识库"><Plus size={24} /></button>
          </>
        )}
      </div>
    </div>
  );
}

/** 小记卡片：previewText + 首图缩略图（canonical URL 直显——本地 AssetServer 服务 quick-notes/）。 */
function QuickNoteCard({ note, onEdit }: { note: MobileQuickNote; onEdit: () => void }) {
  const thumbUrl = note.firstImage ? localAssetHttpUrl(note.id, note.firstImage, { space: "quick-notes" }) : null;

  return (
    <div className="mobile-qcard" onClick={onEdit}>
      {thumbUrl && <img className="mobile-qcard-thumb" src={thumbUrl} alt="" loading="lazy" />}
      <div className="mobile-qcard-text">{note.previewText || (note.imageCount > 0 ? "[图片]" : "（空白小记）")}</div>
      <div className="mobile-qcard-meta">{new Date(note.updatedAt).toLocaleDateString("zh-CN")}</div>
    </div>
  );
}
