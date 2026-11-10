/**
 * 一级「日记」页（261109 v1；261110 二改 = 新建语义 + v2 柔光纸面重排 + 日历入口）。
 *
 * 职责（**不新造输入面**：正文输入仍走工作区 + dock）：
 *  · 页头右上角三个入口（左 → 右）= **搜索 / 日历 / ＋**：
 *      ＋ = 今天新建（`mode:"new"`，永远新建一篇）；
 *      日历 = 选任意日期新建（应用内月历 = 共享原语 `ui/MonthCalendar`，包在既有 `MobileSheet` 里）；
 *      搜索 = 复用移动端既有全库搜索（宿主按日记条目 id 过滤，不新建索引）；
 *  · 今日卡主按钮「写今天 / 继续写今天」= `mode:"open"` **幂等**（当天已有就开最新那篇）；
 *  · 时间线 = 年（分组卡标题）→ 月（卡内小节）→ 条目行；同日多篇按行内时刻区分（docs/DIARY.md 决策 4）；
 *  · 条目「⋯ → 转为文档…」= **移动**这条笔记到选中的笔记本（同一个 note，不复制正文/历史）。
 *
 * 判据全部来自 `src/core/diary`（**组件里不重算**）：
 *  · 日记本/条目 = diaryNotebookId + diaryEntries；分组 = groupDiaryEntries；今天 = formatDiaryDateKey；
 *  · 「新建 vs 幂等」= 数据层按 mode 选 planDiaryCreate / planDiaryOpen（本页只传 mode，不自己判"当天有没有"）；
 *  · 可承接的笔记本 = diaryConvertTargets；移动前校验 = planDiaryConvert（UI 不另写一套）。
 * 写入只走既有写域：`bridge.diaryOpenDate(dateKey, mode)`（runWrite("diaryOpenDate")）/
 * `bridge.moveTreeNodeOrdered`；连点由页面侧在途守卫（openingRef）+ 数据层单事务共同兜住。
 * **不打标**：本页不提供任何标签入口（docs/DIARY.md 决策 7）。
 *
 * 版式（261110 v2）：页头 = 玻璃条（.mobile-page-head + .mb-glass，与「标签」页同形）；今日卡与年段 =
 * 白卡分组（.mb-set-section / .mb-item 原语）；行 = 名称 + 时刻 + 行尾 ⋯。**零新增视觉语言**，不新写页面骨架。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { BookX, CalendarDays, FileText, MoreVertical, Pencil, Plus, Search, Trash2 } from "lucide-react";
import {
  diaryConvertTargets,
  diaryEntries,
  diaryNotebookId,
  formatDiaryDateKey,
  groupDiaryEntries,
  planDiaryConvert,
  type DiaryConvertRejection,
  type DiaryEntry,
} from "../../core/diary.js";
import { formatHm } from "../../core/dateFormat.js";
import type { TreeNode } from "../../lib/types";
import { bridge, type DiaryOpenMode } from "../bridge";
import { EmptyState } from "../ui/EmptyState";
import { MobileSheet } from "../ui/MobileSheet";
import { MonthCalendar } from "../ui/MonthCalendar";
import { MobileSheetMenu } from "../ui/MobileSheetMenu";
import { MoveTargetTreeSheet } from "../ui/MoveTargetTreeSheet";
import { toastActionError } from "../lib/actionError";
import { showToast } from "../ui/toastBus";
import { confirmMobile } from "../ui/ConfirmDialog";
import { formatRelativeTime } from "../lib/listTime";

export interface DiaryPageProps {
  /** 全量目录树（含日记本；知识库列表那份是过滤过的，见 MobileApp）。 */
  nodes: readonly TreeNode[];
  /** 打开某天的日记：进现有工作区（编辑器/阅读器由 mode 决定）。 */
  onOpenEntry(input: { noteId: string; notebookId: string; mode: "viewer" | "editor" }): void;
  /** 搜索日记（宿主打开全库搜索并按日记条目过滤）。 */
  onOpenSearch(): void;
  /** 目录变了（新建了本/年/月/文档）后刷新首页快照。 */
  onChanged(): Promise<void>;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** planDiaryConvert 的拒绝原因 → 一句人话（判据在 core，这里只翻译文案）。 */
const CONVERT_REJECTION_TEXT: Record<DiaryConvertRejection, string> = {
  "missing-entry": "找不到这条日记",
  "not-diary-entry": "这条已经不是日记条目了",
  "target-missing": "目标笔记本不存在",
  "target-is-diary": "不能转进日记本",
  "target-not-notebook": "只能转到笔记本",
};

