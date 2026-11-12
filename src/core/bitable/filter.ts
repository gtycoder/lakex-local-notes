/**
 * 多维表正文（core/bitable）：视图筛选：操作符表、条件求值、日期范围、条件树归一（**条件求值唯一实现**，AGENTS §3#19）。
 *
 * 由 core/bitableDoc.ts 按域拆出（261112 R1-S1，纯搬移：导出名/行为未变）。
 * 对外 API 仍由 ../bitableDoc.ts 门面 re-export；本文件只被同目录模块与门面 import。
 */
import type { BitableDateFilterMode, BitableField, BitableFilterGroup, BitableFilterJoin, BitableFilterNode, BitableFilterOperator, BitableFilterRule, BitableFilterValue, BitableFilterValueKind, BitableRecord, BitableTable, BitableView } from "./types.js";
import { BITABLE_FILL_NO_COLOR, BITABLE_FILTER_MAX_GROUP_DEPTH, isRelationFieldType, newBitableId } from "./types.js";
import { bitableAttachments, bitableDisplayValue, bitableFieldValue, dateValueOf, isNumericFieldType, isSystemTimeField, localDateString, relationRecordIds } from "./values.js";

const BITABLE_FILTER_OPERATORS = new Set<BitableFilterOperator>([
  "equalTo", "notEqualTo", "greaterThan", "greaterThanOrEqualTo", "lessThan", "lessThanOrEqualTo",
  "isEmpty", "isNotEmpty", "startsWith", "notStartsWith", "endsWith", "notEndsWith", "contains", "notContains",
  "is", "isNot", "isEmptySelect", "isNotEmptySelect", "isExactly", "hasAnyOf", "hasAllOf", "hasNoneOf",
]);

const BITABLE_DATE_FILTER_MODE_SET = new Set<BitableDateFilterMode>([
  "custom", "today", "tomorrow", "yesterday", "thisWeek", "lastWeek", "nextWeek", "lastMonth", "thisMonth",
  "nextMonth", "thisYear", "last7days", "next7days", "last30days", "next30days",
]);

function normalizeFilterValue(value: unknown): BitableFilterValue | undefined {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return undefined;
}

/** 内部共享（跨模块用，**不**由门面 re-export）。 */
export function normalizeFilterNode(raw: unknown, depth: number): BitableFilterNode | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as { id?: unknown; fieldId?: unknown; operator?: unknown; value?: unknown; valueMode?: unknown; filters?: unknown };
  if (Array.isArray(node.filters)) {
    if (depth > BITABLE_FILTER_MAX_GROUP_DEPTH) return null;
    const children = node.filters.map((child) => normalizeFilterNode(child, depth + 1)).filter((child): child is BitableFilterNode => !!child);
    if (children.length === 0) return null;
    return {
      ...(typeof node.id === "string" ? { id: node.id } : {}),
      operator: node.operator === "or" ? "or" : "and",
      filters: children,
    };
  }
  if (typeof node.fieldId !== "string" || typeof node.operator !== "string" || !BITABLE_FILTER_OPERATORS.has(node.operator as BitableFilterOperator)) return null;
  const next: BitableFilterRule = {
    ...(typeof node.id === "string" ? { id: node.id } : {}),
    fieldId: node.fieldId,
    operator: node.operator as BitableFilterOperator,
  };
  const value = normalizeFilterValue(node.value);
  if (value !== undefined) next.value = value;
  if (typeof node.valueMode === "string" && BITABLE_DATE_FILTER_MODE_SET.has(node.valueMode as BitableDateFilterMode)) {
    next.valueMode = node.valueMode as BitableDateFilterMode;
  }
  return next;
}

/** 内部共享（跨模块用，**不**由门面 re-export）。 */
export function normalizeFilters(raw: unknown): BitableFilterNode[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((node) => normalizeFilterNode(node, 1)).filter((node): node is BitableFilterNode => !!node);
}

const BITABLE_FILTER_EMPTY_OPERATORS = new Set<BitableFilterOperator>(["isEmpty", "isNotEmpty", "isEmptySelect", "isNotEmptySelect"]);

export function isBitableFilterGroup(node: BitableFilterNode): node is BitableFilterGroup {
  return !!node && typeof node === "object" && Array.isArray((node as BitableFilterGroup).filters);
}

