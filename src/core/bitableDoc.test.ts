import { describe, expect, it } from "vitest";
import { extractAssetRefs } from "./assetNaming.js";
import {
  BITABLE_FIELD_TYPES,
  BITABLE_FIELD_TYPE_LABEL,
  BITABLE_IMPLEMENTED_VIEW_TYPES,
  BITABLE_VIEW_TYPES,
  applyViewToRecords,
  bitableAttachments,
  bitableAttachmentFields,
  bitableDateFields,
  bitableSelectFields,
  bitableDisplayValue,
  bitableRecordTitle,
  removeBitableAttachment,
  renameBitableAttachment,
  reorderBitableAttachments,
  attachmentGridColumns,
  defaultRecordValues,
  localDateString,
  bitableToSearchText,
  bitablesToBody,
  createBitableField,
  createBitableRecord,
  createBitableView,
  createDefaultBitableTable,
  filterOperatorsFor,
  groupRecordsTree,
  defaultViewName,
  emptyBitableBody,
  calendarColorField,
  calendarEndField,
  calendarEvents,
  calendarEventsByDay,
  calendarMonthDays,
  calendarMovePatch,
  calendarStartField,
  calendarTitleField,
  computeColumnStat,
  statForField,
  statsForField,
  galleryCardFieldCandidates,
  galleryCardFields,
  galleryCoverField,
  galleryCoverImage,
  bitableFieldText,
  bitableFieldValue,
  isAttachmentLikeField,
  isImplementedViewType,
  isNumericFieldType,
  isSystemTimeField,
  localDateTimeString,
  isKnownFieldType,
  isKnownViewType,
  kanbanCardFieldCandidates,
  kanbanCardFields,
  kanbanColumns,
  kanbanGroupField,
  localDateDiff,
  orderedTableFields,
  parseBitableBody,
  shiftLocalDate,
  viewTypeLabel,
} from "./bitableDoc.js";

