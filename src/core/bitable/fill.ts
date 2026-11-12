/**
 * 多维表正文（core/bitable）：条件填色：规则投影与背景色（cell/row/rowSide/column 语义与 alpha 混色不得改，AGENTS §3#19）。
 *
 * 由 core/bitableDoc.ts 按域拆出（261112 R1-S1，纯搬移：导出名/行为未变）。
 * 对外 API 仍由 ../bitableDoc.ts 门面 re-export；本文件只被同目录模块与门面 import。
 */
import { DEFAULT_LIGHT_COLORS, isHexColor } from "../colorPalette.js";
import type { BitableField, BitableFillMatch, BitableFillMode, BitableFillProjection, BitableFillRule, BitableRecord, BitableTable, BitableView } from "./types.js";
import { BITABLE_FILL_MAX_RULES, BITABLE_FILL_NO_COLOR, newBitableId } from "./types.js";
import { createBitableFilterRule, evaluateFilter, filterOperatorsFor, isBitableFilterGroup, isBitableFilterRuleConfigured, normalizeFilterNode } from "./filter.js";
import { bitableFieldValue } from "./values.js";

function normalizeFillRule(raw: unknown): BitableFillRule | null {
  if (!raw || typeof raw !== "object") return null;
  const rule = raw as { id?: unknown; mode?: unknown; color?: unknown; fieldId?: unknown; condition?: unknown };
  if (typeof rule.id !== "string" || !rule.id) return null;
  if (rule.mode !== "cell" && rule.mode !== "row" && rule.mode !== "rowSide" && rule.mode !== "column") return null;
  if (rule.color !== BITABLE_FILL_NO_COLOR && !isHexColor(rule.color)) return null;
  const color = rule.color;
  if (rule.mode === "column") {
    if (typeof rule.fieldId !== "string" || !rule.fieldId) return null;
    return { id: rule.id, mode: "column", color, fieldId: rule.fieldId };
  }
  const condition = normalizeFilterNode(rule.condition, 1);
  if (!condition || isBitableFilterGroup(condition)) return null;
  return { id: rule.id, mode: rule.mode, color, condition };
}

/** 内部共享（跨模块用，**不**由门面 re-export）。 */
export function normalizeFillRules(raw: unknown): BitableFillRule[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map(normalizeFillRule)
    .filter((rule): rule is BitableFillRule => !!rule)
    .slice(0, BITABLE_FILL_MAX_RULES);
}

function fillCellKey(recordId: string, fieldId: string): string {
  return recordId + ":" + fieldId;
}

/**
 * 对齐钉钉当前实现：
 * - 每种模式在规则数组中取首个命中项；column 取首个指向该列的规则；
 * - cell / row / column 三个候选再按原始下标倒序交给背景层混色；
 * - rowSide 走独立通道。
 */
export function buildBitableFillProjection(
  table: BitableTable,
  view: BitableView | undefined,
  records: readonly BitableRecord[],
  options?: { now?: Date },
): BitableFillProjection {
  const rules = view?.fillRules ?? [];
  const fieldById = new Map(table.fields.map((field) => [field.id, field] as const));
  const now = options?.now ?? new Date();
  const projection: BitableFillProjection = {
    cell: new Map(),
    row: new Map(),
    rowSide: new Map(),
    column: new Map(),
  };

  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (rule.color === BITABLE_FILL_NO_COLOR) continue;
    if (rule.mode !== "column" || projection.column.has(rule.fieldId)) continue;
    projection.column.set(rule.fieldId, { ruleIndex: index, color: rule.color });
  }

  // CORE-06：配置判定（操作符/值是否填完）与字段查找与记录无关，先提出来算一次。
  // 此前是 records × rules 双层循环里每条记录每条规则都重算一次（20k × 40 规则 = 80 万次）。
  // 保留原始下标 ⇒ 候选顺序与混色结果不变。
  const activeRules: Array<{ index: number; rule: Exclude<BitableFillRule, { mode: "column" }>; field: BitableField }> = [];
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (rule.color === BITABLE_FILL_NO_COLOR || rule.mode === "column") continue;
    const field = fieldById.get(rule.condition.fieldId);
    if (!field || !isBitableFilterRuleConfigured(field, rule.condition)) continue;
    activeRules.push({ index, rule, field });
  }

  for (const record of records) {
    let rowMatched = false;
    let sideMatched = false;
    for (const { index, rule, field } of activeRules) {
      // 已命中整行/色条后，后续同模式规则本来就会被丢弃 ⇒ 直接跳过求值（纯浪费消除，结果不变）。
      if (rule.mode === "row" && rowMatched) continue;
      if (rule.mode === "rowSide" && sideMatched) continue;
      // 同一格只取首个命中：已着色的 cell key 无需再对后面的规则求值。
      const cellKey = rule.mode === "cell" ? fillCellKey(record.id, rule.condition.fieldId) : "";
      if (cellKey && projection.cell.has(cellKey)) continue;
      if (!evaluateFilter(field, bitableFieldValue(record, field), rule.condition, now)) continue;

      if (rule.mode === "row") {
        projection.row.set(record.id, { ruleIndex: index, color: rule.color });
        rowMatched = true;
      } else if (rule.mode === "rowSide") {
        projection.rowSide.set(record.id, { ruleIndex: index, color: rule.color });
        sideMatched = true;
      } else {
        projection.cell.set(cellKey, { ruleIndex: index, color: rule.color });
      }
    }
  }

  return projection;
}

/**
 * 返回 CSS background-image 的层序（顶层在前）。
 * 钉钉的 mix_colors 先放后置规则为底色，再把前置规则叠上去；CSS 的首层正好是最上层，
 * 因此这里把候选按 ruleIndex 升序返回，视觉结果与钉钉一致。
 */
export function bitableFillBackgroundTokens(
  projection: BitableFillProjection,
  recordId: string,
  fieldId: string,
): string[] {
  const matches = [
    projection.cell.get(fillCellKey(recordId, fieldId)),
    projection.row.get(recordId),
    projection.column.get(fieldId),
  ].filter((match): match is BitableFillMatch => !!match);
  if (matches.length === 0) return [];
  matches.sort((a, b) => b.ruleIndex - a.ruleIndex);
  return matches.reverse().map((match) => match.color);
}

export function stripFillRulesForField(rules: readonly BitableFillRule[] | undefined, fieldId: string): BitableFillRule[] {
  if (!rules?.length) return [];
  return rules.filter((rule) => (rule.mode === "column" ? rule.fieldId !== fieldId : rule.condition.fieldId !== fieldId));
}

export function createBitableFillRule(
  mode: BitableFillMode,
  fields: readonly BitableField[],
  color = DEFAULT_LIGHT_COLORS[0],
  preferredFieldId?: string,
): BitableFillRule | null {
  const id = newBitableId("fil");
  if (mode === "column") {
    const field = fields.find((item) => item.id === preferredFieldId) ?? fields[0];
    return field ? { id, mode, color, fieldId: field.id } : null;
  }
  const filterFields = fields.filter((field) => filterOperatorsFor(field).length > 0);
  const field = filterFields.find((item) => item.id === preferredFieldId) ?? filterFields[0];
  return field ? { id, mode, color, condition: createBitableFilterRule(field) } : null;
}
