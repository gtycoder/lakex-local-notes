/**
 * 多维表**业务写入纯函数**（AR02）。
 *
 * 把「一次用户操作要改哪些字段、哪些视图配置」从编辑器组件收敛到 core 单一来源：
 * 组件只决定「什么时候调用、调用谁」，不再自己遍历 tables/views 做清理。
 *
 * 约束（见 docs/BITABLE-OPTIMIZATION-HANDOFF.md §17.7 AR02）：
 * - 纯函数，无 DOM / React / node: 依赖；
 * - 入参是当前 doc + 明确目标（tableId / recordId / fieldId）与值，返回新 doc；
 * - **没有实际变化时返回原引用**，避免空写入消耗写事件/撤销步数；
 * - 不改正文序列化格式；关联字段仍只存目标记录 id，写值统一走 applyRelationMirror。
 */
import {
  applyRelationMirror,
  bitableAttachments,
  createBitableRecord,
  defaultRecordValues,
  isAttachmentLikeField,
  isBitableFilterGroup,
  isRelationFieldType,
  isSystemTimeField,
  newBitableId,
  relationRecordIds,
  stripFillRulesForField,
  unpairRelationFields,
  type BitableAttachment,
  type BitableDoc,
  type BitableField,
  type BitableFilterNode,
  type BitableRecord,
  type BitableTable,
  type BitableView,
} from "./bitableDoc.js";

const nowIso = (): string => new Date().toISOString();

/** 从 id 数组里摘掉 fieldId；未命中返回原引用。 */
function stripId(list: readonly string[] | undefined, fieldId: string): string[] | undefined {
  if (!list || !list.includes(fieldId)) return list as string[] | undefined;
  return list.filter((id) => id !== fieldId);
}

/** 从 fieldId → value 的映射里摘掉一个键；未命中返回原引用。 */
function stripKey<T>(map: Record<string, T> | undefined, fieldId: string): Record<string, T> | undefined {
  if (!map || map[fieldId] === undefined) return map;
  const next = { ...map };
  delete next[fieldId];
  return next;
}

/** 递归清掉筛选树里指向该字段的规则；变空的分组一并移除。返回原引用表示无变化。 */
function stripFilterNodes(nodes: readonly BitableFilterNode[], fieldId: string): BitableFilterNode[] {
  let changed = false;
  const out: BitableFilterNode[] = [];
  for (const node of nodes) {
    if (isBitableFilterGroup(node)) {
      const children = stripFilterNodes(node.filters, fieldId);
      if (children.length === 0) { changed = true; continue; }
      if (children !== node.filters) { changed = true; out.push({ ...node, filters: children }); }
      else out.push(node);
      continue;
    }
    if (node.fieldId === fieldId) { changed = true; continue; }
    out.push(node);
  }
  return changed ? out : (nodes as BitableFilterNode[]);
}

/**
 * 删除字段时，从**单个视图**里清掉所有指向它的配置（单一来源）。
 *
 * 覆盖：隐藏列 / 列序 / 表单题目 / 重复值高亮 / 条件填色 / 看板卡片 / 画册卡片 /
 * 筛选树（递归，空分组移除）/ 排序 / 分组 / 列统计 / 列文字颜色 / 表单逐字段描述，
 * 以及看板分组字段、画册封面、日历四个字段。返回原引用表示该视图未引用此字段。
 */
export function stripFieldFromView(view: BitableView, fieldId: string): BitableView {
  let changed = false;
  const next: BitableView = { ...view };
  const listKeys = ["hiddenFieldIds", "fieldOrder", "formFieldIds", "highlightDuplicateFieldIds", "kanbanFieldIds", "galleryFieldIds"] as const;
  for (const key of listKeys) {
    const stripped = stripId(view[key], fieldId);
    if (stripped !== view[key]) { next[key] = stripped; changed = true; }
  }

  if (view.fillRules?.length) {
    const stripped = stripFillRulesForField(view.fillRules, fieldId);
    if (stripped.length !== view.fillRules.length) {
      if (stripped.length > 0) next.fillRules = stripped; else delete next.fillRules;
      changed = true;
    }
  }
  if (view.filters?.length) {
    const stripped = stripFilterNodes(view.filters, fieldId);
    if (stripped !== view.filters) {
      if (stripped.length > 0) next.filters = stripped; else delete next.filters;
      changed = true;
    }
  }
  if (view.sorts?.some((rule) => rule.fieldId === fieldId)) {
    next.sorts = view.sorts.filter((rule) => rule.fieldId !== fieldId);
    changed = true;
  }
  if (view.groups?.some((rule) => rule.fieldId === fieldId)) {
    next.groups = view.groups.filter((rule) => rule.fieldId !== fieldId);
    changed = true;
  }
  for (const key of ["columnStats", "columnTextColors", "formDescriptions"] as const) {
    const stripped = stripKey(view[key], fieldId);
    if (stripped !== view[key]) {
      if (stripped && Object.keys(stripped).length > 0) next[key] = stripped; else delete next[key];
      changed = true;
    }
  }
  if (view.kanbanGroupFieldId === fieldId) { delete next.kanbanGroupFieldId; changed = true; }
  if (view.galleryCoverFieldId === fieldId) { delete next.galleryCoverFieldId; changed = true; }
  if (view.calendarStartFieldId === fieldId) { delete next.calendarStartFieldId; changed = true; }
  if (view.calendarEndFieldId === fieldId) { delete next.calendarEndFieldId; changed = true; }
  if (view.calendarTitleFieldId === fieldId) { delete next.calendarTitleFieldId; changed = true; }
  if (view.calendarColorFieldId === fieldId) { delete next.calendarColorFieldId; changed = true; }

  return changed ? next : view;
}

