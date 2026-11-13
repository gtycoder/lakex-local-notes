/**
 * 第一层（首页）：小记 / 知识库 / 标签 / 日记 四个 tab（tab 行横向分页，判据见 ./tabPager）。
 * 布局（对齐 Yuque 官方移动端首层）：
 * - 小记 → 卡片（图在上/文在下/日期+更多「...」）；
 * - 知识库 → 「置顶」分组（顶部固定、可收起；横向卡，左右滑动找）+ 笔记本书架（3:4 彩面书卡，右上角切换 书架↔列表）；
 *   「最近文档」已按用户 261019 点单整体删除（手机端不存最近访问记录，也不展示）；
 * - 空态不做「创建」提示（默认空白即可）；
 * - 底部胶囊栏 = [筛选 | 新建 | 云同步]（新建按 tab 记性：小记=写小记、知识库=新建笔记本）。
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { writeLocalStorage } from "../../lib/localStorageSafe";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, CloudUpload, List, LayoutGrid, ArrowUpDown, BookMarked, Feather, ListFilter, MoreHorizontal, NotebookPen, Pencil, Plus, Search, Settings, Settings2, SmilePlus, Sparkles, Tag, Trash } from "lucide-react";
import type { TreeNode } from "../../lib/types";
import type { LocalNoteSummary } from "../data/noteRepository";
const NotebookGrid = lazy(() => import("./NotebookGrid").then((m) => ({ default: m.NotebookGrid })));
import { QuickNotePreview } from "../../features/quickNotes/QuickNotePreview";
import { openImagePreview } from "../../features/editor/imagePreview";
import { resolvePreviewAssetUrl } from "../../features/preview/previewAsset";
import { isQuickNoteImageMime, type StoredQuickNoteImage } from "../../core/quickNoteModel.js";
import { MobileErrorBoundary } from "../ui/MobileErrorBoundary";
import { MobileSheetMenu, type MobileSheetItem } from "../ui/MobileSheetMenu";
import { MobileSheet } from "../ui/MobileSheet";
import { NameSheet } from "../ui/NameSheet";
import { CreateSheet, type CreateActionId } from "../ui/CreateSheet";
import { CREATE_LONG_PRESS_MS, blockPressRelease, createPressArmed, createPressRevealed } from "../ui/createPress";
import { pickLocalFile } from "../ui/pickFile";
import { longPressFeedback } from "../ui/haptics";
// 261111 首屏瘦身：图标/表情选择器带表情数据表（≈16.6KB gz），只在长按笔记本打开面板时用 ⇒
// 懒加载，不进首屏静态图（Suspense 兜底 null：只有长按打开面板那一刻会拉分包，基本无感）。
const MobileNodeIconPicker = lazy(() => import("../ui/NodeIconPicker").then((m) => ({ default: m.MobileNodeIconPicker })));
import { confirmMobile } from "../ui/ConfirmDialog";
import { showToast } from "../ui/toastBus";
import { reportMobileActionError } from "../lib/reportMobileActionError";
// 待办勾选 = 与桌面同一实现（纯函数改写正文里那一个 checkbox 卡值）。
import { toggleTaskInBody } from "../../features/quickNotes/quickNotePreviewParser";
import { bridge } from "../bridge";
import { describeSyncProgress, readSyncProgress, subscribeSyncProgress, type SyncProgressSnapshot } from "../sync/syncProgressStore";
import { escapeId } from "../../lib/cssEscape";
import { useTabPager } from "./useTabPager";
// 小记排序：**两端共用的单一来源**（档位/文案/比较器/本机持久化都在这里；261015 用户要求桌面与移动统一）
import { quickNoteSortTime, type QuickNoteSort } from "../../core/quickNoteSort";
import { syncWarningSummary, syncWarningSummaryText } from "../../core/syncWarningText";
import { formatDiaryDateKey } from "../../core/diary";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { imageBoxAttrs, quickNoteImageUrl, quickNotePreviewAssetUrl } from "./quickNoteImage";
import { formatDateOnly, formatRelativeTime } from "../lib/listTime";
import { rowActivationProps } from "../ui/rowActivation";
import { withAssetAccessToken } from "../../lib/assetPort";
import { pushBackHandler } from "../ui/backStack";
import { useLongPress } from "../ui/useLongPress";
import { useSelectionMode } from "../ui/useSelectionMode";
import { SelectionActionBar, type SelectionAction } from "../ui/SelectionActionBar";
import { SelectionCheckbox } from "../ui/SelectionCheckbox";
import { SelectionTopBar } from "../ui/SelectionTopBar";
import { BatchTagPickerSheet } from "../ui/BatchTagPickerSheet";
import { summarizeBatchResult } from "../ui/batchNotesResult";
import { readFavoriteIds, readFavoritesOpen, subscribeFavorites, writeFavoritesOpen } from "../data/favorites";
import { QuickNoteComposerLazy } from "./quickNoteComposerLazy";
import { MobileQuickNoteTagSheet } from "./MobileQuickNoteTagSheet";
const TagsHomeTab = lazy(() => import("../tags/TagsHomeTab").then((m) => ({ default: m.TagsHomeTab })));
// 日记页按需加载（261109）：它把 core/diary + 自己的列表/搜索接线带进分包，
// 静态引入会直接抬高移动端 entry 预算（check:bundle 的 mobile-entry-js/preload 是硬门禁）。
const DiaryPage = lazy(() => import("../diary/DiaryPage").then((m) => ({ default: m.DiaryPage })));
/** 第五个空间（底部 Dock 的「AI」）：内嵌 AI 页（embedded 模式，不再全屏路由）。 */
const MobileAiPage = lazy(() => import("../ai/MobileAiPage").then((m) => ({ default: m.MobileAiPage })));
import { HOME_TABS, type HomeTab } from "./tabPager";
import { quickNoteDetailOf, useQuickNoteDetailCache } from "./useQuickNoteDetailCache";
import { notifyMissingQuickNoteOnce } from "./missingQuickNoteNotice";
import { useQuickNoteListModel } from "./useQuickNoteListModel";
import { addQuickNoteTagId, buildQuickNoteTagOptions, type QuickNoteTag } from "../../core/quickNoteTags";
import { toastActionError } from "../lib/actionError";
import { EmptyState } from "../ui/EmptyState";

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
/** 未接线（render 测试/宿主没传 diaryNodes）时的稳定空数组：稳定引用 ⇒ 日记页的 useMemo 不每帧重算。 */
const EMPTY_DIARY_NODES: readonly TreeNode[] = [];

export type LibraryView = "shelf" | "list";

