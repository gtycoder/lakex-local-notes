/**
 * 多维表**业务写入纯函数**（AR02）。
 *
 * 把「一次用户操作要改哪些字段、哪些视图配置」从编辑器组件收敛到 core 单一来源：
 * 组件只决定「什么时候调用、调用谁」，不再自己遍历 tables/views 做清理。
 *
 * 约束：
 * - 纯函数，无 DOM / React / node: 依赖；
 * - 入参是当前 doc + 明确目标（tableId / recordId / fieldId）与值，返回新 doc；
 * - **没有实际变化时返回原引用**，避免空写入消耗写事件/撤销步数；
 * - 不改正文序列化格式；关联字段仍只存目标记录 id，写值统一走 applyRelationMirror。
 */
import {
  applyRelationMirror,
  bitableAttachments,
  createBitableField,
  createBitableRecord,
  isKnownFieldType,
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
  type BitableFieldOption,
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
 * 字段重命名联动（261003，单一来源）：把同表 AI 字段命令里的 `{{旧名}}` 改写成 `{{新名}}`，
 * 保证「插入字段」插入的变量在重命名后仍然可用。无变化返回原字段引用。
 * （字段**删除**不做改写：命令里的变量保留，编辑器提示「未找到字段」、生成时按「（空）」处理，不静默改写用户命令。）
 */
export function renameAiFieldToken(field: BitableField, oldName: string, newName: string): BitableField {
  const ai = field.ai;
  if (!ai || !ai.prompt.includes("{{" + oldName + "}}")) return field;
  return { ...field, ai: { ...ai, prompt: ai.prompt.split("{{" + oldName + "}}").join("{{" + newName + "}}") } };
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
    // AI 命令里的 `{{字段名}}` 变量保留（见 renameAiFieldToken 注释）：删除后编辑器提示、生成按空处理。
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

// ---- 数据表级（261030 用户点单：重命名 / 删除 / 复制；移动端抽屉与桌面左侧列表共用） ----

/** 重命名数据表（空名 / 无变化返回原引用，避免空写入）。 */
export function renameBitableTable(doc: BitableDoc, tableId: string, name: string): BitableDoc {
  const table = doc.tables.find((t) => t.id === tableId);
  if (!table) return doc;
  const next = name.trim();
  if (!next || next === table.name) return doc;
  return { ...doc, tables: doc.tables.map((t) => (t.id === tableId ? { ...t, name: next } : t)) };
}

/**
 * 删除数据表：**至少保留一张**（返回原引用 = 拒绝）。活动表被删时回落到第一张。
 * 与桌面既有行为一致：只摘表本身，不追改其它表里指向它的关联字段（展示层会标「关联已失效」）。
 */
export function deleteBitableTable(doc: BitableDoc, tableId: string): BitableDoc {
  if (doc.tables.length <= 1) return doc;
  if (!doc.tables.some((t) => t.id === tableId)) return doc;
  const tables = doc.tables.filter((t) => t.id !== tableId);
  const activeTableId = doc.activeTableId === tableId ? tables[0].id : doc.activeTableId;
  return { ...doc, tables, activeTableId };
}

/** 视图配置里的「字段 id 引用」换 id（复制表用；未知 id 原样保留）。 */
function remapViewFieldIds(view: BitableView, map: Map<string, string>): BitableView {
  const one = (id: string | undefined): string | undefined => (id ? map.get(id) ?? id : id);
  const list = (ids: string[] | undefined): string[] | undefined => (ids ? ids.map((id) => map.get(id) ?? id) : ids);
  const keys = <T>(obj: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!obj) return obj;
    const out: Record<string, T> = {};
    for (const [key, value] of Object.entries(obj)) out[map.get(key) ?? key] = value;
    return out;
  };
  const filters = (nodes: BitableFilterNode[] | undefined): BitableFilterNode[] | undefined => {
    if (!nodes) return nodes;
    return nodes.map((node) => (isBitableFilterGroup(node)
      ? { ...node, filters: filters(node.filters) ?? [] }
      : { ...node, fieldId: map.get(node.fieldId) ?? node.fieldId }));
  };
  const next: BitableView = { ...view };
  (["hiddenFieldIds", "fieldOrder", "formFieldIds", "highlightDuplicateFieldIds", "kanbanFieldIds", "galleryFieldIds"] as const)
    .forEach((key) => { if (view[key]) next[key] = list(view[key]); });
  if (view.formDescriptions) next.formDescriptions = keys(view.formDescriptions);
  if (view.columnStats) next.columnStats = keys(view.columnStats);
  if (view.columnTextColors) next.columnTextColors = keys(view.columnTextColors);
  if (view.sorts) next.sorts = view.sorts.map((rule) => ({ ...rule, fieldId: map.get(rule.fieldId) ?? rule.fieldId }));
  if (view.groups) next.groups = view.groups.map((rule) => ({ ...rule, fieldId: map.get(rule.fieldId) ?? rule.fieldId }));
  if (view.filters) next.filters = filters(view.filters);
  if (view.fillRules) {
    next.fillRules = view.fillRules.map((rule) => (rule.mode === "column"
      ? { ...rule, fieldId: map.get(rule.fieldId) ?? rule.fieldId }
      : { ...rule, condition: { ...rule.condition, fieldId: map.get(rule.condition.fieldId) ?? rule.condition.fieldId } }));
  }
  if (view.kanbanGroupFieldId) next.kanbanGroupFieldId = one(view.kanbanGroupFieldId);
  if (view.galleryCoverFieldId) next.galleryCoverFieldId = one(view.galleryCoverFieldId);
  if (view.calendarStartFieldId) next.calendarStartFieldId = one(view.calendarStartFieldId);
  if (view.calendarEndFieldId) next.calendarEndFieldId = one(view.calendarEndFieldId);
  if (view.calendarTitleFieldId) next.calendarTitleFieldId = one(view.calendarTitleFieldId);
  if (view.calendarColorFieldId) next.calendarColorFieldId = one(view.calendarColorFieldId);
  return next;
}

/**
 * 复制数据表（结构 + 记录，id 全部重新生成；追加到末尾并返回新表 id）。
 * - 记录值按字段 id 映射；关联字段在副本里**清空已选值、去掉双向配对**（对侧仍指向原表，避免镜像打架）；
 * - 视图配置里的字段引用全部换 id；活动视图换成副本里的对应视图；
 * - 名称 = 「原名 副本」（已是副本再追加序号）。
 */
export function duplicateBitableTable(doc: BitableDoc, tableId: string): { doc: BitableDoc; tableId: string } {
  const table = doc.tables.find((t) => t.id === tableId);
  if (!table) return { doc, tableId: "" };
  const fieldIds = new Map<string, string>();
  const fields = table.fields.map((field) => {
    const id = newBitableId("fld");
    fieldIds.set(field.id, id);
    if (!isRelationFieldType(field.type)) return { ...field, id };
    const relation = { ...(field.relation ?? {}), pairedFieldId: undefined };
    return { ...field, id, relation };
  });
  const viewIds = new Map<string, string>();
  const views = table.views.map((view) => {
    const id = newBitableId("vew");
    viewIds.set(view.id, id);
    return { ...remapViewFieldIds(view, fieldIds), id };
  });
  const records = table.records.map((record) => {
    const values: Record<string, unknown> = {};
    for (const field of table.fields) {
      if (isRelationFieldType(field.type)) continue;
      const value = record.values[field.id];
      if (value !== undefined) values[fieldIds.get(field.id) ?? field.id] = value;
    }
    return { ...record, id: newBitableId("rec"), values };
  });
  const name = table.name.endsWith(" 副本") ? table.name + " 2" : table.name + " 副本";
  const copy: BitableTable = {
    ...table,
    id: newBitableId("tbl"),
    name,
    fields,
    records,
    views,
    activeViewId: viewIds.get(table.activeViewId) ?? views[0]?.id ?? "",
  };
  return { doc: { ...doc, tables: [...doc.tables, copy] }, tableId: copy.id };
}

/** 字段是否已有数据（任一记录该字段「非空」即算）——类型互转的前置判据。 */
export function fieldHasData(table: BitableTable, fieldId: string): boolean {
  return table.records.some((record) => {
    const value = record.values[fieldId];
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "number") return Number.isFinite(value);
    return true;
  });
}

