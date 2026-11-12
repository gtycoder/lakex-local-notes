/**
 * 日记空间（桌面，docs/DIARY.md §分层「桌面 UI」）—— 一级空间页。
 *
 * 形态（用户 261109 定稿，D2）：**数据 = 笔记本体系内的普通 Lake 文档**；这里只是"表现层的一层皮"：
 * - 左栏 280px：年 → 月折叠清单。分组与排序**全部来自 core**（`diaryEntries` + `groupDiaryEntries`），
 *   组件里不得再算年/月（护栏见 diaryWorkspace.test.ts）。
 * - 主区：打开当天那篇，**复用 `EditorTab`**（不新写编辑器；内核仍走 React.lazy 边界）。
 * - 空态：一个「写今天」主按钮（懒建：只有用户点才走 IPC，不在进入空间时静默建文档）。
 * - 左下：日记本设置（改名 / 换图标，复用既有 `NamePromptDialog` + `NodeIconPicker`）。
 * - 搜索：入口只负责打开**现有全局搜索面板**（日记 = 文档，天然进 FTS；不新增索引）。
 *
 * **不做月历**（v1 明确不做：会与多维表月历撞「同一交互语义只有一套视觉」）。
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { BookX, CalendarDays, ChevronRight, Feather, FileText, NotebookPen, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { NodeIconGlyph } from "../../components/ui/NodeIconGlyph";
import {
  diaryConvertTargets,
  formatDiaryDateKey,
  groupDiaryEntries,
  planDiaryConvert,
} from "../../core/diary";
import { formatHm } from "../../core/dateFormat";
import { Dialog, Menu } from "../../components/ui/Overlay";
import { CalendarPanel } from "../../components/ui/CalendarPanel";
import { SplitPane } from "../../components/ui/SplitPane";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { NamePromptDialog } from "../../components/app/NamePromptDialog";
import { MoveTargetTreeDialog } from "../../components/app/MoveTargetTreeDialog";
import type { LakeEditorInstance } from "../editor/lakeRuntime";
import type { TreeNode } from "../../lib/types";
import { diaryEntryViews, diaryNotebookOf, type DiaryEntryView } from "./diaryTree";
import "./diary.css";

/** 内核（Lake）边界：EditorTab 只能懒加载（P12 静态契约，见 features/editor/desktopKernelLazy.test.ts）。 */
const EditorTab = lazy(() => import("../editor/EditorTab").then((m) => ({ default: m.EditorTab })));
/** 图标/表情源表约 41KB gzip：与 Sidebar 同款，点到才加载。 */
const NodeIconPicker = lazy(() => import("../../components/app/NodeIconPicker").then((m) => ({ default: m.NodeIconPicker })));

/** 主区需要的标签最小形状（App 的 `TabInfo` 结构兼容，不 import 宿主避免把 kernel 拖进类型图）。 */
export interface DiaryEditorTabLike {
  noteId: string;
  title: string;
  content: string;
  deleted?: boolean;
  bodyMissing?: boolean;
}

export interface DiaryWorkspaceProps {
  /** 当前是否处于日记空间（keep-alive 之外的挂载由 App 决定；可见性/编辑器挂载仍按它收敛）。 */
  active: boolean;
  treeNodes: TreeNode[];
  activeNoteId: string | null;
  /** 已打开的标签（正文在这里；不在标签里的日记条目由 App 负责先 openNote）。 */
  tabs: DiaryEditorTabLike[];
  lockedNoteIds: ReadonlySet<string>;
  tocEnabled: boolean;
  outlineEnhance: boolean;
  editorPrefs: { fontSize: number; showToolbar?: boolean; floatingToolbar?: boolean; blockHandle?: boolean };
  /** 打开某篇已有日记（不建文档）。 */
  onOpenEntry: (noteId: string) => void;
  /** 写今天：App 侧 planDiaryOpen → 已存在就打开，否则走 IPC `diary_open_date`。 */
  onWriteToday: (dateKey: string) => void;
  /** 新建某一天的日记（261109：一天允许多篇；加号=今天，选日期=任意历史日期，**永远新建**）。 */
  onCreateEntry: (dateKey: string) => void;
  /** 打开现有全局搜索面板（v1 全库范围，日记已进 FTS）。 */
  onOpenSearch: () => void;
  /** 「转为文档」：把该日记条目移到目标笔记本（换父节点 = 移动，不复制正文/历史）。 */
  onConvertEntry: (nodeId: string, targetNotebookId: string) => void;
  /** 「转为小记」：日期标题写入小记第一行 + 正文接在后面；成功后勤日记移入回收站。 */
  onConvertToQuickNote: (nodeId: string) => void;
  /** 「删除」：移入回收站（软删，可恢复）。走既有删除确认与 deleteTreeNode，不新造删除路径。 */
  onDeleteEntry: (nodeId: string) => void;
  /** 「取消日记标记」（整本）：笔记本 space 置 NULL，笔记本与文档原样保留（只回到知识库）。 */
  onUnmarkNotebook: () => void;
  onRenameNotebook: (title: string) => void;
  onSetNotebookIcon: (icon: string | null) => void;
  onContentChange: (noteId: string, content?: string) => void;
  onEditorReady: (noteId: string, editor: LakeEditorInstance | null) => void;
  onReloadNote: (noteId: string) => void;
}

