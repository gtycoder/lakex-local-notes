/**
 * 第一层（首页）：小记 / 知识库 两个 tab。
 * 布局（对齐 Yuque 官方移动端首层）：
 * - 小记 → 卡片（图在上/文在下/日期+更多「...」）；
 * - 知识库 → 「最近文档」横向卡 + 笔记本书架（3:4 彩面书卡，右上角切换 书架↔列表）；
 * - 空态不做「创建」提示（默认空白即可）；
 * - 底部胶囊栏 = [筛选 | 新建 | 云同步]（新建按 tab 记性：小记=写小记、知识库=新建笔记本）。
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { writeLocalStorage } from "../../lib/localStorageSafe";
import { CloudUpload, List, LayoutGrid, ArrowUpDown, BookMarked, Feather, MoreHorizontal, Pencil, Plus, Search, Settings, SmilePlus, Sparkles, Trash, X } from "lucide-react";
import type { TreeNode } from "../../lib/types";
import type { LocalNoteSummary } from "../noteRepository";
import { NotebookGrid } from "./NotebookGrid";
import { QuickNotePreview } from "../../features/quickNotes/QuickNotePreview";
import { MobileSheetMenu, type MobileSheetItem } from "../ui/MobileSheetMenu";
import { CreateSheet, type CreateActionId } from "../ui/CreateSheet";
import { CREATE_LONG_PRESS_MS, blockPressRelease, createPressArmed, createPressRevealed } from "../ui/createPress";
import { pickLocalFile } from "../ui/pickFile";
import { longPressFeedback } from "../ui/haptics";
import { EmojiPanel } from "../ui/EmojiPanel";
import { confirmMobile } from "../ui/ConfirmDialog";
import { showToast } from "../ui/toastBus";
import { bridge } from "../bridge";
import { useHorizontalSwipe } from "../useHorizontalSwipe";
import { localAssetHttpUrl, withAssetWidth } from "../../core/assetUrl.js";
import { withAssetAccessToken } from "../../lib/assetPort";

/** 完整小记编辑器（内含 Lake 内核）：**按需加载**——首屏/小记都不需要内核。 */
const QuickNoteComposer = lazy(() => import("./QuickNoteComposer").then((m) => ({ default: m.QuickNoteComposer })));

export interface MobileQuickNote {
  id: string;
  previewText: string;
  imageCount: number;
  updatedAt: string;
  /** 首图文件名（listQuickNotes 一次返回，卡片不再逐条 readQuickNote） */
  firstImage: string | null;
  /** 内核形态正文：有它就用桌面同一套只读预览渲染（富文本/卡片/待办），没有则回退纯文本摘要。 */
  body?: string;
  images?: Array<import("../../core/quickNoteModel.js").StoredQuickNoteImage>;
}

export type LibraryView = "shelf" | "list";
type QuickSort = "recent" | "oldest";

export interface HomePageProps {
  tab: "quick" | "library";
  notebooks: TreeNode[];
  /** 全部笔记（「最近文档」用，按 updatedAt 取最近 N 条） */
  notes: LocalNoteSummary[];
  quickNotes: MobileQuickNote[];
  /** 笔记本 → 文档数 */
  docCounts: Record<string, number>;
  onTabChange: (tab: "quick" | "library") => void;
  onOpenNotebook: (id: string) => void;
  onOpenNote: (id: string) => void;
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
  onCreateNotebook: () => void;
  /** 「空白文档」：在用户选中的笔记本下建文档并进编辑态（归属判定复用 MobileApp.createNoteInParent）。 */
  onCreateNote: (notebookId: string) => void;
  /** 目录树（笔记本/分组）变了以后刷新数据（重命名 / 设置图标 / 删除笔记本都走它）。 */
  onTreeChanged: () => Promise<void>;
  onQuickNotesChanged: () => Promise<void>;
}

/**
 * 写作卡状态。`files` / `command` = 首页**新建面板**带进来的起手内容（拍摄 / 图片 / 待办）：
 * 正文只能由内核产出，所以这里**不拼 body**，而是挂载后经 `initialInsert` 走内核通道（见 QuickNoteComposer）。
 */