/** 当前筛选树里的规则数（分组不计入；用于工具栏「N个筛选」徽标）。 */
export function bitableFilterRuleCount(filters: readonly BitableFilterNode[] | undefined): number {
  if (!filters?.length) return 0;
  return filters.reduce((count, node) => count + (isBitableFilterGroup(node) ? bitableFilterRuleCount(node.filters) : 1), 0);
}

/** 某个操作符右侧值 UI 的类型；none = 该操作符不需要值。 */
export function filterValueKindFor(field: BitableField, operator: BitableFilterOperator): BitableFilterValueKind {
  if (BITABLE_FILTER_EMPTY_OPERATORS.has(operator)) return "none";
  if (field.type === "date" || isSystemTimeField(field.type)) return "date";
  if (isNumericFieldType(field.type)) return "number";
  if (field.type === "select") return "select";
  if (field.type === "multiSelect" || isRelationFieldType(field.type)) return "multiSelect";
  if (field.type === "boolean") return "boolean";
  if (field.type === "attachment" || field.type === "image") return "file";
  if (field.type === "text" || field.type === "link" || field.type === "ai" || field.type === "markdown") return "text";
  return "none";
}

/** 某个字段类型可用的筛选操作符（逐项对齐远端 lake 的类型分组）。 */
export function filterOperatorsFor(field: BitableField): BitableFilterOperator[] {
  if (field.type === "text" || field.type === "link" || field.type === "ai" || field.type === "markdown") {
    return ["startsWith", "notStartsWith", "endsWith", "notEndsWith", "contains", "notContains", "isEmpty", "isNotEmpty"];
  }
  if (isNumericFieldType(field.type)) {
    return ["equalTo", "notEqualTo", "greaterThan", "greaterThanOrEqualTo", "lessThan", "lessThanOrEqualTo", "isEmpty", "isNotEmpty"];
  }
  if (field.type === "date" || isSystemTimeField(field.type)) {
    return ["equalTo", "lessThan", "greaterThan", "isEmpty", "isNotEmpty"];
  }
  if (field.type === "select") return ["is", "isNot", "isEmptySelect", "isNotEmptySelect"];
  if (field.type === "multiSelect" || isRelationFieldType(field.type)) {
    return ["isExactly", "isNot", "hasAnyOf", "hasAllOf", "hasNoneOf", "isEmptySelect", "isNotEmptySelect"];
  }
  if (field.type === "boolean") return ["equalTo"];
  if (field.type === "attachment" || field.type === "image") return ["isEmpty", "isNotEmpty"];
  return [];
}

export const BITABLE_FILTER_OPERATOR_LABEL: Record<BitableFilterOperator, string> = {
  equalTo: "等于",
  notEqualTo: "不等于",
  greaterThan: "大于",
  greaterThanOrEqualTo: "大于等于",
  lessThan: "小于",
  lessThanOrEqualTo: "小于等于",
  isEmpty: "为空",
  isNotEmpty: "非空",
  startsWith: "开头是",
  notStartsWith: "开头不是",
  endsWith: "结尾是",
  notEndsWith: "结尾不是",
  contains: "包含",
  notContains: "不包含",
  is: "是",
  isNot: "不是",
  isEmptySelect: "为空",
  isNotEmptySelect: "非空",
  isExactly: "是",
  hasAnyOf: "包含一个",
  hasAllOf: "包含所有",
  hasNoneOf: "不包含",
};

/** 操作符展示文案（日期类把小于/大于改为远端 lake 的早于/晚于）。 */
export function filterOperatorLabel(field: BitableField, operator: BitableFilterOperator): string {
  if (field.type === "date" || isSystemTimeField(field.type)) {
    if (operator === "lessThan") return "早于";
    if (operator === "greaterThan") return "晚于";
  }
  return BITABLE_FILTER_OPERATOR_LABEL[operator];
}

export const BITABLE_DATE_FILTER_MODE_LABEL: Record<BitableDateFilterMode, string> = {
  custom: "具体日期",
  today: "今天",
  tomorrow: "明天",
  yesterday: "昨天",
  thisWeek: "本周",
  lastWeek: "上周",
  nextWeek: "下周",
  lastMonth: "上月",
  thisMonth: "本月",
  nextMonth: "下月",
  thisYear: "本年",
  last7days: "过去7天内",
  next7days: "未来7天内",
  last30days: "过去30天内",
  next30days: "未来30天内",
};

const BITABLE_DATE_FILTER_MODES: BitableDateFilterMode[] = [
  "custom", "today", "tomorrow", "yesterday", "thisWeek", "lastWeek", "nextWeek", "lastMonth", "thisMonth",
  "nextMonth", "thisYear", "last7days", "next7days", "last30days", "next30days",
];