/**
 * 删除一个字段（**一次覆盖全部视图引用**）：
 * 先解除双向配对（对侧降级为单向、两侧数据都保留），再移除字段，并把所有视图中指向它的配置清干净。
 * 表不存在 / 只剩一个字段 / 字段不存在 → 返回原 doc（组件因此不会产生空写入）。
 */
export function deleteBitableField(doc: BitableDoc, tableId: string, fieldId: string): BitableDoc {
  const table = doc.tables.find((t) => t.id === tableId);
  if (!table || table.fields.length <= 1 || !table.fields.some((f) => f.id === fieldId)) return doc;
  const unpaired = unpairRelationFields(doc.tables, tableId, fieldId);
  const tables = unpaired.map((t) => (t.id !== tableId ? t : {
    ...t,
    fields: t.fields.filter((f) => f.id !== fieldId),
    views: t.views.map((view) => stripFieldFromView(view, fieldId)),
  }));
  return { ...doc, tables };
}

/** 写一个单元格。关联字段走**双向镜像唯一写入口**；值与现状相同 → 返回原 doc。 */
export function setBitableCellValue(doc: BitableDoc, tableId: string, recordId: string, fieldId: string, value: unknown): BitableDoc {
  const table = doc.tables.find((t) => t.id === tableId);
  const field = table?.fields.find((f) => f.id === fieldId);
  const record = table?.records.find((r) => r.id === recordId);
  if (!table || !field || !record) return doc;
  if (isRelationFieldType(field.type)) {
    const next = relationRecordIds(value);
    const prev = relationRecordIds(record.values[fieldId]);
    if (prev.length === next.length && prev.every((id, index) => id === next[index])) return doc;
    return { ...doc, tables: applyRelationMirror(doc.tables, tableId, fieldId, recordId, next) };
  }
  if (Object.is(record.values[fieldId], value)) return doc;
  return {
    ...doc,
    tables: doc.tables.map((t) => (t.id !== tableId ? t : {
      ...t,
      records: t.records.map((r) => (r.id !== recordId ? r : { ...r, values: { ...r.values, [fieldId]: value }, updatedAt: nowIso() })),
    })),
  };
}

/** 一次写多个字段值（日历拖拽平移等多值写入；不经过关联镜像）。值与现状相同 → 返回原 doc。 */
export function setBitableRecordValues(doc: BitableDoc, tableId: string, recordId: string, patch: Record<string, unknown>): BitableDoc {
  const table = doc.tables.find((t) => t.id === tableId);
  const record = table?.records.find((r) => r.id === recordId);
  if (!table || !record) return doc;
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.every((key) => Object.is(record.values[key], patch[key]))) return doc;
  return {
    ...doc,
    tables: doc.tables.map((t) => (t.id !== tableId ? t : {
      ...t,
      records: t.records.map((r) => (r.id !== recordId ? r : { ...r, values: { ...r.values, ...patch }, updatedAt: nowIso() })),
    })),
  };
}

/** 追加附件条目（上传成功后回填）。空条目 / 目标表记录字段已不存在 → 返回原 doc。 */
export function appendBitableAttachments(doc: BitableDoc, tableId: string, recordId: string, fieldId: string, entries: readonly BitableAttachment[]): BitableDoc {
  if (entries.length === 0) return doc;
  const table = doc.tables.find((t) => t.id === tableId);
  const record = table?.records.find((r) => r.id === recordId);
  const field = table?.fields.find((f) => f.id === fieldId);
  if (!table || !record || !field) return doc;
  const current = bitableAttachments(record.values[fieldId]);
  return {
    ...doc,
    tables: doc.tables.map((t) => (t.id !== tableId ? t : {
      ...t,
      records: t.records.map((r) => (r.id !== recordId ? r : { ...r, values: { ...r.values, [fieldId]: [...current, ...entries] }, updatedAt: nowIso() })),
    })),
  };
}

export interface BitableRecordAdd {
  /** 固定 record（调用方先建好以便马上拿到 id）；缺省在函数内新建。 */
  record?: BitableRecord;
  /** 预置字段（如「加进本组」的分组字段值）。 */
  fieldId?: string;
  value?: unknown;
}