/** 删选项后清掉记录里对已不存在选项的引用（单选置空 / 多选过滤），避免显示裸 option id。 */
export function pruneBitableOptionValues(doc: BitableDoc, tableId: string, fieldId: string): BitableDoc {
  const table = doc.tables.find((t) => t.id === tableId);
  const field = table?.fields.find((f) => f.id === fieldId);
  if (!table || !field || (field.type !== "select" && field.type !== "multiSelect")) return doc;
  const allowed = new Set((field.options ?? []).map((option) => option.id));
  let changed = false;
  const records = table.records.map((record) => {
    const value = record.values[fieldId];
    if (value === undefined || value === null) return record;
    if (field.type === "select") {
      if (typeof value === "string" && value && !allowed.has(value)) { changed = true; const values = { ...record.values }; delete values[fieldId]; return { ...record, values }; }
      return record;
    }
    if (!Array.isArray(value)) return record;
    const filtered = value.filter((item): item is string => typeof item === "string" && allowed.has(item));
    if (filtered.length === value.length) return record;
    changed = true;
    return { ...record, values: { ...record.values, [fieldId]: filtered } };
  });
  if (!changed) return doc;
  return { ...doc, tables: doc.tables.map((t) => (t.id !== tableId ? t : { ...t, records })) };
}