export interface HomePageProps {
  tab: HomeTab;
  notebooks: TreeNode[];
  /** 全部笔记（解析「置顶」文档的标题/时间用） */
  notes: LocalNoteSummary[];
  quickNotes: MobileQuickNote[];
  /** 标签目录（标签表是唯一来源；随小记 Manifest 同步）。 */
  tagDirectory: readonly QuickNoteTag[];
  /** 笔记本 → 文档数 */
  docCounts: Record<string, number>;
  onTabChange: (tab: HomeTab) => void;
  onOpenNotebook: (id: string) => void;
  onOpenNote: (id: string) => void;
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
  /** AI 页内「存为文档 / 存为小记」后刷新首页数据（AI 现在是第四格分页，不再全屏路由）。 */
  onAiChanged?: () => void;
  onCreateNotebook: () => void;
  /** 「空白文档」：在用户选中的笔记本下建文档并进编辑态（归属判定复用 MobileApp.createNoteInParent）。 */
  onCreateNote: (notebookId: string) => void;
  /** 目录树（笔记本/分组）变了以后刷新数据（重命名 / 设置图标 / 删除笔记本都走它）。 */
  onTreeChanged: () => Promise<void>;
  onQuickNotesChanged: () => Promise<void>;
  /** 标签目录变了（建标签/改名/删除）：只刷新标签目录，不回读小记列表。 */
  onQuickNoteTagsChanged: () => Promise<void>;
  /** 「标签」页点小记：回小记 tab 并定位/高亮（与全局搜索同一条通路）。 */
  onOpenQuickNote?: (id: string) => void;
  /** 标签目录/关系变了（标签页里的管理动作）：刷新快照。 */
  onTagsChanged?: () => Promise<void>;
  /** 全局搜索命中小记：首页常驻组件接力定位/高亮该条（不自动进编辑态）。 */
  pendingQuickNoteId?: string | null;
  onPendingQuickNoteConsumed?: () => void;
  /**
   * 全量目录树（**含日记本**）：日记页的判据要看得见日记笔记本；知识库列表那份由 MobileApp 过滤掉日记本。
   * 缺省 [] ⇒ 日记页显示空态（render 测试不传也能渲染）。
   */
  diaryNodes?: readonly TreeNode[];
  /** 打开某天的日记：进现有工作区（日记不新造编辑面，正文输入仍走工作区 + dock）。 */
  onOpenDiaryEntry?: (input: { noteId: string; notebookId: string; mode: "viewer" | "editor" }) => void;
  /** 搜索日记：复用移动端既有全库搜索，由宿主按日记条目 id 过滤。 */
  onOpenDiarySearch?: () => void;
}

/**
 * 写作卡状态。`files` / `command` = 首页**新建面板**带进来的起手内容（拍摄 / 图片 / 待办）：
 * 正文只能由内核产出，所以这里**不拼 body**，而是挂载后经 `initialInsert` 走内核通道（见 QuickNoteComposer）。
 */
type ComposerState =
  | { mode: "new"; files?: File[]; command?: "taskList" }
  | { mode: "edit"; id: string }
  | null;

const VIEW_KEY = "lakex-local-notes-mobile.libraryView";

/**
 * 首层五空间（261110 底部 Dock）：顺序 = HOME_TABS，图标 + 文字同一个来源。
 * 与桌面五空间 1:1（文档=知识库 / 小记 / 日记 / AI（移动为助手，已有会话历史）/ 标签）。
 */
const HOME_TAB_META: Record<HomeTab, { label: string; Icon: typeof Feather }> = {
  quick: { label: "小记", Icon: Feather },
  library: { label: "知识库", Icon: BookMarked },
  diary: { label: "日记", Icon: NotebookPen },
  ai: { label: "AI", Icon: Sparkles },
  tags: { label: "标签", Icon: Tag },
};


