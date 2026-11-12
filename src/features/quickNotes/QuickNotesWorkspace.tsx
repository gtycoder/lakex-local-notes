import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ArrowUpDown, Check, ChevronDown, FilePlus, Feather, Filter, LayoutList, LoaderCircle, MoreHorizontal, Plus, RotateCcw, Search, StickyNote, Tag, Tags, Trash, X } from "lucide-react";
import { native } from "../../lib/native";
import { QuickNotesVirtualList } from "../../components/app/QuickNotesVirtualList";
import { formatListTime } from "../../core/dateFormat";
import { QUICK_NOTE_VERSION } from "../../core/quickNoteModel";
// 小记排序：**两端共用的单一来源**（档位/文案/比较器/本机持久化都在这里；261015 用户要求桌面与移动统一）
import { QUICK_NOTE_SORT_OPTIONS, quickNoteSortTime } from "../../core/quickNoteSort";
import type { NoteDocument, QuickNoteDocument, QuickNoteListSummary, TreeNode } from "../../lib/types";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { QuickNoteTagPicker } from "./QuickNoteTagPicker";
import { QuickNoteTagManager } from "./QuickNoteTagManager";
import { QuickNoteFilterDialog, type QuickNoteFilterState } from "./QuickNoteFilterDialog";
import { isQuickNoteTimeFilterActive, quickNoteTimeFilterLabel } from "../../core/quickNoteFilters";
import { addQuickNoteTagId, type QuickNoteTagFilter } from "../../core/quickNoteTags";
import { QUICK_NOTE_TYPE_OPTIONS, type QuickNoteTypeFilter } from "../../core/quickNoteTypeFilter";
import { useAnchoredMenu } from "../../hooks/useAnchoredMenu";
import { useScrollFade } from "../../hooks/useScrollFade";
import { listSummaryOf, useQuickNoteList } from "./useQuickNoteList";
import { useQuickNoteFilters, type QuickNotesView } from "./useQuickNoteFilters";
import { useQuickNoteDraftSave } from "./useQuickNoteDraftSave";
import { useConfirm } from "../../hooks/useConfirm";
import { Dialog } from "../../components/ui/Overlay";
import { QuickNoteComposer } from "../../components/app/QuickNoteComposer";
import { QuickNoteCard } from "../../components/app/QuickNoteCard";

export interface QuickNotesWorkspaceHandle {
  /** 返回 true 代表可以离开当前小记页面；false 代表用户选择继续编辑。 */
  confirmLeave(): Promise<boolean>;
  /** 同步完成后刷新小记列表。 */
  refresh(): Promise<void>;
  /** 全局搜索命中一条小记：只定位/高亮并滚到视口，不自动进编辑态。 */
  revealNote(id: string): Promise<void>;
}

interface QuickNotesWorkspaceProps {
  notebooks: TreeNode[];
  /** 工作区级可见性（keep-alive：小记视图被隐藏时仍挂载，但**不建内核实例** —— 见 QuickNoteEditor.active）。 */
  visible?: boolean;
  onConverted(note: NoteDocument): void;
  onDirtyChange(dirty: boolean): void;
  /**
   * 云同步是否可用（判据 = core/cloudState 的 canTouchNetwork(cloudStateOf(...))，由 App 传入，单一来源）。
   * false ⇒「保存并同步」**置灰**并给说明（用户 261013 定稿）；「保存」不受影响（本地是真相）。
   */
  cloudReady?: boolean;
}


/**
 * 列表投影 → 卡片可渲染的文档占位（正文/资源尚未按需读回时）。
 * body 为空 ⇒ QuickNotePreview 回落到 previewText（纯文本），详情到达后原地换成富预览。
 *
 * 261112：**首屏**这层占位不再被看到 —— 列表面板在 setItems 前预热一屏正文（见 refreshItems 与
 * `core/quickNoteDetailPrewarm`），否则首帧是纯文本、下一帧才换富预览（用户报「小记第一打开闪屏」）。
 * 本占位只剩两个用途：滚动进入视口的新卡片、以及预热/读取失败时的降级（纯文本总比空白好）。
 */
const placeholderDocument = (item: QuickNoteListSummary): QuickNoteDocument => ({
  ...item,
  content: { version: QUICK_NOTE_VERSION, text: item.previewText, body: "", images: [], tagIds: item.tagIds, tags: item.tags },
});
/**
 * 列表行的标题文案：**只取前 10 个字**（用户 260919：列表列很窄，不用整段渲染再省略）。
 * 用主进程已算好的 `previewText`（截断 120 字），并剥掉内核 text/plain 的待办前缀 `[ ]` / `[x]`。
 */
const indexLabel = (item: QuickNoteListSummary): string => {
  const raw = (item.previewText || "").replace(/^\[\s*[xX]?\s*\]\s*/, "").trim();
  if (!raw) return "（无文字）";
  return raw.length > 10 ? `${raw.slice(0, 10)}…` : raw;
};

/** 列表版式的时间戳（对齐云端）：今天 = 「今天 HH:MM」，其余 = 「MM-DD」。 */
function indexStamp(iso: string): string {
  return formatListTime(new Date(iso), new Date());
}

