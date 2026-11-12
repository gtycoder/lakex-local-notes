/**
 * 多维表正文（core/bitable）：文档模型编排：工厂 / 导航归一 / 序列化 / 解析（正文 JSON 的唯一出入口）。
 *
 * 由 core/bitableDoc.ts 按域拆出（261112 R1-S1，纯搬移：导出名/行为未变）。
 * 对外 API 仍由 ../bitableDoc.ts 门面 re-export；本文件只被同目录模块与门面 import。
 */
import type { BitableAiConfig, BitableDisplayContext, BitableDoc, BitableField, BitableFieldOption, BitableFieldType, BitableRecord, BitableRelation, BitableTable, BitableView, BitableViewType } from "./types.js";
import { BITABLE_DOC_KIND, BITABLE_DOC_VERSION, BITABLE_FIELD_TYPE_LABEL, BITABLE_OPTION_PALETTE, BITABLE_RELATION_DEFAULT, isAiFieldType, isRelationFieldType, newBitableId, nowIso } from "./types.js";
import { normalizeFilters } from "./filter.js";
import { normalizeFillRules } from "./fill.js";
import { bitableFieldText } from "./values.js";
import { defaultViewName } from "./views.js";

/** 新建选项时按调色板轮转取色（可显式传 colors 覆盖）。 */
export function createBitableFieldOptions(names: string[], colors?: Array<string | undefined>): BitableFieldOption[] {
  return names.map((name, index) => ({
    id: newBitableId("opt"),
    name,
    color: colors?.[index] ?? BITABLE_OPTION_PALETTE[index % BITABLE_OPTION_PALETTE.length],
  }));
}

export function createBitableField(type: BitableFieldType, name?: string, id = newBitableId("fld")): BitableField {
  const field: BitableField = { id, name: name ?? BITABLE_FIELD_TYPE_LABEL[type], type };
  if (type === "select" || type === "multiSelect") field.options = [];
  if (isRelationFieldType(type)) field.relation = { ...BITABLE_RELATION_DEFAULT };
  if (type === "ai") field.ai = { prompt: "" };
  return field;
}

export function createBitableView(type: BitableViewType, name?: string, id = newBitableId("vew")): BitableView {
  const view: BitableView = { id, name: name ?? defaultViewName(type), type };
  if (type === "grid") view.rowHeight = "low";
  return view;
}

export function createBitableRecord(id = newBitableId("rec")): BitableRecord {
  const ts = nowIso();
  return { id, values: {}, createdAt: ts, updatedAt: ts };
}

/**
 * 新建数据表的**产品默认**（260929 用户口径）：**只有 1 列文本 + 3 行空白记录**。
 * 原先预置的「单选 / 日期」两列已取消——用户不需要猜我们要什么样的表结构，加列由用户自己加。
 * （新建多维表文档时的首张表走同一函数，口径一致。）
 */
export function createDefaultBitableTable(name = "数据表 1", id = newBitableId("tbl")): BitableTable {
  const primary = createBitableField("text", "文本");
  const grid = createBitableView("grid", defaultViewName("grid"));
  const records = [createBitableRecord(), createBitableRecord(), createBitableRecord()];
  return { id, name, fields: [primary], records, views: [grid], activeViewId: grid.id };
}

/** 新建多维表文档的正文（1 张默认数据表；随后由编辑器保存覆盖）。 */
export function emptyBitableBody(): string {
  const table = createDefaultBitableTable();
  return bitablesToBody([table], table.id);
}

/**
 * 导航字段归一（CORE-05，261006 用户选 C）——**core 单一来源**。
 *
 * 正文里恒写「第一张表 / 每张表的第一个视图」：`activeTableId`/`activeViewId` 是
 * **设备本地 UI 状态**（localStorage 的 `bitable-nav.*`），不是文档数据。
 * 切表 / 切视图因此不得改变正文字节，否则纯导航会标脏并触发一次 S3 上传。
 * 桌面 `useBitableSession` 与移动端 `serializeBitableBody` 都只调它，不再各抄一份 map。
 */
export function canonicalBitableNav(
  tables: BitableTable[],
  activeTableId?: string,
): { tables: BitableTable[]; activeTableId: string } {
  // 已经是第一个视图时复用原表对象（不制造无意义的浅拷贝）。
  const canonicalTables = tables.map((table) => {
    const firstViewId = table.views[0]?.id;
    return firstViewId && firstViewId !== table.activeViewId ? { ...table, activeViewId: firstViewId } : table;
  });
  return {
    tables: canonicalTables,
    activeTableId: activeTableId && canonicalTables.some((t) => t.id === activeTableId) ? activeTableId : canonicalTables[0]?.id ?? "",
  };
}

