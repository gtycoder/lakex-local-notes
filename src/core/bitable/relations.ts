/**
 * 多维表正文（core/bitable）：双向关联：配对字段、镜像写入、关联选择器数据源。
 *
 * 由 core/bitableDoc.ts 按域拆出（261112 R1-S1，纯搬移：导出名/行为未变）。
 * 对外 API 仍由 ../bitableDoc.ts 门面 re-export；本文件只被同目录模块与门面 import。
 */
import type { BitableDisplayContext, BitableField, BitableRecord, BitableRelation, BitableTable, BitableView } from "./types.js";
import { isRelationFieldType, newBitableId, nowIso } from "./types.js";
import { orderedAllTableFields, orderedTableFields, relationRecordIds, relationTargetTable, relationTargetView } from "./values.js";
import { applyViewToRecords } from "./sortGroup.js";

/**
 * 关联选择器的**草稿**切换（纯函数；UI 只改本机草稿，点「确认」才写正文）：
 * - `allowMultiple`：该目标记录来回切换（增删）；
 * - 单条模式：选中即替换，再点当前同一条即取消。
 */
export function toggleRelationDraft(draft: readonly string[], recordId: string, allowMultiple: boolean): string[] {
  const next = [...draft];
  if (!allowMultiple) return next.length === 1 && next[0] === recordId ? [] : [recordId];
  const index = next.indexOf(recordId);
  if (index >= 0) next.splice(index, 1);
  else next.push(recordId);
  return next;
}

/** 目标表的默认视图：优先第一个表格视图，其次第一个视图；没有视图则为 undefined。 */
export function defaultGridView(table: BitableTable): BitableView | undefined {
  return table.views.find((view) => view.type === "grid") ?? table.views[0];
}

/**
 * 关联选择器展示的字段：
 * - 绑定视图：像正式表格视图一样应用 fieldOrder + hiddenFieldIds；
 * - 未绑定视图：应用目标表默认视图的 fieldOrder，但不隐藏字段、不过滤记录。
 * 每次由当前 `ctx` 重新计算，因此后加字段会在下次打开时动态进入候选列。
 */
export function relationPickerFields(ctx: BitableDisplayContext | undefined, field: BitableField): BitableField[] {
  const target = relationTargetTable(ctx, field);
  if (!target) return [];
  const boundView = relationTargetView(ctx, field);
  if (boundView) return orderedTableFields(target, boundView);
  return orderedAllTableFields(target, defaultGridView(target));
}

/**
 * **关联选择器能选的记录**：绑定了数据范围视图就走该视图的筛选 + 排序（`applyViewToRecords`），
 * 否则就是目标表全部记录。只影响「能选什么」，不影响已有值的展示解析。
 */
export function relationCandidateRecords(ctx: BitableDisplayContext | undefined, field: BitableField): BitableRecord[] {
  const target = relationTargetTable(ctx, field);
  if (!target) return [];
  const view = relationTargetView(ctx, field);
  return view ? applyViewToRecords(target, view) : [...target.records];
}

/** 反向字段默认名：**来源表名 + 来源字段名**（专项 §2.4；创建后允许像普通字段一样重命名）。 */
export function relationReverseFieldName(sourceTable: BitableTable, field: BitableField): string {
  return sourceTable.name + field.name;
}

/** 把字段降级为单向：保留 tableId / allowMultiple，清掉 pairedFieldId。 */
function asOneWay(field: BitableField): BitableField {
  if (!isRelationFieldType(field.type) || !field.relation) return field;
  const relation: BitableRelation = { ...field.relation };
  delete relation.pairedFieldId;
  return { ...field, type: "relationOneWay", relation };
}

/**
 * **建立双向关联**（T02B.3）：在目标表创建反向字段、两侧写 `pairedFieldId`、类型改为 `relationTwoWay`，
 * 并把来源表**已有值**镜像到反向侧（所以「A 关联 B 后，B 反向出现 A」对历史数据也成立）。
 * 返回新的 tables；来源字段非关联 / 目标表缺失 / 已配对时原样返回（幂等）。
 */