/** 日期规则右侧可选模式；与远端 bundle 的 matchFuncs 一致：滚动 7/30 天只用于“等于”。 */
export function dateFilterModesFor(operator: BitableFilterOperator): BitableDateFilterMode[] {
  if (operator === "equalTo") return BITABLE_DATE_FILTER_MODES;
  return ["custom", "today", "tomorrow", "yesterday", "thisWeek", "lastWeek", "nextWeek", "lastMonth", "thisMonth", "nextMonth", "thisYear"];
}

export function defaultFilterValueFor(field: BitableField, operator: BitableFilterOperator): BitableFilterValue | undefined {
  const kind = filterValueKindFor(field, operator);
  if (kind === "none") return undefined;
  if (kind === "boolean") return undefined;
  if (kind === "select") return "";
  if (kind === "multiSelect") return [];
  return "";
}

/** 新建一条默认规则（默认字段必须可筛选）。 */
export function createBitableFilterRule(field: BitableField, id = newBitableId("flt")): BitableFilterRule {
  const operator = filterOperatorsFor(field)[0] ?? "isEmpty";
  const rule: BitableFilterRule = { id, fieldId: field.id, operator };
  const value = defaultFilterValueFor(field, operator);
  if (value !== undefined) rule.value = value;
  if (field.type === "date" || isSystemTimeField(field.type)) rule.valueMode = "custom";
  return rule;
}

export function createBitableFilterGroup(id = newBitableId("fgr"), operator: BitableFilterJoin = "or"): BitableFilterGroup {
  return { id, operator, filters: [] };
}

function startOfLocalDay(at: Date): Date { return new Date(at.getFullYear(), at.getMonth(), at.getDate()); }

function endOfLocalDay(at: Date): Date { return new Date(at.getFullYear(), at.getMonth(), at.getDate(), 23, 59, 59, 999); }

function startOfLocalWeek(at: Date): Date {
  const day = (at.getDay() + 6) % 7; // 周一为一周起点，与日历视图一致
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() - day);
}

function addLocalDays(at: Date, days: number): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + days, at.getHours(), at.getMinutes(), at.getSeconds(), at.getMilliseconds());
}