interface YearNode {
  year: string;
  count: number;
  months: Array<{ month: string; entries: DiaryEntryView[] }>;
}

/** 时刻标签（同日多篇用）：只显示 HH:mm，空值回落为空串。 */
function diaryClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return formatHm(date);
}

export function DiaryWorkspace(props: DiaryWorkspaceProps) {
  const {
    active, treeNodes, activeNoteId, tabs, lockedNoteIds, tocEnabled, outlineEnhance, editorPrefs,
    onOpenEntry, onWriteToday, onCreateEntry, onOpenSearch, onConvertEntry, onConvertToQuickNote, onDeleteEntry, onUnmarkNotebook, onRenameNotebook, onSetNotebookIcon,
    onContentChange, onEditorReady, onReloadNote,
  } = props;

  /** 左栏数据：条目来自 core，分组也来自 core（`groupDiaryEntries`）——组件里没有任何年/月换算。
   *  打开/选中一律用 `documentId`（= noteFileId）：core 的 `noteId` 是树节点 id，不能拿去 openNote。 */
  const entries = useMemo(() => diaryEntryViews(treeNodes), [treeNodes]);
  const years: YearNode[] = useMemo(() => groupDiaryEntries(entries) as unknown as YearNode[], [entries]);
  const entryDocIds = useMemo(() => new Set(entries.map((entry) => entry.documentId)), [entries]);
  const notebook = useMemo(() => diaryNotebookOf(treeNodes), [treeNodes]);
  /** 「今天」必须**跨天自动刷新**：debug 版常驻过夜时没有 re-render，闭包里的今天会一直是昨天
   *  （261110 现场：昨天启动的实例今天点「＋」建出昨天的日记）。定时 + 回前台/可见性变化各刷新一次。 */
  const [todayKey, setTodayKey] = useState(() => formatDiaryDateKey());
  useEffect(() => {
    const sync = () => setTodayKey(formatDiaryDateKey());
    const timer = window.setInterval(sync, 60_000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  const [collapsedYears, setCollapsedYears] = useState<Set<string>>(() => new Set());
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(() => new Set());
  const [renameOpen, setRenameOpen] = useState(false);
  /** 「取消日记标记」确认（整本；破坏结构但不是删数据 ⇒ 必须说清"文档会保留"）。 */
  const [unmarkOpen, setUnmarkOpen] = useState(false);
  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null);
  const iconBtnRef = useRef<HTMLButtonElement>(null);

  /** 进入空间时**自动打开今天那篇（仅当它已存在）**：不存在就停在空态，等用户点「写今天」。
   *  为什么不自动建：进入空间不是用户要写的表达，静默建文档会污染目录（DIARY.md 未授权该行为）。
   *  ref 保证一次进入只自动开一次（treeNodes 随编辑刷新时不抢焦点）。 */
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!active) { autoOpenedRef.current = false; return; }
    if (autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    if (!notebook) return;
    const todayEntry = entries.find((entry) => entry.dateKey === todayKey);
    if (todayEntry && todayEntry.documentId !== activeNoteId) onOpenEntry(todayEntry.documentId);
  }, [active, notebook, entries, todayKey, activeNoteId, onOpenEntry]);

  /** 右键菜单（条目级）：坐标锚点，走共用浮层定位（禁自己估算位置）。 */
  const [entryMenu, setEntryMenu] = useState<{ entry: DiaryEntryView; x: number; y: number } | null>(null);
  const entryMenuPos = usePopoverPosition({
    open: Boolean(entryMenu),
    at: entryMenu ? { x: entryMenu.x, y: entryMenu.y } : null,
  });
  /** 「转为文档」目标 = 文档空间的笔记本（判据在 core.diaryConvertTargets，排除日记本）。 */
  const convertTargets = useMemo(() => {
    const ids = new Set(diaryConvertTargets(treeNodes).map((target) => target.id));
    return treeNodes.filter((node) => ids.has(node.id));
  }, [treeNodes]);
  /** 正在挑选目标的条目：null = 不在转换流程里。 */
  const [convertEntry, setConvertEntry] = useState<DiaryEntryView | null>(null);
  /** 「选日期新建」浮层（加号 = 今天，这里 = 任意日期）。
   *  两段式：先弹**应用内月历**（kit 的 .ln-calendar，与多维表日期字段同源），选完再弹确认（保持原弹窗语义）。 */
  const [dateMenu, setDateMenu] = useState<{ x: number; y: number } | null>(null);
  const [pickDate, setPickDate] = useState(todayKey);
  const [dateStage, setDateStage] = useState<"calendar" | "confirm">("calendar");
  const dateMenuPos = usePopoverPosition({
    open: Boolean(dateMenu),
    at: dateMenu ? { x: dateMenu.x, y: dateMenu.y } : null,
  });
  /** 同一天多篇时行内显示时刻（HH:mm）区分；只有一篇仍显示「更新于」。 */
  const sameDayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) counts.set(entry.dateKey, (counts.get(entry.dateKey) ?? 0) + 1);
    return counts;
  }, [entries]);

  const isEntry = (noteId: string | null): boolean => noteId !== null && entryDocIds.has(noteId);
  const activeTab = activeNoteId !== null && isEntry(activeNoteId)
    ? tabs.find((tab) => tab.noteId === activeNoteId) ?? null
    : null;

  const toggle = (set: Set<string>, key: string, update: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    update(next);
  };

  return (
    <div className="diary-space" data-diary-space>
      {/* 左栏可拖（SplitPane：分隔条唯一实现，宽度设备本地记忆）。 */}
      <SplitPane
        ariaLabel="调整日记目录宽度"
        storageKey="diary-rail"
        minWidth={200}
        maxWidth={560}
        minRight={420}
        className="diary-split"
      >
      <aside className="diary-dir" aria-label="日记目录">
        <div className="diary-dir__head">
          <h2 className="diary-dir__title"><NotebookPen size={15} aria-hidden="true" />日记</h2>
          <span className="diary-dir__count" title="日记篇数">{entries.length}</span>
          {/* 261110 用户点单定稿：头部按钮左→右 = 搜索、日历、＋（＋始终最右）；
              语义不变——搜索 = 打开既有全局搜索面板，日历 = 选日期新建，＋ = 今天新建。 */}
          <button
            type="button"
            className="ln-iconbtn ln-iconbtn--compact"
            aria-label="搜日记（全库范围，含日记）"
            title="搜日记（全库范围，含日记）"
            onClick={onOpenSearch}
          >
            <Search size={14} />
          </button>
          <button
            type="button"
            className="ln-iconbtn ln-iconbtn--compact"
            aria-label="选择日期新建日记"
            title="选择日期新建日记"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setPickDate(formatDiaryDateKey());
              setDateStage("calendar");
              setDateMenu({ x: rect.left, y: rect.bottom + 4 });
            }}
          >
            <CalendarDays size={15} />
          </button>
          <button
            type="button"
            className="ln-iconbtn ln-iconbtn--compact"
            aria-label="新建今天的日记"
            title="新建今天的日记"
            onClick={() => onCreateEntry(formatDiaryDateKey())}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="diary-tree ln-scroll" role="tree" aria-label="年 / 月">
          {years.length === 0 ? (
            <p className="diary-tree__empty">还没有日记。写下今天的这一篇，从今天开始。</p>
          ) : years.map((year) => {
            const yearOpen = !collapsedYears.has(year.year);
            return (
              <div className="diary-year" key={year.year} role="treeitem" aria-expanded={yearOpen}>
                <button
                  type="button"
                  className="diary-year__head"
                  onClick={() => toggle(collapsedYears, year.year, setCollapsedYears)}
                  aria-expanded={yearOpen}
                >
                  <ChevronRight size={14} className={"diary-caret" + (yearOpen ? " is-open" : "")} aria-hidden="true" />
                  <span className="diary-year__label">{year.year}</span>
                  <span className="diary-year__count">{year.count}</span>
                </button>
                {yearOpen && year.months.map((month) => {
                  const monthKey = year.year + "-" + month.month;
                  const monthOpen = !collapsedMonths.has(monthKey);
                  return (
                    <div className="diary-month" key={monthKey} role="group">
                      <button
                        type="button"
                        className="diary-month__head"
                        onClick={() => toggle(collapsedMonths, monthKey, setCollapsedMonths)}
                        aria-expanded={monthOpen}
                      >
                        <ChevronRight size={13} className={"diary-caret" + (monthOpen ? " is-open" : "")} aria-hidden="true" />
                        <span className="diary-month__label">{month.month} 月</span>
                        <span className="diary-year__count">{month.entries.length}</span>
                      </button>
                      {monthOpen && month.entries.map((entry) => (
                        <button
                          key={entry.nodeId}
                          type="button"
                          role="treeitem"
                          aria-selected={entry.documentId === activeNoteId}
                          className={"diary-entry ln-row" + (entry.documentId === activeNoteId ? " is-selected" : "")}
                          onClick={() => onOpenEntry(entry.documentId)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setEntryMenu({ entry, x: event.clientX, y: event.clientY });
                          }}
                          title={entry.dateKey}
                        >
                          <span className="diary-entry__day">{entry.dateKey.slice(8, 10)}</span>
                          <span className="diary-entry__title ln-ellipsis">{entry.dateKey}</span>
                          {/* 同一天多篇（261109）时用时刻区分，否则同名行分不清。 */}
                          {(sameDayCounts.get(entry.dateKey) ?? 0) > 1 && (
                            <span className="diary-entry__time">{diaryClock(entry.createdAt)}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="diary-dir__foot">
          {/* 261109 用户定稿：日记本名字前就是**笔记本图标**（默认图标兜底），点它直接换图标。 */}
          <button
            ref={iconBtnRef}
            type="button"
            className="ln-iconbtn ln-iconbtn--compact diary-dir__icon"
            aria-label="更换日记本图标"
            title="更换日记本图标"
            disabled={!notebook}
            onClick={() => setIconAnchor(iconBtnRef.current)}
          >
            {notebook?.icon ? <NodeIconGlyph value={notebook.icon} /> : <NotebookPen size={14} aria-hidden="true" />}
          </button>
          <span className="diary-dir__book ln-ellipsis" title={notebook?.title ?? "日记本"}>
            {notebook?.title ?? "日记本"}
          </span>
          <button
            type="button"
            className="ln-iconbtn ln-iconbtn--compact"
            aria-label="重命名日记本"
            title="重命名日记本"
            disabled={!notebook}
            onClick={() => setRenameOpen(true)}
          >
            <Pencil size={13} />
          </button>
        </div>
      </aside>

      <section className="diary-main" aria-label="日记正文">
        {activeTab ? (
          <Suspense fallback={<p className="diary-main__loading">正在打开日记…</p>}>
            <EditorTab
              key={activeTab.noteId}
              noteId={activeTab.noteId}
              content={activeTab.content}
              visible={active}
              focused
              readOnly={lockedNoteIds.has(activeTab.noteId) || activeTab.deleted === true}
              tocEnabled={tocEnabled}
              outlineEnhance={outlineEnhance}
              onChange={() => onContentChange(activeTab.noteId)}
              prefs={editorPrefs}
              pathTitle={null}
              onEditorReady={onEditorReady}
              onReloadNote={onReloadNote}
            />
          </Suspense>
        ) : (
          <div className="diary-empty">
            <h2 className="diary-empty__title">{notebook ? "今天还没有写" : "还没有日记本"}</h2>
            <p className="diary-empty__hint">
              {notebook
                ? "日记按天一篇，标题就是日期。点下面开始写今天这一篇。"
                : "日记放在一个独立的日记本里（与文档同一套存储）。写今天时会自动建好它。"}
            </p>
            <button type="button" className="ln-btn ln-btn--primary" onClick={() => onWriteToday(formatDiaryDateKey())}>
              <NotebookPen size={15} aria-hidden="true" />写今天
            </button>
          </div>
        )}
      </section>
      </SplitPane>

      {/* 条目右键菜单（新建浮层只挂一条动作；位置走共用 usePopoverPosition，禁自己估算）。 */}
      {entryMenu && (
        <Menu
          surfaceRef={entryMenuPos.surfaceRef}
          style={entryMenuPos.style ?? undefined}
          onDismiss={() => setEntryMenu(null)}
          aria-label="日记条目操作"
        >
          <button
            type="button"
            role="menuitem"
            className="ln-menu__item"
            onClick={() => { setConvertEntry(entryMenu.entry); setEntryMenu(null); }}
          >
            <FileText size={15} aria-hidden="true" />
            <span>转为文档…</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="ln-menu__item"
            onClick={() => { onConvertToQuickNote(entryMenu.entry.nodeId); setEntryMenu(null); }}
          >
            <Feather size={15} aria-hidden="true" />
            <span>转为小记</span>
          </button>
          {/* 整本动作放在条目菜单末尾：文案必须写清"整本"，否则会被当成只对这条生效。 */}
          <button
            type="button"
            role="menuitem"
            className="ln-menu__item"
            onClick={() => { setUnmarkOpen(true); setEntryMenu(null); }}
          >
            <BookX size={15} aria-hidden="true" />
            <span>取消日记标记（整本）</span>
          </button>
          <div className="context-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="ln-menu__item ln-menu__item--danger"
            onClick={() => { onDeleteEntry(entryMenu.entry.nodeId); setEntryMenu(null); }}
          >
            <Trash2 size={15} aria-hidden="true" />
            <span>删除</span>
          </button>
        </Menu>
      )}

      {/* 选日期新建（261109）：加号 = 今天；这里 = 任意日期，永远新建一篇。 */}
      {dateMenu && (
        <Menu
          surfaceRef={dateMenuPos.surfaceRef}
          style={dateMenuPos.style ?? undefined}
          onDismiss={() => setDateMenu(null)}
          aria-label={dateStage === "calendar" ? "选择日期" : "确认新建日记"}
        >
          {dateStage === "calendar" ? (
            /* 月历 = 共享原语（与多维表日期字段同一实现），不再是系统 date picker。 */
            <CalendarPanel
              value={pickDate}
              onPick={(dateKey) => { setPickDate(dateKey); setDateStage("confirm"); }}
            />
          ) : (
            <div className="diary-date-picker">
              <span className="diary-date-picker__value">{pickDate}</span>
              <button
                type="button"
                className="ln-btn ln-btn--primary ln-btn--compact"
                onClick={() => { onCreateEntry(pickDate); setDateMenu(null); }}
              >
                新建
              </button>
            </div>
          )}
        </Menu>
      )}

      {/* 转为文档 = 移到目标笔记本（同一个 note，不复制；正文/历史/回收站都跟着走）。 */}
      {convertEntry && (
        <MoveTargetTreeDialog
          open
          title="转为文档"
          confirmLabel="转为文档"
          description="选择目标笔记本"
          nodes={convertTargets}
          movingIds={[convertEntry.nodeId]}
          currentParentId={convertEntry.parentId}
          onConfirm={(targetNotebookId) => {
            const plan = planDiaryConvert(treeNodes, convertEntry.nodeId, targetNotebookId);
            setConvertEntry(null);
            if (!plan.ok) return;
            onConvertEntry(plan.entry.noteId, plan.targetId);
          }}
          onClose={() => setConvertEntry(null)}
        />
      )}

      {/* 取消日记标记（整本）：先确认，且必须说清"笔记本与文档会保留"。 */}
      {unmarkOpen && (
        <Dialog
          open
          onDismiss={() => setUnmarkOpen(false)}
          label={"取消「" + (notebook?.title ?? "日记本") + "」的日记标记？"}
          className="confirm-dialog"
        >
          <div className="ln-dialog__head">
            <span className="ln-dialog__title">取消「{notebook?.title ?? "日记本"}」的日记标记？</span>
          </div>
          <div className="ln-dialog__body">
            笔记本与其中的文档都会保留，只是不再归入日记空间（会回到知识库）。取消后写今天会新建一个日记本。
          </div>
          <div className="ln-dialog__actions">
            <button type="button" className="ln-btn ln-btn--ghost" onClick={() => setUnmarkOpen(false)}>取消</button>
            <button
              type="button"
              className="ln-btn ln-btn--secondary ln-btn--danger-text"
              onClick={() => { setUnmarkOpen(false); onUnmarkNotebook(); }}
            >
              取消日记标记
            </button>
          </div>
        </Dialog>
      )}

      <NamePromptDialog
        open={renameOpen}
        title="重命名日记本"
        inputLabel="日记本名称"
        initialValue={notebook?.title ?? "日记"}
        submitText="保存"
        onSubmit={(name) => { onRenameNotebook(name); setRenameOpen(false); }}
        onClose={() => setRenameOpen(false)}
      />
      {iconAnchor && (
        <Suspense fallback={null}>
          <NodeIconPicker
            anchor={iconAnchor}
            nodeType="notebook"
            value={notebook?.icon ?? null}
            onPick={(icon) => { onSetNotebookIcon(icon); setIconAnchor(null); }}
            onClose={() => setIconAnchor(null)}
          />
        </Suspense>
      )}
    </div>
  );
}