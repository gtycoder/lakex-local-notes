/**
 * 日记（Diary）——纯逻辑单一来源。
 *
 * 形态（261109 用户定稿，D2）：**数据 = 笔记本体系内的普通 Lake 文档**，
 * wire 标记 = lake 索引 `folders[].space === "diary"`（**不复用 `kind`**：TreeNode.kind 已被文档类型占用）；
 * 表现 = 顶层独立空间。
 *
 * 本文件只做判据与派生，**不碰 IO**（不读库、不建文档、不启动同步）：
 * - 日期键：`YYYY-MM-DD`（本地日期，绝不经过 UTC —— 东八区 23:30 用 UTC 会差一天）
 * - 层级：日记笔记本 → 年分组（`2026`）→ 月分组（`11`）→ 文档（`2026-11-09`）
 * - 幂等：按 (日记笔记本, 日期键) 判定「打开已存在」还是「需要新建」
 *
 * 数据不变量：**标题就是日期**。所以"补写某天"= 按该日期建文档，不需要新字段。
 */

/** 日记笔记本在 wire 上的标记值。 */
export const DIARY_FOLDER_SPACE = "diary" as const;
export type DiaryFolderSpace = typeof DIARY_FOLDER_SPACE;

/** 结构类型：`TreeNode` / 移动端行 / 测试夹具都可直接传入。 */
export interface DiaryTreeNode {
  id: string;
  parentId: string | null;
  /** "notebook" | "group" | "note"（保持 string，便于跨端复用） */
  nodeType: string;
  title: string;
  /** 笔记本标记；只有 `nodeType === "notebook"` 时有效 */
  space?: DiaryFolderSpace | null;
  updatedAt?: string;
  sortOrder?: number;
}

/** 日期键严格形状：`YYYY-MM-DD`。 */
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** 分组标题：年 = 4 位数字，月 = 2 位数字（补零，字典序 = 时间序）。 */
const YEAR_TITLE_PATTERN = /^\d{4}$/;
const MONTH_TITLE_PATTERN = /^\d{2}$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 本地日期键（本地时区当日，绝不用 toISOString）。 */
export function formatDiaryDateKey(at: Date = new Date()): string {
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
}

/**
 * 解析日期键；非法（形状不对 / 日期不存在，如 2026-02-30 / 2026-13-01）返回 null。
 * 只认`标题即日期`这一种载体 —— 标题被改过就不再是日记条目。
 */
export function parseDiaryDateKey(title: string): string | null {
  const matched = DATE_KEY_PATTERN.exec(title.trim());
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // 用 Date 反查真实存在（处理闰年与大小月）
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;
  return `${matched[1]}-${matched[2]}-${matched[3]}`;
}

/** 日期键 → 年/月分组标题（月补零，与多维表日期值域一致）。 */
export function diaryGroupTitles(dateKey: string): { year: string; month: string } {
  const year = dateKey.slice(0, 4);
  const month = dateKey.slice(5, 7);
  return { year, month };
}

/** 分组标题是否是**我们自动建的**那种（用于区分用户手建的同名分组）。 */
export function isDiaryGroupTitle(title: string, level: "year" | "month"): boolean {
  const trimmed = title.trim();
  return level === "year" ? YEAR_TITLE_PATTERN.test(trimmed) : MONTH_TITLE_PATTERN.test(trimmed);
}

/** wire 读取：未知值一律当"非日记"（向前兼容：未来可能出现别的 kind）。 */
export function normalizeFolderSpace(value: unknown): DiaryFolderSpace | null {
  return value === DIARY_FOLDER_SPACE ? DIARY_FOLDER_SPACE : null;
}

/**
 * wire 写入：**必须显式写**。
 * 非日记写 `null`（而不是省略字段）—— 否则"取消日记标记"在 wire 上不可见、两端会互刷
 * （同标签 `tagIds` 空集合必须写 `[]` 的教训，AGENTS §4）。
 */
export function folderSpaceForWire(kind: string | null | undefined): DiaryFolderSpace | null {
  return kind === DIARY_FOLDER_SPACE ? DIARY_FOLDER_SPACE : null;
}

function isNotebook(node: DiaryTreeNode): boolean {
  return node.nodeType === "notebook";
}

/** 全部日记笔记本（正常只有 1 个；多个时按 sortOrder/id 稳定排序，取第一个为准）。 */
export function diaryNotebooks(nodes: readonly DiaryTreeNode[]): DiaryTreeNode[] {
  return nodes
    .filter((node) => isNotebook(node) && normalizeFolderSpace(node.space) === DIARY_FOLDER_SPACE)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id));
}

/** 日记本 id；没有则 null。多个时取第一个（调用方可用 `diaryNotebooks` 报告警）。 */
export function diaryNotebookId(nodes: readonly DiaryTreeNode[]): string | null {
  return diaryNotebooks(nodes)[0]?.id ?? null;
}