export type BitableFieldConvertFailure = "missing" | "unknown-type" | "has-data";

/**
 * 字段类型互转（261030 用户定稿：**只有没数据的字段才能转**）。
 * 无数据 ⇒ 按新类型重建字段（id/名称/必填/列宽保留，旧类型专属配置全部丢弃），并把视图里
 * 已失效的类型专属引用清掉（看板分组/画册封面/日历字段，走 stripViewRefsForFieldType）。
 * 有数据 ⇒ 拒绝并回 reason，由 UI 说明「有数据不能修改类型」。
 */
export function convertBitableFieldType(
  doc: BitableDoc,
  tableId: string,
  fieldId: string,
  nextType: string,
): { doc: BitableDoc; ok: boolean; reason?: BitableFieldConvertFailure } {
  const table = doc.tables.find((t) => t.id === tableId);
  const field = table?.fields.find((f) => f.id === fieldId);
  if (!table || !field) return { doc, ok: false, reason: "missing" };
  if (field.type === nextType) return { doc, ok: true };
  if (!isKnownFieldType(nextType)) return { doc, ok: false, reason: "unknown-type" };
  if (fieldHasData(table, fieldId)) return { doc, ok: false, reason: "has-data" };
  const base = createBitableField(nextType, field.name, field.id);
  const nextField: BitableField = {
    ...base,
    ...(field.required === true ? { required: true } : {}),
    ...(typeof field.width === "number" ? { width: field.width } : {}),
  };
  return {
    doc: {
      ...doc,
      tables: doc.tables.map((t) => (t.id !== tableId ? t : {
        ...t,
        fields: t.fields.map((f) => (f.id === fieldId ? nextField : f)),
        views: t.views.map((view) => stripViewRefsForFieldType(view, nextField)),
      })),
    },
    ok: true,
  };
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

/** 记录 id 集合归一化：空集合 / 全不存在 → 返回原 doc（不产生空写入）。 */
function existingRecordIds(table: BitableTable, ids: readonly string[]): Set<string> {
  const want = new Set(ids);
  return new Set(table.records.filter((r) => want.has(r.id)).map((r) => r.id));
}

/**
 * 追加一个字段（移动端字段面板 / 后续桌面共用；261020）。字段由调用方用 `createBitableField` 造好，
 * 这里只做「表存在 + id 不重复 + 追加到末尾」（桌面 addField 同一行为）。返回原引用表示无变化。
 */
export function addBitableField(doc: BitableDoc, tableId: string, field: BitableField): BitableDoc {
  const table = doc.tables.find((t) => t.id === tableId);
  if (!table || table.fields.some((f) => f.id === field.id)) return doc;
  return { ...doc, tables: doc.tables.map((t) => (t.id !== tableId ? t : { ...t, fields: [...t.fields, field] })) };
}

/**
 * 字段重命名（单一来源，261020）：空名 / 未变化 / 字段不存在 → 原引用；
 * 同表 AI 字段命令里的 `{{旧名}}` 跟随改写（与桌面 updateField 同一口径，见 renameAiFieldToken）。
 */
export function renameBitableField(doc: BitableDoc, tableId: string, fieldId: string, name: string): BitableDoc {
  const table = doc.tables.find((t) => t.id === tableId);
  const before = table?.fields.find((f) => f.id === fieldId);
  if (!table || !before) return doc;
  const nextName = name.trim();
  if (!nextName || nextName === before.name) return doc;
  const fields = table.fields.map((f) => (f.id === fieldId ? { ...f, name: nextName } : f));
  return {
    ...doc,
    tables: doc.tables.map((t) => (t.id !== tableId ? t : {
      ...t,
      fields: fields.map((f) => renameAiFieldToken(f, before.name, nextName)),
    })),
  };
}

/**
 * 字段配置更新（261030 移动端「修改字段」用；桌面 FieldEditorModal 的语义收窄版）：
 * 名称走 renameBitableField（联动 AI 命令变量），其余按类型写 required / defaultValue / dateAutoFill /
 * progressColor / options。**用 hasOwnProperty 判「传了没有」**：显式传 undefined = 清空该配置。
 * 无变化返回原引用（不产生空写入）。
 */
export interface BitableFieldConfigPatch {
  name?: string;
  required?: boolean;
  defaultValue?: unknown;
  dateAutoFill?: boolean;
  progressColor?: string;
  options?: BitableFieldOption[];
  /** 字段级显示格式（日期 / 数字；undefined = 清空）。 */
  format?: string;
}

export function updateBitableField(doc: BitableDoc, tableId: string, fieldId: string, patch: BitableFieldConfigPatch): BitableDoc {
  const has = (key: keyof BitableFieldConfigPatch): boolean => Object.prototype.hasOwnProperty.call(patch, key);
  let next = doc;
  if (has("name") && typeof patch.name === "string") next = renameBitableField(next, tableId, fieldId, patch.name);
  const table = next.tables.find((t) => t.id === tableId);
  const before = table?.fields.find((f) => f.id === fieldId);
  if (!table || !before) return next;
  const field: BitableField = { ...before };
  if (has("required")) {
    if (patch.required === true) field.required = true;
    else delete field.required;
  }
  if (has("defaultValue")) {
    if (patch.defaultValue === undefined) delete field.defaultValue;
    else field.defaultValue = patch.defaultValue;
  }
  if (has("dateAutoFill")) {
    if (patch.dateAutoFill === true) field.dateAutoFill = true;
    else delete field.dateAutoFill;
  }
  if (has("progressColor")) {
    if (typeof patch.progressColor === "string" && patch.progressColor) field.progressColor = patch.progressColor;
    else delete field.progressColor;
  }
  if (has("options")) {
    if (patch.options) field.options = patch.options;
    else delete field.options;
  }
  if (has("format")) {
    if (typeof patch.format === "string" && patch.format) field.format = patch.format;
    else delete field.format;
  }
  if (JSON.stringify(field) === JSON.stringify(before)) return next;
  const updated: BitableDoc = {
    ...next,
    tables: next.tables.map((t) => (t.id !== tableId ? t : { ...t, fields: t.fields.map((f) => (f.id === fieldId ? field : f)) })),
  };
  // 选项被删/改名不影响值（值存 id）；但**删掉**的 id 必须在记录里清掉，否则显示裸 option id。
  return has("options") ? pruneBitableOptionValues(updated, tableId, fieldId) : updated;
}

/**
 * 删除记录（一条或多条；261020 从桌面 `records.filter` 上收）。不存在的 id 忽略；
 * 记录集合无变化 → 原引用（不产生空写入 / 空撤销步）。
 */
export function deleteBitableRecords(doc: BitableDoc, tableId: string, recordIds: readonly string[]): BitableDoc {
  const table = doc.tables.find((t) => t.id === tableId);
  if (!table || recordIds.length === 0) return doc;
  const drop = existingRecordIds(table, recordIds);
  if (drop.size === 0) return doc;
  return {
    ...doc,
    tables: doc.tables.map((t) => (t.id !== tableId ? t : { ...t, records: t.records.filter((r) => !drop.has(r.id)) })),
  };
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
