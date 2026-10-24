/**
 * 第一层（首页）：小记 / 知识库 两个 tab。
 * 布局（对齐 Yuque 官方移动端首层）：
 * - 小记 → 卡片（图在上/文在下/日期+更多「...」）；
 * - 知识库 → 「常用」分组（顶部固定、可收起；横向卡，左右滑动找）+ 笔记本书架（3:4 彩面书卡，右上角切换 书架↔列表）；
 *   「最近文档」已按用户 261019 点单整体删除（手机端不存最近访问记录，也不展示）；
 * - 空态不做「创建」提示（默认空白即可）；
 * - 底部胶囊栏 = [筛选 | 新建 | 云同步]（新建按 tab 记性：小记=写小记、知识库=新建笔记本）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { writeLocalStorage } from "../../lib/localStorageSafe";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, CloudUpload, List, LayoutGrid, ArrowUpDown, BookMarked, Feather, MoreHorizontal, Pencil, Plus, Search, Settings, SmilePlus, Sparkles, Tag, Trash, X } from "lucide-react";
import type { TreeNode } from "../../lib/types";
import type { LocalNoteSummary } from "../data/noteRepository";
import { NotebookGrid } from "./NotebookGrid";
import { QuickNotePreview } from "../../features/quickNotes/QuickNotePreview";
import type { StoredQuickNoteImage } from "../../core/quickNoteModel.js";
import { MobileSheetMenu, type MobileSheetItem } from "../ui/MobileSheetMenu";
import { CreateSheet, type CreateActionId } from "../ui/CreateSheet";
import { CREATE_LONG_PRESS_MS, blockPressRelease, createPressArmed, createPressRevealed } from "../ui/createPress";
import { pickLocalFile } from "../ui/pickFile";
import { longPressFeedback } from "../ui/haptics";
import { MobileNodeIconPicker } from "../ui/NodeIconPicker";
import { confirmMobile } from "../ui/ConfirmDialog";
import { showToast } from "../ui/toastBus";
import { bridge } from "../bridge";
import { escapeId } from "../../lib/cssEscape";
import { HOME_TABS, pagerScrollLeft, settledIndex, tabAt, tabIndex } from "./tabPager";
// 小记排序：**两端共用的单一来源**（档位/文案/比较器/本机持久化都在这里；261015 用户要求桌面与移动统一）
import { quickNoteSortTime, type QuickNoteSort } from "../../core/quickNoteSort";
import { localAssetHttpUrl, withAssetWidth } from "../../core/assetUrl.js";
import { formatListTime } from "../../core/dateFormat";
import { withAssetAccessToken } from "../../lib/assetPort";
import { pushBackHandler } from "../ui/backStack";
import { readFavoriteIds, readFavoritesOpen, subscribeFavorites, writeFavoritesOpen } from "../data/favorites";
import { QuickNoteComposerLazy } from "./quickNoteComposerLazy";
import { MobileQuickNoteTagSheet } from "./MobileQuickNoteTagSheet";
import { useQuickNoteDetailCache } from "./useQuickNoteDetailCache";
import { useQuickNoteListModel } from "./useQuickNoteListModel";
import { addQuickNoteTagId, buildQuickNoteTagOptions, type QuickNoteTag } from "../../core/quickNoteTags";

// 完整小记编辑器（内含 Lake 内核）：**按需加载**，加载壳见 ./quickNoteComposerLazy（预取过则同步渲染、零 fallback）。

export interface MobileQuickNote {
  id: string;
  /** 创建时间（ISO）：261015 用户点单「加创建时间排序」时一并带上来的。 */
  createdAt: string;
  previewText: string;
  imageCount: number;
  updatedAt: string;
  /** 首图文件名（getHomeSnapshot / getQuickNotePage 一次返回，卡片不再逐条 readQuickNote） */
  firstImage: string | null;
  /** 内核形态正文：有它就用桌面同一套只读预览渲染（富文本/卡片/待办），没有则回退纯文本摘要。 */
  body?: string;
  images?: StoredQuickNoteImage[];
  tags: string[];
  tagIds: string[];
}

const QUICK_NOTE_VIRTUAL_THRESHOLD = 24;

export type LibraryView = "shelf" | "list";