describe("bitableDoc 数据模型", () => {
  it("emptyBitableBody 往返：1 表 / 3 字段 / 1 表格视图", () => {
    const doc = parseBitableBody(emptyBitableBody());
    expect(doc).not.toBeNull();
    expect(doc!.kind).toBe("bitable");
    expect(doc!.version).toBe(1);
    expect(doc!.tables).toHaveLength(1);
    const table = doc!.tables[0];
    expect(table.fields.map((f) => f.type)).toEqual(["text", "select", "date"]);
    expect(table.views).toHaveLength(1);
    expect(table.views[0].type).toBe("grid");
    expect(table.activeViewId).toBe(table.views[0].id);
    expect(doc!.activeTableId).toBe(table.id);
  });

  it("非法/空/版本不符 → null", () => {
    expect(parseBitableBody("")).toBeNull();
    expect(parseBitableBody(null)).toBeNull();
    expect(parseBitableBody(undefined)).toBeNull();
    expect(parseBitableBody("not json")).toBeNull();
    expect(parseBitableBody(JSON.stringify({ kind: "sheet", version: 2, sheets: [] }))).toBeNull();
    expect(parseBitableBody(JSON.stringify({ kind: "bitable", version: 99, tables: [] }))).toBeNull();
    expect(parseBitableBody(JSON.stringify({ kind: "bitable", version: 1, tables: [] }))).toBeNull();
  });

  it("未知字段类型只读保留、不清空（开放字符串）", () => {
    const table = createDefaultBitableTable("t1", "tbl1");
    table.fields.push({ id: "fld-x", name: "公式列", type: "formula" });
    const doc = parseBitableBody(bitablesToBody([table], "tbl1"))!;
    const field = doc.tables[0].fields.find((f) => f.id === "fld-x")!;
    expect(field.type).toBe("formula");
  });

  it("搜索文本包含表名与各字段展示值（单选解析选项名）", () => {
    const table = createDefaultBitableTable("持仓", "tbl1");
    const primary = table.fields[0];
    const status = table.fields[1];
    const date = table.fields[2];
    const rec = createBitableRecord("rec1");
    rec.values[primary.id] = "茅台";
    rec.values[status.id] = status.options!.find((o) => o.name === "进行中")!.id;
    rec.values[date.id] = "2026-01-02";
    table.records.push(rec);
    const text = bitableToSearchText(bitablesToBody([table], "tbl1"));
    expect(text).toContain("[持仓]");
    expect(text).toContain("茅台");
    expect(text).toContain("进行中");
    expect(text).toContain("2026-01-02");
  });

  it("orderedTableFields：隐藏列剔除、fieldOrder 生效、未列出字段追加在后", () => {
    const table = createDefaultBitableTable("t", "tbl1");
    const a = table.fields[0];
    const b = table.fields[1];
    const d = table.fields[2];
    const c = createBitableField("number", "数量", "fld-c");
    table.fields.push(c);
    const view = createBitableView("grid", "g", "vew1");
    view.fieldOrder = [c.id, a.id];
    view.hiddenFieldIds = [b.id];
    const out = orderedTableFields(table, view).map((f) => f.id);
    // 隐藏 b；fieldOrder 先把 c 提到最前，a 其次，未列出的 d 追加在后
    expect(out).toEqual([c.id, a.id, d.id]);
  });

  it("applyViewToRecords：筛选 + 排序（稳定）", () => {
    const table = createDefaultBitableTable("t", "tbl1");
    const primary = table.fields[0];
    const status = table.fields[1];
    const date = table.fields[2];
    const mk = (id: string, title: string, day: string, stat: string) => {
      const r = createBitableRecord(id);
      r.values[primary.id] = title;
      r.values[date.id] = day;
      r.values[status.id] = status.options!.find((o) => o.name === stat)!.id;
      return r;
    };
    table.records.push(mk("r1", "A", "2026-01-03", "进行中"), mk("r2", "B", "2026-01-01", "进行中"), mk("r3", "C", "2026-01-02", "已完成"));
    const view = createBitableView("grid", "g", "vew1");
    view.filters = [{ fieldId: status.id, operator: "equals", value: "进行中" }];
    expect(applyViewToRecords(table, view).map((r) => r.id)).toEqual(["r1", "r2"]);
    view.filters = [];
    view.sorts = [{ fieldId: date.id }];
    expect(applyViewToRecords(table, view).map((r) => r.id)).toEqual(["r2", "r3", "r1"]);
    view.sorts = [{ fieldId: date.id, desc: true }];
    expect(applyViewToRecords(table, view).map((r) => r.id)).toEqual(["r1", "r3", "r2"]);
  });

  it("defaultRecordValues：只收集有默认值的字段（含单选 option id）", () => {
    const table = createDefaultBitableTable("t", "tbl1");
    const primary = table.fields[0];
    const status = table.fields[1];
    table.fields[2].defaultValue = "2026-01-01";
    primary.defaultValue = "新记录";
    status.defaultValue = status.options!.find((o) => o.name === "待开始")!.id;
    const values = defaultRecordValues(table);
    expect(values[primary.id]).toBe("新记录");
    expect(values[status.id]).toBe(status.options![0].id);
    expect(values[table.fields[2].id]).toBe("2026-01-01");
    const empty = defaultRecordValues(createDefaultBitableTable("t", "tbl2"));
    expect(Object.keys(empty)).toHaveLength(0);
  });

  it("日期字段「添加记录时间」：按**本地**日填当天（不能用 UTC 日期）", () => {
    const table = createDefaultBitableTable("t", "tbl-date");
    const date = table.fields.find((f) => f.type === "date")!;
    date.dateAutoFill = true;
    date.defaultValue = "2020-01-01"; // 自动时间优先，写死的默认值不再生效
    // 本地 2026-09-28 00:30：东八区下 UTC 还是 09-27，toISOString().slice(0,10) 会算成前一天
    const at = new Date(2026, 8, 28, 0, 30).toISOString();
    expect(defaultRecordValues(table, at)).toEqual({ [date.id]: "2026-09-28" });
    expect(localDateString(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
    expect(localDateString("not-a-date")).toBe("");
  });

  it("附件单元格：磁盘名进正文 → 能被 extractAssetRefs 提取（统一资产管线/声明/GC 保护）", () => {
    const table = createDefaultBitableTable("t", "tbl1");
    const af = createBitableField("attachment", "附件", "fld-att");
    table.fields.push(af);
    const rec = createBitableRecord("rec1");
    rec.values[af.id] = [{ file: "1700000000000_ab12cd34.png", name: "照片.png", size: 0 }];
    table.records.push(rec);
    const refs = extractAssetRefs(bitablesToBody([table], "tbl1"));
    expect([...refs]).toContain("1700000000000_ab12cd34.png");
  });

  it("附件单元格：file 定位磁盘文件、name 用于展示（展示名不参与资产引用）", () => {
    const field = createBitableField("attachment", "附件", "fld-att");
    const value = [
      { file: "1700000000000_ab12cd34.mp3", name: "鞠磊8.27音频.mp3", size: 448000 },
      { file: "1700000000001_cd34ab12.pptx", size: 1024 },
    ];
    expect(bitableAttachments(value)).toEqual([
      { file: "1700000000000_ab12cd34.mp3", name: "鞠磊8.27音频.mp3", size: 448000 },
      // 缺展示名时**不暴露磁盘名**（用户 260928）：回落到中性文案
      { file: "1700000000001_cd34ab12.pptx", name: "附件", size: 1024 },
    ]);
    // 展示值（搜索/卡片/标题统一口径）同样不暴露磁盘名
    expect(bitableDisplayValue(field, value)).toBe("鞠磊8.27音频.mp3, 附件");
  });

  it("展示名守卫：历史脏值（把落盘名当展示名）也不再外显磁盘名", () => {
    expect(bitableAttachments([{ file: "1700000000000_ab12cd34.png", name: "1700000000000_ab12cd34.png", size: 1 }]))
      .toEqual([{ file: "1700000000000_ab12cd34.png", name: "附件", size: 1 }]);
    // 正常展示名原样保留（中文 / 带扩展名）
    expect(bitableAttachments([{ file: "1700000000000_ab12cd34.png", name: "封面色块.png", size: 1 }]))
      .toEqual([{ file: "1700000000000_ab12cd34.png", name: "封面色块.png", size: 1 }]);
  });

  it("附件单元格：非法 size 回落 0，但不会丢掉合法附件", () => {
    expect(bitableAttachments([{ file: "1700000000000_ab12cd34.mp3", name: "a.mp3", size: -1 }])).toEqual([
      { file: "1700000000000_ab12cd34.mp3", name: "a.mp3", size: 0 },
    ]);
  });

  it("附件单元格：非法条目直接丢弃（缺 file / 非对象 / 非数组）", () => {
    expect(bitableAttachments(null)).toEqual([]);
    expect(bitableAttachments("1700000000000_ab12cd34.png")).toEqual([]);
    expect(bitableAttachments([{ name: "只有展示名.png" }, "旧的字符串值.png", null, 42])).toEqual([]);
  });

  it("removeBitableAttachment：按磁盘名删除，展示名不同也不误删", () => {
    const value = [
      { file: "1700000000000_ab12cd34.mp3", name: "a.mp3", size: 0 },
      { file: "1700000000001_cd34ab12.mp3", name: "b.mp3", size: 0 },
    ];
    expect(removeBitableAttachment(value, "1700000000001_cd34ab12.mp3")).toEqual([
      { file: "1700000000000_ab12cd34.mp3", name: "a.mp3", size: 0 },
    ]);
  });

  it("renameBitableAttachment：只改展示名、磁盘名不动；空名视为放弃编辑", () => {
    const value = [{ file: "1700000000000_ab12cd34.mp3", name: "a.mp3", size: 0 }];
    expect(renameBitableAttachment(value, "1700000000000_ab12cd34.mp3", "  演示音频  ")).toEqual([
      { file: "1700000000000_ab12cd34.mp3", name: "演示音频", size: 0 },
    ]);
    expect(renameBitableAttachment(value, "1700000000000_ab12cd34.mp3", "   ")).toEqual(value);
    expect(renameBitableAttachment(value, "1700000009999_ffffffff.mp3", "x")).toEqual(value);
  });

  it("attachmentGridColumns：少数量铺一行（≤3 列），再多只增列以保持 ≤3 行，上限 6 列", () => {
    expect([1, 2, 3].map(attachmentGridColumns)).toEqual([1, 2, 3]);
    expect([4, 5, 6].map(attachmentGridColumns)).toEqual([3, 3, 3]);
    expect([7, 9].map(attachmentGridColumns)).toEqual([3, 3]);
    expect([10, 12].map(attachmentGridColumns)).toEqual([4, 4]);
    expect([13, 15].map(attachmentGridColumns)).toEqual([5, 5]);
    expect([16, 18, 19, 40].map(attachmentGridColumns)).toEqual([6, 6, 6, 6]);
    for (const count of [1, 2, 5, 9, 14, 18]) {
      expect(Math.ceil(count / attachmentGridColumns(count))).toBeLessThanOrEqual(3);
    }
  });

  it("reorderBitableAttachments：按新顺序重排，未列出的条目按原序补回（拖拽不会丢附件）", () => {
    const value = [
      { file: "1700000000000_ab12cd34.mp3", name: "a.mp3", size: 0 },
      { file: "1700000000001_cd34ab12.mp3", name: "b.mp3", size: 0 },
      { file: "1700000000002_ef56ab78.mp4", name: "c.mp4", size: 0 },
    ];
    expect(reorderBitableAttachments(value, ["1700000000002_ef56ab78.mp4", "1700000000000_ab12cd34.mp3", "1700000000001_cd34ab12.mp3"])).toEqual([
      { file: "1700000000002_ef56ab78.mp4", name: "c.mp4", size: 0 },
      { file: "1700000000000_ab12cd34.mp3", name: "a.mp3", size: 0 },
      { file: "1700000000001_cd34ab12.mp3", name: "b.mp3", size: 0 },
    ]);
    expect(reorderBitableAttachments(value, ["1700000000001_cd34ab12.mp3"])).toEqual([
      { file: "1700000000001_cd34ab12.mp3", name: "b.mp3", size: 0 },
      { file: "1700000000000_ab12cd34.mp3", name: "a.mp3", size: 0 },
      { file: "1700000000002_ef56ab78.mp4", name: "c.mp4", size: 0 },
    ]);
  });

  it("bitableRecordTitle：主字段空 → 未命名记录", () => {
    const table = createDefaultBitableTable("t", "tbl1");
    const rec = createBitableRecord("rec1");
    expect(bitableRecordTitle(table, rec)).toBe("未命名记录");
    rec.values[table.fields[0].id] = "标题";
    expect(bitableRecordTitle(table, rec)).toBe("标题");
  });

  it("parse 归一化：缺失 activeViewId 时回退到首个视图，空视图自动补一个 grid", () => {
    const table = createDefaultBitableTable("t", "tbl1");
    const raw = JSON.parse(bitablesToBody([table], "tbl1"));
    raw.tables[0].views = [];
    delete raw.tables[0].activeViewId;
    const doc = parseBitableBody(JSON.stringify(raw))!;
    expect(doc.tables[0].views).toHaveLength(1);
    expect(doc.tables[0].views[0].type).toBe("grid");
    expect(doc.tables[0].activeViewId).toBe(doc.tables[0].views[0].id);
  });

  it("未知视图类型原样保留（不得改写成 grid），只有缺 type 的脏数据才回落", () => {
    const table = createDefaultBitableTable("t", "tbl1");
    const raw = JSON.parse(bitablesToBody([table], "tbl1"));
    raw.tables[0].views.push({ id: "vew-chart", name: "图表视图", type: "chart" });
    raw.tables[0].activeViewId = "vew-chart";
    const doc = parseBitableBody(JSON.stringify(raw))!;
    const view = doc.tables[0].views.find((v) => v.id === "vew-chart")!;
    expect(view.type).toBe("chart");
    expect(view.name).toBe("图表视图");
    expect(doc.tables[0].activeViewId).toBe("vew-chart");

    // 缺 type 的脏数据才回落到 grid（旧版本打开新正文不能被静默改写）
    const dirty = { kind: "bitable", version: 1, activeTableId: table.id, tables: [{ ...raw.tables[0], views: [{ id: "v", name: "无名" }], activeViewId: "v" }] };
    expect(parseBitableBody(JSON.stringify(dirty))!.tables[0].views[0].type).toBe("grid");
  });

  it("视图类型元数据：五种类型可新建、默认名/标签同源、board 不算视图类型", () => {
    expect(BITABLE_VIEW_TYPES).toEqual(["grid", "form", "kanban", "gallery", "calendar"]);
    expect(createBitableView("kanban").name).toBe("看板视图");
    expect(createBitableView("gallery").name).toBe("画册视图");
    expect(createBitableView("calendar").name).toBe("日历视图");
    expect(createBitableView("form").name).toBe("表单视图");
    expect(defaultViewName("chart")).toBe("视图");
    expect(viewTypeLabel("kanban")).toBe("看板视图");
    expect(viewTypeLabel("chart")).toBe("chart");
    expect(isKnownViewType("calendar")).toBe(true);
    expect(isKnownViewType("board")).toBe(false);   // board 是画板文档 kind，不是视图类型
    // 行高只属于表格视图：别让看板/画册/日历继承 grid 的 36px 行高语义
    expect(createBitableView("grid").rowHeight).toBe("low");
    expect(createBitableView("kanban").rowHeight).toBeUndefined();
  });

  it("看板分栏：选项即分栏（空栏保留）、未分组恒在最后、组内保持传入顺序", () => {
    const table = createDefaultBitableTable("t", "tbl-kanban");
    const primary = table.fields[0];
    const status = table.fields[1];
    const view = createBitableView("kanban", undefined, "vew-k");
    view.kanbanGroupFieldId = status.id;
    const optionIds = status.options!.map((o) => o.id);
    const mk = (id: string, title: string, optionId?: string) => {
      const record = createBitableRecord(id);
      record.values[primary.id] = title;
      if (optionId !== undefined) record.values[status.id] = optionId;
      return record;
    };
    const records = [mk("r1", "A", optionIds[1]), mk("r2", "B"), mk("r3", "C", optionIds[1]), mk("r4", "D", "opt-deleted")];
    const columns = kanbanColumns(table, view, records);
    // 三个选项都在（空栏也保留，否则没法把卡片拖进空分组），未分组固定排最后
    expect(columns.map((c) => c.optionId)).toEqual([...optionIds, null]);
    expect(columns.map((c) => c.records.map((r) => r.id))).toEqual([[], ["r1", "r3"], [], ["r2", "r4"]]);
    const last = columns[columns.length - 1];
    expect(last.label).toBe("未分组");
    expect(last.key).toBe("");
    expect(last.color).toBeUndefined();
  });

  it("看板：分组字段必须是单选；未配置→无分栏；卡片字段默认排除主字段与分组字段", () => {
    const table = createDefaultBitableTable("t", "tbl-kanban2");
    const view = createBitableView("kanban", undefined, "vew-k2");
    expect(kanbanGroupField(table, view)).toBeUndefined();
    expect(kanbanColumns(table, view, [])).toEqual([]);
    expect(bitableSelectFields(table).map((f) => f.type)).toEqual(["select"]);

    view.kanbanGroupFieldId = table.fields[0].id;   // 文本字段不能当分栏
    expect(kanbanGroupField(table, view)).toBeUndefined();
    view.kanbanGroupFieldId = table.fields[1].id;
    expect(kanbanGroupField(table, view)?.id).toBe(table.fields[1].id);

    const candidates = kanbanCardFieldCandidates(table, view).map((f) => f.id);
    expect(candidates).toEqual([table.fields[2].id]);   // 主字段当标题、分组字段当分栏，都不上卡
    expect(kanbanCardFields(table, view).map((f) => f.id)).toEqual(candidates);
    view.kanbanFieldIds = [];
    expect(kanbanCardFields(table, view)).toEqual([]);   // 显式清空 = 只显示标题
  });

  it("已实现视图集合：五种视图全部已实现，未知类型才走回退", () => {
    expect(BITABLE_IMPLEMENTED_VIEW_TYPES).toEqual(["grid", "form", "kanban", "gallery", "calendar"]);
    expect(isImplementedViewType("calendar")).toBe(true);
    expect(isImplementedViewType("chart")).toBe(false);
  });

  it("图片字段：与附件同一值模型，只是上传侧限定图片；图片/附件都能当封面", () => {
    const table = createDefaultBitableTable("t", "tbl-img");
    const image = createBitableField("image", "图片", "fld-img");
    const attachment = createBitableField("attachment", "附件", "fld-att");
    table.fields.push(image, attachment);
    expect(isKnownFieldType("image")).toBe(true);
    expect(BITABLE_FIELD_TYPES).toContain("image");
    expect(BITABLE_FIELD_TYPE_LABEL.image).toBe("图片");
    expect(BITABLE_FIELD_TYPE_LABEL.attachment).toBe("附件");
    expect(isAttachmentLikeField("image")).toBe(true);
    expect(isAttachmentLikeField("attachment")).toBe(true);
    expect(isAttachmentLikeField("text")).toBe(false);
    // 画册封面候选：附件类字段全都算（图片字段也能当封面）
    expect(bitableAttachmentFields(table).map((f) => f.id)).toEqual(["fld-img", "fld-att"]);

    const view = createBitableView("gallery", undefined, "vew-g3");
    view.galleryCoverFieldId = image.id;
    expect(galleryCoverField(table, view)?.id).toBe(image.id);
    const record = createBitableRecord("r1");
    record.values[image.id] = [{ file: "1700000000001_ab12cd34.png", name: "图.png", size: 1 }];
    expect(galleryCoverImage(table, view, record)?.name).toBe("图.png");
    // 展示值口径与附件一致（附件名列表）
    expect(bitableDisplayValue(image, record.values[image.id])).toBe("图.png");
    expect(bitableDisplayValue(createBitableField("image"), "x")).toBe("");
  });

  it("画册封面：取封面字段里第一个图片附件；只有非图片/字段类型不符 → 无封面", () => {
    const table = createDefaultBitableTable("t", "tbl-gal");
    const coverField = createBitableField("attachment", "相册", "fld-cover");
    table.fields.push(coverField);
    const view = createBitableView("gallery", undefined, "vew-g");
    view.galleryCoverFieldId = coverField.id;
    expect(bitableAttachmentFields(table).map((f) => f.id)).toEqual([coverField.id]);
    expect(galleryCoverField(table, view)?.id).toBe(coverField.id);

    const record = createBitableRecord("r1");
    record.values[coverField.id] = [
      { file: "1700000000000_ab12cd34.mp3", name: "音频.mp3", size: 1 },
      { file: "1700000000001_ab12cd34.png", name: "图一.png", size: 2 },
      { file: "1700000000002_ab12cd34.jpg", name: "图二.jpg", size: 3 },
    ];
    expect(galleryCoverImage(table, view, record)?.name).toBe("图一.png");

    const audioOnly = createBitableRecord("r2");
    audioOnly.values[coverField.id] = [{ file: "1700000000000_ab12cd34.mp3", name: "音频.mp3", size: 1 }];
    expect(galleryCoverImage(table, view, audioOnly)).toBeUndefined();

    view.galleryCoverFieldId = table.fields[0].id;   // 非附件字段不能当封面
    expect(galleryCoverField(table, view)).toBeUndefined();
  });

  it("画册卡片字段：默认排除主字段与封面字段；配置过按视图列顺序取交集", () => {
    const table = createDefaultBitableTable("t", "tbl-gal2");
    const coverField = createBitableField("attachment", "相册", "fld-cover");
    table.fields.push(coverField);
    const view = createBitableView("gallery", undefined, "vew-g2");
    view.galleryCoverFieldId = coverField.id;
    const ids = galleryCardFieldCandidates(table, view).map((f) => f.id);
    expect(ids).toEqual([table.fields[1].id, table.fields[2].id]);
    expect(galleryCardFields(table, view).map((f) => f.id)).toEqual(ids);
    view.galleryFieldIds = [table.fields[2].id];
    expect(galleryCardFields(table, view).map((f) => f.id)).toEqual([table.fields[2].id]);
    view.galleryFieldIds = [];
    expect(galleryCardFields(table, view)).toEqual([]);
  });

  it("日历月网格：周一起始、42 格、跨月填充与日期平移（全本地日期）", () => {
    const days = calendarMonthDays(2026, 9);
    expect(days).toHaveLength(42);
    expect(days[0].date).toBe("2026-08-31");    // 2026-09-01 是周二 → 周一列是 08-31
    expect(days[0].inMonth).toBe(false);
    expect(days.find((d) => d.date === "2026-09-01")?.inMonth).toBe(true);
    expect(days.filter((d) => d.inMonth)).toHaveLength(30);
    expect(shiftLocalDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftLocalDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(localDateDiff("2026-09-10", "2026-09-01")).toBe(9);
    expect(localDateDiff("2026-09-01", "2026-09-01")).toBe(0);
  });

  it("日历日程：无开始日期不上、结束早于开始按单日、颜色取单选、跨天按天展开", () => {
    const table = createDefaultBitableTable("t", "tbl-cal");
    const primary = table.fields[0];
    const status = table.fields[1];
    const date = table.fields[2];
    const endField = createBitableField("date", "结束", "fld-end");
    table.fields.push(endField);
    const view = createBitableView("calendar", undefined, "vew-c");
    view.calendarStartFieldId = date.id;
    view.calendarEndFieldId = endField.id;
    view.calendarColorFieldId = status.id;
    const inProgress = status.options!.find((o) => o.name === "进行中")!;
    const mk = (id: string, title: string, start?: string, end?: string) => {
      const record = createBitableRecord(id);
      record.values[primary.id] = title;
      record.values[status.id] = inProgress.id;
      if (start !== undefined) record.values[date.id] = start;
      if (end !== undefined) record.values[endField.id] = end;
      return record;
    };
    const records = [mk("r1", "单人", "2026-09-02"), mk("r2", "无日期"), mk("r3", "倒挂", "2026-09-05", "2026-09-01"), mk("r4", "跨天", "2026-09-10", "2026-09-12")];
    const events = calendarEvents(table, view, records);
    expect(events.map((e) => e.recordId)).toEqual(["r1", "r3", "r4"]);
    expect(events[0]).toMatchObject({ title: "单人", start: "2026-09-02", end: "2026-09-02", optionId: inProgress.id, color: inProgress.color });
    expect(events[1].end).toBe("2026-09-05");
    const byDay = calendarEventsByDay(events);
    expect([...byDay.keys()].sort()).toEqual(["2026-09-02", "2026-09-05", "2026-09-10", "2026-09-11", "2026-09-12"]);
    expect(byDay.get("2026-09-11")!.map((e) => e.recordId)).toEqual(["r4"]);
    expect(calendarEvents(table, createBitableView("calendar", undefined, "vew-c2"), records)).toEqual([]);
  });

  it("日历拖拽：保持时长整体平移；结束为空只动开始日期；原地拖返回空补丁", () => {
    const table = createDefaultBitableTable("t", "tbl-cal2");
    const date = table.fields[2];
    const endField = createBitableField("date", "结束", "fld-end");
    table.fields.push(endField);
    const view = createBitableView("calendar", undefined, "vew-c3");
    view.calendarStartFieldId = date.id;
    view.calendarEndFieldId = endField.id;
    const record = createBitableRecord("r1");
    record.values[date.id] = "2026-09-10";
    record.values[endField.id] = "2026-09-12";
    expect(calendarMovePatch(table, view, record, "2026-09-20")).toEqual({ [date.id]: "2026-09-20", [endField.id]: "2026-09-22" });
    expect(calendarMovePatch(table, view, record, "2026-09-10")).toEqual({});
    const single = createBitableRecord("r2");
    single.values[date.id] = "2026-09-10";
    expect(calendarMovePatch(table, view, single, "2026-09-11")).toEqual({ [date.id]: "2026-09-11" });
    expect(calendarMovePatch(table, view, createBitableRecord("r3"), "2026-09-11")).toEqual({});
  });

  it("T02A 基础字段：布尔/链接/评分/进度的展示与数值口径；系统时间读记录时间戳", () => {
    const table = createDefaultBitableTable("t", "tbl-t02a");
    const primary = table.fields[0];
    const bool = createBitableField("boolean", "布尔", "fld-bool");
    const link = createBitableField("link", "链接", "fld-link");
    const rating = createBitableField("rating", "评分", "fld-rate");
    const progress = createBitableField("progress", "进度", "fld-prog");
    const created = createBitableField("createdTime", "创建时间", "fld-ct");
    const updated = createBitableField("updatedTime", "修改时间", "fld-ut");
    table.fields.push(bool, link, rating, progress, created, updated);
    expect(isKnownFieldType("boolean")).toBe(true);
    expect(BITABLE_FIELD_TYPES).toContain("progress");
    expect(BITABLE_FIELD_TYPE_LABEL.createdTime).toBe("创建时间");
    expect(isNumericFieldType("rating")).toBe(true);
    expect(isNumericFieldType("progress")).toBe(true);
    expect(isNumericFieldType("text")).toBe(false);
    expect(isSystemTimeField("createdTime")).toBe(true);
    expect(isSystemTimeField("date")).toBe(false);
    expect(bitableDisplayValue(bool, true)).toBe("是");
    expect(bitableDisplayValue(bool, false)).toBe("否");
    expect(bitableDisplayValue(bool, undefined)).toBe("");
    expect(bitableDisplayValue(link, "https://x.dev")).toBe("https://x.dev");
    expect(bitableDisplayValue(rating, 4)).toBe("4");
    expect(bitableDisplayValue(progress, 60)).toBe("60");
    const record = createBitableRecord("r1");
    record.createdAt = "2026-09-28T01:30:00.000Z";
    record.updatedAt = "2026-09-28T02:45:00.000Z";
    record.values[primary.id] = "标题";
    // 管线取值 = 本地日期（与 date 同域）；展示文本到分钟
    expect(bitableFieldValue(record, created)).toBe(localDateString(record.createdAt));
    expect(bitableFieldText(record, created)).toBe(localDateTimeString(record.createdAt));
    expect(bitableFieldText(record, updated)).toBe(localDateTimeString(record.updatedAt));
    // 数值口径：评分/进度参与排序、统计、筛选操作符
    const mk = (id: string, r: number, p: number) => { const x = createBitableRecord(id); x.values[rating.id] = r; x.values[progress.id] = p; return x; };
    table.records = [mk("r1", 3, 10), mk("r2", 5, 90), mk("r3", 1, 50)];
    const view = createBitableView("grid", "g", "vew-t02a");
    view.sorts = [{ fieldId: rating.id }];
    expect(applyViewToRecords(table, view).map((x) => x.id)).toEqual(["r3", "r1", "r2"]);
    expect(computeColumnStat(rating, table.records, "sum")).toBe("9");
    expect(computeColumnStat(progress, table.records, "max")).toBe("90");
    expect(filterOperatorsFor(rating)).toContain("gte");
    expect(filterOperatorsFor(bool)).toEqual(["equals", "notEquals", "isEmpty", "isNotEmpty"]);
    // 默认值预填（false / 0 不能被当成空值丢掉）
    bool.defaultValue = false;
    rating.defaultValue = 0;
    progress.defaultValue = 25;
    link.defaultValue = "https://a.dev";
    const defaults = defaultRecordValues(table);
    expect(defaults[bool.id]).toBe(false);
    expect(defaults[rating.id]).toBe(0);
    expect(defaults[progress.id]).toBe(25);
    expect(defaults[link.id]).toBe("https://a.dev");
  });

  it("系统时间字段（创建/修改时间）能参与筛选、排序、分组与列统计", () => {
    const table = createDefaultBitableTable("t", "tbl-systime");
    const primary = table.fields[0];
    const created = createBitableField("createdTime", "创建时间", "fld-ct");
    table.fields.push(created);
    const mk = (id: string, title: string, iso: string) => {
      const record = createBitableRecord(id);
      record.values[primary.id] = title;
      record.createdAt = iso;
      record.updatedAt = iso;
      return record;
    };
    table.records = [
      mk("r1", "C", "2026-09-03T10:00:00.000Z"),
      mk("r2", "A", "2026-09-01T10:00:00.000Z"),
      mk("r3", "B", "2026-09-05T10:00:00.000Z"),
    ];
    const view = createBitableView("grid", "g", "vew-systime");
    // 排序：按创建时间升序/降序
    view.sorts = [{ fieldId: created.id }];
    expect(applyViewToRecords(table, view).map((r) => r.id)).toEqual(["r2", "r1", "r3"]);
    view.sorts = [{ fieldId: created.id, desc: true }];
    expect(applyViewToRecords(table, view).map((r) => r.id)).toEqual(["r3", "r1", "r2"]);
    // 筛选：操作符与 date 同口径（gte），值域 = 本地日期
    expect(filterOperatorsFor(created)).toContain("gte");
    view.sorts = [];
    view.filters = [{ fieldId: created.id, operator: "gte", value: localDateString("2026-09-03T10:00:00.000Z") }];
    expect(applyViewToRecords(table, view).map((r) => r.id)).toEqual(["r1", "r3"]);
    view.filters = [];
    // 分组 + 列统计：走同一取值口径
    const tree = groupRecordsTree(table, table.records, [{ fieldId: created.id }]);
    expect(tree.map((n) => n.label)).toEqual([localDateString(table.records[1].createdAt), localDateString(table.records[0].createdAt), localDateString(table.records[2].createdAt)]);
    expect(statsForField(created)).toContain("dateRange");
    expect(computeColumnStat(created, table.records, "earliestDate")).toBe(localDateString(table.records[1].createdAt));
    expect(computeColumnStat(created, table.records, "dateRange")).toBe("5 天");
  });

  it("语义排序（T04）：单选/多选按选项顺序（空值恒最后），多条件稳定，字典序不受影响", () => {
    const table = createDefaultBitableTable("t", "tbl-sort");
    const primary = table.fields[0];
    const status = table.fields[1];
    const ids = status.options!.map((o) => o.id);
    const multi = createBitableField("multiSelect", "多选", "fld-multi");
    multi.options = [...status.options!];
    table.fields.push(multi);
    const mk = (id: string, opt: string, multiVal: string[]) => { const record = createBitableRecord(id); record.values[primary.id] = id; record.values[status.id] = opt; record.values[multi.id] = multiVal; return record; };
    table.records = [mk("r1", ids[2], [ids[2]]), mk("r2", ids[0], [ids[0]]), mk("r3", "", []), mk("r4", ids[1], [ids[1], ids[2]]), mk("r5", ids[0], [ids[0]])];
    const view = createBitableView("grid", "g", "vew-sort");
    view.sorts = [{ fieldId: status.id, mode: "optionOrder" }];
    expect(applyViewToRecords(table, view).map((r) => r.id)).toEqual(["r2", "r5", "r4", "r1", "r3"]);
    view.sorts = [{ fieldId: status.id, mode: "optionOrder", desc: true }];
    expect(applyViewToRecords(table, view).map((r) => r.id)).toEqual(["r1", "r4", "r2", "r5", "r3"]);
    view.sorts = [{ fieldId: multi.id, mode: "optionOrder" }];
    expect(applyViewToRecords(table, view).map((r) => r.id)).toEqual(["r2", "r5", "r4", "r1", "r3"]);
    // 多条件：状态选项序 + 主字段降序 → 同组内按第二条件稳定排
    view.sorts = [{ fieldId: status.id, mode: "optionOrder" }, { fieldId: primary.id, desc: true }];
    expect(applyViewToRecords(table, view).map((r) => r.id)).toEqual(["r5", "r2", "r4", "r1", "r3"]);
    // 原有字典序不受影响
    view.sorts = [{ fieldId: primary.id }];
    expect(applyViewToRecords(table, view).map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
  });

  it("列统计：通用/数字/日期口径，空值与非法值不参与，附件关联不崩", () => {
    const table = createDefaultBitableTable("t", "tbl-stat");
    const primary = table.fields[0];
    const status = table.fields[1];
    const date = table.fields[2];
    const num = createBitableField("number", "数量", "fld-num");
    const att = createBitableField("attachment", "附件", "fld-att");
    const rel = createBitableField("relation", "关联", "fld-rel");
    table.fields.push(num, att, rel);
    const optionIds = status.options!.map((o) => o.id);
    const mk = (id: string, title: string, n: number | "", day: string, opt: string) => {
      const record = createBitableRecord(id);
      record.values[primary.id] = title;
      record.values[num.id] = n;
      record.values[date.id] = day;
      record.values[status.id] = opt;
      return record;
    };
    const records = [mk("r1", "A", 1, "2026-09-01", optionIds[0]), mk("r2", "B", 2, "2026-09-03", optionIds[1]), mk("r3", "C", "", "2026-09-05", optionIds[0]), mk("r4", "D", 4, "2026-09-09", optionIds[0])];
    expect(computeColumnStat(primary, records, "count")).toBe("4");
    expect(computeColumnStat(num, records, "filled")).toBe("3");
    expect(computeColumnStat(num, records, "empty")).toBe("1");
    expect(computeColumnStat(primary, records, "unique")).toBe("4");
    expect(computeColumnStat(status, records, "unique")).toBe("2");
    expect(computeColumnStat(num, records, "percentFilled")).toBe("75%");
    expect(computeColumnStat(num, records, "percentEmpty")).toBe("25%");
    expect(computeColumnStat(primary, records, "percentUnique")).toBe("100%");
    expect(computeColumnStat(num, records, "sum")).toBe("7");   // 空格子不能当 0
    expect(computeColumnStat(num, records, "average")).toBe("2.333");
    expect(computeColumnStat(num, records, "median")).toBe("2");   // 1,2,4 → 中位 2
    expect(computeColumnStat(num, records, "min")).toBe("1");
    expect(computeColumnStat(num, records, "max")).toBe("4");
    expect(computeColumnStat(date, records, "earliestDate")).toBe("2026-09-01");
    expect(computeColumnStat(date, records, "latestDate")).toBe("2026-09-09");
    expect(computeColumnStat(date, records, "dateRange")).toBe("9 天");
    expect(computeColumnStat(date, records, "monthRange")).toBe("1 月");   // 同月
    // 附件 / 关联走通用口径不崩；无值 → "—"
    expect(computeColumnStat(att, records, "filled")).toBe("0");
    expect(computeColumnStat(rel, records, "unique")).toBe("0");
    expect(computeColumnStat(num, [], "sum")).toBe("—");
    expect(computeColumnStat(num, [], "count")).toBe("0");
    // 每种字段的可选项**严格对齐云端 config 的 types 限制**
    expect(statsForField(num)).toEqual(["count", "filled", "empty", "unique", "percentFilled", "percentEmpty", "percentUnique", "sum", "average", "median", "max", "min"]);
    expect(statsForField(primary)).not.toContain("sum");       // 文本没有求和
    expect(statsForField(date).slice(-4)).toEqual(["earliestDate", "latestDate", "dateRange", "monthRange"]);
    const progressField = createBitableField("progress", "进度", "fld-prog-stat");
    const boolField = createBitableField("boolean", "复选框", "fld-bool-stat");
    expect(statsForField(progressField)).toEqual(["count", "filled", "empty", "unique", "percentFilled", "percentEmpty", "percentUnique", "max", "min"]);   // 进度：只有最大最小、无求和
    expect(statsForField(boolField)).toEqual(["count", "checked", "unchecked", "percentChecked", "percentUnchecked"]);   // 复选框专属
    // 复选框口径
    const boxRecords = [1, 2, 3, 4].map((i) => { const rc = createBitableRecord("b" + i); rc.values[boolField.id] = i <= 3; return rc; });
    expect(computeColumnStat(boolField, boxRecords, "checked")).toBe("3");
    expect(computeColumnStat(boolField, boxRecords, "unchecked")).toBe("1");
    expect(computeColumnStat(boolField, boxRecords, "percentChecked")).toBe("75%");
    expect(computeColumnStat(boolField, boxRecords, "percentUnchecked")).toBe("25%");
    // 视图配置：未配置/不认识 → 不统计
    const view = createBitableView("grid", "g", "vew-stat");
    expect(statForField(view, num.id)).toBeUndefined();
    view.columnStats = { [num.id]: "sum" };
    expect(statForField(view, num.id)).toBe("sum");
    expect(statForField(view, primary.id)).toBeUndefined();
    // 序列化往返保留统计配置
    table.views = [view];
    table.activeViewId = view.id;
    const parsed = parseBitableBody(bitablesToBody([table], table.id))!;
    expect(parsed.tables[0].views[0].columnStats).toEqual({ [num.id]: "sum" });
  });

  it("日历字段解析：类型不符即无效；标题回落主字段；颜色只认单选", () => {
    const table = createDefaultBitableTable("t", "tbl-cal3");
    const view = createBitableView("calendar", undefined, "vew-c4");
    expect(bitableDateFields(table).map((f) => f.type)).toEqual(["date"]);
    expect(calendarStartField(table, view)).toBeUndefined();
    view.calendarStartFieldId = table.fields[0].id;
    expect(calendarStartField(table, view)).toBeUndefined();
    expect(calendarTitleField(table, view)?.id).toBe(table.fields[0].id);
    view.calendarTitleFieldId = table.fields[2].id;
    expect(calendarTitleField(table, view)?.id).toBe(table.fields[2].id);
    view.calendarColorFieldId = table.fields[1].id;
    expect(calendarColorField(table, view)?.id).toBe(table.fields[1].id);
    view.calendarColorFieldId = table.fields[0].id;
    expect(calendarColorField(table, view)).toBeUndefined();
    view.calendarEndFieldId = table.fields[1].id;
    expect(calendarEndField(table, view)).toBeUndefined();
  });
});
