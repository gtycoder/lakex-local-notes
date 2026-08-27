/** 首页（小记/知识库切换 + 笔记本宫格）。小记 tab：composer 新建/编辑 + 卡片（含图片缩略图）。 */
import { useEffect, useState } from "react";
import { Feather, Plus, Search, Settings, Trash2 } from "lucide-react";
import type { TreeNode } from "../../lib/types";
import { NotebookGrid } from "./NotebookGrid";
import { QuickNoteComposer } from "./QuickNoteComposer";
import { bridge } from "../bridge";

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
  /** 小记列表变化（composer 保存/编辑后刷新） */
  onQuickNotesChanged: () => Promise<void>;
}

type ComposerState = { mode: "new" } | { mode: "edit"; id: string } | null;

export function HomePage(props: HomePageProps) {
  const {
    tab, notebooks, quickNotes, onTabChange, onOpenNotebook, onReorderNotebooks, onOpenNote,
    onOpenDrawer, onOpenSearch, onCreateNote, onCreateNotebook, onOpenQuickTrash, onQuickNotesChanged,
  } = props;
  const [composer, setComposer] = useState<ComposerState>(null);
  const [editNote, setEditNote] = useState<{ id: string; text: string; images: import("../../core/quickNoteModel.js").StoredQuickNoteImage[] } | null>(null);

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
        {tab === "quick" && <button className="mobile-icon-btn" onClick={onOpenQuickTrash} aria-label="小记回收站" title="小记回收站"><Trash2 size={18} /></button>}
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
            <button className="mobile-fab" onClick={onCreateNote} aria-label="新建文档"><Plus size={24} /></button>
            <button className="mobile-fab mobile-fab-secondary" onClick={onCreateNotebook} aria-label="新建知识库"><Feather size={20} /></button>
          </>
        )}
      </div>
    </div>
  );
}

/** 小记卡片：previewText + 首图缩略图（canonical URL 直显——本地 AssetServer 服务 quick-notes/）。 */
function QuickNoteCard({ note, onEdit }: { note: MobileQuickNote; onEdit: () => void }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const full = await bridge.readQuickNote(note.id);
        const first = full?.content.images?.[0];
        if (first && alive) {
          // 与桌面端一致的 canonical 形态：http://127.0.0.1:19876/quick-notes/{id}/{file}
          setThumbUrl(`http://127.0.0.1:19876/quick-notes/${note.id}/${encodeURIComponent(first.filename)}`);
        }
      } catch { /* 单卡缩略图失败忽略 */ }
    })();
    return () => { alive = false; };
  }, [note.id]);

  return (
    <div className="mobile-qcard" onClick={onEdit}>
      {thumbUrl && <img className="mobile-qcard-thumb" src={thumbUrl} alt="" loading="lazy" />}
      <div className="mobile-qcard-text">{note.previewText || (note.imageCount > 0 ? "[图片]" : "（空白小记）")}</div>
      <div className="mobile-qcard-meta">{new Date(note.updatedAt).toLocaleDateString("zh-CN")}</div>
    </div>
  );
}