/** 「11 月 9 日 周日」——从日期键直接取，不经过 UTC（与 core 的本地日期口径一致）。 */
function dayLabel(dateKey: string): string {
  const month = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));
  const weekday = WEEKDAYS[new Date(Number(dateKey.slice(0, 4)), month - 1, day).getDay()] ?? "";
  return month + " 月 " + day + " 日 " + weekday;
}

/** 日期键 → 月历游标（本地日期，不经 UTC）。 */
function monthOf(dateKey: string): { year: number; month: number } {
  return { year: Number(dateKey.slice(0, 4)), month: Number(dateKey.slice(5, 7)) };
}

/**
 * 条目行内时刻（同日多篇靠它区分，docs/DIARY.md 决策 4「行内显示时刻」）：
 * 优先创建时刻（新建时写入），历史条目缺失则回落到更新时刻；坏值返回空串（不显示该行说明）。
 */
function entryClock(entry: DiaryEntry): string {
  const iso = entry.createdAt || entry.updatedAt;
  if (!iso) return "";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : formatHm(at);
}

export function DiaryPage({ nodes, onOpenEntry, onOpenSearch, onChanged }: DiaryPageProps) {
  /** 在途守卫：＋/日历/写今天三条路共用（连点只发一次写请求；数据层另有单事务兜底）。 */
  const openingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const todayKey = formatDiaryDateKey();
  const entries = useMemo(() => diaryEntries(nodes, diaryNotebookId(nodes)), [nodes]);
  const years = useMemo(() => groupDiaryEntries(entries), [entries]);
  const todayCount = useMemo(() => entries.filter((entry) => entry.dateKey === todayKey).length, [entries, todayKey]);
  const wroteToday = todayCount > 0;
  /** 有日记的日期集合：只喂月历的「这一天已有」圆点（复用共享原语的 hasDot，不另画一套）。 */
  const entryDateKeys = useMemo(() => new Set(entries.map((entry) => entry.dateKey)), [entries]);

  /**
   * 打开/新建某天日记的唯一执行点：mode = "open"（幂等）/ "new"（永远新建）。
   * 判据不在这里 —— 由 bridge → data 层按 mode 选 core 的 plan。
   */
  const openDate = useCallback(async (dateKey: string, mode: DiaryOpenMode, failLabel: string): Promise<void> => {
    if (openingRef.current) return;
    openingRef.current = true;
    setBusy(true);
    try {
      const opened = await bridge.diaryOpenDate(dateKey, mode);
      onOpenEntry({ noteId: opened.noteId, notebookId: opened.notebookId, mode: "editor" });
      void onChanged();
    } catch (error) {
      toastActionError(failLabel, error);
    } finally {
      openingRef.current = false;
      setBusy(false);
    }
  }, [onChanged, onOpenEntry]);

  const writeToday = useCallback((): void => { void openDate(todayKey, "open", "打开今天的日记"); }, [openDate, todayKey]);
  const createToday = useCallback((): void => { void openDate(todayKey, "new", "新建今天的日记"); }, [openDate, todayKey]);

  // ---- 日历：选任意日期新建（复用月历原语 + 既有 MobileSheet 浮层） ----
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [cursor, setCursor] = useState(() => monthOf(todayKey));
  const openCalendar = useCallback((): void => {
    setCursor(monthOf(todayKey));
    setCalendarOpen(true);
  }, [todayKey]);
  const shiftMonth = useCallback((delta: number): void => {
    setCursor((current) => {
      const next = new Date(current.year, current.month - 1 + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() + 1 };
    });
  }, []);
  /** 选中日期 = **新建**（一天允许多篇，所以不做"已存在就打开"的分支）。 */
  const createOnDate = useCallback((dateKey: string): void => {
    setCalendarOpen(false);
    void openDate(dateKey, "new", "新建这一天的日记");
  }, [openDate]);

  const openEntry = useCallback((entry: DiaryEntry): void => {
    const notebookId = diaryNotebookId(nodes);
    if (!notebookId) return;
    onOpenEntry({ noteId: entry.noteId, notebookId, mode: "viewer" });
  }, [nodes, onOpenEntry]);

  // ---- 条目操作：转为文档（= 移动到选中的笔记本；同一个 note，不复制正文/历史） ----
  /** 可承接的笔记本：判据在 core（已排除日记本/分组），这里只做投影。 */
  const convertTargets = useMemo(() => diaryConvertTargets(nodes), [nodes]);
  const convertTargetNodes = useMemo(
    () => convertTargets.map((target) => ({ id: target.id, title: target.title, parentId: null, nodeType: "notebook" })),
    [convertTargets],
  );
  const [menuFor, setMenuFor] = useState<DiaryEntry | null>(null);
  const [convertFor, setConvertFor] = useState<DiaryEntry | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  const closeConvert = useCallback((): void => {
    if (converting) return;
    setConvertFor(null);
    setConvertError(null);
  }, [converting]);

  const convertEntry = useCallback(async (entry: DiaryEntry, targetId: string): Promise<void> => {
    // 判据单一来源：渲染层不另写「是不是日记条目/目标是不是笔记本」。
    const plan = planDiaryConvert(nodes, entry.noteId, targetId);
    if (!plan.ok) {
      setConvertError(CONVERT_REJECTION_TEXT[plan.reason]);
      return;
    }
    setConverting(true);
    setConvertError(null);
    try {
      // orderedIds = 目标笔记本**现有子节点排序 + 本条追加末尾**（与 useTreeActions.moveTreeNode 的 "inside" 同口径；
      // 只传 [id] 会被 assertOrderedChildren 判「必须包含该父节点的全部子节点」拒绝）。
      const snapshot = await bridge.getWorkspaceSnapshot(plan.targetId);
      const siblings = snapshot.tree
        .filter((item) => item.parentId === plan.targetId && item.id !== entry.noteId)
        .map((item) => item.id);
      await bridge.moveTreeNodeOrdered(entry.noteId, plan.targetId, [...siblings, entry.noteId]);
      const targetTitle = convertTargets.find((target) => target.id === plan.targetId)?.title ?? "文档";
      setConvertFor(null);
      showToast("已转为文档：《" + targetTitle + "》");
      void onChanged();
    } catch (error) {
      setConvertError("转文档失败，请重试");
      toastActionError("转为文档", error);
    } finally {
      setConverting(false);
    }
  }, [convertTargets, nodes, onChanged]);

  return (
    <div className="mobile-scroll">
      {/* 页头 = 玻璃条（与「标签」页同一形态）：左标题 + 计数，右三个入口「搜索 / 日历 / ＋」。 */}
      <header className="mobile-settings-head mobile-page-head mb-glass mb-glass--bar">
        <div className="mobile-settings-title mb-flex1">
          日记
          <span className="mb-row__meta"> {entries.length} 篇</span>
        </div>
        <div className="mb-set-item__ctl">
          <button type="button" className="mb-iconbtn" aria-label="搜索日记" onClick={onOpenSearch}>
            <Search size={18} />
          </button>
          <button type="button" className="mb-iconbtn" aria-label="按日期新建日记" onClick={openCalendar}>
            <CalendarDays size={18} />
          </button>
          <button type="button" className="mb-iconbtn" aria-label="今天新建日记" disabled={busy} onClick={createToday}>
            <Plus size={18} />
          </button>
        </div>
      </header>

      <div className="mobile-quick-cards">
        {/* 今日卡（v2 纸面卡）：左 = 今天 + 状态，右 = 幂等主按钮「写今天 / 继续写今天」。 */}
        <div className="mb-set-section">
          <div className="mb-set-item">
            <span className="mb-set-item__icon" aria-hidden="true"><CalendarDays size={19} /></span>
            <div className="mb-set-item__main">
              <div className="mb-set-name">今天</div>
              <div className="mb-set-item__desc">
                {dayLabel(todayKey)}，{wroteToday ? "已写 " + todayCount + " 篇，可继续写" : "还没有写"}
              </div>
            </div>
            <div className="mb-set-item__ctl">
              <button
                type="button"
                className="mb-btn mb-btn--primary mb-btn--sm"
                disabled={busy}
                onClick={writeToday}
                aria-label={wroteToday ? "继续写今天的日记" : "写今天的日记"}
              >
                <Pencil size={16} />
                <span>{wroteToday ? "继续写今天" : "写今天"}</span>
              </button>
            </div>
          </div>
        </div>

        {years.length === 0 ? (
          <EmptyState>还没有日记。点上面「写今天」写下第一篇。</EmptyState>
        ) : years.map((year) => (
          <section className="mb-set-section" key={year.year} aria-label={year.year + " 年"}>
            <div className="mb-set-section__title">{year.year} 年（{year.count}）</div>
            {year.months.map((month) => (
              <div className="diary-month" key={year.year + "-" + month.month}>
                <div className="diary-month__title">{Number(month.month)} 月</div>
                <div className="mb-set-items">
                  {month.entries.map((entry) => (
                    /* 行结构照设置页原语（TagsHomeTab 同形）：容器 .mb-set-item + 主区按钮，不新造行样式。 */
                    <div className="mb-set-item" key={entry.noteId}>
                      <button
                        type="button"
                        className="mb-set-item__main"
                        onClick={() => openEntry(entry)}
                        aria-label={"打开 " + entry.dateKey + " 的日记"}
                      >
                        <span className="mb-set-name">{dayLabel(entry.dateKey)}</span>
                        <span className="mb-set-item__desc">
                          {entryClock(entry) ? "写于 " + entryClock(entry) : "更新于 " + formatRelativeTime(entry.updatedAt)}
                        </span>
                      </button>
                      {/* 行尾操作入口：⋮ → 弹层菜单（HomePage 同一份 MobileSheetMenu；不新造行样式）。 */}
                      <span className="mb-set-item__ctl">
                        <button
                          type="button"
                          className="mb-iconbtn"
                          aria-label={"日记操作 " + entry.dateKey}
                          onClick={() => setMenuFor(entry)}
                        >
                          <MoreVertical size={16} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>

      {/* 日历 = 选任意日期**新建**（应用内月历 = 共享原语；外壳 = 既有底部 Sheet，不引桌面日历）。 */}
      <MobileSheet open={calendarOpen} title="按日期新建" onClose={() => setCalendarOpen(false)}>
        <MonthCalendar
          year={cursor.year}
          month={cursor.month}
          selected={null}
          today={todayKey}
          onShiftMonth={shiftMonth}
          onPick={createOnDate}
          hasDot={(dateKey) => entryDateKeys.has(dateKey)}
        />
      </MobileSheet>

      {/* 条目 ⋯ 菜单：转文档 / 删除 + 整本「取消日记标记」；移动端不新造 Sheet 类型。 */}
      <MobileSheetMenu
        open={menuFor !== null}
        items={[
          { id: "convert", label: "转为文档…", icon: FileText },
          { id: "unmark", label: "取消日记标记（整本）", icon: BookX },
          { id: "delete", label: "删除", icon: Trash2 },
        ]}
        onClose={() => setMenuFor(null)}
        onSelect={(item) => {
          const entry = menuFor;
          setMenuFor(null);
          if (!entry) return;
          if (item.id === "convert") { setConvertError(null); setConvertFor(entry); }
          if (item.id === "unmark") {
            // 整本取消标记：笔记本 + 全部文档都保留，只是不再归入日记空间（必须说清，防止误以为删数据）。
            void (async () => {
              const notebookId = diaryNotebookId(nodes);
              if (!notebookId) return;
              const ok = await confirmMobile({
                title: "取消日记标记（整本）？",
                body: "笔记本与其中的文档都会保留，只是不再归入日记空间（会回到知识库）。",
                confirmText: "取消日记标记",
                danger: true,
              });
              if (!ok) return;
              try {
                const result = await bridge.clearDiaryMark(notebookId);
                showToast(result.cleared ? "已取消日记标记，笔记本已回到知识库" : "这本已经不是日记本了");
                void onChanged();
              } catch (error) {
                toastActionError("取消日记标记", error);
              }
            })();
          }
          if (item.id === "delete") {
            // 移入回收站（软删，可恢复；恢复会回日记空间，见 core/trash 判据）。
            void (async () => {
              const ok = await confirmMobile({ title: "删除这篇日记？", body: "会移入回收站，可恢复。", confirmText: "删除", danger: true });
              if (!ok) return;
              try {
                await bridge.trashTreeItem(entry.noteId, "note");
                showToast("已移入回收站");
                onChanged();
              } catch (error) {
                toastActionError("删除日记", error);
              }
            })();
          }
        }}
      />
      {/* 目标笔记本选择：复用既有 MoveTargetTreeSheet（只列笔记本；本列表来自 core.diary.diaryConvertTargets）。 */}
      {convertFor && (
        <MoveTargetTreeSheet
          open
          title="转为文档"
          confirmLabel="转为文档"
          description="选择目标笔记本"
          nodes={convertTargetNodes}
          currentParentId={convertFor.parentId}
          excludedIds={[convertFor.noteId]}
          busy={converting}
          error={convertError}
          onConfirm={(targetId) => void convertEntry(convertFor, targetId)}
          onClose={closeConvert}
        />
      )}
    </div>
  );
}