type ComposerState =
  | { mode: "new"; files?: File[]; command?: "taskList" }
  | { mode: "edit"; id: string }
  | null;

const VIEW_KEY = "lake-notes-mobile.libraryView";

/**
 * 卡片封面缩略图档位。封面是整列宽、最高 210px（`.qn-card__img` max-width 100% / max-height 210px），
 * 手机宽屏约 360 CSS px ⇒ dpr 2~3 需要 720~1080 设备像素，**只有最大档位 1024 不会发虚**
 * （再往上会超过档位表上限、反而退回原图）。
 * 一张手机照片 4000×3000 是 48MB 位图，1024 档只剩 ~3MB —— 一屏多张封面的差别是几百 MB。
 */
const COVER_THUMB_PX = 1024;

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
    onOpenNote, onOpenDrawer, onOpenSearch, onCreateNotebook, onCreateNote, onTreeChanged, onQuickNotesChanged,
  } = props;
  const [composer, setComposer] = useState<ComposerState>(null);
  const [editNote, setEditNote] = useState<{ id: string; text: string; body?: string; images: import("../../core/quickNoteModel.js").StoredQuickNoteImage[] } | null>(null);
  const [libraryView, setLibraryView] = useState<LibraryView>(() => (localStorage.getItem(VIEW_KEY) === "list" ? "list" : "shelf"));
  const [quickMenuFor, setQuickMenuFor] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [quickSort, setQuickSort] = useState<QuickSort>("recent");
  const [createOpen, setCreateOpen] = useState(false);
  /** 「空白文档」选笔记本：**只列已有笔记本**（用户 261014 定）；一个都没有就先去建知识库。 */
  const [docPickOpen, setDocPickOpen] = useState(false);
  /**
   * 笔记本的**编辑入口 = 知识库页长按卡片**（用户 261014 定；抽屉里那个 ⋮ 已按同一条点单删掉）。
   * 菜单只放"编辑"三项：重命名 / 设置图标 / 删除笔记本 —— **不含**新建文档、新建分组（用户明确去掉）。
   */
  const [nbMenuFor, setNbMenuFor] = useState<TreeNode | null>(null);
  const [renamingNb, setRenamingNb] = useState<{ id: string; value: string } | null>(null);
  const [iconNb, setIconNb] = useState<TreeNode | null>(null);
  /** 「＋」按压态（语雀手感）：revealed = 长按到点浮出气泡，armed = 已上滑越过触发线。 */
  const [pressRevealed, setPressRevealed] = useState(false);
  const [pressArmed, setPressArmed] = useState(false);
  const pressRef = useRef({ startY: 0, at: 0, revealed: false, timer: 0 });
  /** 长按过的那一次，随后的 click 要吞掉（否则"长按搜索再松手"会顺带把搜索页打开）。 */
  const suppressTapRef = useRef(false);

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
      setEditNote({ id, text: full.content.text, body: full.content.body, images: full.content.images });
      setComposer({ mode: "edit", id });
    } catch { /* 读取失败忽略 */ }
  };
  const closeComposer = (): void => { setComposer(null); setEditNote(null); };
  const switchTab = (next: "quick" | "library"): void => { onTabChange(next); };
  const runSync = async (): Promise<void> => {
    try { const r = await bridge.syncNow(); const w = r.notes?.warnings?.length ?? 0; showToast((r.message || "已同步") + (w > 0 ? `，${w} 项被跳过` : "")); }
    catch (e) { showToast("同步失败：" + (e as Error).message, { type: "error" }); }
  };
  const toggleView = (): void => {
    setLibraryView((v) => { const nv = v === "shelf" ? "list" : "shelf"; writeLocalStorage(VIEW_KEY, nv); return nv; });
  };

  /** 新建小记：写作卡只在「小记」tab 里渲染 ⇒ **先切 tab 再开**（顺序反了会被 tab 变化的重置 effect 清掉）。 */
  const startNewQuickNote = (opts?: { files?: File[]; command?: "taskList" }): void => {
    if (tab !== "quick") onTabChange("quick");
    setEditNote(null);
    setComposer({ mode: "new", ...opts });
  };

  /** 新建面板的六个动作（唯一分派点；**不做模板、不做 OCR 识图**）。 */
  const runCreateAction = async (id: CreateActionId): Promise<void> => {
    setCreateOpen(false);
    switch (id) {
      case "blank-quick":
        startNewQuickNote();
        return;
      case "camera": {
        const file = await pickLocalFile("image/*", "environment");
        if (file) startNewQuickNote({ files: [file] });
        return;
      }
      case "image": {
        const file = await pickLocalFile("image/*");
        if (file) startNewQuickNote({ files: [file] });
        return;
      }
      case "todo":
        startNewQuickNote({ command: "taskList" });
        return;
      case "blank-doc":
        if (notebooks.length === 0) { showToast("请先新建知识库"); onCreateNotebook(); return; }
        setDocPickOpen(true);
        return;
      case "notebook":
        onCreateNotebook();
        return;
    }
  };

  /** 「＋」长按计时器：只负责**视觉浮出**（判定在松手时按真实时长重算，见 endPress）。 */
  const clearPressTimer = (): void => {
    if (pressRef.current.timer) { window.clearTimeout(pressRef.current.timer); pressRef.current.timer = 0; }
  };
  /**
   * 按压期间把 move/up/cancel 挂在 **window** 上 —— **不要用 setPointerCapture**：
   * 捕获会把随后的 click 重定向到胶囊（捕获元素）本身，条目自己的 onClick 就再也不触发了（261014 实测踩过）。
   * 挂 window 既能拿到滑出胶囊后的位移/抬手，又不影响 click 的落点。
   */
  const pressDetachRef = useRef<() => void>(() => {});
  const pressMoveRef = useRef<(clientY: number) => void>(() => {});
  const pressEndRef = useRef<(pointer: { clientY: number } | null) => void>(() => {});
  useEffect(() => () => pressDetachRef.current(), []);

  const onPressDown = (e: React.PointerEvent<HTMLElement>): void => {
    pressRef.current.startY = e.clientY;
    pressRef.current.at = Date.now();
    pressRef.current.revealed = false;
    clearPressTimer();
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.revealed = true;
      setPressRevealed(true);
      longPressFeedback();
    }, CREATE_LONG_PRESS_MS);
    pressDetachRef.current();
    const onMove = (ev: PointerEvent): void => pressMoveRef.current(ev.clientY);
    const onUp = (ev: PointerEvent): void => pressEndRef.current(ev);
    const onCancel = (): void => pressEndRef.current(null);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    pressDetachRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      pressDetachRef.current = () => {};
    };
  };
  const onPressMove = (clientY: number): void => {
    if (!pressRef.current.at) return;
    const armed = createPressArmed(clientY - pressRef.current.startY);
    setPressArmed((prev) => (prev === armed ? prev : armed));
  };
  /**
   * 松手（**整块触发**：手势挂在整条胶囊上）：
   *   · 没长按到点 → pass：条目自己的 onClick 照常跑（短按语义完全不变）；
   *   · 长按 + 上滑过线 → 速记一条小记；
   *   · 长按但没上滑 → 取消（用户明确"长按容易误触"，不做"长按即建"）。
   */
  const endPress = (pointer: { clientY: number } | null): void => {
    pressDetachRef.current();
    const p = pressRef.current;
    clearPressTimer();
    const elapsed = p.at ? Date.now() - p.at : 0;
    const dy = pointer ? pointer.clientY - p.startY : 0;
    const released = pointer ? blockPressRelease({ revealed: createPressRevealed(elapsed), dy }) : "cancel";
    pressRef.current = { startY: 0, at: 0, revealed: false, timer: 0 };
    setPressRevealed(false);
    setPressArmed(false);
    if (p.revealed) {
      suppressTapRef.current = true;
      window.setTimeout(() => { suppressTapRef.current = false; }, 350);
    }
    if (released === "quick-note") startNewQuickNote();
  };
  // window 监听回调取"最新闭包"（handler 只用 ref + setState，这里刷新引用即可）
  pressMoveRef.current = onPressMove;
  pressEndRef.current = endPress;

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
    setQuickSort(item.id as QuickSort);
  };

  /** 笔记本编辑三项（用户 261014：入口 = 知识库页长按；抽屉里那个 ⋮ 已删）。 */
  const renameNotebook = async (): Promise<void> => {
    const cur = renamingNb;
    setRenamingNb(null);
    const value = cur?.value.trim();
    if (!cur || !value) return;
    try { await bridge.renameTreeNode(cur.id, value); await onTreeChanged(); }
    catch { showToast("重命名失败", { type: "error" }); }
  };
  const applyNotebookIcon = async (icon: string | null): Promise<void> => {
    const nb = iconNb; setIconNb(null);
    if (!nb) return;
    try { await bridge.setNodeIcon(nb.id, icon); await onTreeChanged(); }
    catch { showToast("设置图标失败", { type: "error" }); }
  };
  /** 删除笔记本 = 整棵移入回收站（可恢复，与桌面笔记本右键同语义）。 */
  const deleteNotebook = async (nb: TreeNode): Promise<void> => {
    const ok = await confirmMobile({
      title: "删除笔记本？",
      body: (nb.title || "未命名") + "：连同其中的文档一起移入回收站，可在回收站恢复。",
      confirmText: "删除", danger: true,
    });
    if (!ok) return;
    try { await bridge.trashTreeItem(nb.id, "folder"); await onTreeChanged(); showToast("已移入回收站"); }
    catch { showToast("删除失败", { type: "error" }); }
  };

  const viewIcon = libraryView === "shelf" ? <LayoutGrid size={20} /> : <List size={20} />;

  return (
    <div className="mobile-home">
      <header className="toolbar toolbar--border mobile-topbar">
        <button className="toolbar__button" onClick={onOpenDrawer} aria-label="设置" title="设置"><Settings /></button>
        {/* 左侧等宽空槽：右侧固定挂**两枚**图标（排序/视图 + 云同步）⇒ 左也补一格，tab 才真的居中
            （用户 261014 定稿的构图；冷启动骨架同构 5 槽，数据到达原地填充不跳）。 */}
        <span className="mobile-topbar-gap" aria-hidden="true" />
        <div className="mobile-home-tabs">
          <button className={tab === "quick" ? "mobile-htab active" : "mobile-htab"} onClick={() => switchTab("quick")}>小记</button>
          <button className={tab === "library" ? "mobile-htab active" : "mobile-htab"} onClick={() => switchTab("library")}>知识库</button>
        </div>
        {/* 用户 261014 定稿：排序（小记）/ 视图（知识库）+ 云同步**固定挂在顶栏右上角**，云同步恒在最右。 */}
        {tab === "quick" ? (
          <button className="toolbar__button" onClick={() => setFilterOpen(true)} aria-label="排序" title="排序"><ArrowUpDown /></button>
        ) : (
          <button className="toolbar__button" onClick={toggleView} aria-label={libraryView === "shelf" ? "切换到列表" : "切换到书架"} title={libraryView === "shelf" ? "切换到列表" : "切换到书架"}>{viewIcon}</button>
        )}
        <button className="toolbar__button" onClick={() => void runSync()} aria-label="立即同步" title="立即同步"><CloudUpload /></button>
      </header>

      <div key={tab} className="mobile-tab-stage">
      {tab === "quick" ? (
        composer !== null ? (
          /* 写作 = 编辑会话：滚动区给底部 dock 留白（见 .mobile-scroll--with-dock），底栏同时让位。 */
          <div className="mobile-scroll mobile-scroll--with-dock">
            <Suspense fallback={<div className="mb-empty">正在加载编辑器…</div>}>
              <QuickNoteComposer
                editNote={editNote}
                initialInsert={composer.mode === "new" ? { files: composer.files, command: composer.command } : null}
                onSaved={async () => { closeComposer(); await onQuickNotesChanged(); }}
                onCancel={closeComposer}
              />
            </Suspense>
          </div>
        ) : (
          <div className="mobile-scroll">
            {sortedQuickNotes.length === 0 ? (
              <div className="mb-empty">暂无小记</div>
            ) : (
              <div className="mobile-quick-cards">
                {sortedQuickNotes.map((n) => (
                  <QuickNoteCard key={n.id} note={n} onEdit={() => { void openEdit(n.id); }} onMore={() => setQuickMenuFor(n.id)} />
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
                  <button key={r.id} className="doc-card" onClick={() => onOpenNote(r.id)} aria-label={r.title || "文档"}>
                    <span className="doc-card__paper" aria-hidden="true">
                      <span className="doc-card__lines" />
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
              onOpenNotebook={onOpenNotebook}
              onLongPressNotebook={(nb) => setNbMenuFor(nb)}
              renamingId={renamingNb?.id ?? null}
              renameValue={renamingNb?.value ?? ""}
              onRenameChange={(value) => setRenamingNb((cur) => (cur ? { ...cur, value } : cur))}
              onRenameCommit={() => void renameNotebook()}
              onRenameCancel={() => setRenamingNb(null)}
            />
          </section>
        </div>
      )}
      </div>

      {/* 底部胶囊栏（首页，用户 261014 定稿）：搜索 | ＋ | AI。
          · 排序 / 视图 与 云同步**都在顶栏右上角**（不在胶囊里）；
          · 「＋」是**统一加号**（不再按 tab 换成"新建知识库"图标）：短按开新建面板、长按上滑速记；
          · AI 只占位（用户定：先加图标，接入方案另行立项）。
          ⚠️ 小记写作时**让位**：写作卡底部挂的是文档编辑那条 dock（用户 261013 定稿），
          两条都贴底会打架（胶囊 z-index 更高会把 dock 盖住）⇒ 编辑会话期间不渲染胶囊。 */}
      {composer === null && (
      /* **整块触发**（261014 用户定稿）：手势挂在整条胶囊上 —— 按住**任意处**约 260ms，整块变成「小记」；
         继续上滑越过触发线松手 = 速记一条小记；不上滑松手 = 取消。短按不接手势（pass），条目自己的 onClick 照常。 */
      <nav
        className={"mobile-bottom-bar mobile-bottom-bar--home" + (pressRevealed ? " is-revealed" : "") + (pressArmed ? " is-armed" : "")}
        aria-label="首页操作"
        data-prevent-swipe
        onPointerDown={onPressDown}
        onContextMenu={(e) => e.preventDefault()}
        /* 长按过的那一次，吞掉随后由同一次按压合成的 click。 */
        onClickCapture={(e) => { if (suppressTapRef.current) { e.preventDefault(); e.stopPropagation(); } }}
      >
        {/* 整块变化层（语雀效果）：常挂载，只在 is-revealed 时可见（条件渲染会让变化没有过渡）。 */}
        <div className="mobile-block-quick" aria-hidden="true">
          <Feather size={20} />
          <span className="mobile-block-quick__label">小记</span>
        </div>
        <button className="mobile-bottom-bar__item" onClick={onOpenSearch} aria-label="搜索" title="搜索"><Search /></button>
        <button className="mobile-bottom-bar__item" onClick={() => setCreateOpen(true)} aria-label="新建" title="新建" aria-haspopup="dialog" aria-expanded={createOpen}><Plus /></button>
        <button className="mobile-bottom-bar__item" onClick={() => showToast("AI 助手尚未接入：已立项，接入后这里再定用法")} aria-label="AI 助手" title="AI 助手（未接入）"><Sparkles /></button>
      </nav>
      )}

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

      {/* 笔记本编辑菜单（**知识库页长按卡片**触发；用户 261014）。只放编辑三项 —— **不含**新建文档 / 新建分组。 */}
      <MobileSheetMenu
        open={!!nbMenuFor}
        items={[
          { id: "rename", label: "重命名", icon: Pencil },
          { id: "icon", label: "设置图标", icon: SmilePlus },
          { id: "delete", label: "删除笔记本", icon: Trash, danger: true },
        ]}
        onClose={() => setNbMenuFor(null)}
        onSelect={(it) => {
          const nb = nbMenuFor;
          setNbMenuFor(null);
          if (!nb) return;
          if (it.id === "rename") setRenamingNb({ id: nb.id, value: nb.title || "" });
          else if (it.id === "icon") setIconNb(nb);
          else if (it.id === "delete") void deleteNotebook(nb);
        }}
      />

      {/* 设置图标：与目录树 / 新建知识库共用同一个表情面板（EmojiPanel 是面板的唯一实现） */}
      {iconNb && (
        <div className="mb-scrim" data-prevent-swipe onClick={() => setIconNb(null)}>
          <div className="mb-sheet" data-prevent-swipe onClick={(e) => e.stopPropagation()}>
            <div className="mb-sheet__head">
              <span className="mb-sheet__title">设置图标</span>
              <button className="mobile-icon-btn" onClick={() => setIconNb(null)} aria-label="关闭"><X size={20} /></button>
            </div>
            <div className="mb-sheet__body">
              <EmojiPanel onPick={(icon) => void applyNotebookIcon(icon)} onClear={() => void applyNotebookIcon(null)} />
            </div>
          </div>
        </div>
      )}

      {/* 筛选 / 排序 */}
      <MobileSheetMenu
        open={filterOpen}
        items={filterItems}
        onClose={() => setFilterOpen(false)}
        onSelect={onFilterSelect}
      />

      {/* 新建面板（「＋」短按）：新建小记 / 新建文档知识库（**无模板、无 OCR**） */}
      <CreateSheet open={createOpen} onClose={() => setCreateOpen(false)} onAction={(id) => void runCreateAction(id)} />

      {/* 「空白文档」选笔记本：只列已有笔记本（用户 261014 定） */}
      <MobileSheetMenu
        open={docPickOpen}
        items={notebooks.map((nb) => ({ id: nb.id, label: nb.title || "未命名知识库", icon: BookMarked }))}
        onClose={() => setDocPickOpen(false)}
        onSelect={(it) => { setDocPickOpen(false); onCreateNote(it.id); }}
      />
    </div>
  );
}

/** 小记卡片：大图 + 摘要 + 日期 + 「...」（有图必展示，无图留中性占位）。 */
function QuickNoteCard({ note, onEdit, onMore }: { note: MobileQuickNote; onEdit: () => void; onMore: () => void }) {
  /** 预览用资源（canonical URL + token）：图片卡/附件卡都靠它渲染。 */
  const previewAssets = (note.images ?? []).map((image) => ({
    ...image,
    url: withAssetAccessToken(localAssetHttpUrl(note.id, image.filename, { space: "quick-notes" })),
  }));
  const thumbUrl = note.firstImage
    ? withAssetWidth(
        withAssetAccessToken(localAssetHttpUrl(note.id, note.firstImage, { space: "quick-notes" })),
        COVER_THUMB_PX,
      )
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
        {note.body ? (
          <QuickNotePreview
            ellipsisClassName="mb-ellipsis"
            body={note.body}
            noteId={note.id}
            assets={previewAssets}
            // 卡片是「打开编辑」的入口：预览里的图片不抢点击（否则点图上只会弹放大预览、进不去编辑），
            // 需要放大看图时进编辑态点图（内核/浅色预览层在编辑态仍可用）。
            onImageClick={() => undefined}
          />
        ) : (
          <div className="qn-card__text">{note.previewText || (note.imageCount > 0 ? "[图片]" : "（空白小记）")}</div>
        )}
        <div className="qn-card__meta">
          <span className="qn-card__date">{fmtDate(note.updatedAt)}</span>
          <button className="qn-card__more mb-tap" onClick={(e) => { e.stopPropagation(); onMore(); }} aria-label="更多"><MoreHorizontal size={18} /></button>
        </div>
      </div>
    </div>
  );
}
