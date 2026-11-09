/**
 * 一级「日记」页（261109 v1，第 4 个 tab；契约见 docs/DIARY.md）。
 *
 * 职责（**不新造输入面**）：
 *  · 「写今天」主按钮 → `bridge.diaryOpenDate(今天)` 幂等 ensure → 交给宿主进**现有工作区**编辑（正文输入仍走工作区 + dock）；
 *  · 年/月分组列表 → 点条目同样进现有工作区（v1 没有日历/缺天提示/补写，见 docs/DIARY.md「不做」）；
 *  · 搜索入口 → 复用移动端既有全库搜索（结果集在宿主按日记条目 id 过滤，不新建索引）；
 *  · 条目「⋯ → 转为文档…」= **移动**这条笔记到选中的笔记本（同一个 note，不复制正文/历史）。
 *
 * 判据全部来自 `src/core/diary`（**组件里不重算**）：
 *  · 日记本/条目 = diaryNotebookId + diaryEntries；分组 = groupDiaryEntries；今天 = formatDiaryDateKey；
 *  · 可承接的笔记本 = diaryConvertTargets；移动前校验 = planDiaryConvert（UI 不另写一套）。
 * 写入只走既有写域：`bridge.moveTreeNodeOrdered`（`runWrite("moveTreeNodeOrdered")`）。
 * **不打标**：本页不提供任何标签入口（docs/DIARY.md 决策 7）。
 */
import { useCallback, useMemo, useState } from "react";
import { FileText, MoreVertical, Pencil, Search } from "lucide-react";
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
import type { TreeNode } from "../../lib/types";
import { bridge } from "../bridge";
import { EmptyState } from "../ui/EmptyState";
import { MobileSheetMenu } from "../ui/MobileSheetMenu";
import { MoveTargetTreeSheet } from "../ui/MoveTargetTreeSheet";
import { toastActionError } from "../lib/actionError";
import { showToast } from "../ui/toastBus";
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

export function DiaryPage({ nodes, onOpenEntry, onOpenSearch, onChanged }: DiaryPageProps) {
  const [busy, setBusy] = useState(false);
  const todayKey = formatDiaryDateKey();
  const entries = useMemo(() => diaryEntries(nodes, diaryNotebookId(nodes)), [nodes]);
  const years = useMemo(() => groupDiaryEntries(entries), [entries]);
  const wroteToday = entries.some((entry) => entry.dateKey === todayKey);

  const writeToday = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const opened = await bridge.diaryOpenDate(todayKey);
      if (opened.duplicates.length > 0) showToast("同一天有多篇日记，已打开最新一篇", { type: "info" });
      onOpenEntry({ noteId: opened.noteId, notebookId: opened.notebookId, mode: "editor" });
      void onChanged();
    } catch (error) {
      toastActionError("打开今天的日记", error);
    } finally {
      setBusy(false);
    }
  }, [busy, onChanged, onOpenEntry, todayKey]);

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
      <header className="mobile-settings-head mobile-page-head mb-glass mb-glass--bar">
        <div className="mobile-settings-title mb-flex1">
          日记
          <span className="mb-row__meta"> {entries.length} 篇</span>
        </div>
        <button type="button" className="mb-iconbtn" aria-label="搜索日记" onClick={onOpenSearch}>
          <Search size={18} />
        </button>
      </header>
      <div className="mobile-quick-cards">
        <button
          type="button"
          className="mb-btn mb-btn--primary mb-btn--block diary-write-today"
          disabled={busy}
          onClick={() => void writeToday()}
          aria-label={wroteToday ? "继续写今天的日记" : "写今天的日记"}
        >
          <Pencil size={16} />
          <span>{wroteToday ? "继续写今天" : "写今天"}</span>
        </button>
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
                        <span className="mb-set-item__desc">更新于 {formatRelativeTime(entry.updatedAt)}</span>
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
      {/* 条目 ⋯ 菜单：v1 只有一项「转为文档…」（移动端不新造 Sheet 类型）。 */}
      <MobileSheetMenu
        open={menuFor !== null}
        items={[{ id: "convert", label: "转为文档…", icon: FileText }]}
        onClose={() => setMenuFor(null)}
        onSelect={(item) => {
          const entry = menuFor;
          setMenuFor(null);
          if (!entry) return;
          if (item.id === "convert") { setConvertError(null); setConvertFor(entry); }
        }}
      />
      {/* 目标笔记本选择：复用既有 MoveTargetTreeSheet（只列笔记本；本列表来自 core.diary.diaryConvertTargets）。 */}
      {convertFor && (
        <MoveTargetTreeSheet
          open
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