/** 文档空间的目录树要排除日记本（表现层过滤，不改存储）。 */
export function withoutDiaryNotebook(nodes: readonly DiaryTreeNode[]): DiaryTreeNode[] {
  const hidden = new Set(diaryNotebooks(nodes).map((node) => node.id));
  if (hidden.size === 0) return nodes as DiaryTreeNode[];
  return nodes.filter((node) => !hidden.has(node.id));
}

/** 一条日记（供时间线/日历派生）。 */
export interface DiaryEntry {
  noteId: string;
  dateKey: string;
  year: string;
  month: string;
  title: string;
  updatedAt: string;
  parentId: string | null;
}

/**
 * 日记笔记本下的全部条目，**按日期倒序**（最新在上）。
 * 只认标题能解析成日期键的文档；标题被改过的不出现在时间线里（不是日记条目了）。
 */
export function diaryEntries(nodes: readonly DiaryTreeNode[], notebookId: string | null): DiaryEntry[] {
  if (!notebookId) return [];
  const children = new Map<string, DiaryTreeNode[]>();
  for (const node of nodes) {
    const key = node.parentId ?? "";
    const bucket = children.get(key);
    if (bucket) bucket.push(node);
    else children.set(key, [node]);
  }
  const entries: DiaryEntry[] = [];
  const walk = (parentId: string): void => {
    for (const node of children.get(parentId) ?? []) {
      if (node.nodeType === "note") {
        const dateKey = parseDiaryDateKey(node.title);
        if (!dateKey) continue;
        const { year, month } = diaryGroupTitles(dateKey);
        entries.push({ noteId: node.id, dateKey, year, month, title: node.title, updatedAt: node.updatedAt ?? "", parentId: node.parentId });
      } else if (node.nodeType === "group") {
        walk(node.id);
      }
    }
  };
  walk(notebookId);
  return entries.sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.updatedAt.localeCompare(a.updatedAt));
}

/** 时间线按 年 → 月 分组（渲染直接用，不再在组件里重算）。 */
export interface DiaryMonthGroup {
  year: string;
  month: string;
  entries: DiaryEntry[];
}
export interface DiaryYearGroup {
  year: string;
  months: DiaryMonthGroup[];
  count: number;
}

export function groupDiaryEntries(entries: readonly DiaryEntry[]): DiaryYearGroup[] {
  const years: DiaryYearGroup[] = [];
  const yearIndex = new Map<string, DiaryYearGroup>();
  const monthIndex = new Map<string, DiaryMonthGroup>();
  for (const entry of entries) {
    let yearGroup = yearIndex.get(entry.year);
    if (!yearGroup) {
      yearGroup = { year: entry.year, months: [], count: 0 };
      yearIndex.set(entry.year, yearGroup);
      years.push(yearGroup);
    }
    const monthKey = `${entry.year}-${entry.month}`;
    let monthGroup = monthIndex.get(monthKey);
    if (!monthGroup) {
      monthGroup = { year: entry.year, month: entry.month, entries: [] };
      monthIndex.set(monthKey, monthGroup);
      yearGroup.months.push(monthGroup);
    }
    monthGroup.entries.push(entry);
    yearGroup.count += 1;
  }
  for (const yearGroup of years) {
    yearGroup.months.sort((a, b) => b.month.localeCompare(a.month));
  }
  return years;
}

/** 打开某一天的计划（纯派生；调用方按 step 执行）。 */
export interface DiaryOpenPlan {
  /** 需要的日记笔记本 id；null ⇒ 先建笔记本，再重新 plan。 */
  notebookId: string | null;
  dateKey: string;
  yearTitle: string;
  monthTitle: string;
  /** 已存在的目标文档（命中即直接打开，不再创建）。 */
  existingNoteId: string | null;
  /** 需要创建的容器，按顺序（年 → 月）；parentId 已解析成真实 id。 */
  groupsToCreate: Array<{ parentId: string; title: string; nodeType: "group" }>;
  /** 目标文档的父节点 id（月分组）；existingNoteId 存在时仍给出，便于展示。 */
  noteParentId: string | null;
  /** 同名的重复文档（历史脏数据）；>0 时调用方应告警但不自动删除。 */
  duplicateNoteIds: string[];
}

function findChildGroup(nodes: readonly DiaryTreeNode[], parentId: string, title: string): DiaryTreeNode | null {
  return nodes.find((node) => node.parentId === parentId && node.nodeType === "group" && node.title.trim() === title) ?? null;
}

function diaryNotesOnDate(nodes: readonly DiaryTreeNode[], notebookId: string, dateKey: string): DiaryTreeNode[] {
  const noteParentIds = new Set(
    nodes.filter((node) => node.nodeType === "group").map((node) => node.id),
  );
  return nodes.filter(
    (node) => node.nodeType === "note" && node.parentId !== null && (noteParentIds.has(node.parentId) || node.parentId === notebookId) && parseDiaryDateKey(node.title) === dateKey,
  );
}