export function createRelationPair(tables: readonly BitableTable[], sourceTableId: string, fieldId: string): BitableTable[] {
  const source = tables.find((table) => table.id === sourceTableId);
  const field = source?.fields.find((f) => f.id === fieldId);
  if (!source || !field || field.type !== "relationTwoWay") return [...tables];
  const target = relationTargetTable({ tables }, field);
  if (!target) return [...tables];
  const pairedId = field.relation?.pairedFieldId;
  if (typeof pairedId === "string" && target.fields.some((f) => f.id === pairedId)) return [...tables];
  const reverse: BitableField = {
    id: newBitableId("fld"),
    name: relationReverseFieldName(source, field),
    type: "relationTwoWay",
    relation: { tableId: sourceTableId, allowMultiple: field.relation?.allowMultiple !== false, pairedFieldId: field.id },
  };
  return tables.map((table) => {
    if (table.id === sourceTableId) {
      return { ...table, fields: table.fields.map((f) => (f.id === fieldId ? { ...f, type: "relationTwoWay", relation: { ...f.relation, pairedFieldId: reverse.id } } : f)) };
    }
    if (table.id !== target.id) return table;
    // 反向侧：凡被来源记录引用过的目标记录，都补上来源记录 id（历史值一次性对齐）
    const records = table.records.map((record) => {
      const refs = source.records.filter((r) => relationRecordIds(r.values[fieldId]).includes(record.id)).map((r) => r.id);
      if (refs.length === 0) return record;
      const current = relationRecordIds(record.values[reverse.id]);
      const merged = [...current];
      for (const id of refs) if (!merged.includes(id)) merged.push(id);
      if (merged.length === current.length) return record;
      return { ...record, values: { ...record.values, [reverse.id]: merged } };
    });
    return { ...table, fields: [...table.fields, reverse], records };
  });
}

/**
 * **解除双向配对**（删除一侧字段前 / 把「双向」改回「单向」）：清掉对侧的 `pairedFieldId` 并降级为单向，
 * **两侧数据都原样保留**（专项 §2.4：删一侧保留另一侧字段和数据）。
 */
export function unpairRelationFields(tables: readonly BitableTable[], tableId: string, fieldId: string): BitableTable[] {
  const table = tables.find((t) => t.id === tableId);
  const field = table?.fields.find((f) => f.id === fieldId);
  if (!field) return [...tables];
  const reverse = tables
    .flatMap((t) => t.fields)
    .find((candidate) => candidate.id !== fieldId && candidate.relation?.pairedFieldId === fieldId);
  const pairedId = field.relation?.pairedFieldId ?? reverse?.id;
  return tables.map((t) => {
    let next = t;
    if (t.id === tableId && isRelationFieldType(field.type)) next = { ...next, fields: next.fields.map((f) => (f.id === fieldId ? asOneWay(f) : f)) };
    if (typeof pairedId === "string") next = { ...next, fields: next.fields.map((f) => (f.id === pairedId ? asOneWay(f) : f)) };
    return next;
  });
}

/**
 * **双向关联的唯一写入口**：把 `recordId` 的关联值设为 `nextIds`，并把增删差集镜像到对侧反向字段
 * （新增目标 → 对侧记录加上来源 id；移除目标 → 对侧记录去掉来源 id）。只改 id 集合、不复制数据。
 * 非双向（无 pairedFieldId）时等价于普通写值。
 */
export function applyRelationMirror(tables: readonly BitableTable[], tableId: string, fieldId: string, recordId: string, nextIds: readonly string[]): BitableTable[] {
  const source = tables.find((t) => t.id === tableId);
  const field = source?.fields.find((f) => f.id === fieldId);
  if (!source || !field) return [...tables];
  const prev = relationRecordIds(source.records.find((r) => r.id === recordId)?.values[fieldId]);
  const next = relationRecordIds(nextIds);
  const pairedId = field.type === "relationTwoWay" ? field.relation?.pairedFieldId : undefined;
  const pairedTable = typeof pairedId === "string" ? tables.find((t) => t.fields.some((f) => f.id === pairedId)) : undefined;
  const added = next.filter((id) => !prev.includes(id));
  const removed = prev.filter((id) => !next.includes(id));
  return tables.map((t) => {
    if (t.id === tableId) {
      return { ...t, records: t.records.map((r) => (r.id === recordId ? { ...r, values: { ...r.values, [fieldId]: next }, updatedAt: nowIso() } : r)) };
    }
    if (field.type !== "relationTwoWay" || !pairedTable || t.id !== pairedTable.id || typeof pairedId !== "string") return t;
    return {
      ...t,
      records: t.records.map((record) => {
        const shouldAdd = added.includes(record.id);
        const shouldRemove = removed.includes(record.id);
        if (!shouldAdd && !shouldRemove) return record;
        const current = relationRecordIds(record.values[pairedId]);
        const merged = shouldAdd ? (current.includes(recordId) ? current : [...current, recordId]) : current.filter((id) => id !== recordId);
        if (merged.length === current.length && merged.every((id, index) => id === current[index])) return record;
        return { ...record, values: { ...record.values, [pairedId]: merged }, updatedAt: nowIso() };
      }),
    };
  });
}