/** tables + activeTableId → 正文 JSON（紧凑、不 pretty-print；导航字段先走 canonicalBitableNav）。 */
export function bitablesToBody(tables: BitableTable[], activeTableId?: string): string {
  const canonical = canonicalBitableNav(tables, activeTableId);
  const doc: BitableDoc = {
    kind: BITABLE_DOC_KIND,
    version: BITABLE_DOC_VERSION,
    tables: canonical.tables,
    activeTableId: canonical.activeTableId,
  };
  return JSON.stringify(doc);
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === "string");
}

function normalizeField(raw: unknown): BitableField | null {
  if (!raw || typeof raw !== "object") return null;
  const field = raw as Partial<BitableField>;
  if (typeof field.id !== "string" || typeof field.name !== "string" || typeof field.type !== "string") return null;
  const next: BitableField = { ...(raw as BitableField), id: field.id, name: field.name, type: field.type };
  if (Array.isArray(field.options)) {
    next.options = (field.options as unknown[])
      .filter((o): o is BitableFieldOption => !!o && typeof o === "object" && typeof (o as BitableFieldOption).id === "string" && typeof (o as BitableFieldOption).name === "string")
      .map((o) => ({ ...o }));
  }
  // 关联配置归一：只保留认识的键，多选补默认（方向由 relationOneWay / relationTwoWay 类型决定）。
  if (isRelationFieldType(field.type)) {
    const rel = field.relation && typeof field.relation === "object" ? field.relation : {};
    const relation: BitableRelation = { allowMultiple: rel.allowMultiple !== false };
    if (typeof rel.tableId === "string" && rel.tableId) relation.tableId = rel.tableId;
    if (typeof rel.viewId === "string" && rel.viewId) relation.viewId = rel.viewId;
    if (typeof rel.pairedFieldId === "string" && rel.pairedFieldId) relation.pairedFieldId = rel.pairedFieldId;
    next.relation = relation;
  } else {
    delete next.relation;
  }
  // AI 配置归一（261003）：只保留 prompt（字段变量写在命令里）；非 AI 字段一律不带配置。
  if (isAiFieldType(field.type)) {
    const rawAi = field.ai && typeof field.ai === "object" ? (field.ai as Partial<BitableAiConfig>) : {};
    next.ai = {
      prompt: typeof rawAi.prompt === "string" ? rawAi.prompt : "",
      ...(rawAi.includeAttachments === true ? { includeAttachments: true } : {}),
    };
  } else {
    delete next.ai;
  }
  return next;
}

function normalizeRecord(raw: unknown): BitableRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Partial<BitableRecord>;
  if (typeof rec.id !== "string") return null;
  const ts = typeof rec.createdAt === "string" ? rec.createdAt : nowIso();
  return {
    ...(raw as BitableRecord),
    id: rec.id,
    values: rec.values && typeof rec.values === "object" ? { ...rec.values } : {},
    createdAt: ts,
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : ts,
  };
}