/** 计算「打开 todayKey 这篇日记」要做的事。幂等：已存在就只打开。 */
export function planDiaryOpen(nodes: readonly DiaryTreeNode[], dateKey: string): DiaryOpenPlan {
  const normalized = parseDiaryDateKey(dateKey) ?? dateKey;
  const { year, month } = diaryGroupTitles(normalized);
  const notebookId = diaryNotebookId(nodes);
  const base: DiaryOpenPlan = {
    notebookId,
    dateKey: normalized,
    yearTitle: year,
    monthTitle: month,
    existingNoteId: null,
    groupsToCreate: [],
    noteParentId: null,
    duplicateNoteIds: [],
  };
  if (!notebookId) return base;

  const groupsToCreate: DiaryOpenPlan["groupsToCreate"] = [];
  const yearGroup = findChildGroup(nodes, notebookId, year);
  const effectiveYearId = yearGroup?.id ?? notebookId;
  if (!yearGroup) groupsToCreate.push({ parentId: notebookId, title: year, nodeType: "group" });
  const monthGroup = yearGroup ? findChildGroup(nodes, yearGroup.id, month) : null;
  if (!monthGroup) groupsToCreate.push({ parentId: effectiveYearId, title: month, nodeType: "group" });

  const existing = diaryNotesOnDate(nodes, notebookId, normalized)
    .slice()
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return {
    ...base,
    existingNoteId: existing[0]?.id ?? null,
    groupsToCreate,
    noteParentId: monthGroup?.id ?? effectiveYearId,
    duplicateNoteIds: existing.slice(1).map((node) => node.id),
  };
}

/** 最近 N 天里「写过/没写」的状态（v1 只用于空态提示，不做缺天提醒）。 */
export function recentDiaryDays(entries: readonly DiaryEntry[], todayKey: string, days: number): Array<{ dateKey: string; wrote: boolean }> {
  const wrote = new Set(entries.map((entry) => entry.dateKey));
  const anchor = parseDiaryDateKey(todayKey) ? new Date(Number(todayKey.slice(0, 4)), Number(todayKey.slice(5, 7)) - 1, Number(todayKey.slice(8, 10))) : new Date();
  const out: Array<{ dateKey: string; wrote: boolean }> = [];
  for (let i = 0; i < days; i += 1) {
    const day = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - i);
    const key = formatDiaryDateKey(day);
    out.push({ dateKey: key, wrote: wrote.has(key) });
  }
  return out;
}

/** 「转为文档」：日记条目 → 文档空间的某本笔记本（换父节点 = 移动，不复制正文/历史）。 */
export interface DiaryConvertTarget {
  id: string;
  title: string;
  sortOrder: number;
}

/**
 * 可承接日记的容器 = **文档空间的笔记本**（根层 notebook，排除日记本）。
 * 只要笔记本、不要分组：日记转出去是"成为一篇正式文档"，落在分组里属于同一动作的另一种入口，
 * 需要时再放宽（v1 不做，别预先设计）。
 */
export function diaryConvertTargets(nodes: readonly DiaryTreeNode[]): DiaryConvertTarget[] {
  const diaryIds = new Set(diaryNotebooks(nodes).map((node) => node.id));
  return nodes
    .filter((node) => node.nodeType === "notebook" && node.parentId === null && !diaryIds.has(node.id))
    .map((node) => ({ id: node.id, title: node.title, sortOrder: node.sortOrder ?? 0 }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

export type DiaryConvertRejection = "missing-entry" | "not-diary-entry" | "target-missing" | "target-is-diary" | "target-not-notebook";

/**
 * 校验一次「转为文档」。**渲染层与任何写入路径都先问这里**，不要在 UI 里另写一遍判据。
 * 通过时返回目标笔记本 id 与条目所在的月分组 id（供移动/回滚用）。
 */
export function planDiaryConvert(
  nodes: readonly DiaryTreeNode[],
  entryNodeId: string | null,
  targetNotebookId: string | null,
): { ok: true; entry: DiaryEntry; targetId: string } | { ok: false; reason: DiaryConvertRejection } {
  if (!entryNodeId) return { ok: false, reason: "missing-entry" };
  const notebookIds = diaryNotebooks(nodes).map((node) => node.id);
  const entry = notebookIds.length
    ? diaryEntries(nodes, notebookIds[0]).find((item) => item.noteId === entryNodeId) ?? null
    : null;
  if (!entry) return { ok: false, reason: "not-diary-entry" };
  if (!targetNotebookId) return { ok: false, reason: "target-missing" };
  if (notebookIds.includes(targetNotebookId)) return { ok: false, reason: "target-is-diary" };
  const target = nodes.find((node) => node.id === targetNotebookId);
  if (!target) return { ok: false, reason: "target-missing" };
  if (target.nodeType !== "notebook") return { ok: false, reason: "target-not-notebook" };
  return { ok: true, entry, targetId: targetNotebookId };
}
