/**
 * 第一层（首页）：小记 / 知识库 两个 tab。
 * 布局（对齐 Yuque 官方移动端首层）：
 * - 小记 → 卡片（图在上/文在下/日期+更多「...」）；
 * - 知识库 → 「最近文档」横向卡 + 笔记本书架（3:4 彩面书卡，右上角切换 书架↔列表）；
 * - 空态不做「创建」提示（默认空白即可）；
 * - 底部胶囊栏 = [筛选 | 新建 | 云同步]（新建按 tab 记性：小记=写小记、知识库=新建笔记本）。
 */
import { useEffect, useMemo, useState } from "react";
import { CloudUpload, List, LayoutGrid, ArrowUpDown, MoreHorizontal, Pencil, Plus, Search, Settings, Trash, Paperclip, FolderPlus } from "lucide-react";
import type { TreeNode } from "../../lib/types";
import type { POCNoteSummary } from "../noteRepository";
import { NotebookGrid } from "./NotebookGrid";
import { QuickNoteComposer } from "./QuickNoteComposer";
import { MobileSheetMenu, type MobileSheetItem } from "../ui/MobileSheetMenu";
import { confirmMobile } from "../ui/ConfirmDialog";
import { showToast } from "../ui/toastBus";
import { bridge } from "../bridge";
import { useHorizontalSwipe } from "../useHorizontalSwipe";
import { tapFeedback } from "../ui/haptics";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { withAssetAccessToken } from "../../lib/assetPort";

export interface MobileQuickNote {
  id: string;
  previewText: string;
  imageCount: number;
  updatedAt: string;
  /** 首图文件名（listQuickNotes 一次返回，卡片不再逐条 readQuickNote） */
  firstImage: string | null;
}

export type LibraryView = "shelf" | "list";
type QuickSort = "recent" | "oldest";

export interface HomePageProps {
  tab: "quick" | "library";
  notebooks: TreeNode[];
  /** 全部笔记（「最近文档」用，按 updatedAt 取最近 N 条） */
  notes: POCNoteSummary[];
  quickNotes: MobileQuickNote[];
  /** 笔记本 → 文档数 */
  docCounts: Record<string, number>;
  onTabChange: (tab: "quick" | "library") => void;
  onOpenNotebook: (id: string) => void;
  onOpenNote: (id: string) => void;
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
  onCreateNotebook: () => void;
  onQuickNotesChanged: () => Promise<void>;
}

type ComposerState = { mode: "new" } | { mode: "edit"; id: string } | null;

const VIEW_KEY = "lake-notes-mobile.libraryView";