/** 动态日期 → 本地日期闭区间；custom 返回 null。 */
export function dateFilterRangeFor(mode: BitableDateFilterMode, now: Date = new Date()): { start: string; end: string } | null {
  if (mode === "custom") return null;
  if (mode === "today") return { start: localDateString(startOfLocalDay(now)), end: localDateString(endOfLocalDay(now)) };
  if (mode === "tomorrow") { const d = addLocalDays(now, 1); return { start: localDateString(startOfLocalDay(d)), end: localDateString(endOfLocalDay(d)) }; }
  if (mode === "yesterday") { const d = addLocalDays(now, -1); return { start: localDateString(startOfLocalDay(d)), end: localDateString(endOfLocalDay(d)) }; }
  if (mode === "thisWeek") { const s = startOfLocalWeek(now); return { start: localDateString(s), end: localDateString(addLocalDays(s, 6)) }; }
  if (mode === "lastWeek") { const s = addLocalDays(startOfLocalWeek(now), -7); return { start: localDateString(s), end: localDateString(addLocalDays(s, 6)) }; }
  if (mode === "nextWeek") { const s = addLocalDays(startOfLocalWeek(now), 7); return { start: localDateString(s), end: localDateString(addLocalDays(s, 6)) }; }
  if (mode === "thisMonth") return { start: localDateString(new Date(now.getFullYear(), now.getMonth(), 1)), end: localDateString(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  if (mode === "lastMonth") return { start: localDateString(new Date(now.getFullYear(), now.getMonth() - 1, 1)), end: localDateString(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (mode === "nextMonth") return { start: localDateString(new Date(now.getFullYear(), now.getMonth() + 1, 1)), end: localDateString(new Date(now.getFullYear(), now.getMonth() + 2, 0)) };
  if (mode === "thisYear") return { start: localDateString(new Date(now.getFullYear(), 0, 1)), end: localDateString(new Date(now.getFullYear(), 11, 31)) };
  // 滚动窗口口径 = **含今天共 N 个日历日**（本地时区按天取整；不跟着 now 的时分秒漂移）。
  // 此前写 -N/+N ⇒ 文案「过去7天内」实际覆盖 8 个日历日、边界日多算一天（CORE-08）。
  const today = startOfLocalDay(now);
  if (mode === "last7days") return { start: localDateString(addLocalDays(today, -6)), end: localDateString(today) };
  if (mode === "next7days") return { start: localDateString(today), end: localDateString(addLocalDays(today, 6)) };
  if (mode === "last30days") return { start: localDateString(addLocalDays(today, -29)), end: localDateString(today) };
  // 其余 = next30days
  return { start: localDateString(today), end: localDateString(addLocalDays(today, 29)) };
}

/** 动态日期条件是否读「今天」：只有日期/系统时间字段 + 非 custom 模式会依赖 now。 */
function filterRuleUsesClock(field: BitableField | undefined, rule: BitableFilterRule): boolean {
  if (!field) return false;
  if (field.type !== "date" && !isSystemTimeField(field.type)) return false;
  return (rule.valueMode ?? "custom") !== "custom";
}

/**
 * 视图求值是否真的依赖「今天」（CORE-06 重算时机）。
 *
 * 只有筛选 / 填色里存在**动态日期**条件时才需要随 clock 重算；全是静态条件时，
 * 切回窗口 / 跨日重算整表（5k≈40ms、20k≈100ms）是纯浪费。求值本身仍走
 * applyViewToRecords / buildBitableFillProjection 这唯一来源（这里只回答「要不要重算」）。
 */
export function bitableViewNeedsClock(table: BitableTable, view: BitableView | undefined): boolean {
  if (!view) return false;
  const fieldById = new Map(table.fields.map((field) => [field.id, field] as const));
  const nodeUsesClock = (node: BitableFilterNode): boolean =>
    isBitableFilterGroup(node) ? node.filters.some(nodeUsesClock) : filterRuleUsesClock(fieldById.get(node.fieldId), node);
  if ((view.filters ?? []).some(nodeUsesClock)) return true;
  return (view.fillRules ?? []).some((rule) => {
    if (rule.mode === "column" || rule.color === BITABLE_FILL_NO_COLOR) return false;
    return filterRuleUsesClock(fieldById.get(rule.condition.fieldId), rule.condition);
  });
}

function ruleExpectedIsEmpty(rule: BitableFilterRule): boolean {
  if (rule.value === undefined || rule.value === null) return true;
  if (typeof rule.value === "string") return rule.value === "";
  if (Array.isArray(rule.value)) return rule.value.length === 0;
  return false;
}

function textMatches(actual: string, expected: string, operator: BitableFilterOperator): boolean {
  const a = actual.toLowerCase();
  const b = expected.toLowerCase();
  if (operator === "startsWith") return a.startsWith(b);
  if (operator === "notStartsWith") return !a.startsWith(b);
  if (operator === "endsWith") return a.endsWith(b);
  if (operator === "notEndsWith") return !a.endsWith(b);
  if (operator === "contains") return a.includes(b);
  if (operator === "notContains") return !a.includes(b);
  return true;
}

function numericMatches(actual: unknown, expected: string, operator: BitableFilterOperator, zeroWhenEmpty = false): boolean {
  if (operator === "isEmpty") return actual == null || actual === "";
  if (operator === "isNotEmpty") return !(actual == null || actual === "");
  const a = actual === "" || actual == null ? (zeroWhenEmpty ? 0 : NaN) : Number(actual);
  const b = Number(expected);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (operator === "equalTo") return a === b;
  if (operator === "notEqualTo") return a !== b;
  if (operator === "greaterThan") return a > b;
  if (operator === "greaterThanOrEqualTo") return a >= b;
  if (operator === "lessThan") return a < b;
  if (operator === "lessThanOrEqualTo") return a <= b;
  return true;
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((value, index) => value === sb[index]);
}

function multiMatches(actualValues: string[], expectedValues: string[], operator: BitableFilterOperator): boolean {
  if (operator === "isEmptySelect") return actualValues.length === 0;
  if (operator === "isNotEmptySelect") return actualValues.length > 0;
  if (operator === "isExactly") return sameStringSet(actualValues, expectedValues);
  if (operator === "isNot") return !sameStringSet(actualValues, expectedValues);
  if (operator === "hasAnyOf") return expectedValues.some((value) => actualValues.includes(value));
  if (operator === "hasAllOf") return expectedValues.every((value) => actualValues.includes(value));
  if (operator === "hasNoneOf") return expectedValues.every((value) => !actualValues.includes(value));
  return true;
}

function dateMatches(actual: unknown, rule: BitableFilterRule, now: Date): boolean {
  const day = dateValueOf(actual);
  if (rule.operator === "isEmpty") return day === "";
  if (rule.operator === "isNotEmpty") return day !== "";
  if (!day) return false;
  const mode = rule.valueMode ?? "custom";
  let start = "";
  let end = "";
  if (mode === "custom") {
    start = dateValueOf(rule.value);
    end = start;
  } else {
    const range = dateFilterRangeFor(mode, now);
    if (range) { start = range.start; end = range.end; }
  }
  if (!start) return false;
  if (rule.operator === "equalTo") return day >= start && day <= end;
  if (rule.operator === "lessThan") return day < start;
  if (rule.operator === "greaterThan") return day > end;
  return true;
}

/** 单条规则求值（公开供条件着色等复用；值不完整时视为“未配置”，不拦截记录）。 */
export function evaluateFilter(field: BitableField, value: unknown, rule: BitableFilterRule, now: Date = new Date()): boolean {
  const operator = rule.operator;
  const kind = filterValueKindFor(field, operator);
  if (kind !== "none" && ruleExpectedIsEmpty(rule)) return true;
  if (operator === "isEmpty" || operator === "isEmptySelect") {
    if (field.type === "attachment" || field.type === "image") return bitableAttachments(value).length === 0;
    if (field.type === "multiSelect" || isRelationFieldType(field.type)) return relationRecordIds(value).length === 0;
    if (field.type === "boolean") return value == null;
    return value == null || value === "";
  }
  if (operator === "isNotEmpty" || operator === "isNotEmptySelect") return !evaluateFilter(field, value, { ...rule, operator: operator === "isNotEmptySelect" ? "isEmptySelect" : "isEmpty" }, now);
  if (field.type === "date" || isSystemTimeField(field.type)) return dateMatches(value, rule, now);
  // markdown / ai 同样是文本域：漏掉会落到末尾 return true ⇒ 筛选静默恒真（CORE-01，2026-10-27 审计）
  if (field.type === "text" || field.type === "link" || field.type === "ai" || field.type === "markdown") {
    return textMatches(bitableDisplayValue(field, value), String(rule.value ?? ""), operator);
  }
  if (isNumericFieldType(field.type)) return numericMatches(value, String(rule.value ?? ""), operator, field.type === "rating" || field.type === "progress");
  if (field.type === "boolean") {
    const actual = value === true || value === "true";
    const expected = rule.value === true || rule.value === "true";
    return operator === "equalTo" ? actual === expected : true;
  }
  if (field.type === "select") {
    const actual = Array.isArray(value) ? value[0] : value;
    const expected = String(rule.value ?? "");
    return operator === "is" ? actual === expected : operator === "isNot" ? actual !== expected : true;
  }
  if (field.type === "multiSelect" || isRelationFieldType(field.type)) {
    return multiMatches(relationRecordIds(value), Array.isArray(rule.value) ? rule.value : typeof rule.value === "string" ? rule.value.split(",").filter(Boolean) : [], operator);
  }
  if (field.type === "attachment" || field.type === "image") {
    return bitableAttachments(value).length > 0;
  }
  return true;
}

/** 递归求值一个筛选组（组内统一 AND/OR）。 */
export function evaluateFilterGroup(
  group: BitableFilterGroup,
  record: BitableRecord,
  fieldById: ReadonlyMap<string, BitableField>,
  now: Date = new Date(),
): boolean {
  if (group.filters.length === 0) return true;
  const check = (node: BitableFilterNode): boolean => evaluateFilterNode(node, record, fieldById, now);
  return group.operator === "or" ? group.filters.some(check) : group.filters.every(check);
}

export function evaluateFilterNode(
  node: BitableFilterNode,
  record: BitableRecord,
  fieldById: ReadonlyMap<string, BitableField>,
  now: Date = new Date(),
): boolean {
  if (isBitableFilterGroup(node)) return evaluateFilterGroup(node, record, fieldById, now);
  const field = fieldById.get(node.fieldId);
  if (!field) return true;
  return evaluateFilter(field, bitableFieldValue(record, field), node, now);
}

/** 筛选规则是否已经填完值；未填完的规则在筛选里视为“不拦截”，在填色里必须视为“未配置”。 */
export function isBitableFilterRuleConfigured(field: BitableField, rule: BitableFilterRule): boolean {
  if (!filterOperatorsFor(field).includes(rule.operator)) return false;
  return filterValueKindFor(field, rule.operator) === "none" || !ruleExpectedIsEmpty(rule);
}
