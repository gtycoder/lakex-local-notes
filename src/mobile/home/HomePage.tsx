/**
 * 第一层（首页）：小记 / 知识库 两个 tab。
 * 思源口径：顶栏 = .toolbar--border + .toolbar__button（48×48 图标）；tab 用「底部指示线」语言（与桌面 .ln-tabs 同源）；
 * 列表 = .b3-list--mobile 平铺行（不再白卡阴影）；新建/同步走底部胶囊栏（思源移动端没有 FAB）。
 */
import { useState } from "react";
import { CloudUpload, FilePlus, Plus, Search, Settings, StickyNote } from "lucide-react";
import type { TreeNode } from "../../lib/types";
import { NotebookGrid } from "./NotebookGrid";
import { QuickNoteComposer } from "./QuickNoteComposer";
import { bridge } from "../bridge";
import { useHorizontalSwipe } from "../useHorizontalSwipe";
import { showToast } from "../ui/toastBus";
import { tapFeedback } from "../ui/haptics";
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
  /** 笔记本 → 文档数（列表行 .counter） */
  docCounts: Record<string, number>;
  onTabChange: (tab: "quick" | "library") => void;
  onOpenNotebook: (id: string) => void;
  onReorderNotebooks: (orderedIds: string[]) => Promise<void>;
  onOpenNote: (id: string) => void;
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
  onCreateNote: () => void;
  onCreateNotebook: () => void;
  onQuickNotesChanged: () => Promise<void>;
}

type ComposerState = { mode: "new" } | { mode: "edit"; id: string } | null;

export function HomePage(props: HomePageProps) {
  const {
    tab, notebooks, quickNotes, docCounts, onTabChange, onOpenNotebook, onReorderNotebooks,
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
  const closeComposer = (): void => { setComposer(null); setEditNote(null); };
  const switchTab = (next: "quick" | "library"): void => { tapFeedback(); onTabChange(next); };
  const runSync = async (): Promise<void> => {
    tapFeedback();
    try { const r = await bridge.syncNow(); showToast(r.message || "已同步"); }
    catch (e) { showToast("同步失败：" + (e as Error).message, { type: "error" }); }
  };

  return (
    <div className="mobile-home">
      <header className="toolbar toolbar--border mobile-topbar">
        <button className="toolbar__button" onClick={onOpenDrawer} aria-label="设置" title="设置"><Settings /></button>
        <div className="mobile-home-tabs">
          <button className={tab === "quick" ? "mobile-htab active" : "mobile-htab"} onClick={() => switchTab("quick")}>小记</button>
          <button className={tab === "library" ? "mobile-htab active" : "mobile-htab"} onClick={() => switchTab("library")}>知识库</button>
        </div>
        <button className="toolbar__button" onClick={onOpenSearch} aria-label="搜索" title="搜索"><Search /></button>
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
            {quickNotes.length === 0 ? (
              <div className="mobile-empty">
                暂无小记
                <button className="b3-button b3-button--outline mobile-empty-action" onClick={() => { setEditNote(null); setComposer({ mode: "new" }); }}>
                  <Plus size={16} />写一条小记
                </button>
              </div>
            ) : (
              <div className="b3-list b3-list--mobile mobile-quick-list">
                {quickNotes.map((n) => <QuickNoteRow key={n.id} note={n} onEdit={() => void openEdit(n.id)} />)}
              </div>
            )}
          </div>
        )
      ) : (
        <div className="mobile-scroll">
          <NotebookGrid notebooks={notebooks} docCounts={docCounts} onOpenNotebook={onOpenNotebook} onReorder={onReorderNotebooks} />
          {notebooks.length === 0 && (
            <div className="mobile-empty">
              暂无知识库
              <button className="b3-button b3-button--outline mobile-empty-action" onClick={onCreateNotebook}><Plus size={16} />新建知识库</button>
            </div>
          )}
        </div>
      )}

      {/* 底部胶囊栏（思源 #mobileBottomBar：纯图标；移动端不用 FAB） */}
      <nav className="mobile-bottom-bar" aria-label="首页操作">
        {tab === "quick" ? (
          <button className="mobile-bottom-bar__item" onClick={() => { tapFeedback(); setEditNote(null); setComposer({ mode: "new" }); }} aria-label="新建小记" title="新建小记"><Plus /></button>
        ) : (
          <>
            <button className="mobile-bottom-bar__item" onClick={() => { tapFeedback(); onCreateNote(); }} aria-label="新建文档" title="新建文档"><FilePlus /></button>
            <button className="mobile-bottom-bar__item" onClick={() => { tapFeedback(); onCreateNotebook(); }} aria-label="新建知识库" title="新建知识库"><Plus />
            </button>
          </>
        )}
        <button className="mobile-bottom-bar__item" onClick={() => void runSync()} aria-label="立即同步" title="立即同步"><CloudUpload /></button>
      </nav>
    </div>
  );
}

/** 小记行：缩略图 40 + 单行摘要 + 时间（思源列表语言，不再是白卡）。 */
function QuickNoteRow({ note, onEdit }: { note: MobileQuickNote; onEdit: () => void }) {
  const thumbUrl = note.firstImage ? localAssetHttpUrl(note.id, note.firstImage, { space: "quick-notes" }) : null;
  return (
    <div className="b3-list-item mobile-quick-row" role="button" tabIndex={0} onClick={onEdit}>
      <span className="b3-list-item__graphic mobile-quick-thumb">
        {thumbUrl ? <img src={thumbUrl} alt="" loading="lazy" /> : <StickyNote size={18} />}
      </span>
      <span className="b3-list-item__text">{note.previewText || (note.imageCount > 0 ? "[图片]" : "（空白小记）")}</span>
      <span className="b3-list-item__meta">{new Date(note.updatedAt).toLocaleDateString("zh-CN")}</span>
    </div>
  );
}