export interface HomePageProps {
  tab: "quick" | "library";
  notebooks: TreeNode[];
  /** 全部笔记（解析「常用」文档的标题/时间用） */
  notes: LocalNoteSummary[];
  quickNotes: MobileQuickNote[];
  /** 标签目录（标签表是唯一来源；随小记 Manifest 同步）。 */
  tagDirectory: readonly QuickNoteTag[];
  /** 笔记本 → 文档数 */
  docCounts: Record<string, number>;
  onTabChange: (tab: "quick" | "library") => void;
  onOpenNotebook: (id: string) => void;
  onOpenNote: (id: string) => void;
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
  /** 打开 AI 全屏页（261023 P1）。 */
  onOpenAi?: () => void;
  onCreateNotebook: () => void;
  /** 「空白文档」：在用户选中的笔记本下建文档并进编辑态（归属判定复用 MobileApp.createNoteInParent）。 */
  onCreateNote: (notebookId: string) => void;
  /** 目录树（笔记本/分组）变了以后刷新数据（重命名 / 设置图标 / 删除笔记本都走它）。 */
  onTreeChanged: () => Promise<void>;
  onQuickNotesChanged: () => Promise<void>;
  /** 全局搜索命中小记：首页常驻组件接力定位/高亮该条（不自动进编辑态）。 */
  pendingQuickNoteId?: string | null;
  onPendingQuickNoteConsumed?: () => void;
}

/**
 * 写作卡状态。`files` / `command` = 首页**新建面板**带进来的起手内容（拍摄 / 图片 / 待办）：
 * 正文只能由内核产出，所以这里**不拼 body**，而是挂载后经 `initialInsert` 走内核通道（见 QuickNoteComposer）。
 */
type ComposerState =
  | { mode: "new"; files?: File[]; command?: "taskList" }
  | { mode: "edit"; id: string }
  | null;

const VIEW_KEY = "local-lakex-notes-mobile.libraryView";

/**
 * 卡片封面缩略图档位。封面是整列宽、最高 210px（`.qn-card__img` max-width 100% / max-height 210px），
 * 手机宽屏约 360 CSS px ⇒ dpr 2~3 需要 720~1080 设备像素，**只有最大档位 1024 不会发虚**
 * （再往上会超过档位表上限、反而退回原图）。
 * 一张手机照片 4000×3000 是 48MB 位图，1024 档只剩 ~3MB —— 一屏多张封面的差别是几百 MB。
 */
const COVER_THUMB_PX = 1024;

function fmtDate(iso: string): string {
  try { return formatListTime(new Date(iso), new Date(), true); }
  catch { return iso; }
}

/** 列表时间措辞统一走 core/dateFormat.formatListTime（Q10/B）。 */
function fmtRelative(iso: string): string {
  try { return formatListTime(new Date(iso), new Date()); }
  catch { return ""; }
}