function normalizeView(raw: unknown): BitableView | null {
  if (!raw || typeof raw !== "object") return null;
  const view = raw as Partial<BitableView>;
  if (typeof view.id !== "string" || typeof view.name !== "string") return null;
  // 未知 type 原样保留：把 kanban/gallery/calendar 降级成 grid，等于旧版本打开一次就静默改写正文。
  // 只有真正缺 type 的脏数据才回落到 grid。
  const type = typeof view.type === "string" && view.type ? view.type : "grid";
  const next: BitableView = { ...(raw as BitableView), id: view.id, name: view.name, type };
  const fieldOrder = asStringArray(view.fieldOrder);
  if (fieldOrder) next.fieldOrder = fieldOrder; else delete next.fieldOrder;
  const hidden = asStringArray(view.hiddenFieldIds);
  if (hidden) next.hiddenFieldIds = hidden; else delete next.hiddenFieldIds;
  const formFields = asStringArray(view.formFieldIds);
  if (formFields) next.formFieldIds = formFields; else delete next.formFieldIds;
  const kanbanFields = asStringArray(view.kanbanFieldIds);
  if (kanbanFields) next.kanbanFieldIds = kanbanFields; else delete next.kanbanFieldIds;
  const galleryFields = asStringArray(view.galleryFieldIds);
  if (galleryFields) next.galleryFieldIds = galleryFields; else delete next.galleryFieldIds;
  if (typeof view.formTitle !== "string") delete next.formTitle;
  if (typeof view.formDescription !== "string") delete next.formDescription;
  if (view.gallerySize !== "regular" && view.gallerySize !== "compact") delete next.gallerySize;
  if (view.galleryFit !== "cover" && view.galleryFit !== "contain") delete next.galleryFit;
  const filters = normalizeFilters(view.filters);
  if (filters && filters.length > 0) next.filters = filters; else delete next.filters;
  if (next.filters && (view.filterOperator === "or" || view.filterOperator === "and")) next.filterOperator = view.filterOperator;
  else delete next.filterOperator;
  if (!Array.isArray(view.sorts)) delete next.sorts;
  if (Array.isArray(view.groups)) next.groups = view.groups.slice(0, 1);
  else delete next.groups;
  if (!Array.isArray(view.highlightDuplicateFieldIds)) delete next.highlightDuplicateFieldIds;
  const fillRules = normalizeFillRules(view.fillRules);
  if (fillRules && fillRules.length > 0) next.fillRules = fillRules; else delete next.fillRules;
  if (!view.columnStats || typeof view.columnStats !== "object") delete next.columnStats;
  if (!view.columnTextColors || typeof view.columnTextColors !== "object") delete next.columnTextColors;
  return next;
}

function normalizeTable(raw: unknown): BitableTable | null {
  if (!raw || typeof raw !== "object") return null;
  const table = raw as Partial<BitableTable>;
  if (typeof table.id !== "string") return null;
  const fields = Array.isArray(table.fields) ? table.fields.map(normalizeField).filter((f): f is BitableField => !!f) : [];
  if (fields.length === 0) return null;
  const records = Array.isArray(table.records) ? table.records.map(normalizeRecord).filter((r): r is BitableRecord => !!r) : [];
  const views = Array.isArray(table.views) ? table.views.map(normalizeView).filter((v): v is BitableView => !!v) : [];
  if (views.length === 0) views.push(createBitableView("grid", defaultViewName("grid")));
  const activeViewId = typeof table.activeViewId === "string" && views.some((v) => v.id === table.activeViewId) ? table.activeViewId : views[0].id;
  return {
    ...(raw as BitableTable),
    id: table.id,
    name: typeof table.name === "string" && table.name ? table.name : "数据表",
    fields,
    records,
    views,
    activeViewId,
  };
}

/** 解析多维表正文；非法/空/版本不符返回 null（调用方按「空表」处理，不抛错）。 */
export function parseBitableBody(content: string | null | undefined): BitableDoc | null {
  if (!content) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const doc = parsed as Partial<BitableDoc>;
  if (doc.kind !== BITABLE_DOC_KIND || doc.version !== BITABLE_DOC_VERSION || !Array.isArray(doc.tables)) return null;
  const tables = doc.tables.map(normalizeTable).filter((t): t is BitableTable => !!t);
  if (tables.length === 0) return null;
  const activeTableId = typeof doc.activeTableId === "string" && tables.some((t) => t.id === doc.activeTableId) ? doc.activeTableId : tables[0].id;
  return { kind: BITABLE_DOC_KIND, version: BITABLE_DOC_VERSION, tables, activeTableId };
}

/**
 * 多维表正文 → 供全文搜索的纯文本（表名 + 每条记录各字段展示值）。
 * 与 Lake 的 lakeHtmlToPlain 职责对应：非文档类型的正文不能喂给 HTML 解析器。
 */
export function bitableToSearchText(content: string | null | undefined, maxChars = 20000): string {
  const doc = parseBitableBody(content);
  if (!doc) return "";
  const ctx: BitableDisplayContext = { tables: doc.tables };
  const parts: string[] = [];
  const size = () => parts.join("\n").length;
  for (const table of doc.tables) {
    parts.push("[" + table.name + "]");
    for (const record of table.records) {
      const cells: string[] = [];
      for (const field of table.fields) {
        const text = bitableFieldText(record, field, ctx);
        if (text) cells.push(text);
      }
      if (cells.length > 0) parts.push(cells.join("\t"));
      if (size() > maxChars) break;
    }
    if (size() > maxChars) break;
  }
  const text = parts.join("\n");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