/**
 * 新增一条记录：按表默认值填充，允许预置一个字段值（「加进本组」）。
 * 表不存在 → 原 doc + 新 record id（不改正文）。
 */
export function addBitableRecord(doc: BitableDoc, tableId: string, options: BitableRecordAdd = {}): { doc: BitableDoc; recordId: string } {
  const record = options.record ?? createBitableRecord();
  const table = doc.tables.find((t) => t.id === tableId);
  if (!table) return { doc, recordId: record.id };
  const values = defaultRecordValues(table, record.createdAt);
  if (options.fieldId && options.value !== undefined && options.value !== "") {
    // 系统时间字段的值来自 createdAt/updatedAt，预置写进 values 无意义（也不该假装写成功）。
    const preset = table.fields.find((item) => item.id === options.fieldId);
    if (preset && !isSystemTimeField(preset.type)) values[options.fieldId] = options.value;
  }
  return {
    doc: { ...doc, tables: doc.tables.map((t) => (t.id !== tableId ? t : { ...t, records: [...t.records, { ...record, values }] })) },
    recordId: record.id,
  };
}

/**
 * 用**表单草稿值**新增记录（AR-F7 续）：先落记录，再对每个关联字段走双向镜像唯一写入口，
 * 因此表单里选的双向关联会同步到目标表反向字段（原实现在 UI 内直接 push records，会漏镜像）。
 */
export function addBitableRecordWithValues(tables: readonly BitableTable[], tableId: string, values: Record<string, unknown>): { tables: BitableTable[]; recordId: string } {
  const source = tables.find((t) => t.id === tableId);
  const record = createBitableRecord();
  if (!source) return { tables: [...tables], recordId: record.id };
  // 关联字段先留空：applyRelationMirror 按「记录当前值 → 新值」的差集镜像，
  // 若这里先写入目标 id，差集为空、对侧就永远不更新。
  const recordValues: Record<string, unknown> = { ...values };
  for (const field of source.fields) if (isRelationFieldType(field.type)) delete recordValues[field.id];
  let next: BitableTable[] = tables.map((t) => (t.id !== tableId ? t : { ...t, records: [...t.records, { ...record, values: recordValues }] }));
  for (const field of source.fields) {
    if (!isRelationFieldType(field.type)) continue;
    const ids = relationRecordIds(values[field.id]);
    if (ids.length === 0) continue;
    next = applyRelationMirror(next, tableId, field.id, record.id, ids);
  }
  return { tables: next, recordId: record.id };
}

/**
 * 复制字段（AR-F7 续）：**不继承双向配对**——复制出来的关联字段回落为单向，
 * 否则两个来源字段会共用同一条反向字段。字段/选项 id 重新生成，原字段不动。
 */
export function duplicateBitableField(tables: readonly BitableTable[], tableId: string, fieldId: string): BitableTable[] {
  const table = tables.find((t) => t.id === tableId);
  if (!table || !table.fields.some((item) => item.id === fieldId)) return tables as BitableTable[];
  return tables.map((t) => {
    if (t.id !== tableId) return t;
    const index = t.fields.findIndex((item) => item.id === fieldId);
    const source = t.fields[index];
    const field: BitableField = { ...source, id: newBitableId("fld"), name: source.name + " 副本", options: (source.options ?? []).map((o) => ({ ...o, id: newBitableId("opt") })) };
    if (isRelationFieldType(source.type)) {
      field.type = "relationOneWay";
      field.relation = source.relation
        ? { tableId: source.relation.tableId, allowMultiple: source.relation.allowMultiple, viewId: source.relation.viewId }
        : undefined;
    }
    const fields = [...t.fields];
    fields.splice(index + 1, 0, field);
    return { ...t, fields };
  });
}

/**
 * 字段**类型变更**后清掉不再成立的视图引用（AR-F7 续；只清配置、不迁移记录值）：
 * 看板分组字段要求单选、画册封面要求附件类、日历开始/结束要求日期、日历颜色要求单选。
 * 返回原引用表示无变化。
 */
export function stripViewRefsForFieldType(view: BitableView, field: BitableField): BitableView {
  let changed = false;
  const next: BitableView = { ...view };
  if (next.kanbanGroupFieldId === field.id && field.type !== "select") { delete next.kanbanGroupFieldId; changed = true; }
  if (next.galleryCoverFieldId === field.id && !isAttachmentLikeField(field.type)) { delete next.galleryCoverFieldId; changed = true; }
  if (next.calendarStartFieldId === field.id && field.type !== "date") { delete next.calendarStartFieldId; changed = true; }
  if (next.calendarEndFieldId === field.id && field.type !== "date") { delete next.calendarEndFieldId; changed = true; }
  if (next.calendarColorFieldId === field.id && field.type !== "select") { delete next.calendarColorFieldId; changed = true; }
  return changed ? next : view;
}
