/**
 * 多维表正文（core/bitable）：排序 / 分组 / 字段顺序 / 视图应用（applyViewToRecords）。
 *
 * 由 core/bitableDoc.ts 按域拆出（261112 R1-S1，纯搬移：导出名/行为未变）。
 * 对外 API 仍由 ../bitableDoc.ts 门面 re-export；本文件只被同目录模块与门面 import。
 */
import type { BitableField, BitableFilterGroup, BitableGroupRule, BitableRecord, BitableRowHeight, BitableSortMode, BitableSortRule, BitableTable, BitableView } from "./types.js";
import { BITABLE_SORT_MODE_LABEL } from "./types.js";
import { evaluateFilterGroup } from "./filter.js";
import { bitableDisplayValue, bitableFieldValue, bitableRawDisplayValue, isNumericFieldType, isSystemTimeField } from "./values.js";

/** 该字段可选的排序方式：单选/多选多给选项语义序（T04）。 */
export function sortModesForField(field: BitableField): BitableSortMode[] {
  return field.type === "select" || field.type === "multiSelect" ? ["asc", "desc", "optionOrder", "optionReverse"] : ["asc", "desc"];
}

/** 排序方式显示文案：日期字段用日期语义（早→晚 / 晚→早），口径不变。 */
export function sortModeLabel(field: BitableField, mode: BitableSortMode): string {
  if ((field.type === "date" || isSystemTimeField(field.type)) && (mode === "asc" || mode === "desc")) return mode === "desc" ? "晚→早" : "早→晚";
  return BITABLE_SORT_MODE_LABEL[mode];
}

/** 排序方式 ↔ (mode, desc) 的**单一映射**（UI 只认「排序方式」一个下拉；T04 语义排序）。 */
export function sortModeOf(rule: BitableSortRule): BitableSortMode {
  if (rule.mode === "optionOrder") return rule.desc ? "optionReverse" : "optionOrder";
  return rule.desc ? "desc" : "asc";
}

/** 把「排序方式」写回规则（选项序 = optionOrder + desc 的正逆）。 */
export function applySortMode(rule: BitableSortRule, mode: BitableSortMode): BitableSortRule {
  if (mode === "optionOrder") return { ...rule, mode: "optionOrder", desc: false };
  if (mode === "optionReverse") return { ...rule, mode: "optionOrder", desc: true };
  return { fieldId: rule.fieldId, desc: mode === "desc" };
}

/** 换字段时丢掉该字段不支持的语义排序（只有单选/多选有「选项顺序」）。 */
export function changeSortField(fields: readonly BitableField[], rule: BitableSortRule, fieldId: string): BitableSortRule {
  const field = fields.find((item) => item.id === fieldId);
  const keep = rule.mode === "optionOrder" && (field?.type === "select" || field?.type === "multiSelect");
  return { fieldId, desc: rule.desc, ...(keep ? { mode: "optionOrder" as const } : {}) };
}

/** 行高档位 → 像素（唯一映射；桌面 estimate 与移动端 CSS 变量都取这里）。 */
export function bitableRowHeightPx(value: BitableRowHeight | undefined): number {
  if (typeof value === "number") return value;
  if (value === "medium") return 44;
  if (value === "high") return 64;
  if (value === "xhigh") return 96;
  return 36;
}

