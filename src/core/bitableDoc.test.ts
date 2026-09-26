import { describe, expect, it } from "vitest";
import { extractAssetRefs } from "./assetNaming.js";
import {
  applyViewToRecords,
  bitableAttachments,
  bitableDisplayValue,
  bitableRecordTitle,
  removeBitableAttachment,
  renameBitableAttachment,
  reorderBitableAttachments,
  attachmentGridColumns,
  defaultRecordValues,
  bitableToSearchText,
  bitablesToBody,
  createBitableField,
  createBitableRecord,
  createBitableView,
  createDefaultBitableTable,
  emptyBitableBody,
  orderedTableFields,
  parseBitableBody,
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

  it("附件单元格：磁盘名进正文 → 能被 extractAssetRefs 提取（统一资产管线/声明/GC 保护）", () => {
    const table = createDefaultBitableTable("t", "tbl1");
    const af = createBitableField("attachment", "附件", "fld-att");
    table.fields.push(af);
    const rec = createBitableRecord("rec1");
    rec.values[af.id] = [{ file: "1700000000000_ab12cd34.png", name: "照片.png" }];
    table.records.push(rec);
    const refs = extractAssetRefs(bitablesToBody([table], "tbl1"));
    expect([...refs]).toContain("1700000000000_ab12cd34.png");
  });

  it("附件单元格：file 定位磁盘文件、name 用于展示（展示名不参与资产引用）", () => {
    const field = createBitableField("attachment", "附件", "fld-att");
    const value = [
      { file: "1700000000000_ab12cd34.mp3", name: "鞠磊8.27音频.mp3" },
      { file: "1700000000001_cd34ab12.pptx" },
    ];
    expect(bitableAttachments(value)).toEqual([
      { file: "1700000000000_ab12cd34.mp3", name: "鞠磊8.27音频.mp3" },
      { file: "1700000000001_cd34ab12.pptx", name: "1700000000001_cd34ab12.pptx" },
    ]);
    expect(bitableDisplayValue(field, value)).toBe("鞠磊8.27音频.mp3, 1700000000001_cd34ab12.pptx");
  });

  it("附件单元格：非法条目直接丢弃（缺 file / 非对象 / 非数组）", () => {
    expect(bitableAttachments(null)).toEqual([]);
    expect(bitableAttachments("1700000000000_ab12cd34.png")).toEqual([]);
    expect(bitableAttachments([{ name: "只有展示名.png" }, "旧的字符串值.png", null, 42])).toEqual([]);
  });

  it("removeBitableAttachment：按磁盘名删除，展示名不同也不误删", () => {
    const value = [
      { file: "1700000000000_ab12cd34.mp3", name: "a.mp3" },
      { file: "1700000000001_cd34ab12.mp3", name: "b.mp3" },
    ];
    expect(removeBitableAttachment(value, "1700000000001_cd34ab12.mp3")).toEqual([
      { file: "1700000000000_ab12cd34.mp3", name: "a.mp3" },
    ]);
  });

  it("renameBitableAttachment：只改展示名、磁盘名不动；空名视为放弃编辑", () => {
    const value = [{ file: "1700000000000_ab12cd34.mp3", name: "a.mp3" }];
    expect(renameBitableAttachment(value, "1700000000000_ab12cd34.mp3", "  演示音频  ")).toEqual([
      { file: "1700000000000_ab12cd34.mp3", name: "演示音频" },
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
      { file: "1700000000000_ab12cd34.mp3", name: "a.mp3" },
      { file: "1700000000001_cd34ab12.mp3", name: "b.mp3" },
      { file: "1700000000002_ef56ab78.mp4", name: "c.mp4" },
    ];
    expect(reorderBitableAttachments(value, ["1700000000002_ef56ab78.mp4", "1700000000000_ab12cd34.mp3", "1700000000001_cd34ab12.mp3"])).toEqual([
      { file: "1700000000002_ef56ab78.mp4", name: "c.mp4" },
      { file: "1700000000000_ab12cd34.mp3", name: "a.mp3" },
      { file: "1700000000001_cd34ab12.mp3", name: "b.mp3" },
    ]);
    expect(reorderBitableAttachments(value, ["1700000000001_cd34ab12.mp3"])).toEqual([
      { file: "1700000000001_cd34ab12.mp3", name: "b.mp3" },
      { file: "1700000000000_ab12cd34.mp3", name: "a.mp3" },
      { file: "1700000000002_ef56ab78.mp4", name: "c.mp4" },
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
});