export function HomePage(props: HomePageProps) {
  const {
    tab, notebooks, notes, quickNotes, tagDirectory, docCounts, onTabChange, onOpenNotebook,
    onOpenNote, onOpenQuickNote, onTagsChanged, onOpenDrawer, onOpenSearch, onAiChanged, onCreateNotebook, onCreateNote, onTreeChanged, onQuickNotesChanged, onQuickNoteTagsChanged,
    pendingQuickNoteId, onPendingQuickNoteConsumed,
    diaryNodes, onOpenDiaryEntry, onOpenDiarySearch,
  } = props;
  const [composer, setComposer] = useState<ComposerState>(null);
  const [editNote, setEditNote] = useState<{ id: string; text: string; body?: string; images: import("../../core/quickNoteModel.js").StoredQuickNoteImage[]; tagIds: string[] } | null>(null);
  const [revealedQuickNoteId, setRevealedQuickNoteId] = useState<string | null>(null);
  const [libraryView, setLibraryView] = useState<LibraryView>(() => (localStorage.getItem(VIEW_KEY) === "list" ? "list" : "shelf"));
  const [quickMenuFor, setQuickMenuFor] = useState<string | null>(null);
  const [tagSheetFor, setTagSheetFor] = useState<string | null>(null);

  const [filterOpen, setFilterOpen] = useState(false);
  /** 261110 A+B：小记筛选用**单入口 + 中性底部 Sheet**（不再有一排彩色常驻 chips）。 */
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  // P0-6：同步进度（引擎 onProgress → 节流 → 顶部同步按钮 title/aria-label；不改 5 槽构图）。
  const [syncProgress, setSyncProgress] = useState<SyncProgressSnapshot | null>(() => readSyncProgress());
  useEffect(() => subscribeSyncProgress(() => setSyncProgress(readSyncProgress())), []);
  const { details: quickNoteDetails, loadDetail: loadQuickNoteDetail, cacheDetail: cacheQuickNoteDetail } = useQuickNoteDetailCache(quickNotes);
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
   * 首层 tab = **横向分页**（261019 用户点单，对齐语雀 App；261028 MOB-03 收口成纯状态机）：
   * 两页常驻在同一个原生横向滚动容器里 ⇒ 手指跟手拖动、松手由 `scroll-snap` 吸附，
   * 等价于语雀 RN 侧的 `react-native-pager-view`。
   * 判据/事件流在 tabPager.reducePager（纯函数 + 单测），DOM 接线在 useTabPager（只负责 scrollTo）：
   * ① tab → 滚动位置对齐（点 tab / 路由变化 / 横竖屏宽度变化）；② 滚动过半把页码回写成 tab；
   * ③ 非活动页 inert；④ 写作会话中锁横滑（否则父级 [tab] effect 会清掉草稿）。
   */
  const { stageRef } = useTabPager({ tab, onTabChange });
  // v2（261107）：顶栏滚动状态用 class 直接切（滚动里 setState 会整页重渲染）。
  const topbarRef = useRef<HTMLElement | null>(null);
  const quickPaneRef = useRef<HTMLElement | null>(null);
  const quickScrollRef = useRef<HTMLDivElement | null>(null);
  const quickCardsRef = useRef<HTMLDivElement | null>(null);
  const libraryPaneRef = useRef<HTMLElement | null>(null);
  const tagsPaneRef = useRef<HTMLElement | null>(null);
  const diaryPaneRef = useRef<HTMLElement | null>(null);
  const aiPaneRef = useRef<HTMLElement | null>(null);
  /** AI 页首次进入才挂载（懒 chunk，不进首页首屏）；切走后保留 DOM（会话/流在 store 里不丢）。 */
  const [aiMounted, setAiMounted] = useState(false);
  useEffect(() => { if (tab === "ai") setAiMounted(true); }, [tab]);

  // ③ 非活动页 inert：各页都在 DOM 里，不能让读屏/焦点摸到屏幕外那页。
  useEffect(() => {
    quickPaneRef.current?.toggleAttribute("inert", tab !== "quick");
    libraryPaneRef.current?.toggleAttribute("inert", tab !== "library");
    tagsPaneRef.current?.toggleAttribute("inert", tab !== "tags");
    diaryPaneRef.current?.toggleAttribute("inert", tab !== "diary");
    aiPaneRef.current?.toggleAttribute("inert", tab !== "ai");
  }, [tab]);

  // v2（261107）：首页顶栏滚动状态 —— 任一 pane 滚过 6px 就浮出玻璃底 / 收起 tab / 显示居中标题。
  // 用 class 直接切（滚动里 setState 会让整页重渲染）；rAF 合并同一帧内的多次 scroll。
  useEffect(() => {
    const stage = stageRef.current;
    const bar = topbarRef.current;
    if (!stage || !bar) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      let y = 0;
      stage.querySelectorAll<HTMLElement>(".mobile-scroll").forEach((node) => { y = Math.max(y, node.scrollTop); });
      bar.classList.toggle("is-scrolled", y > 6);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    stage.addEventListener("scroll", onScroll, true);
    return () => {
      stage.removeEventListener("scroll", onScroll, true);
      if (raf) cancelAnimationFrame(raf);
    };
    // 261111：写作会话会卸载顶栏（全屏写作卡）⇒ 依赖里带上 composer，退出写作时重新绑定新顶栏节点。
  }, [stageRef, tab, composer]);

  // ④ 写作/编辑小记时锁横向分页：切走会清掉写作卡（= 丢草稿）。CSS 侧只留纵向滚动（touch-action: pan-y）。
  useEffect(() => {
    if (composer === null || tab !== "quick") return;
    stageRef.current?.scrollTo({ left: 0, behavior: "auto" });
  }, [composer, tab]);

  // 「置顶」= 设备本地入口（工作区目录菜单「置顶」写入；不同步、不进 S3）
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

  /**
   * 多选模式（261106 task-82）：只给小记列表用（目录抽屉/标签页长按仍是拖拽，笔记本卡片长按仍是菜单）。
   * 可见集合 = sortedQuickNotes（当前筛选+排序后的列表，全选/剪枝都以它为准）。
   * 动作 = 打标签 / **移入回收站**（软删，可恢复；不做批量彻底删除）。
   * 桥接（bridge.batchNotes）在 task-80 落地后接入，本阶段先占位提示。
   */
  const selection = useSelectionMode(sortedQuickNotes.map((note) => note.id));
  const quickSelectionActions: SelectionAction[] = [
    { id: "tag", label: "打标签", icon: Tag },
    { id: "trash", label: "移入回收站", icon: Trash },
  ];
  /** 批量操作：打标签走选择器 Sheet；移入回收站走二次确认。桥 = bridge.batchNotes（软删，可恢复）。 */
  const [batchTagOpen, setBatchTagOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const applyQuickBatch = async (payload: { action: "trash" | "tag-add"; tagIds?: string[] }): Promise<void> => {
    if (selection.count === 0) { showToast("请先选择小记"); return; }
    setBatchBusy(true);
    setBatchError(null);
    try {
      const result = await bridge.batchNotes({ ...payload, ids: [...selection.ids], space: "quickNotes" });
      const failed = result.summary.failed;
      const summary = summarizeBatchResult(result, payload.action === "trash" ? "已移入回收站" : "已加标签");
      if (failed > 0) showToast(summary, { type: "error" });
      else showToast(summary);
      if (failed > 0) { setBatchError(summarizeBatchResult(result, "")); return; }
      setBatchTagOpen(false);
      selection.exit();
      await onQuickNotesChanged();
    } catch (error) {
      showToast((payload.action === "trash" ? "移入回收站失败：" : "加标签失败：") + (error as Error).message, { type: "error" });
    } finally {
      setBatchBusy(false);
    }
  };
  const runQuickSelectionAction = (actionId: string): void => {
    if (selection.count === 0) { showToast("请先选择小记"); return; }
    if (actionId === "tag") { setBatchError(null); setBatchTagOpen(true); return; }
    if (actionId === "trash") {
      void confirmMobile({
        title: "移入回收站？",
        body: "将把选中的 " + selection.count + " 条小记移入回收站（可在小记回收站恢复，不会彻底删除）。",
        confirmText: "移入回收站",
        danger: true,
      }).then((ok) => { if (ok) void applyQuickBatch({ action: "trash" }); });
    }
  };
  // 选择态下返回键先退出多选（不退出 App）。
  useEffect(() => {
    if (!selection.active) return;
    return pushBackHandler(() => { selection.exit(); return true; });
  }, [selection.active]);

  /** 写作区/选择器用完整目录（含 0 条小记的新标签）；标签条只用有计数的索引。 */
  const quickNoteTagOptions = useMemo(
    () => buildQuickNoteTagOptions(tagDirectory, quickTagIndex.tags),
    [tagDirectory, quickTagIndex.tags],
  );

  /** 261110 A+B：筛选入口上显示「当前条件」的人话（all / untagged / 某标签 / 选中集合）。 */
  const quickFilterLabel = quickTagFilter.kind === "all"
    ? "全部"
    : quickTagFilter.kind === "untagged"
      ? "无标签"
      : quickTagFilter.kind === "tag"
        ? (quickTagIndex.tags.find((tag) => tag.id === quickTagFilter.id)?.name ?? "标签")
        : "已选筛选";
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

  /** v2（261107）：共享元素转场 —— 卡片 → 目标容器（FLIP 克隆）。
   *  克隆按卡片当前矩形浮起，扩到目标矩形后淡出；真实目标视图随后挂载/切换。
   *  只动几何 + opacity，不参与布局；reduced-motion 下直接跳过。 */
  const morphCardToRect = useCallback((card: HTMLElement | null, target: HTMLElement | null): void => {
    if (!card || !target) return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const from = card.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    if (!from.width || !to.width) return;
    const clone = card.cloneNode(true) as HTMLElement;
    clone.classList.add("mb-morph-card");
    clone.setAttribute("aria-hidden", "true");
    clone.style.left = from.left + "px";
    clone.style.top = from.top + "px";
    clone.style.width = from.width + "px";
    clone.style.height = from.height + "px";
    document.body.appendChild(clone);
    requestAnimationFrame(() => {
      clone.style.transition = "left var(--mb-dur-page) var(--mb-ease), top var(--mb-dur-page) var(--mb-ease), width var(--mb-dur-page) var(--mb-ease), height var(--mb-dur-page) var(--mb-ease), border-radius var(--mb-dur-page) var(--mb-ease)";
      clone.style.left = to.left + "px";
      clone.style.top = to.top + "px";
      clone.style.width = to.width + "px";
      clone.style.height = to.height + "px";
      clone.style.borderRadius = "var(--mb-radius-card)";
    });
    window.setTimeout(() => {
      clone.classList.add("is-out");
      window.setTimeout(() => clone.remove(), 180);
    }, 330);
  }, []);

  /** 小记卡 → 写作卡。 */
  const morphCardToComposer = useCallback((card: HTMLElement | null): void => {
    morphCardToRect(card, quickScrollRef.current);
  }, [morphCardToRect]);

  /** 置顶文档卡 → 文档工作区（共享元素扩到整页，路由转场在其下方完成）。 */
  const morphCardToScreen = useCallback((card: HTMLElement | null): void => {
    morphCardToRect(card, stageRef.current);
  }, [morphCardToRect]);

  const openEdit = async (id: string): Promise<void> => {
    try {
      const full = await bridge.readQuickNote(id);
      // 正文文件缺失（元数据还在）：**不能静默 return** —— 给与「缺正文文档」同源的提示，每篇每会话一次。
      if (!full) { notifyMissingQuickNoteOnce(id, showToast); return; }
      setEditNote({ id, text: full.content.text, body: full.content.body, images: full.content.images, tagIds: full.tagIds });
      setComposer({ mode: "edit", id });
    } catch (error) { reportMobileActionError("打开小记", error); }
  };
  const closeComposer = (): void => { setComposer(null); setEditNote(null); };

  /**
   * 卡片预览里勾选待办（261106 用户反馈：移动端勾选框点不动 —— HomePage 此前没给 QuickNotePreview 传
   * onToggleTask，组件在无回调时把复选框设成只读）。
   * 与桌面 togglePreviewTask 同语义、不新增桥/IPC：读全文 → toggleTaskInBody 翻转第 N 个 checkbox →
   * saveQuickNoteContent 原样回写 text/images → 回填详情缓存（勾选态立刻可见）+ 刷新列表（摘要/时间/排序）。
   */
  const toggleCardTask = async (noteId: string, checkboxIndex: number, checked: boolean): Promise<void> => {
    try {
      const full = await bridge.readQuickNote(noteId);
      if (!full) { notifyMissingQuickNoteOnce(noteId, showToast); return; }
      const body = toggleTaskInBody(full.content.body, checkboxIndex, checked);
      if (body === full.content.body) return; // 序号越界 / 值本来就一致：不动库，也不打扰
      await bridge.saveQuickNoteContent(noteId, { text: full.content.text, body, images: full.content.images });
      // 勾选态要立刻变（不能等列表刷新后重新读正文，否则会先闪回纯文本摘要）。
      const saved = await bridge.readQuickNote(noteId);
      if (saved) cacheQuickNoteDetail(noteId, quickNoteDetailOf(saved));
      await onQuickNotesChanged();
    } catch (error) {
      toastActionError("更新待办", error);
    }
  };

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
  const switchTab = (next: HomeTab): void => { onTabChange(next); };
  const runSync = async (): Promise<void> => {
    try {
      const r = await bridge.syncNow();
      // 同步可能改了远端小记/目录：刷新首页数据，否则列表停留在旧快照。
      await Promise.all([onQuickNotesChanged(), onTreeChanged()]);
      // task-67：跳过项计数/分组单一来源 = core/syncWarningText（不再手写「N 项被跳过」）。
      const summaryText = syncWarningSummaryText(syncWarningSummary(r.warnings ?? []));
      showToast((r.message || "已同步") + (summaryText ? `，${summaryText}` : ""));
    } catch (e) { toastActionError("同步", e); }
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
      case "diary": {
        // 261110：默认「今天」——bridge.diaryOpenDate 幂等（当天已有就打开最新那篇，没有就建一篇）。
        try {
          const result = await bridge.diaryOpenDate(formatDiaryDateKey());
          await onTreeChanged();
          onOpenDiaryEntry?.({ noteId: result.noteId, notebookId: result.notebookId, mode: "editor" });
        } catch (error) {
          toastActionError("打开今天的日记", error);
        }
        return;
      }
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

  /** 标签关系是独立子系统：只改关联表，**不重写正文**（正文 hash 不变，也不推进正文更新时间）。 */
  const applyQuickNoteTags = async (id: string, tagIds: string[]): Promise<void> => {
    try {
      await bridge.setQuickNoteTags(id, tagIds);
      await onQuickNotesChanged();
    } catch (reason) {
      toastActionError("更新标签", reason);
    }
  };

  /** 标签页写操作后：目录（新建/改名/排序）与关系（合并/删除）都可能变 ⇒ 两边一起刷新。
   *  （261106：管理动作已搬到一级「标签」页，原小记标签条只保留筛选 + 「管理」跳转。） */
  const applyTagsTabChanged = async (): Promise<void> => {
    if (onTagsChanged) await onTagsChanged();
    else { await onQuickNoteTagsChanged(); await onQuickNotesChanged(); }
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
  /** v2（261107）：重命名改为弹窗提交（value 由 NameSheet 传入，不再依赖行内 input 的 state 时序）。 */
  const renameNotebook = async (value: string): Promise<void> => {
    const cur = renamingNb;
    setRenamingNb(null);
    const title = value.trim();
    if (!cur || !title) return;
    try { await bridge.renameTreeNode(cur.id, title); await onTreeChanged(); }
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

  /**
   * P0-6 可视进度条（261026）：用户点单"先让文档展示出来 + 加进度条"。
   * 计数优先（正文/附件张数），没有计数就用字节；两者都没有（metadata/finalize）= 不确定态。
   * 只有同步进行中才渲染；结束后条消失，布局回到原样。
   */
  const syncPct = (() => {
    if (!syncProgress) return -1;
    const counted = syncProgress.total !== undefined && syncProgress.total > 0;
    const bytes = syncProgress.bytesTotal !== undefined && syncProgress.bytesTotal > 0;
    if (counted) return Math.max(0, Math.min(100, Math.round(((syncProgress.done ?? 0) / (syncProgress.total as number)) * 100)));
    if (bytes) return Math.max(0, Math.min(100, Math.round(((syncProgress.bytesDone ?? 0) / (syncProgress.bytesTotal as number)) * 100)));
    return -1;
  })();

  const renderQuickNoteCard = (note: MobileQuickNote) => (
    <QuickNoteCard
      key={note.id}
      note={note}
      revealed={revealedQuickNoteId === note.id}
      onRequestDetail={loadQuickNoteDetail}
      dateValue={quickNoteSortTime(note, quickSort)}
      onEdit={(card) => { morphCardToComposer(card); void openEdit(note.id); }}
      onMore={() => setQuickMenuFor(note.id)}
      onFilterTag={(tagId) => setQuickTagFilter({ kind: "tag", id: tagId })}
      onToggleTask={(checkboxIndex, checked) => { void toggleCardTask(note.id, checkboxIndex, checked); }}
      selecting={selection.active}
      selected={selection.isSelected(note.id)}
      onEnterSelect={() => selection.enter(note.id)}
      onToggleSelect={() => selection.toggle(note.id)}
    />
  );

  return (
    <div className="mobile-home">
      {/* 写作会话 = 全屏（261111）：顶栏让位给写作卡（取消/保存在卡内），保证写作区占满状态栏以下。 */}
      {composer === null && (selection.active && tab === "quick" ? (
        <SelectionTopBar
          count={selection.count}
          allSelected={selection.allSelected}
          onCancel={() => selection.exit()}
          onToggleAll={() => selection.toggleAll()}
        />
      ) : (
      <header ref={topbarRef} className="toolbar toolbar--border mobile-topbar mobile-topbar--home">
        {/* 三组栅格（261109 二改）：左右两侧各占 1fr、tab 组按内容定宽 ⇒
            **tab 恒在整栏居中**；右侧（排序/视图 + 云同步）永远靠右，加 tab 也不会被挤出去。 */}
        <div className="mobile-topbar-group mobile-topbar-group--start">
          <button className="toolbar__button" onClick={onOpenDrawer} aria-label="设置" title="设置"><Settings /></button>
        </div>
        <div className="mobile-topbar-group mobile-topbar-group--center">
          {/* 261110 底部 Dock 改版：空间切换全部下沉到 Dock，顶栏中间只显示**当前空间标题**。 */}
          <span className="mobile-topbar-title mobile-home-space-title" aria-live="polite">{HOME_TAB_META[tab].label}</span>
        </div>
        <div className="mobile-topbar-group mobile-topbar-group--end">
          {/* 用户 261014 定稿：排序（小记）/ 视图（知识库）+ 云同步**固定挂在顶栏右上角**，云同步恒在最右。 */}
          {tab === "quick" ? (
            <button className="toolbar__button" onClick={() => setFilterOpen(true)} aria-label="排序" title="排序"><ArrowUpDown /></button>
          ) : tab === "library" ? (
            <button className="toolbar__button" onClick={toggleView} aria-label={libraryView === "shelf" ? "切换到列表" : "切换到书架"} title={libraryView === "shelf" ? "切换到列表" : "切换到书架"}>{viewIcon}</button>
          ) : null}
          <button className="toolbar__button" onClick={onOpenSearch} aria-label="搜索" title="搜索"><Search /></button>
          {/* 261110 用户要求：云同步入口**始终可见**（不收起、不藏进菜单），恒在最右。 */}
          <button
            className="toolbar__button"
            onClick={() => void runSync()}
            aria-label={syncProgress ? "同步中：" + describeSyncProgress(syncProgress) : "立即同步"}
            title={syncProgress ? "同步中：" + describeSyncProgress(syncProgress) : "立即同步"}
          ><CloudUpload /></button>
        </div>
      </header>
      ))}

      {syncProgress && (
        <div className={"mobile-sync-strip" + (syncPct < 0 ? " is-indeterminate" : "")} role="status" aria-live="polite">
          <div className="mobile-sync-strip__text">
            <span className="mobile-sync-strip__label">{describeSyncProgress(syncProgress)}</span>
            {syncPct >= 0 && <span className="mobile-sync-strip__pct">{syncPct}%</span>}
          </div>
          <div className="mobile-sync-strip__bar" aria-hidden="true">
            {/* 不确定进度交给 CSS 动画（width 由 .is-indeterminate 规则给），不下发 inline width。 */}
            <span style={syncPct < 0 ? undefined : { width: syncPct + "%" }} />
          </div>
        </div>
      )}

      <div
        ref={stageRef}
        className={"mobile-tab-stage" + (composer !== null ? " mobile-tab-stage--locked" : "")}
        aria-label="首页内容"
      >
        {/* 两页**常驻**：手指拖动时两页同时可见（语雀 pager 同形态）；非活动页由 effect 挂 inert。 */}
        <section ref={quickPaneRef} className="mobile-tab-pane">
        {composer !== null ? (
          /* 写作 = 全屏编辑会话（261111）：与 capture 入口共用 .mobile-qn-screen；底栏/＋已让位。 */
          <div className="mobile-qn-screen">
            <QuickNoteComposerLazy
              editNote={editNote}
              tagOptions={quickNoteTagOptions}
              onCreateTag={async (name) => {
                const created = await bridge.createQuickNoteTag(name);
                await onQuickNoteTagsChanged();
                return created.id;
              }}
              initialInsert={composer.mode === "new" ? { files: composer.files, command: composer.command } : null}
              onSaved={async () => { closeComposer(); await onQuickNotesChanged(); }}
              onCancel={closeComposer}
            />
          </div>
        ) : (
          <div ref={setQuickScrollNode} className="mobile-scroll">
            {(quickTagIndex.tags.length > 0 || tagDirectory.length > 0) && (
              <div className="qn-filter-bar">
                <button
                  type="button"
                  className={"mb-chip mb-chip--shrink" + (quickTagFilter.kind === "all" ? "" : " is-on")}
                  aria-haspopup="dialog"
                  aria-expanded={filterSheetOpen}
                  aria-label="筛选小记"
                  onClick={() => setFilterSheetOpen(true)}
                >
                  <ListFilter size={14} aria-hidden="true" />
                  <span className="mb-ellipsis">{quickFilterLabel}</span>
                  <span className="qn-num">{sortedQuickNotes.length}</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                <button type="button" className="mb-btn mb-btn--sm mb-btn--ghost" aria-label="标签管理" onClick={() => switchTab("tags")}>
                  <Settings2 size={15} aria-hidden="true" /><span>管理</span>
                </button>
              </div>
            )}
            {sortedQuickNotes.length === 0 ? (
              <EmptyState>{quickTagFilter.kind === "all" ? "暂无小记" : "该筛选下暂无小记"}</EmptyState>
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
          {/* 「置顶」分组（261019 用户点单，261107 原「常用」改名）：固定在最上方，三角可收起/展开；卡片样式与首页文档卡一致，
              多个置顶项靠**横向滑动**浏览。内容只来自设备本地入口（工作区目录菜单「置顶」）。 */}
          {libraryView === "shelf" && favoriteNotes.length > 0 && (
            <section className="home-section home-favorite">
              <div className="home-section__head">
                <button
                  className="home-section__toggle"
                  onClick={toggleFavoriteOpen}
                  aria-expanded={favoriteOpen}
                  aria-label={favoriteOpen ? "收起置顶" : "展开置顶"}
                >
                  <span className="home-section__title">置顶</span>
                  {favoriteOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
              </div>
              {favoriteOpen && (
                <div className="home-card-row">
                  {favoriteNotes.map((r) => (
                    <button key={r.id} className="doc-card" onClick={(e) => { morphCardToScreen(e.currentTarget); onOpenNote(r.id); }} aria-label={r.title || "文档"}>
                      <span className="doc-card__paper" aria-hidden="true">
                        <span className="doc-card__lines" />
                      </span>
                      <span className="doc-card__name">{r.title || "无标题"}</span>
                      <span className="doc-card__date">{formatRelativeTime(r.updatedAt)}</span>
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
            <Suspense fallback={null}>
            <NotebookGrid
              notebooks={notebooks}
              docCounts={docCounts}
              view={libraryView}
              onOpenNotebook={onOpenNotebook}
              onLongPressNotebook={(nb) => setNbMenuFor(nb)}
            />
            </Suspense>
          </section>
        </div>
        </section>
        {/* 一级「日记」页（261109 v1）：列表 + 写今天 + 搜索入口；正文编辑仍进现有工作区（不新造输入面）。 */}
        <section ref={diaryPaneRef} className="mobile-tab-pane">
          {/* 分包未就绪时不画空白：给一个同构骨架（面在惰性 tab 里，用户切过来时通常已加载完）。 */}
          <Suspense fallback={<div className="mb-diary-skeleton" aria-hidden="true" />}>
            <DiaryPage
              nodes={diaryNodes ?? EMPTY_DIARY_NODES}
              onOpenEntry={(input) => { onOpenDiaryEntry?.(input); }}
              onOpenSearch={() => { onOpenDiarySearch?.(); }}
              onChanged={onTreeChanged}
            />
          </Suspense>
        </section>
        {/* 一级「AI」页（261110 底部 Dock 第四格）：内嵌嵌入式 AI 页；懒挂载，切走保留 DOM。 */}
        <section ref={aiPaneRef} className="mobile-tab-pane mobile-tab-pane--ai">
          {aiMounted ? (
            <Suspense fallback={<div className="mb-ai-pane-skeleton" aria-hidden="true" />}>
              <MobileErrorBoundary scope="ai" title="AI 面板加载失败">
                <MobileAiPage open embedded onClose={() => switchTab("quick")} onChanged={onAiChanged} />
              </MobileErrorBoundary>
            </Suspense>
          ) : null}
        </section>
        {/* 一级「标签」页（261106）：标签即入口 → 点进去看文档/小记 → 管理动作收在「管理」里。 */}
        <section ref={tagsPaneRef} className="mobile-tab-pane">
          <Suspense fallback={null}>
          <TagsHomeTab
            tags={tagDirectory}
            notes={notes}
            quickNotes={quickNotes}
            active={tab === "tags"}
            onOpenNote={onOpenNote}
            onOpenQuickNote={onOpenQuickNote ?? (() => showToast("小记入口暂不可用", { type: "error" }))}
            onChanged={applyTagsTabChanged}
          />
          </Suspense>
        </section>
      </div>

      {/* 底部 Dock（261110 用户点单，方案 A）：五格空间 + 中央悬浮「＋」。
          · 五个空间 = 小记 / 知识库 / 日记 / AI / 标签（与桌面五空间 1:1；左右滑动仍是同一个分页容器）；
          · 「＋」悬浮在 Dock 中央上方：短按 = 新建面板（按 tab 记性）；**长按 260ms + 上滑 = 速记一条小记**
            （手势判据沿用 ui/createPress.ts，与旧胶囊同源）；
          · 云同步与搜索在顶栏右上角：**同步恒可见**（用户 261110 明确要求，不收起）；
          · 写作会话 / 多选态期间不渲染（底部让给文档编辑 dock，避免两条贴底打架）。 */}
      {composer === null && !selection.active && (
        <div className="mb-home-dockwrap" data-prevent-swipe>
          <nav className="mb-home-dock" aria-label="空间">
            {HOME_TABS.map((id) => {
              const meta = HOME_TAB_META[id];
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={"mb-home-dock__item" + (active ? " is-active" : "")}
                  aria-current={active ? "page" : undefined}
                  onClick={() => switchTab(id)}
                >
                  <meta.Icon size={22} aria-hidden="true" />
                  <span className="mb-home-dock__label">{meta.label}</span>
                </button>
              );
            })}
          </nav>
          {/* AI 页自带「新对话」入口，且底部有自己的输入条 ⇒ 这一格不显示全局＋（否则会压住输入条）。 */}
          {tab !== "ai" && (
          <button
            type="button"
            className={"mb-home-fab" + (pressRevealed ? " is-revealed" : "") + (pressArmed ? " is-armed" : "")}
            aria-label="新建（长按上滑可速记）"
            aria-haspopup="dialog"
            aria-expanded={createOpen}
            onPointerDown={onPressDown}
            onContextMenu={(e) => e.preventDefault()}
            /* 长按过的那一次，吞掉随后由同一次按压合成的 click。 */
            onClickCapture={(e) => { if (suppressTapRef.current) { e.preventDefault(); e.stopPropagation(); } }}
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={24} aria-hidden="true" />
            {pressRevealed && <span className="mb-home-fab__tip" aria-hidden="true">{pressArmed ? "松手记一条小记" : "继续上滑记小记"}</span>}
          </button>
          )}
        </div>
      )}

      {/* 261110 A+B：小记筛选 —— 入口是顶部一行「筛选 · 当前条件」；候选（中性 chips）收进底部 Sheet，
          不再有一排彩色药丸常驻占位。 */}
      <MobileSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="筛选"
        ariaLabel="筛选小记"
        bodyClassName="qn-filter-sheet__body"
      >
        <div className="mb-chip-row qn-filter-sheet__chips" role="group" aria-label="按标签筛选小记">
          <button
            type="button"
            className={"mb-chip mb-chip--shrink" + (quickTagFilter.kind === "all" ? " is-on" : "")}
            aria-pressed={quickTagFilter.kind === "all"}
            onClick={() => { setQuickTagFilter({ kind: "all" }); setFilterSheetOpen(false); }}
          ><span>全部</span><span className="qn-num">{quickNotes.length}</span></button>
          {quickTagIndex.tags.map((tag) => {
            const on = quickTagFilter.kind === "tag" && quickTagFilter.id === tag.id;
            return (
              <button
                key={tag.id}
                type="button"
                className={"mb-chip mb-chip--shrink" + (on ? " is-on" : "")}
                aria-pressed={on}
                onClick={() => { setQuickTagFilter(on ? { kind: "all" } : { kind: "tag", id: tag.id }); setFilterSheetOpen(false); }}
              ><span className="mb-ellipsis">{tag.name}</span><span className="qn-num">{tag.count}</span></button>
            );
          })}
          {quickTagIndex.untaggedCount > 0 && (
            <button
              type="button"
              className={"mb-chip mb-chip--shrink" + (quickTagFilter.kind === "untagged" ? " is-on" : "")}
              aria-pressed={quickTagFilter.kind === "untagged"}
              onClick={() => { setQuickTagFilter(quickTagFilter.kind === "untagged" ? { kind: "all" } : { kind: "untagged" }); setFilterSheetOpen(false); }}
            ><span>无标签</span><span className="qn-num">{quickTagIndex.untaggedCount}</span></button>
          )}
          {quickTagIndex.tags.length === 0 && quickTagIndex.untaggedCount === 0 && (
            <div className="mb-empty">还没有标签</div>
          )}
        </div>
      </MobileSheet>

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
              // 标签是独立子系统：建标签只刷新标签目录，不回读小记列表。
              await onQuickNoteTagsChanged();
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

      {/* 节点选择器与目录树 / 新建知识库共用；正文输入表情独立。
          MOB-11：scrim / 右滑 / 返回栈 / 焦点 / 滚动锁交给 MobileSheet（此前漏了返回栈）。 */}
      {iconNb && (
        <MobileSheet open title="设置图标" onClose={() => setIconNb(null)}>
          <Suspense fallback={null}>
            <MobileNodeIconPicker key={iconNb.id} nodeType="notebook" value={iconNb.icon ?? null} onPick={(icon) => void applyNotebookIcon(icon)} />
          </Suspense>
        </MobileSheet>
      )}

      {/* 筛选 / 排序 */}
      <MobileSheetMenu
        open={filterOpen}
        items={filterItems}
        onClose={() => setFilterOpen(false)}
        onSelect={onFilterSelect}
      />

      {/* 新建面板（「＋」短按）：新建小记 / 文档与知识库（**无模板、无 OCR**） */}
      <CreateSheet open={createOpen} onClose={() => setCreateOpen(false)} onAction={(id) => void runCreateAction(id)} />

      {/* 「空白文档」选笔记本：只列已有笔记本（用户 261014 定） */}
      <MobileSheetMenu
        open={docPickOpen}
        items={notebooks.map((nb) => ({ id: nb.id, label: nb.title || "未命名知识库", icon: BookMarked }))}
        onClose={() => setDocPickOpen(false)}
        onSelect={(it) => { setDocPickOpen(false); onCreateNote(it.id); }}
      />

      {batchTagOpen && (
        <BatchTagPickerSheet
          open={batchTagOpen}
          options={quickNoteTagOptions}
          count={selection.count}
          busy={batchBusy}
          error={batchError}
          onClose={() => setBatchTagOpen(false)}
          onConfirm={(tagIds) => { void applyQuickBatch({ action: "tag-add", tagIds: [...tagIds] }); }}
        />
      )}

      {/* v2（261107）：知识库重命名走弹窗（不再在书卡/列表行内出现 input）。 */}
      <NameSheet
        open={!!renamingNb}
        title="重命名知识库"
        initialValue={renamingNb?.value ?? ""}
        placeholder="知识库名称"
        onSubmit={(value) => { void renameNotebook(value); }}
        onClose={() => setRenamingNb(null)}
      />

      {/* 多选模式的底部操作条（小记：打标签 / 移入回收站；不做批量彻底删除）。 */}
      {selection.active && tab === "quick" && (
        <SelectionActionBar fixed actions={quickSelectionActions} onAction={runQuickSelectionAction} />
      )}
    </div>
  );
}

/** 小记卡片：大图 + 摘要 + 日期 + 「...」（有图必展示，无图留中性占位）。 */
/**
 * 小记卡片图片「单击 vs 双击」判定窗（ms）：窗口内同一张图再次点按 = 双击（编辑）。
 * 卡片走的是 click（不是内核宿主，没有元素被重渲染的问题）：WebView 的 click 延迟 ~150ms、
 * 实测两击间隔可达 251ms ⇒ 取 320ms 覆盖它（250ms 会把双击判成两个单击）。
 */
const IMAGE_TAP_WINDOW_MS = 320;

function QuickNoteCard({ note, revealed, dateValue, onEdit, onMore, onFilterTag, onRequestDetail, onToggleTask, selecting, selected, onEnterSelect, onToggleSelect }: {
  note: MobileQuickNote; revealed: boolean; dateValue: string;
  onEdit: (card: HTMLElement | null) => void; onMore: () => void; onFilterTag: (tagId: string) => void; onRequestDetail: (id: string) => void;
  onToggleTask: (checkboxIndex: number, checked: boolean) => void;
  /** 多选模式（261106 task-82）：长按卡片进入、选择态下点卡片切换勾选（不打开编辑器）。 */
  selecting: boolean; selected: boolean; onEnterSelect: () => void; onToggleSelect: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  /** 长按进入多选后，抬手补发的那一次 click 要吞掉（否则会误开小记）。 */
  const suppressTap = useRef(false);
  /** 卡片图片「单击看大图 / 双击进编辑」的判定状态（261112 用户定稿）。 */
  const imageTapTimer = useRef<number | null>(null);
  const lastImageTap = useRef<{ key: string; at: number } | null>(null);
  const longPress = useLongPress(() => {
    suppressTap.current = true;
    onEnterSelect();
  }, { moveCancelPx: 10 });
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

  /**
   * 预览用资源（canonical URL + token + 图片离散缩略档位）：
   *  · 图片走 `?w=1024`（与封面同一档 ⇒ 同一张图在封面/正文里是同一个 URL，浏览器只解码一次）；
   *  · 视频/音频/附件原样（服务端只缩图片，加 query 只会打散缓存）。
   */
  const previewAssets = (note.images ?? []).map((image) => {
    const withToken = withAssetAccessToken(localAssetHttpUrl(note.id, image.filename, { space: "quick-notes" }));
    return {
      ...image,
      url: quickNotePreviewAssetUrl(withToken, image.mimeType),
      // Q02：点开大图后换原图（去显示档 w/date、保留 token）；Lightbox 先显示档位图再替换。
      originalUrl: resolvePreviewAssetUrl(
        { noteId: note.id, filename: image.filename, src: withToken, mimeType: image.mimeType },
        "original",
      ),
    };
  });
  /**
   * Lightbox 画廊**只收图片**（261112 R2）：资源清单是「图片 + 视频/音频/附件」混合数组
   * （core/quickNoteModel 的 StoredQuickNoteContent.images 语义），全塞进画廊会出现「左右切到视频 ⇒ 大图层空白」。
   * 判据与 QuickNotePreview 的渲染判据一致（它用同一个 isQuickNoteImageMime 决定 <img> 还是视频/音频/文件 chip），
   * 所以「预览里能点开大图的」与「画廊里的」是同一集合。
   * 注意：QuickNotePreview 的 assets 仍传**全量**（视频/音频/附件卡要 URL），只有画廊用它。
   */
  const galleryAssets = previewAssets.filter((asset) => isQuickNoteImageMime(asset.mimeType));
  const thumbUrl = note.firstImage
    ? quickNoteImageUrl(withAssetAccessToken(localAssetHttpUrl(note.id, note.firstImage, { space: "quick-notes" })))
    : null;
  /** 封面比例盒（宽高元数据可用时先占位，加载完不跳版）。 */
  const coverImage = note.firstImage ? (note.images ?? []).find((image) => image.filename === note.firstImage) : undefined;
  const coverBox = imageBoxAttrs(coverImage);
  useEffect(() => () => {
    if (imageTapTimer.current !== null) window.clearTimeout(imageTapTimer.current);
  }, []);

  /**
   * 卡片图片（用户 261112 定稿：**单击看图片、双击编辑**）：
   * - 单击 → 判定窗后开大图（画廊 = 本条小记全部图片，按正文顺序）；
   * - 判定窗内再点同一张 → 取消预览，走卡片默认动作（进编辑）；
   * - 选择态：与卡片一致只切勾选（不看大图）；长按刚进多选后补发的那次点击吞掉。
   * 图片的 click 在 QuickNotePreview 内部已 stopPropagation ⇒ 不会顺带触发卡片 activate。
   */
  const handleImageTap = (image: { filename?: string }): void => {
    if (suppressTap.current) { suppressTap.current = false; return; }
    if (selecting) { onToggleSelect(); return; }
    const key = image.filename ?? "";
    const now = Date.now();
    const previous = lastImageTap.current;
    const doubleTap = previous !== null && previous.key === key && now - previous.at <= IMAGE_TAP_WINDOW_MS;
    lastImageTap.current = { key, at: now };
    if (doubleTap) {
      if (imageTapTimer.current !== null) { window.clearTimeout(imageTapTimer.current); imageTapTimer.current = null; }
      lastImageTap.current = null;
      onEdit(cardRef.current);
      return;
    }
    if (imageTapTimer.current !== null) window.clearTimeout(imageTapTimer.current);
    imageTapTimer.current = window.setTimeout(() => {
      imageTapTimer.current = null;
      const shots = galleryAssets.filter((asset) => Boolean(asset.url));
      const index = Math.max(0, shots.findIndex((asset) => asset.filename === image.filename));
      openImagePreview(shots.map((asset) => ({ src: asset.url as string, originalSrc: asset.originalUrl })), index);
    }, IMAGE_TAP_WINDOW_MS);
  };
  /** 触摸点击 / 外接键盘 Enter·Space 共用同一激活语义（选择态 = 切换勾选，否则进编辑）。 */
  const activate = (): void => {
    if (suppressTap.current) { suppressTap.current = false; return; }
    if (selecting) { onToggleSelect(); return; }
    onEdit(cardRef.current);
  };
  return (
    <div
      ref={cardRef}
      className={"qn-card" + (revealed ? " is-revealed" : "") + (selected ? " is-selected" : "")}
      data-quick-note-id={note.id}
      {...rowActivationProps(activate)}
      aria-pressed={selecting ? selected : undefined}
      onTouchStart={longPress.onTouchStart}
      onTouchMove={longPress.onTouchMove}
      onTouchEnd={longPress.onTouchEnd}
      onTouchCancel={longPress.onTouchCancel}
      onClick={activate}
    >
      {thumbUrl && (
        <div className="qn-card__cover">
          <img
            className="qn-card__img"
            src={thumbUrl}
            alt=""
            loading="lazy"
            decoding="async"
            {...(coverBox ?? {})}
            // 封面也是「一点就开大图」的主入口（用户 261112：点击看图片、双击编辑）：
            // 单击 = 预览（画廊 = 本条全部图片，当前这张为第一张）；双击 = 进编辑。
            onClick={(event) => { event.stopPropagation(); handleImageTap({ filename: note.firstImage ?? undefined }); }}
          />
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
            // 图片：单击看大图、双击进编辑（261112 用户定稿；判定窗见 handleImageTap）。
            onImageClick={handleImageTap}
            // 封面上方已经画过第一张图 ⇒ 预览不再重复（261112 用户报「插一张图预览里出现两张」）。
            hiddenMediaNames={thumbUrl && note.firstImage ? new Set([note.firstImage]) : undefined}
            // 勾选框可点（与桌面卡片预览同能力）；组件内部已 stopPropagation ⇒ 不会顺带进编辑态。
            onToggleTask={onToggleTask}
          />
        ) : (
          <div className="qn-card__text">{note.previewText || (note.imageCount > 0 ? "[图片]" : "（空白小记）")}</div>
        )}
        <div className="qn-card__meta">
          <span className="qn-card__date">{formatDateOnly(dateValue)}</span>
          {selecting ? (
            <SelectionCheckbox compact checked={selected} />
          ) : (
            <button className="qn-card__more mb-tap" onClick={(e) => { e.stopPropagation(); onMore(); }} aria-label="更多"><MoreHorizontal size={18} /></button>
          )}
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
