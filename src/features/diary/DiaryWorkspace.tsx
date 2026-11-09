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
import { ChevronRight, Image as ImageIcon, NotebookPen, Pencil, Search } from "lucide-react";
import {
  formatDiaryDateKey,
  groupDiaryEntries,
} from "../../core/diary";
import { NamePromptDialog } from "../../components/app/NamePromptDialog";
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
  /** 打开现有全局搜索面板（v1 全库范围，日记已进 FTS）。 */
  onOpenSearch: () => void;
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

export function DiaryWorkspace(props: DiaryWorkspaceProps) {
  const {
    active, treeNodes, activeNoteId, tabs, lockedNoteIds, tocEnabled, outlineEnhance, editorPrefs,
    onOpenEntry, onWriteToday, onOpenSearch, onRenameNotebook, onSetNotebookIcon,
    onContentChange, onEditorReady, onReloadNote,
  } = props;

  /** 左栏数据：条目来自 core，分组也来自 core（`groupDiaryEntries`）——组件里没有任何年/月换算。
   *  打开/选中一律用 `documentId`（= noteFileId）：core 的 `noteId` 是树节点 id，不能拿去 openNote。 */
  const entries = useMemo(() => diaryEntryViews(treeNodes), [treeNodes]);
  const years: YearNode[] = useMemo(() => groupDiaryEntries(entries) as unknown as YearNode[], [entries]);
  const entryDocIds = useMemo(() => new Set(entries.map((entry) => entry.documentId)), [entries]);
  const notebook = useMemo(() => diaryNotebookOf(treeNodes), [treeNodes]);
  const todayKey = formatDiaryDateKey();

  const [collapsedYears, setCollapsedYears] = useState<Set<string>>(() => new Set());
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(() => new Set());
  const [renameOpen, setRenameOpen] = useState(false);
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
      <aside className="diary-dir" aria-label="日记目录">
        <div className="diary-dir__head">
          <h2 className="diary-dir__title"><NotebookPen size={15} aria-hidden="true" />日记</h2>
          <span className="diary-dir__count" title="日记篇数">{entries.length}</span>
          <button
            type="button"
            className="ln-iconbtn ln-iconbtn--compact"
            aria-label="搜日记（全库范围，含日记）"
            title="搜日记（全库范围，含日记）"
            onClick={onOpenSearch}
          >
            <Search size={14} />
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
                          title={entry.dateKey}
                        >
                          <span className="diary-entry__day">{entry.dateKey.slice(8, 10)}</span>
                          <span className="diary-entry__title ln-ellipsis">{entry.dateKey}</span>
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
          <button
            ref={iconBtnRef}
            type="button"
            className="ln-iconbtn ln-iconbtn--compact"
            aria-label="换日记本图标"
            title="换日记本图标"
            disabled={!notebook}
            onClick={() => setIconAnchor(iconBtnRef.current)}
          >
            <ImageIcon size={13} />
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
            <button type="button" className="ln-btn ln-btn--primary" onClick={() => onWriteToday(todayKey)}>
              <NotebookPen size={15} aria-hidden="true" />写今天
            </button>
          </div>
        )}
      </section>

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