/** 排序比较（含 T04 语义排序）：选项语义序下，空值/指向已删选项的值**恒排最后**（与分组口径一致）。 */
function compareSortValues(field: BitableField, a: unknown, b: unknown, rule: BitableSortRule): number {
  if (rule.mode === "optionOrder" && (field.type === "select" || field.type === "multiSelect")) {
    const indexOf = (value: unknown): number => {
      const first = field.type === "multiSelect" ? (Array.isArray(value) ? value[0] : undefined) : value;
      const index = (field.options ?? []).findIndex((option) => option.id === first);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    const ia = indexOf(a);
    const ib = indexOf(b);
    if (ia === Number.MAX_SAFE_INTEGER || ib === Number.MAX_SAFE_INTEGER) {
      if (ia === ib) return 0;
      return ia === Number.MAX_SAFE_INTEGER ? 1 : -1;
    }
    const cmp = ia - ib;
    return rule.desc ? -cmp : cmp;
  }
  const cmp = compareValues(field, a, b);
  return rule.desc ? -cmp : cmp;
}

function compareValues(field: BitableField, a: unknown, b: unknown): number {
  const sa = bitableRawDisplayValue(field, a);
  const sb = bitableRawDisplayValue(field, b);
  if (isNumericFieldType(field.type)) {
    const na = typeof a === "number" ? a : Number(sa);
    const nb = typeof b === "number" ? b : Number(sb);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  }
  if (field.type === "date" || isSystemTimeField(field.type)) return sa < sb ? -1 : sa > sb ? 1 : 0;
  return sa.localeCompare(sb, "zh-Hans-CN");
}

/** 对记录套用视图的筛选 + 排序（返回新数组，不改原值）。 */
export function applyViewToRecords(table: BitableTable, view: BitableView | undefined, options?: { now?: Date }): BitableRecord[] {
  const fieldById = new Map(table.fields.map((f) => [f.id, f] as const));
  let records = [...table.records];
  const filters = view?.filters ?? [];
  if (filters.length > 0) {
    const group: BitableFilterGroup = { operator: view?.filterOperator ?? "and", filters };
    const now = options?.now ?? new Date();
    records = records.filter((record) => evaluateFilterGroup(group, record, fieldById, now));
  }
  const sorts = view?.sorts ?? [];
  if (sorts.length > 0) {
    records = records
      .map((record, index) => ({ record, index }))
      .sort((a, b) => {
        for (const rule of sorts) {
          const field = fieldById.get(rule.fieldId);
          if (!field) continue;
          const cmp = compareSortValues(field, bitableFieldValue(a.record, field), bitableFieldValue(b.record, field), rule);
          if (cmp !== 0) return cmp;
        }
        return a.index - b.index;
      })
      .map((x) => x.record);
  }
  return records;
}

/** 分组用的组键：单选取选项名、多选取选项名拼接、其余取展示值；空 = ""。 */
function groupKeyOf(field: BitableField, value: unknown): string {
  // 分组 key 必须用**原始值**：field.format 只影响展示，若用格式化后的展示值当 key，
  // 「6月9日」这种格式会把不同年份的同月同日合并成一组（显示格式改变分组 = 数据语义被改）。
  if (field.type === "date" || field.type === "number" || isSystemTimeField(field.type)) {
    return bitableRawDisplayValue(field, value);
  }
  if (field.type === "select") {
    const opt = (field.options ?? []).find((o) => o.id === value);
    return opt ? opt.name : "";
  }
  if (field.type === "multiSelect") {
    const ids = Array.isArray(value) ? value : [];
    return ids
      .map((id) => (field.options ?? []).find((o) => o.id === id)?.name)
      .filter((name): name is string => !!name)
      .join("、");
  }
  return bitableDisplayValue(field, value).trim();
}

/**
 * 按分组规则把记录分组（组内保持传入顺序，组间按组值排序；空值组排最后）。
 * 无规则/字段不存在时返回单个"未分组"组（key/label 为空），调用方可直接拍平。
 */
export function groupRecords(
  table: BitableTable,
  records: BitableRecord[],
  rule: BitableGroupRule | undefined,
): Array<{ key: string; label: string; records: BitableRecord[] }> {
  if (!rule) return [{ key: "", label: "", records }];
  const field = table.fields.find((f) => f.id === rule.fieldId);
  if (!field) return [{ key: "", label: "", records }];
  const groups = new Map<string, BitableRecord[]>();
  for (const record of records) {
    const key = groupKeyOf(field, bitableFieldValue(record, field));
    const list = groups.get(key);
    if (list) list.push(record);
    else groups.set(key, [record]);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    if ((a === "") !== (b === "")) return a === "" ? 1 : -1; // 空值组排最后
    const cmp = compareValues(field, bitableFieldValue(groups.get(a)![0], field), bitableFieldValue(groups.get(b)![0], field));
    return rule.desc ? -cmp : cmp;
  });
  return keys.map((key) => ({ key, label: key || "(空)", records: groups.get(key)! }));
}

/** 某列出现次数 > 1 的展示值集合（忽略空值）—— 供「高亮重复值」判定。 */
export function duplicateValues(field: BitableField, records: BitableRecord[]): Set<string> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = bitableRawDisplayValue(field, bitableFieldValue(record, field)).trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value));
}