function fmtDate(iso: string): string {
  try { const d = new Date(iso); return `${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }
  catch { return iso; }
}

/** 相对时间（仿语雀：今天/昨天 HH:mm，更早显示 MM-DD）。 */
function fmtRelative(iso: string): string {
  try {
    const d = new Date(iso); const now = new Date();
    const hm = `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`;
    return `${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  } catch { return ""; }
}

export function HomePage(props: HomePageProps) {
  const {
    tab, notebooks, notes, quickNotes, docCounts, onTabChange, onOpenNotebook,
    onOpenNote, onOpenDrawer, onOpenSearch, onCreateNotebook, onQuickNotesChanged,
  } = props;
  const [composer, setComposer] = useState<ComposerState>(null);
  const [editNote, setEditNote] = useState<{ id: string; text: string; images: import("../../core/quickNoteModel.js").StoredQuickNoteImage[] } | null>(null);
  const [libraryView, setLibraryView] = useState<LibraryView>(() => (localStorage.getItem(VIEW_KEY) === "list" ? "list" : "shelf"));
  const [quickMenuFor, setQuickMenuFor] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [quickSort, setQuickSort] = useState<QuickSort>("recent");

  // 离开「小记」tab（未点保存）即取消编辑：切回来是小记列表，不保留编辑框。
  // 覆盖所有离开路径（顶部 tab / 左右横滑 / 父级路由变化）。
  useEffect(() => {
    if (tab !== "quick") { setComposer(null); setEditNote(null); }
  }, [tab]);

  // 左右横滑切换小记 ↔ 知识库（左滑→知识库，右滑→小记）
  useHorizontalSwipe((dir) => {
    if (dir === "left" && tab === "quick") onTabChange("library");
    else if (dir === "right" && tab === "library") onTabChange("quick");
  });

  // 「最近文档」= 最近更新的 N 条笔记（代理；如需"最近打开"后续再加 last_opened_at 追踪）
  const recentNotes = useMemo(() => {
    return [...notes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 6);
  }, [notes]);

  const sortedQuickNotes = useMemo(() => {
    const arr = [...quickNotes];
    arr.sort((a, b) => quickSort === "recent"
      ? new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      : new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
    return arr;
  }, [quickNotes, quickSort]);

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
  const toggleView = (): void => {
    tapFeedback();
    setLibraryView((v) => { const nv = v === "shelf" ? "list" : "shelf"; try { localStorage.setItem(VIEW_KEY, nv); } catch { /* 忽略 */ } return nv; });
  };

  const deleteQuickNote = async (id: string): Promise<void> => {
    const ok = await confirmMobile({ title: "删除小记？", body: "小记不备份，删除后不可恢复。", confirmText: "删除", danger: true });
    if (!ok) return;
    try { await bridge.deleteQuickNote(id); await onQuickNotesChanged(); showToast("已删除小记"); }
    catch { showToast("删除失败", { type: "error" }); }
  };

  // 排序（小记专用；知识库顺序 = 共享 sort_order = 桌面端顺序，不做本地排序）
  const filterItems = useMemo<MobileSheetItem[]>(() => {
    return [
      { id: "recent", label: "最近更新", note: quickSort === "recent" ? "当前" : undefined },
      { id: "oldest", label: "最早更新", note: quickSort === "oldest" ? "当前" : undefined },
    ];
  }, [quickSort]);
  const onFilterSelect = (item: MobileSheetItem): void => {
    setFilterOpen(false);
    tapFeedback();
    setQuickSort(item.id as QuickSort);
  };

  const viewIcon = libraryView === "shelf" ? <LayoutGrid size={20} /> : <List size={20} />;

  return (
    <div className="mobile-home">
      <header className="toolbar toolbar--border mobile-topbar">
        <button className="toolbar__button" onClick={onOpenDrawer} aria-label="设置" title="设置"><Settings /></button>
        <div className="mobile-home-tabs">
          <button className={tab === "quick" ? "mobile-htab active" : "mobile-htab"} onClick={() => switchTab("quick")}>小记</button>
          <button className={tab === "library" ? "mobile-htab active" : "mobile-htab"} onClick={() => switchTab("library")}>知识库</button>
        </div>
        {tab === "quick" && <button className="toolbar__button" onClick={() => { tapFeedback(); setFilterOpen(true); }} aria-label="排序" title="排序"><ArrowUpDown /></button>}
        {tab === "library" && <button className="toolbar__button" onClick={toggleView} aria-label={libraryView === "shelf" ? "切换到列表" : "切换到书架"} title={libraryView === "shelf" ? "切换到列表" : "切换到书架"}>{viewIcon}</button>}
      </header>

      <div key={tab} className="mobile-tab-stage">
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
            {sortedQuickNotes.length === 0 ? (
              <div className="mobile-empty">暂无小记</div>
            ) : (
              <div className="mobile-quick-cards">
                {sortedQuickNotes.map((n) => (
                  <QuickNoteCard key={n.id} note={n} onEdit={() => { tapFeedback(); void openEdit(n.id); }} onMore={() => { tapFeedback(); setQuickMenuFor(n.id); }} />
                ))}
              </div>
            )}
          </div>
        )
      ) : (
        <div className="mobile-scroll mobile-library">
          {libraryView === "shelf" && recentNotes.length > 0 && (
            <section className="home-section">
              <div className="home-section__head">
                <span className="home-section__title">最近文档</span>
              </div>
              <div className="home-recent">
                {recentNotes.map((r) => (
                  <button key={r.id} className="doc-card" onClick={() => { tapFeedback(); onOpenNote(r.id); }} aria-label={r.title || "文档"}>
                    <span className="doc-card__paper" aria-hidden="true">
                      <span className="doc-card__lines" />
                      <span className="doc-card__clip"><Paperclip size={10} /></span>
                    </span>
                    <span className="doc-card__name">{r.title || "无标题"}</span>
                    <span className="doc-card__date">{fmtRelative(r.updatedAt)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {/* key=view：切换书架/列表时重挂载，重放入场动效 */}
          <section className={`home-section${libraryView === "list" ? " home-section--list" : ""}`} key={libraryView}>
            <div className="home-section__head">
              <span className="home-section__title">笔记本</span>
            </div>
            <NotebookGrid
              notebooks={notebooks}
              docCounts={docCounts}
              view={libraryView}
              onOpenNotebook={(id) => { tapFeedback(); onOpenNotebook(id); }}
            />
          </section>
        </div>
      )}
      </div>

      {/* 底部胶囊栏（首页）：搜索 | 新建 | 云同步（仿第二层悬浮栏：纯图标胶囊条）；排序已移到右上角 */}
      <nav className="mobile-bottom-bar" aria-label="首页操作">
        <button className="mobile-bottom-bar__item" onClick={() => { tapFeedback(); onOpenSearch(); }} aria-label="搜索" title="搜索"><Search /></button>
        {tab === "quick" ? (
          <button className="mobile-bottom-bar__item" onClick={() => { tapFeedback(); setEditNote(null); setComposer({ mode: "new" }); }} aria-label="新建小记" title="新建小记"><Plus /></button>
        ) : (
          <button className="mobile-bottom-bar__item" onClick={() => { tapFeedback(); onCreateNotebook(); }} aria-label="新建知识库" title="新建知识库"><FolderPlus /></button>
        )}
        <button className="mobile-bottom-bar__item" onClick={() => void runSync()} aria-label="立即同步" title="立即同步"><CloudUpload /></button>
      </nav>

      {/* 小记「...」菜单 */}
      <MobileSheetMenu
        open={!!quickMenuFor}
        items={[
          { id: "edit", label: "编辑", icon: Pencil },
          { id: "delete", label: "删除", icon: Trash, danger: true },
        ]}
        onClose={() => setQuickMenuFor(null)}
        onSelect={(it) => { const id = quickMenuFor; setQuickMenuFor(null); if (!id) return; if (it.id === "edit") void openEdit(id); else if (it.id === "delete") void deleteQuickNote(id); }}
      />

      {/* 筛选 / 排序 */}
      <MobileSheetMenu
        open={filterOpen}
        items={filterItems}
        onClose={() => setFilterOpen(false)}
        onSelect={onFilterSelect}
      />
    </div>
  );
}

/** 小记卡片：大图 + 摘要 + 日期 + 「...」（有图必展示，无图留中性占位）。 */
function QuickNoteCard({ note, onEdit, onMore }: { note: MobileQuickNote; onEdit: () => void; onMore: () => void }) {
  const thumbUrl = note.firstImage
    ? withAssetAccessToken(localAssetHttpUrl(note.id, note.firstImage, { space: "quick-notes" }))
    : null;
  return (
    <div className="qn-card" role="button" tabIndex={0} onClick={onEdit}>
      {thumbUrl && (
        <div className="qn-card__cover">
          <img className="qn-card__img" src={thumbUrl} alt="" loading="lazy" />
          {note.imageCount > 1 && <span className="qn-card__count">{note.imageCount}</span>}
        </div>
      )}
      <div className="qn-card__body">
        <div className="qn-card__text">{note.previewText || (note.imageCount > 0 ? "[图片]" : "（空白小记）")}</div>
        <div className="qn-card__meta">
          <span className="qn-card__date">{fmtDate(note.updatedAt)}</span>
          <button className="qn-card__more" onClick={(e) => { e.stopPropagation(); onMore(); }} aria-label="更多"><MoreHorizontal size={18} /></button>
        </div>
      </div>
    </div>
  );
}