export const QuickNotesWorkspace = forwardRef<QuickNotesWorkspaceHandle, QuickNotesWorkspaceProps>(function QuickNotesWorkspace(props, ref) {
  const { notebooks: notebookNodes, visible = true, onConverted, onDirtyChange, cloudReady = true } = props;
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<QuickNoteListSummary | null>(null);
  /** 待转成正式笔记的小记（多选时是一批） */
  const [convertItems, setConvertItems] = useState<QuickNoteListSummary[] | null>(null);
  /** 多选模式与已选集合（仅本机交互状态，不进 S3） */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  /** 列表视图：搜索（点击放大镜展开）与 ⋯ 菜单（类型/排序/批量操作）。 */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");

  // 五个菜单（排序 / 类型筛选 / 标签筛选 / ⋯ / 行内⋯）统一走锚定菜单原语（DT-12）：open 状态、锚点按钮、
  // aria-haspopup/expanded 与「已开则收」都在 hook 里；定位仍是测量式（内部 usePopoverPosition，DT-03），
  // gap/margin 保持原 clampPopoverPosition 口径的 6（几何不变）。
  const sortMenu = useAnchoredMenu({ gap: 6, margin: 6 });
  const filterMenu = useAnchoredMenu({ gap: 6, margin: 6 });
  const tagMenu = useAnchoredMenu({ gap: 6, margin: 6 });
  const moreMenu = useAnchoredMenu({ gap: 6, margin: 6 });
  /** 行内⋯菜单：同一个菜单服务多行，id 由 hook 记账（对齐云端图2）。 */
  const rowMenu = useAnchoredMenu({ gap: 6, margin: 6 });
  const [tagPickerFor, setTagPickerFor] = useState<{ noteId: string; anchor: HTMLElement } | null>(null);

  /** 标签目录（唯一来源在标签表；随 Manifest 同步）。 */
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  /** 确认浮层（DT-02）：替代 window.confirm（放弃未保存小记 / 批量删除）；渲染在面板末尾。 */
  const { confirm, confirmElement } = useConfirm();
  /** 轻提示（标签暂固定全部等）。 */
  const [viewHint, setViewHint] = useState<string | null>(null);
  const deleteTimer = useRef<number | null>(null);
  /** 列表视图的左列索引（261017 B：滚动边缘渐隐） */
  const indexListRef = useRef<HTMLDivElement | null>(null);
  // 撤销窗口内「尚未落盘删除」的小记 id：外部刷新（如同步完成）不得让它重新出现。
  const pendingDeleteIdRef = useRef<string | null>(null);

  /** 全局搜索跳转：等目标卡片渲染后滚到视口（工作区从隐藏变为可见时再试）。 */
  const [revealNoteId, setRevealNoteId] = useState<string | null>(null);

  /**
   * 列表域（261112 R1 Q19-5）：投影/详情缓存/首屏预热/标签目录见 useQuickNoteList；
   * 预判据单一来源仍是 core/quickNoteDetailPrewarm（hook 只调用）。
   */
  const list = useQuickNoteList({ visible, setError, pendingDeleteIdRef });
  const { items, setItems, loading, tagDirectory, refreshItems, refreshTags, createTag, ensureDetail, cacheDetail } = list;

  /**
   * 筛选 / 版式 / 展示偏好（261112 R1 Q19-5）：过滤链与持久化见 useQuickNoteFilters。
   * 排序档位/比较器仍只来自 core/quickNoteSort；版式/置顶仍只存本机。
   */
  const filters = useQuickNoteFilters({ items, tagDirectory });
  const {
    sortBy, setSortBy, sortLabel, viewMode, setViewMode,
    tagFilter, setTagFilter, timeFilter, setTimeFilter, typeFilter, setTypeFilter,
    searchQuery, setSearchQuery, pinned, togglePin,
    tagIndex, tagOptions, visibleItems, listItems,
  } = filters;
  useScrollFade(indexListRef, viewMode);

  /**
   * 草稿与保存域（261112 R1 Q19-5）：保存管线 / 上传等待 / 编辑器句柄 / 弃稿见 useQuickNoteDraftSave。
   * 单一来源不变：媒体 pending 判据、QUICK_NOTE_FULL_SYNC_TEXT 的 4 个理由、列表视图留编辑器的收尾
   * 都是原样搬入（本批不改行为）。
   */
  const draft = useQuickNoteDraftSave({ list, viewMode, tagDirectory, confirm, setError, setViewHint });
  const {
    createDraft, setCreateDraft, editingId, setEditingId, editingDraft, setEditingDraft,
    saving, setSaving, syncing, dirty,
    saveDraft, saveDraftAndSync, saveBeforeSwitch, cancelDraft, startEditing, startNewDraft,
    togglePreviewTask, copyNoteText, handleEditorReady, quickNoteUploader,
  } = draft;
  const activeIsEditing = editingDraft !== null;

  // 卸载时清掉撤销窗口的删除计时器（列表版本号由 list hook 自己失效）。
  useEffect(() => () => {
    if (deleteTimer.current !== null) window.clearTimeout(deleteTimer.current);
  }, []);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!viewHint) return;
    const timer = window.setTimeout(() => setViewHint(null), 2600);
    return () => window.clearTimeout(timer);
  }, [viewHint]);

  useEffect(() => { pendingDeleteIdRef.current = pendingDelete?.id ?? null; }, [pendingDelete]);

  /** 全局搜索命中：只**定位并高亮**，不自动进编辑态（用户 261021 点单）。 */
  async function revealNote(id: string): Promise<void> {
    const target = items.find((item) => item.id === id) ?? (await refreshItems()).find((item) => item.id === id);
    if (!target) {
      setError("这条小记已不存在（可能已被删除或转换）");
      return;
    }
    setTagFilter({ kind: "all" });
    setTypeFilter("all");
    setSearchOpen(false);
    setSearchInput("");
    setSearchQuery("");
    setRevealNoteId(id);
  }

  useImperativeHandle(ref, () => ({
    async refresh() {
      await Promise.all([refreshItems(), refreshTags()]);
    },
    async revealNote(id: string) {
      await revealNote(id);
    },
    async confirmLeave() {
      // 离开小记页同样"默认保存"（用户 260919）：没改动时不写库；保存失败则留在原地。
      if (!dirty) return true;
      return saveBeforeSwitch();
    },
  }));

  const notebooks = useMemo(() => notebookNodes
    .filter((node) => node.nodeType === "notebook")
    .sort((a, b) => a.sortOrder - b.sortOrder), [notebookNodes]);

  function switchView(next: QuickNotesView) {
    setViewMode(next);
    // 版式切换时收起所有浮层（列表视图的标签下拉/页头筛选/排序）
    tagMenu.close();
    filterMenu.close();
    sortMenu.close();
    moreMenu.close();
    setSearchOpen(false);
    setSearchInput("");
    setSearchQuery("");
  }

  function scheduleDelete(item: QuickNoteListSummary) {
    // 当前 Undo 窗口只承载一条小记；先阻止第二次删除，避免清掉首条计时器后
    // 让卡片从 UI 消失、却没有真正落盘删除或可撤销入口。
    if (pendingDelete) return;
    if (editingId === item.id) { setEditingId(null); setEditingDraft(null); }
    setPendingDelete(item);
    list.invalidateListVersion();
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    if (deleteTimer.current !== null) window.clearTimeout(deleteTimer.current);
    deleteTimer.current = window.setTimeout(() => {
      deleteTimer.current = null;
      void native.deleteQuickNote(item.id).catch((reason) => {
        setError(`删除小记失败：${getNativeErrorMessage(reason)}`);
        setItems((current) => [item, ...current].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      }).finally(() => setPendingDelete(null));
    }, 5000);
  }

  function undoDelete() {
    if (!pendingDelete) return;
    if (deleteTimer.current !== null) window.clearTimeout(deleteTimer.current);
    deleteTimer.current = null;
    list.invalidateListVersion();
    setItems((current) => [pendingDelete, ...current].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setPendingDelete(null);
  }

  /** 转成正式笔记：单选/多选共用同一条路径（逐个转换，全部进同一个笔记本）。 */
  async function convert(notebookId: string) {
    const targets = convertItems;
    if (!targets || targets.length === 0) return;
    setSaving(true); setError(null);
    try {
      for (const item of targets) onConverted(await native.convertQuickNote(item.id, notebookId));
      const ids = new Set(targets.map((item) => item.id));
      list.invalidateListVersion();
      setItems((current) => current.filter((item) => !ids.has(item.id)));
      setConvertItems(null);
      setSelected(new Set()); setSelecting(false);
    } catch (reason) { setError(`转换为正式笔记失败：${getNativeErrorMessage(reason)}`); }
    finally { setSaving(false); }
  }

  function toggleSelected(id: string) {
    setSelecting(true);   // 卡片左侧的勾选框随时可用：点它就进多选（无需单独的"多选"按钮）
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exitSelecting() { setSelecting(false); setSelected(new Set()); }

  /** 批量删除：破坏性且不可恢复（小记不备份），先确认；不进撤销窗口（多选场景语义就是"确定删"）。 */
  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!(await confirm({
      title: `删除选中的 ${ids.length} 篇小记？`,
      body: "小记不备份，删除后无法恢复。",
      confirmText: "删除",
      danger: true,
    }))) return;
    setSaving(true); setError(null);
    try {
      for (const id of ids) await native.deleteQuickNote(id);
      const removed = new Set(ids);
      list.invalidateListVersion();
      setItems((current) => current.filter((item) => !removed.has(item.id)));
      exitSelecting();
    } catch (reason) {
      setError(`批量删除失败：${getNativeErrorMessage(reason)}`);
      await refreshItems();
    } finally { setSaving(false); }
  }


  const clearReveal = useCallback(() => setRevealNoteId(null), []);
  /**
   * 列表页默认选中第一条（用户 260919）：进列表视图 / 首次加载时，若没有正在编辑的小记，
   * 自动打开第一条（没有小记时保持空态）。这样进来就是"左边列表 + 右边内容"，不会是一张空白编辑器。
   */
  useEffect(() => {
    // 隐藏时不预选（keep-alive 视图里建草稿没有意义，还要避免在不可见状态下触发"切换前保存"）
    if (!visible || viewMode !== "list" || loading || activeIsEditing) return;
    const first = visibleItems[0];
    if (!first) return;
    void startEditing(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, viewMode, loading, activeIsEditing, visibleItems.length]);

  /** 类型筛选：与标签筛选同一套「切筛选前先收住正在编辑的小记」口径，避免筛掉卡片时丢未保存正文。 */
  async function changeTypeFilter(next: QuickNoteTypeFilter): Promise<void> {
    if (editingDraft) {
      if (dirty && !(await saveBeforeSwitch())) return;
      setEditingId(null);
      setEditingDraft(null);
    }
    // 语雀语义：类型筛选与标签筛选不叠加 —— 任何类型切换都清空标签筛选，标签条由 renderTagBar 隐藏。
    setTagFilter({ kind: "all" });
    setTypeFilter(next);
  }

  /** 打开列表搜索：先按同一口径收住正在编辑的小记，避免搜索把未保存卡片筛掉。 */
  async function openSearch(): Promise<void> {
    if (editingDraft) {
      if (dirty && !(await saveBeforeSwitch())) return;
      setEditingId(null);
      setEditingDraft(null);
    }
    setSearchOpen(true);
    setSearchInput(searchQuery);
  }

  function closeSearch(): void {
    setSearchOpen(false);
    setSearchInput("");
    setSearchQuery("");
  }

  function toggleSearch(): void {
    if (searchOpen) closeSearch();
    else void openSearch();
  }

  /** 行内 ⋯ 菜单当前指向的那条（id 记账在 useAnchoredMenu 里）。 */
  const rowMenuItem = rowMenu.id ? items.find((item) => item.id === rowMenu.id) ?? null : null;

  /** 切标签筛选前先收住正在编辑的小记：筛掉的卡片会卸载，不能把未保存正文一起带走。 */
  async function changeTagFilter(next: QuickNoteTagFilter): Promise<void> {
    if (editingDraft) {
      if (dirty && !(await saveBeforeSwitch())) return;
      setEditingId(null);
      setEditingDraft(null);
    }
    // 类型筛选与标签筛选互斥（261021 规格）：类型筛选生效时标签条隐藏，但卡片上的标签仍可点，
    // 若只改标签筛选就会形成用户看不见的 AND ⇒ 点标签时一并清掉类型筛选。
    if (typeFilter !== "all") setTypeFilter("all");
    setTagFilter(next);
  }

  /** 高级筛选一次应用（时间 / 类型 / 标签包含排除）；与其它筛选切换同一套"先收住编辑态"口径。 */
  async function applyFilterState(next: QuickNoteFilterState): Promise<void> {
    if (editingDraft) {
      if (dirty && !(await saveBeforeSwitch())) return;
      setEditingId(null);
      setEditingDraft(null);
    }
    setTimeFilter(next.time);
    setTypeFilter(next.type);
    // 类型与标签筛选互斥（同 changeTypeFilter）：选了图片/附件就不叠加标签条件，避免隐藏 AND。
    setTagFilter(next.type !== "all" ? { kind: "all" } : next.tagFilter);
    setFilterDialogOpen(false);
  }

  async function applyNoteTags(noteId: string, tagIds: string[]): Promise<void> {
    const item = items.find((candidate) => candidate.id === noteId);
    if (!item) return;
    try {
      // 只改关联，不重写正文。
      const saved = await native.setQuickNoteTags(noteId, tagIds);
      list.invalidateListVersion();
      cacheDetail(saved);
      setItems((current) => current.map((candidate) => (candidate.id === noteId ? listSummaryOf(saved) : candidate)));
    } catch (reason) {
      setError(`更新标签失败：${getNativeErrorMessage(reason)}`);
    }
  }

  /** 列表搜索输入（列表视图的索引头、卡片视图的右栏上方共用）。 */
  function renderSearchInput() {
    return (
      <div className="quick-notes-index-search">
        <Search size={14} />
        <input
          autoFocus value={searchInput} placeholder="搜索小记" aria-label="搜索小记"
          onChange={(event) => setSearchInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); setSearchQuery(searchInput.trim()); }
            if (event.key === "Escape") { event.preventDefault(); closeSearch(); }
          }}
        />
        {searchInput && <button type="button" className="ln-iconbtn ln-iconbtn--compact quick-notes-index-search__clear" aria-label="清空搜索" onClick={() => { setSearchInput(""); setSearchQuery(""); }}><X size={13} /></button>}
      </div>
    );
  }

  /** 标签筛选条：两套版式共用一份；放在**右侧列表列**（对齐语雀），不再占据左侧写作区。 */
  function renderTagBar() {
    // 对齐语雀：类型筛选（图片/附件）生效时标签条隐藏；切回「小记」后标签筛选已被清空。
    if (typeFilter !== "all" || tagFilter.kind === "selection" || items.length === 0 || tagIndex.tags.length === 0) return null;
    return (
      <div className="quick-notes-tagbar" role="group" aria-label="按标签筛选小记">
        {/* 「全部」= 默认态（不筛标签）：用户 261111 点单，必须能一键回到全量列表。 */}
        <button
          className={"ln-chip" + (tagFilter.kind === "all" ? " is-selected" : "")}
          aria-pressed={tagFilter.kind === "all"}
          onClick={() => void changeTagFilter({ kind: "all" })}
        >
          <span>全部</span><span className="ln-chip__count">({items.length})</span>
        </button>
        {tagIndex.tags.map((tag) => (
          <button
            key={tag.id}
            className={"ln-chip" + (tagFilter.kind === "tag" && tagFilter.id === tag.id ? " is-selected" : "")}
            onClick={() => void changeTagFilter(tagFilter.kind === "tag" && tagFilter.id === tag.id ? { kind: "all" } : { kind: "tag", id: tag.id })}
          >
            <span className="ln-ellipsis">{tag.name}</span><span className="ln-chip__count">({tag.count})</span>
          </button>
        ))}
        {tagIndex.untaggedCount > 0 && (
          <button className={"ln-chip" + (tagFilter.kind === "untagged" ? " is-selected" : "")} onClick={() => void changeTagFilter(tagFilter.kind === "untagged" ? { kind: "all" } : { kind: "untagged" })}>
            <span>无标签</span><span className="ln-chip__count">({tagIndex.untaggedCount})</span>
          </button>
        )}
        <button className="ln-chip" onClick={() => setTagManagerOpen(true)} title="管理标签">
          <Tags size={12} /><span>管理</span>
        </button>
      </div>
    );
  }

  /** 标题 + 版式切换（卡片视图页头与列表视图左栏头共用）。 */
  const titleSwitch = (
    <div className="quick-notes-title">
      <h1>小记</h1>
      {/* 版式切换（对齐云端：标题右侧的分段控件；左侧=列表视图，右侧=小记卡视图） */}
      <div className="ln-segment quick-notes-view-switch" role="group" aria-label="小记版式">
        <button
          className={"ln-segment__item quick-notes-view-segment" + (viewMode === "list" ? " is-active" : "")}
          aria-pressed={viewMode === "list"} title="列表视图" aria-label="列表视图"
          onClick={() => switchView("list")}
        ><LayoutList size={14} /></button>
        <button
          className={"ln-segment__item quick-notes-view-segment" + (viewMode === "note" ? " is-active" : "")}
          aria-pressed={viewMode === "note"} title="小记视图" aria-label="小记视图"
          onClick={() => switchView("note")}
        ><StickyNote size={14} /></button>
      </div>
    </div>
  );
  const newNoteButton = (
    <button className="ln-iconbtn quick-notes-new" title="新建小记" aria-label="新建小记" onClick={() => void startNewDraft()}>
      <span className="quick-notes-new__icon"><Feather size={14} /><Plus size={9} /></span>
    </button>
  );
  const notices = <>
    {viewHint && <div className="quick-notes-hint" role="status">{viewHint}</div>}
    {error && <div className="quick-notes-error"><span>{error}</span><button className="ln-iconbtn ln-iconbtn--compact" onClick={() => setError(null)} aria-label="关闭错误"><X size={15} /></button></div>}
  </>;

  // 左右两栏（对齐云端语雀小记）：左＝常驻写作面板 + 发布行，右＝小记卡片流（各自独立滚动）。
  return <section className="quick-notes-pane" aria-label="小记">
    {viewMode === "note" && <header className="quick-notes-header">
      {titleSwitch}
      <div className="quick-notes-header-tools">
        {/* 多选工具左对齐（与卡片勾选框同列），「N 条 / 排序」始终保留在右侧 —— 两块同时可见。 */}
        {selecting && <>
          <button className={"ln-check" + (selected.size > 0 && selected.size === items.length ? " is-on" : "")} role="checkbox" aria-checked={selected.size > 0 && selected.size === items.length} aria-label="全选" onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((item) => item.id)))}>{selected.size > 0 && selected.size === items.length && <Check size={13} />}</button>
          <span className="quick-notes-select-info">共选择了 {selected.size} 篇小记</span>
          <span className="quick-notes-tools-divider" />
          <button className="ln-btn ln-btn--ghost ln-btn--compact" onClick={exitSelecting}>取消</button>
          <button className="ln-btn ln-btn--ghost ln-btn--compact" disabled={selected.size === 0 || saving} onClick={() => setConvertItems(items.filter((item) => selected.has(item.id)))}>转为文档</button>
          <button className="ln-btn ln-btn--ghost ln-btn--compact ln-btn--danger-text" disabled={selected.size === 0 || saving} onClick={() => void deleteSelected()}>批量删除</button>
        </>}
        <span className="quick-notes-tools-spacer" />
        <span className="quick-notes-count">{items.length} 条</span>
        <button className={"ln-iconbtn quick-notes-tool-btn" + (searchOpen ? " is-selected" : "")} onClick={toggleSearch} title="搜索小记" aria-label="搜索小记"><Search size={16} /></button>
        <button className={"ln-iconbtn quick-notes-tool-btn" + (typeFilter !== "all" || isQuickNoteTimeFilterActive(timeFilter) || tagFilter.kind === "selection" ? " is-selected" : "")} {...filterMenu.anchorProps()} title={"筛选：" + quickNoteTimeFilterLabel(timeFilter)} aria-label="筛选小记"><Filter size={16} /></button>
        <div className="quick-notes-sort-wrap">
          <button className="ln-iconbtn quick-notes-tool-btn" {...sortMenu.anchorProps()} title={"排序：" + sortLabel} aria-label="排序"><ArrowUpDown size={16} /></button>
        </div>
        <button className="ln-iconbtn quick-notes-tool-btn" onClick={() => setTagManagerOpen(true)} title="标签管理" aria-label="标签管理"><Tags size={16} /></button>
      </div>
    </header>}
    {viewMode === "note" && notices}
    {viewMode === "list" ? <div className="quick-notes-split quick-notes-split--list">
      {/* 列表视图（对齐云端 https://www.yuque.com/dashboard/notes）：左＝索引列表（批量条 + 行⋯菜单），
          右＝编辑器。功能都复用分块视图里已有的动作（编辑/转为正式笔记/删除/多选），这里只是把 UI 补上。 */}
      <div className="quick-notes-index-wrap">
        <div className="quick-notes-list-head">
          {titleSwitch}
          {newNoteButton}
        </div>
        {notices}
        <div className="quick-notes-index-tools">
          {searchOpen ? renderSearchInput() : <>
            {items.length > 0 && typeFilter === "all" && (
              <button
                className={"ln-btn ln-btn--ghost ln-btn--compact quick-notes-tag-filter-btn" + (tagFilter.kind !== "all" ? " is-selected" : "")}
                {...tagMenu.anchorProps()}
                title={"标签筛选" + (tagFilter.kind === "all" ? "" : "：" + (tagFilter.kind === "untagged" ? "无标签" : (tagIndex.tags.find((tag) => tag.id === (tagFilter as { id: string }).id)?.name ?? "标签")))}
                aria-label="标签筛选"
              ><Tag size={14} /><span>{tagFilter.kind === "all" ? "标签" : tagFilter.kind === "untagged" ? "无标签" : (tagIndex.tags.find((tag) => tag.id === (tagFilter as { id: string }).id)?.name ?? "标签")}</span><ChevronDown size={14} /></button>
            )}
            <span className="quick-notes-tools-spacer" />
            <button className="ln-iconbtn quick-notes-tool-btn" onClick={() => setTagManagerOpen(true)} title="标签管理" aria-label="标签管理"><Tags size={16} /></button>
            <button className="ln-iconbtn quick-notes-tool-btn" onClick={() => void openSearch()} title="搜索小记" aria-label="搜索小记"><Search size={16} /></button>
          </>}
          <button className="ln-iconbtn quick-notes-tool-btn" {...moreMenu.anchorProps()} title="更多" aria-label="更多"><MoreHorizontal size={16} /></button>
        </div>
        {/* 批量条（对齐云端图1）：勾选框 + N 篇 + 取消 + 动作 */}
        {selecting && <div className="quick-notes-batch">
          <button
            className={"ln-check" + (selected.size > 0 && selected.size === items.length ? " is-on" : "")}
            role="checkbox" aria-checked={selected.size > 0 && selected.size === items.length} aria-label="全选"
            onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((item) => item.id)))}
          >{selected.size > 0 && selected.size === items.length && <Check size={13} />}</button>
          <span className="quick-notes-select-info">{selected.size} 篇</span>
          <span className="quick-notes-tools-divider" />
          <button className="ln-btn ln-btn--ghost ln-btn--compact" onClick={exitSelecting}>取消</button>
          <span className="quick-notes-tools-spacer" />
          <button className="ln-iconbtn quick-notes-tool-btn" title="转为正式文档" aria-label="转为正式文档" disabled={selected.size === 0 || saving} onClick={() => setConvertItems(items.filter((item) => selected.has(item.id)))}><FilePlus size={16} /></button>
          <button className="ln-iconbtn quick-notes-tool-btn ln-iconbtn--danger" title="批量删除" aria-label="批量删除" disabled={selected.size === 0 || saving} onClick={() => void deleteSelected()}><Trash size={16} /></button>
        </div>}
        <QuickNotesVirtualList items={loading ? [] : listItems} mode="index" className="quick-notes-index ln-list-panel ln-list-panel--background" listRef={indexListRef}
          visible={visible} keepIds={[editingId, rowMenu.id, tagPickerFor?.noteId]} revealId={revealNoteId} onRevealed={clearReveal}
          empty={loading
            ? <div className="ln-empty"><LoaderCircle className="spin" size={18} /><span>正在读取小记…</span></div>
            : items.length === 0
              ? <div className="ln-empty ln-empty--idle"><Feather size={24} /><span>还没有小记</span></div>
              : listItems.length === 0
                ? <div className="ln-empty ln-empty--idle"><Filter size={28} /><strong>未能找到相关小记</strong><span>{searchQuery ? "换个关键词再试。" : "切换筛选条件后再试。"}</span></div>: null}
          renderItem={(item) => <div
                  key={item.id}
                  data-quick-note-id={item.id}
                  className={"quick-note-index-row ln-list-item" + (selecting ? " is-selecting" : "") + (!selecting && editingId === item.id ? " ln-list-item--focus" : "") + (selected.has(item.id) ? " is-checked" : "") + (revealNoteId === item.id ? " is-revealed" : "")}
                >
                  <button
                    className={"ln-check quick-note-index-check" + (selected.has(item.id) ? " is-on" : "")}
                    role="checkbox" aria-checked={selected.has(item.id)} aria-label={selected.has(item.id) ? "取消选择" : "选择这篇小记"}
                    onClick={(event) => { event.stopPropagation(); toggleSelected(item.id); }}
                  >{selected.has(item.id) && <Check size={13} />}</button>
                  <button className="quick-note-index-main" onClick={() => (selecting ? toggleSelected(item.id) : void startEditing(item))} title={item.previewText?.trim() || "空小记"}>
                    <span className="ln-list-item__text ln-ellipsis">{indexLabel(item)}</span>
                    <span className="ln-list-item__meta">{indexStamp(quickNoteSortTime(item, sortBy))}</span>
                  </button>
                  <span className="quick-note-index-actions">
                    <button className="ln-iconbtn quick-notes-tool-btn" title="更多" aria-label="更多" {...rowMenu.anchorProps(item.id, { stopPropagation: true })}><MoreHorizontal size={16} /></button>
                  </span>
                </div>}
        />
      </div>
      <div className="quick-notes-detail">
        {activeIsEditing && editingDraft
          ? <QuickNoteComposer
              draft={editingDraft} variant="inline" ui="full" active={visible} saving={saving && activeIsEditing} syncing={syncing && activeIsEditing} cloudReady={cloudReady}
              uploadResource={quickNoteUploader(editingDraft.id)}
              tagOptions={tagOptions}
              onTextChange={(text) => setEditingDraft((current) => current ? { ...current, text } : current)}
              onTagIdsChange={(tagIds) => setEditingDraft((current) => current ? { ...current, tagIds } : current)}
              onCreateTag={createTag}
              onEditorReady={(api) => handleEditorReady(editingDraft.id, api)}
              onSave={() => void saveDraft(editingDraft)} onSaveAndSync={() => void saveDraftAndSync(editingDraft)} onCancel={() => void cancelDraft(editingDraft)}
            />
          : <QuickNoteComposer
              draft={createDraft} variant="pane" ui="full" active={visible} saving={saving && !activeIsEditing} syncing={syncing && !activeIsEditing} cloudReady={cloudReady}
              uploadResource={quickNoteUploader(createDraft.id)}
              tagOptions={tagOptions}
              onTextChange={(text) => setCreateDraft((current) => ({ ...current, text }))}
              onTagIdsChange={(tagIds) => setCreateDraft((current) => ({ ...current, tagIds }))}
              onCreateTag={createTag}
              onEditorReady={(api) => handleEditorReady(createDraft.id, api)}
              onSave={() => void saveDraft(createDraft)} onSaveAndSync={() => void saveDraftAndSync(createDraft)} onCancel={() => void cancelDraft(createDraft)}
            />}
      </div>
    </div> : <div className="quick-notes-split">
      <div className="quick-notes-compose">
        <QuickNoteComposer
          draft={createDraft}
          variant="pane"
          active={visible}
          saving={saving && !activeIsEditing}
          syncing={syncing && !activeIsEditing}
          cloudReady={cloudReady}
          uploadResource={quickNoteUploader(createDraft.id)}
          tagOptions={tagOptions}
          onTextChange={(text) => setCreateDraft((current) => ({ ...current, text }))}
          onTagIdsChange={(tagIds) => setCreateDraft((current) => ({ ...current, tagIds }))}
          onCreateTag={createTag}
          onEditorReady={(api) => handleEditorReady(createDraft.id, api)}
          onSave={() => void saveDraft(createDraft)}
          onSaveAndSync={() => void saveDraftAndSync(createDraft)}
          onCancel={() => void cancelDraft(createDraft)}
        />
      </div>
      <div className={"quick-notes-list" + (selecting ? " selecting" : "")}>
        {searchOpen && <div className="quick-notes-list-search">{renderSearchInput()}</div>}
        {renderTagBar()}
        <QuickNotesVirtualList items={loading ? [] : listItems} mode="timeline" className="quick-notes-timeline"
          visible={visible} keepIds={[editingId, rowMenu.id, tagPickerFor?.noteId]} revealId={revealNoteId} onRevealed={clearReveal}
          empty={loading ? <div className="ln-empty"><LoaderCircle className="spin" size={18} /><span>正在读取小记…</span></div> : items.length === 0
            ? <div className="ln-empty ln-empty--idle"><Feather size={24} /><strong>还没有小记</strong><span>从左侧写下第一条临时记录。</span></div>
            : listItems.length === 0
              ? <div className="ln-empty ln-empty--idle"><Filter size={28} /><strong>未能找到相关小记</strong><span>{searchQuery ? "换个关键词再试。" : "切换筛选条件后再试。"}</span></div>: null}
          renderItem={(item) => editingId === item.id && editingDraft
              ? <article className={"quick-note-entry editing" + (revealNoteId === item.id ? " is-revealed" : "")} key={item.id} data-quick-note-id={item.id}><QuickNoteComposer
                  draft={editingDraft} variant="inline" active={visible} saving={saving && activeIsEditing} syncing={syncing && activeIsEditing} cloudReady={cloudReady}
                  uploadResource={quickNoteUploader(editingDraft.id)}
                  tagOptions={tagOptions}
                  onTextChange={(text) => setEditingDraft((current) => current ? { ...current, text } : current)}
                  onTagIdsChange={(tagIds) => setEditingDraft((current) => current ? { ...current, tagIds } : current)}
                  onCreateTag={createTag}
                  onEditorReady={(api) => handleEditorReady(editingDraft.id, api)}
                  onSave={() => void saveDraft(editingDraft)} onSaveAndSync={() => void saveDraftAndSync(editingDraft)} onCancel={() => void cancelDraft(editingDraft)}
                /></article>
              : <QuickNoteCard
                  key={item.id}
                  item={list.getCachedDetail(item.id) ?? placeholderDocument(item)}
                  onNeedDetail={() => void ensureDetail(item.id)}
                  revealed={revealNoteId === item.id}
                  deletePending={pendingDelete !== null}
                  selecting={selecting}
                  checked={selected.has(item.id)}
                  onToggleSelect={() => toggleSelected(item.id)}
                  onEdit={() => void startEditing(item)}
                  onDelete={() => scheduleDelete(item)}
                  onConvert={() => setConvertItems([item])}
                  onAddTag={(anchor) => setTagPickerFor({ noteId: item.id, anchor })}
                  onFilterTag={(tagId) => void changeTagFilter({ kind: "tag", id: tagId })}
                  onToggleTask={(checkboxIndex, checked) => void togglePreviewTask(item.id, checkboxIndex, checked)}
                />}
        />
      </div>
    </div>}
    {/* 卡片里的图片点击放大：复用编辑器同一套 Lightbox 单例（与 EditorTab / LakeEditor 同款挂法） */}
    {pendingDelete && <div className="quick-notes-toast" role="status" aria-live="polite"><span>已删除一条小记</span><button className="ln-btn ln-btn--link ln-btn--compact" onClick={undoDelete}><RotateCcw size={14} />撤销</button></div>}
    {/* 排序菜单 / 行内 ⋯ 菜单：标准 <Menu>（portal + 外点/Esc + .quick-notes-*-menu 表面），open/定位由 useAnchoredMenu 管 */}
    {sortMenu.menu(<>
      {QUICK_NOTE_SORT_OPTIONS.map((o) => (
        <button className="ln-menu__item" key={o.id} role="menuitemradio" aria-checked={sortBy === o.id} onClick={() => { setSortBy(o.id); sortMenu.close(); }}>{sortBy === o.id ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}{o.label}</button>
      ))}
    </>, "quick-notes-sort-menu")}
    {/* 列表视图标签筛选：收起为「标签 ▾」，不再把全部标签平铺在窄索引列里 */}
    {tagMenu.menu(<>
      <button className="ln-menu__item" role="menuitemradio" aria-checked={tagFilter.kind === "all"} onClick={() => { tagMenu.close(); void changeTagFilter({ kind: "all" }); }}>{tagFilter.kind === "all" ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}全部</button>
      <span className="quick-notes-filter-menu__sep" role="separator" />
      {tagIndex.tags.map((tag) => (
        <button className="ln-menu__item" key={tag.id} role="menuitemradio" aria-checked={tagFilter.kind === "tag" && tagFilter.id === tag.id} onClick={() => { tagMenu.close(); void changeTagFilter({ kind: "tag", id: tag.id }); }}>
          {tagFilter.kind === "tag" && tagFilter.id === tag.id ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}
          <span className="ln-ellipsis quick-notes-tag-ellipsis">{tag.name}</span><span className="quick-notes-tag-filter-menu__count">({tag.count})</span>
        </button>
      ))}
      {tagIndex.untaggedCount > 0 && (
        <button className="ln-menu__item" role="menuitemradio" aria-checked={tagFilter.kind === "untagged"} onClick={() => { tagMenu.close(); void changeTagFilter({ kind: "untagged" }); }}>{tagFilter.kind === "untagged" ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}无标签<span className="quick-notes-tag-filter-menu__count">({tagIndex.untaggedCount})</span></button>
      )}
      <span className="quick-notes-filter-menu__sep" role="separator" />
      <button className="ln-menu__item" role="menuitem" onClick={() => { tagMenu.close(); setTagManagerOpen(true); }}>管理标签…</button>
    </>, "quick-notes-sort-menu quick-notes-tag-filter-menu")}
    {/* 列表视图 ⋯：类型 / 排序 / 批量操作（对齐语雀把这三件收进 ⋯） */}
    {moreMenu.menu(<>
      <span className="quick-notes-menu-section">类型</span>
      {QUICK_NOTE_TYPE_OPTIONS.map((option) => (
        <button className="ln-menu__item" key={option.id} role="menuitemradio" aria-checked={typeFilter === option.id} onClick={() => { moreMenu.close(); void changeTypeFilter(option.id); }}>{typeFilter === option.id ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}{option.label}</button>
      ))}
      <span className="quick-notes-filter-menu__sep" role="separator" />
      <span className="quick-notes-menu-section">排序</span>
      {QUICK_NOTE_SORT_OPTIONS.map((option) => (
        <button className="ln-menu__item" key={option.id} role="menuitemradio" aria-checked={sortBy === option.id} onClick={() => { setSortBy(option.id); moreMenu.close(); }}>{sortBy === option.id ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}{option.label}</button>
      ))}
      <span className="quick-notes-filter-menu__sep" role="separator" />
      <button className="ln-menu__item" role="menuitem" onClick={() => { moreMenu.close(); setFilterDialogOpen(true); }}>筛选小记…</button>
      <button className="ln-menu__item" role="menuitem" onClick={() => { moreMenu.close(); setSelecting(true); }}>批量操作</button>
    </>, "quick-notes-sort-menu quick-notes-more-menu")}
    {/* 类型筛选（对齐语雀 dashboard/notes）：小记 / 图片 / 附件；批量操作单独一档 */}
    {filterMenu.menu(<>
      {QUICK_NOTE_TYPE_OPTIONS.map((option) => (
        <button className="ln-menu__item" key={option.id} role="menuitemradio" aria-checked={typeFilter === option.id} onClick={() => { filterMenu.close(); void changeTypeFilter(option.id); }}>{typeFilter === option.id ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}{option.label}</button>
      ))}
      <span className="quick-notes-filter-menu__sep" role="separator" />
      <button className="ln-menu__item" role="menuitem" onClick={() => { filterMenu.close(); setFilterDialogOpen(true); }}>更多筛选…</button>
      <button className="ln-menu__item" role="menuitem" onClick={() => { filterMenu.close(); setSelecting(true); }}>批量操作</button>
    </>, "quick-notes-sort-menu quick-notes-filter-menu")}
    {rowMenuItem && rowMenu.menu(<>
      <button className="ln-menu__item" role="menuitem" onClick={() => { rowMenu.close(); togglePin(rowMenuItem.id); }}>{pinned.has(rowMenuItem.id) ? "取消置顶" : "置顶"}</button>
      <button className="ln-menu__item" role="menuitem" onClick={() => { rowMenu.close(); void startEditing(rowMenuItem); }}>编辑</button>
      <button className="ln-menu__item" role="menuitem" onClick={() => { const anchor = rowMenu.anchor; rowMenu.close(); if (anchor) setTagPickerFor({ noteId: rowMenuItem.id, anchor }); }}>添加标签</button>
      <button className="ln-menu__item" role="menuitem" onClick={() => { rowMenu.close(); void copyNoteText(rowMenuItem); }}>复制文本</button>
      <button className="ln-menu__item" role="menuitem" onClick={() => { rowMenu.close(); setConvertItems([rowMenuItem]); }}>转为正式笔记</button>
      <button role="menuitem" className="ln-menu__item ln-menu__item--danger" onClick={() => { rowMenu.close(); scheduleDelete(rowMenuItem); }} disabled={pendingDelete !== null}>删除</button>
    </>, "quick-note-row-menu")}
    {tagPickerFor && (() => {
      const target = items.find((item) => item.id === tagPickerFor.noteId);
      return target ? (
        <QuickNoteTagPicker
          anchor={tagPickerFor.anchor}
          options={tagOptions}
          selected={target.tagIds}
          onAdd={(tagId) => { void applyNoteTags(target.id, addQuickNoteTagId(target.tagIds, tagId)); }}
          onCreate={createTag}
          onClose={() => setTagPickerFor(null)}
        />
      ) : null;
    })()}
    <QuickNoteTagManager
      open={tagManagerOpen}
      tags={tagOptions}
      onClose={() => setTagManagerOpen(false)}
      onChanged={async () => { await Promise.all([refreshItems(), refreshTags()]); }}
      onError={(message) => setError(message)}
    />
    <QuickNoteFilterDialog
      open={filterDialogOpen}
      tags={tagOptions}
      value={{ time: timeFilter, tagFilter, type: typeFilter }}
      onApply={(next) => { void applyFilterState(next); }}
      onClose={() => setFilterDialogOpen(false)}
    />
    {confirmElement}
    {convertItems && convertItems.length > 0 && (
      <Dialog onDismiss={() => { if (!saving) setConvertItems(null); }} label={convertItems.length > 1 ? `转为正式文档（${convertItems.length} 篇）` : "转为正式笔记"} className="quick-note-convert-dialog">
        <div className="ln-dialog__body">
          <h3>{convertItems.length > 1 ? `转为正式文档（${convertItems.length} 篇）` : "转为正式笔记"}</h3>
          <p>选择一个笔记本。{convertItems.length > 1 ? `${convertItems.length} 篇小记将依次插入该笔记本的最顶部；` : "新文档将插入其中的最顶部；"}转化完成后，小记将从时间线移除。</p>
          <div className="quick-note-notebook-list ln-list-panel ln-list-panel--background">
            {notebooks.map((notebook) => <button key={notebook.id} className="ln-list-item" disabled={saving} onClick={() => void convert(notebook.id)}><span className="ln-list-item__graphic"><FilePlus size={14} /></span><span className="ln-list-item__text ln-ellipsis">{notebook.title}</span></button>)}
            {notebooks.length === 0 && <span className="ln-empty">请先在文档中新建一个笔记本。</span>}
          </div>
          <footer><button className="ln-btn ln-btn--ghost quick-note-convert-cancel" disabled={saving} onClick={() => setConvertItems(null)}>取消</button></footer>
        </div>
      </Dialog>
    )}
  </section>;
});