export function HomePage(props: HomePageProps) {
  const {
    tab, notebooks, notes, quickNotes, tagDirectory, docCounts, onTabChange, onOpenNotebook,
    onOpenNote, onOpenDrawer, onOpenSearch, onOpenAi, onCreateNotebook, onCreateNote, onTreeChanged, onQuickNotesChanged,
    pendingQuickNoteId, onPendingQuickNoteConsumed,
  } = props;
  const [composer, setComposer] = useState<ComposerState>(null);
  const [editNote, setEditNote] = useState<{ id: string; text: string; body?: string; images: import("../../core/quickNoteModel.js").StoredQuickNoteImage[]; tagIds: string[] } | null>(null);
  const [revealedQuickNoteId, setRevealedQuickNoteId] = useState<string | null>(null);
  const [libraryView, setLibraryView] = useState<LibraryView>(() => (localStorage.getItem(VIEW_KEY) === "list" ? "list" : "shelf"));
  const [quickMenuFor, setQuickMenuFor] = useState<string | null>(null);
  const [tagSheetFor, setTagSheetFor] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const { details: quickNoteDetails, loadDetail: loadQuickNoteDetail } = useQuickNoteDetailCache(quickNotes);
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

  /**
   * 首层 tab = **横向分页**（261019 用户点单，对齐语雀 App）：
   * 两页常驻在同一个原生横向滚动容器里 ⇒ 手指跟手拖动、松手由 `scroll-snap` 吸附，
   * 等价于语雀 RN 侧的 `react-native-pager-view`。这里只负责：
   * ① tab → 滚动位置对齐（点 tab / 路由变化 / 横竖屏宽度变化）；② 滚动结束把页码回写成 tab；
   * ③ 非活动页 inert；④ 写作会话中锁横滑（否则父级 [tab] effect 会清掉草稿）。
   */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const quickPaneRef = useRef<HTMLElement | null>(null);
  const quickScrollRef = useRef<HTMLDivElement | null>(null);
  const quickCardsRef = useRef<HTMLDivElement | null>(null);
  const libraryPaneRef = useRef<HTMLElement | null>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const onTabChangeRef = useRef(onTabChange);
  onTabChangeRef.current = onTabChange;
  const tabIndexNow = tabIndex(tab);
  const tabIndexRef = useRef(tabIndexNow);
  tabIndexRef.current = tabIndexNow;
  /** 手指正按在分页上（touchstart..touchend）：此时只让原生滚动驱动，不做程序化对齐（否则会跟手指抢）。 */
  const interactingRef = useRef(false);
  /** 这次 tab 变化是"滚动过半"自己回写的 ⇒ 不要再程序化滚一次（否则会打断惯性/吸附）。 */
  const commitByScrollRef = useRef(false);
  /** 正在做程序化滚动（点 tab / 宽度重对齐）：期间的 scroll 事件不代表用户意图，不能回写 tab。 */
  const programmaticRef = useRef(false);
  const programmaticTimerRef = useRef(0);

  /** 把分页滚到当前 tab 对应的那页；宽度未量到/已对齐时不动。 */
  const alignStage = (behavior: ScrollBehavior): void => {
    const el = stageRef.current;
    if (!el || interactingRef.current) return;
    const target = pagerScrollLeft(tabIndexRef.current, el.clientWidth, HOME_TABS.length);
    if (Math.abs(el.scrollLeft - target) <= 1) return;
    // 程序化滚动期间产生的 scroll 事件不是用户意图：先压住回写，滚动结束/超时再放开。
    programmaticRef.current = true;
    window.clearTimeout(programmaticTimerRef.current);
    programmaticTimerRef.current = window.setTimeout(() => { programmaticRef.current = false; }, 600);
    el.scrollTo({ left: target, behavior });
  };

  // ① tab → 滚动位置：点顶部 tab / 父级改路由时把分页滚过去（动效按 reduced-motion 降级）。
  //    ⚠️ ResizeObserver **必须单独挂一次**：若在这里 new/observe，每次 tab 变化都会触发一次
  //    "初始回调" → 紧跟在本 effect 的 smooth 之后再来一次 auto，把动画当场取消（实测点击 tab 瞬跳）。
  useEffect(() => {
    // 这是滚动回写造成的 tab 变化：内容自己已经滚到位/正在滚，不能再发一次程序化滚动（会打断惯性）。
    if (commitByScrollRef.current) { commitByScrollRef.current = false; return; }
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    alignStage(reduce ? "auto" : "smooth");
  }, [tabIndexNow]);

  // ①b 宽度变化（横竖屏 / 窗口变化）：立即重新对齐，否则会停在半页。高度变化（键盘）不动横向位置。
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => alignStage("auto"));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ② 滚动 → tab：**过半就回写**（不等到 scrollend）。
  //    原因（261019 用户实测反馈）：若只在滚动结束回写，吸附动画期间/刚到位时会短暂出现
  //    "内容已经是小记、顶部还着重知识库" 的错位；过半回写让标签始终跟着"当前多数可见页"。
  //    只写"与当前 tab 不同"的情况，避免自触发循环；监听只挂一次（用 ref 读最新值）。
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const commit = (): void => {
      if (programmaticRef.current) return;
      const w = el.clientWidth;
      if (!w) return;
      const next = tabAt(settledIndex(el.scrollLeft, w, HOME_TABS.length), HOME_TABS.length);
      if (next !== tabRef.current) {
        commitByScrollRef.current = true;
        onTabChangeRef.current(next);
      }
    };
    const onTouchStart = (): void => {
      interactingRef.current = true;
      // 用户接管：程序化滚动（含动画）作废，之后按真实滚动回写。
      programmaticRef.current = false;
      window.clearTimeout(programmaticTimerRef.current);
    };
    const onTouchEnd = (): void => { interactingRef.current = false; };
    const onScrollEnd = (): void => {
      programmaticRef.current = false;
      window.clearTimeout(programmaticTimerRef.current);
      commit();
    };
    el.addEventListener("scroll", commit, { passive: true });
    el.addEventListener("scrollend", onScrollEnd);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.clearTimeout(programmaticTimerRef.current);
      el.removeEventListener("scroll", commit);
      el.removeEventListener("scrollend", onScrollEnd);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  // ③ 非活动页 inert：两页都在 DOM 里，不能让读屏/焦点摸到屏幕外那页。
  useEffect(() => {
    quickPaneRef.current?.toggleAttribute("inert", tab !== "quick");
    libraryPaneRef.current?.toggleAttribute("inert", tab !== "library");
  }, [tab]);

  // ④ 写作/编辑小记时锁横向分页：切走会清掉写作卡（= 丢草稿）。CSS 侧只留纵向滚动（touch-action: pan-y）。
  useEffect(() => {
    if (composer === null || tab !== "quick") return;
    stageRef.current?.scrollTo({ left: 0, behavior: "auto" });
  }, [composer, tab]);

  // 「常用」= 设备本地收藏（工作区目录菜单「设为常用」写入；不同步、不进 S3）
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readFavoriteIds());
  const [favoriteOpen, setFavoriteOpen] = useState<boolean>(() => readFavoritesOpen());
  useEffect(() => subscribeFavorites(() => setFavoriteIds(readFavoriteIds())), []);
  const favoriteNotes = useMemo(
    () => favoriteIds.map((id) => notes.find((n) => n.id === id)).filter((n): n is LocalNoteSummary => !!n),
    [favoriteIds, notes],
  );
  const toggleFavoriteOpen = (): void => {
    setFavoriteOpen((v) => { const next = !v; writeFavoritesOpen(next); return next; });
  };

  const {
    displayedQuickNotes,
    quickTagIndex,
    quickTagFilter,
    setQuickTagFilter,
    quickSort,
    setQuickSort,
    quickSortOptions,
    sortedQuickNotes,
  } = useQuickNoteListModel(quickNotes, quickNoteDetails, tagDirectory);

  /** 写作区/选择器用完整目录（含 0 条小记的新标签）；标签条只用有计数的索引。 */
  const quickNoteTagOptions = useMemo(
    () => buildQuickNoteTagOptions(tagDirectory, quickTagIndex.tags),
    [tagDirectory, quickTagIndex.tags],
  );

  const quickVirtualEnabled = tab === "quick" && composer === null && sortedQuickNotes.length > QUICK_NOTE_VIRTUAL_THRESHOLD;
  const [quickScrollMargin, setQuickScrollMargin] = useState(0);
  const [quickScrollElement, setQuickScrollElement] = useState<HTMLDivElement | null>(null);
  const setQuickScrollNode = useCallback((node: HTMLDivElement | null) => {
    quickScrollRef.current = node;
    setQuickScrollElement(node);
  }, []);
  const getQuickScrollElement = useCallback(() => quickScrollElement, [quickScrollElement]);
  const getQuickItemKey = useCallback((index: number) => sortedQuickNotes[index]?.id ?? index, [sortedQuickNotes]);
  const quickVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: quickVirtualEnabled ? sortedQuickNotes.length : 0,
    getScrollElement: getQuickScrollElement,
    estimateSize: () => 168,
    getItemKey: getQuickItemKey,
    overscan: 6,
    initialRect: { width: 390, height: 800 },
    scrollMargin: quickScrollMargin,
    scrollPaddingStart: quickScrollMargin,
    enabled: quickVirtualEnabled,
  });
  useLayoutEffect(() => {
    if (!quickVirtualEnabled) return;
    const update = () => {
      const scroller = quickScrollRef.current;
      const cards = quickCardsRef.current;
      if (!scroller || !cards) return;
      setQuickScrollMargin(cards.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    if (quickScrollRef.current) ro.observe(quickScrollRef.current);
    return () => ro.disconnect();
  }, [quickVirtualEnabled, sortedQuickNotes.length, quickTagIndex.tags.length]);
  useLayoutEffect(() => {
    if (quickVirtualEnabled) quickVirtualizer.measure();
  }, [quickVirtualEnabled, sortedQuickNotes, quickVirtualizer]);

  const openEdit = async (id: string): Promise<void> => {
    try {
      const full = await bridge.readQuickNote(id);
      if (!full) return;
      setEditNote({ id, text: full.content.text, body: full.content.body, images: full.content.images, tagIds: full.content.tagIds });
      setComposer({ mode: "edit", id });
    } catch { /* 读取失败忽略 */ }
  };
  const closeComposer = (): void => { setComposer(null); setEditNote(null); };

  // 全局搜索命中「小记」：HomePage 常驻 ⇒ 清标签筛选、滚到卡片并短暂高亮，**不自动进编辑**。
  // 注意：高亮计时器必须独立于 pending 清理，否则 pending 变 null 时 cleanup 会把计时器一起清掉、高亮永不消失。
  useEffect(() => {
    if (!pendingQuickNoteId) return;
    setQuickTagFilter({ kind: "all" });
    setRevealedQuickNoteId(pendingQuickNoteId);
    const index = displayedQuickNotes.findIndex((note) => note.id === pendingQuickNoteId);
    if (quickVirtualEnabled && index >= 0) quickVirtualizer.scrollToIndex(index, { align: "center" });
    let second = 0;
    const frame = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-quick-note-id="${escapeId(pendingQuickNoteId)}"]`)?.scrollIntoView({ block: "nearest" });
        // 清 pending 会触发本 effect cleanup；等虚拟行真正挂载后再消费标记。
        onPendingQuickNoteConsumed?.();
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (second) window.cancelAnimationFrame(second);
    };
  }, [displayedQuickNotes, onPendingQuickNoteConsumed, pendingQuickNoteId, quickVirtualEnabled, quickVirtualizer]);

  useEffect(() => {
    if (!revealedQuickNoteId) return;
    const timer = window.setTimeout(() => setRevealedQuickNoteId(null), 1600);
    return () => window.clearTimeout(timer);
  }, [revealedQuickNoteId]);

  // Android 返回键：写作/编辑小记中**先退出编辑**（与「取消」同语义），不能直接退 App。
  // 走统一返回栈，浮层（排序/「...」菜单等）打开时它们在上层、仍先消费。
  useEffect(() => {
    if (composer === null) return;
    return pushBackHandler(() => { closeComposer(); return true; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composer]);
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

  const applyQuickNoteTags = async (id: string, tagIds: string[]): Promise<void> => {
    try {
      const full = await bridge.readQuickNote(id);
      if (!full) return;
      await bridge.saveQuickNoteContent(id, {
        text: full.content.text,
        body: full.content.body,
        images: full.content.images,
        tagIds,
      });
      await onQuickNotesChanged();
    } catch (reason) {
      showToast("更新标签失败：" + (reason as Error).message, { type: "error" });
    }
  };

  // 排序（小记专用；知识库顺序 = 共享 sort_order = 桌面端顺序，不做本地排序）
  //  261015 用户点单：**加创建时间两档** ⇒ 最近更新 / 最早更新 / 最新创建 / 最早创建。
  const filterItems = useMemo<MobileSheetItem[]>(
    () => quickSortOptions.map((o) => ({ id: o.id, label: o.label, note: quickSort === o.id ? "当前" : undefined })),
    [quickSort, quickSortOptions],
  );
  const onFilterSelect = (item: MobileSheetItem): void => {
    setFilterOpen(false);
    const next = item.id as QuickNoteSort;
    setQuickSort(next);
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
    const nb = iconNb;
    if (!nb) return;
    try {
      await bridge.setNodeIcon(nb.id, icon);
      setIconNb((current) => current?.id === nb.id ? { ...current, icon } : current);
      await onTreeChanged();
    }
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

  const renderQuickNoteCard = (note: MobileQuickNote) => (
    <QuickNoteCard
      key={note.id}
      note={note}
      revealed={revealedQuickNoteId === note.id}
      onRequestDetail={loadQuickNoteDetail}
      dateValue={quickNoteSortTime(note, quickSort)}
      onEdit={() => { void openEdit(note.id); }}
      onMore={() => setQuickMenuFor(note.id)}
      onFilterTag={(tagId) => setQuickTagFilter({ kind: "tag", id: tagId })}
    />
  );

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

      <div
        ref={stageRef}
        className={"mobile-tab-stage" + (composer !== null ? " mobile-tab-stage--locked" : "")}
        aria-label="首页内容"
      >
        {/* 两页**常驻**：手指拖动时两页同时可见（语雀 pager 同形态）；非活动页由 effect 挂 inert。 */}
        <section ref={quickPaneRef} className="mobile-tab-pane">
        {composer !== null ? (
          /* 写作 = 编辑会话：滚动区给底部 dock 留白（见 .mobile-scroll--with-dock），底栏同时让位。 */
          <div className="mobile-scroll mobile-scroll--with-dock">
            <QuickNoteComposerLazy
              editNote={editNote}
              tagOptions={quickNoteTagOptions}
              initialInsert={composer.mode === "new" ? { files: composer.files, command: composer.command } : null}
              onSaved={async () => { closeComposer(); await onQuickNotesChanged(); }}
              onCancel={closeComposer}
            />
          </div>
        ) : (
          <div ref={setQuickScrollNode} className="mobile-scroll">
            {quickTagIndex.tags.length > 0 && (
              <div className="qn-tag-filter-bar" role="group" aria-label="按标签筛选小记">
                <button className={"qn-tag" + (quickTagFilter.kind === "all" ? " is-selected" : "")} onClick={() => setQuickTagFilter({ kind: "all" })}>
                  <span>全部</span><span className="qn-tag__count">{quickNotes.length}</span>
                </button>
                {quickTagIndex.tags.map((tag) => (
                  <button
                    key={tag.id}
                    className={"qn-tag" + (quickTagFilter.kind === "tag" && quickTagFilter.id === tag.id ? " is-selected" : "")}
                    onClick={() => setQuickTagFilter(quickTagFilter.kind === "tag" && quickTagFilter.id === tag.id ? { kind: "all" } : { kind: "tag", id: tag.id })}
                  >
                    <span className="mb-ellipsis">{tag.name}</span><span className="qn-tag__count">{tag.count}</span>
                  </button>
                ))}
                {quickTagIndex.untaggedCount > 0 && (
                  <button className={"qn-tag" + (quickTagFilter.kind === "untagged" ? " is-selected" : "")} onClick={() => setQuickTagFilter(quickTagFilter.kind === "untagged" ? { kind: "all" } : { kind: "untagged" })}>
                    <span>无标签</span><span className="qn-tag__count">{quickTagIndex.untaggedCount}</span>
                  </button>
                )}
              </div>
            )}
            {sortedQuickNotes.length === 0 ? (
              <div className="mb-empty">{quickTagFilter.kind === "all" ? "暂无小记" : "该筛选下暂无小记"}</div>
            ) : quickVirtualEnabled ? (
              <div
                ref={quickCardsRef}
                className="mobile-quick-cards"
                style={{ display: "block", position: "relative", height: Math.max(0, quickVirtualizer.getTotalSize() - quickScrollMargin), padding: 0 }}
              >
                {quickVirtualizer.getVirtualItems().map((item) => {
                  const note = sortedQuickNotes[item.index];
                  if (!note) return null;
                  return (
                    <div
                      key={item.key}
                      ref={quickVirtualizer.measureElement}
                      data-index={item.index}
                      style={{ position: "absolute", top: 0, left: 0, width: "100%", padding: "6px 14px", transform: `translateY(${item.start - quickScrollMargin}px)` }}
                    >
                      {renderQuickNoteCard(note)}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div ref={quickCardsRef} className="mobile-quick-cards">
                {sortedQuickNotes.map(renderQuickNoteCard)}
              </div>
            )}
          </div>
        )}
        </section>
        <section ref={libraryPaneRef} className="mobile-tab-pane">
        <div className="mobile-scroll mobile-library">
          {/* 「常用」分组（261019 用户点单）：固定在最上方，三角可收起/展开；卡片样式与首页文档卡一致，
              多个常用靠**横向滑动**浏览。内容只来自设备本地收藏（工作区目录菜单「设为常用」）。 */}
          {libraryView === "shelf" && favoriteNotes.length > 0 && (
            <section className="home-section home-favorite">
              <div className="home-section__head">
                <button
                  className="home-section__toggle"
                  onClick={toggleFavoriteOpen}
                  aria-expanded={favoriteOpen}
                  aria-label={favoriteOpen ? "收起常用" : "展开常用"}
                >
                  <span className="home-section__title">常用</span>
                  {favoriteOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
              </div>
              {favoriteOpen && (
                <div className="home-card-row">
                  {favoriteNotes.map((r) => (
                    <button key={r.id} className="doc-card" onClick={() => onOpenNote(r.id)} aria-label={r.title || "文档"}>
                      <span className="doc-card__paper" aria-hidden="true">
                        <span className="doc-card__lines" />
                      </span>
                      <span className="doc-card__name">{r.title || "无标题"}</span>
                      <span className="doc-card__date">{fmtRelative(r.updatedAt)}</span>
                    </button>
                  ))}
                </div>
              )}
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
        </section>
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
        <button className="mobile-bottom-bar__item" onClick={() => { if (onOpenAi) onOpenAi(); else showToast("AI 助手尚未接入"); }} aria-label="AI 助手" title="AI 助手"><Sparkles /></button>
      </nav>
      )}

      {/* 小记「...」菜单 */}
      <MobileSheetMenu
        open={!!quickMenuFor}
        items={[
          { id: "edit", label: "编辑", icon: Pencil },
          { id: "tag", label: "添加标签", icon: Tag },
          { id: "delete", label: "删除", icon: Trash, danger: true },
        ]}
        onClose={() => setQuickMenuFor(null)}
        onSelect={(it) => { const id = quickMenuFor; setQuickMenuFor(null); if (!id) return; if (it.id === "edit") void openEdit(id); else if (it.id === "tag") setTagSheetFor(id); else if (it.id === "delete") void deleteQuickNote(id); }}
      />

      {(() => {
        const note = tagSheetFor ? quickNotes.find((item) => item.id === tagSheetFor) : null;
        return note ? (
          <MobileQuickNoteTagSheet
            open
            options={quickNoteTagOptions}
            selected={note.tagIds}
            onAdd={(tagId) => { void applyQuickNoteTags(note.id, addQuickNoteTagId(note.tagIds, tagId)); }}
            onCreate={async (name) => {
              const created = await bridge.createQuickNoteTag(name);
              await onQuickNotesChanged();
              return created.id;
            }}
            onClose={() => setTagSheetFor(null)}
          />
        ) : null;
      })()}

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

      {/* 节点选择器与目录树 / 新建知识库共用；正文输入表情独立。 */}
      {iconNb && (
        <div className="mb-scrim" data-prevent-swipe onClick={() => setIconNb(null)}>
          <div className="mb-sheet" data-prevent-swipe onClick={(e) => e.stopPropagation()}>
            <div className="mb-sheet__head">
              <span className="mb-sheet__title">设置图标</span>
              <button className="mobile-icon-btn" onClick={() => setIconNb(null)} aria-label="关闭"><X size={20} /></button>
            </div>
            <div className="mb-sheet__body">
              <MobileNodeIconPicker key={iconNb.id} nodeType="notebook" value={iconNb.icon ?? null} onPick={(icon) => void applyNotebookIcon(icon)} />
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
function QuickNoteCard({ note, revealed, dateValue, onEdit, onMore, onFilterTag, onRequestDetail }: { note: MobileQuickNote; revealed: boolean; dateValue: string; onEdit: () => void; onMore: () => void; onFilterTag: (tagId: string) => void; onRequestDetail: (id: string) => void }) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (note.body || typeof IntersectionObserver === "undefined") return;
    const node = cardRef.current;
    if (!node) return;
    let requested = false;
    const observer = new IntersectionObserver((entries) => {
      if (requested || !entries.some((entry) => entry.isIntersecting)) return;
      requested = true;
      onRequestDetail(note.id);
      observer.disconnect();
    }, { rootMargin: "320px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [note.id, note.body, onRequestDetail]);

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
    <div ref={cardRef} className={"qn-card" + (revealed ? " is-revealed" : "")} data-quick-note-id={note.id} role="button" tabIndex={0} onClick={onEdit}>
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
          <span className="qn-card__date">{fmtDate(dateValue)}</span>
          <button className="qn-card__more mb-tap" onClick={(e) => { e.stopPropagation(); onMore(); }} aria-label="更多"><MoreHorizontal size={18} /></button>
        </div>
        {note.tagIds.length > 0 && (
          <div className="qn-card__tags">
            {note.tagIds.map((tagId, index) => {
              const name = note.tags[index];
              if (!name) return null;
              return (
                <button type="button" className="qn-tag" key={tagId} onClick={(event) => { event.stopPropagation(); onFilterTag(tagId); }}>
                  <span className="mb-ellipsis">{name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
