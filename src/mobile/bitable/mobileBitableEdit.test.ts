/**
 * 移动端多维表编辑纯逻辑护栏（261020 P0）。
 *
 * 这里钉住的是**正文语义**（不是 UI）：canonical 序列化、字段/记录/选项写入、分页窗口与取值转换。
 * 桌面与移动共用同一批 core 纯函数，因此这些断言也等于在保护桌面行为。
 */
import { describe, expect, it } from "vitest";
import {
  createBitableField,
  createBitableView,
  createDefaultBitableTable,
  parseBitableBody,
  type BitableDoc,
  type BitableTable,
} from "../../core/bitableDoc.js";
import {
  addMobileField, addMobileOption, addMobileRecord, dateInputValue, deleteMobileField, deleteMobileRecord,
  isMobileEditableField, mobileFieldNote, progressValue, ratingValue, recordWindow, renameMobileField,
  selectedOptionIds, serializeBitableBody, setMobileCell, textInputValue,
} from "./mobileBitableEdit";

function docOf(tables: BitableTable[], activeTableId?: string): BitableDoc {
  return { kind: "bitable", version: 1, tables, activeTableId: activeTableId ?? tables[0].id };
}

function tableWithText(records = 2): BitableTable {
  const table = createDefaultBitableTable("表一");
  return { ...table, records: table.records.slice(0, records) };
}

describe("移动端多维表 · 正文序列化", () => {
  it("导航字段恒写 canonical（第一张表 / 第一个视图）：切表/切视图不落盘、不进 S3", () => {
    const t1 = tableWithText();
    const secondView = createBitableView("grid", "第二个视图");
    t1.views = [...t1.views, secondView];
    t1.activeViewId = secondView.id; // 桌面上的"当前视图"不是第一个
    const t2 = { ...tableWithText(), id: "t2", name: "表二" };
    const body = serializeBitableBody([t1, t2]);
    const parsed = parseBitableBody(body);
    expect(parsed?.activeTableId).toBe(t1.id);
    expect(parsed?.tables[0].activeViewId).toBe(t1.views[0].id);
    expect(parsed?.tables[1].activeViewId).toBe(t2.views[0].id);
  });
});

describe("移动端多维表 · 单元格与字段写入", () => {
  it("setMobileCell 写值并更新 updatedAt；值未变返回原 doc（不产生空写入）", () => {
    const table = tableWithText();
    const doc = docOf([table]);
    const record = table.records[0];
    const next = setMobileCell(doc, table.id, record.id, table.fields[0].id, "改过");
    expect(next).not.toBe(doc);
    const nextRecord = next.tables[0].records.find((item) => item.id === record.id);
    expect(nextRecord).toBeTruthy();
    expect(nextRecord!.values[table.fields[0].id]).toBe("改过");
    expect(nextRecord!.updatedAt >= record.updatedAt).toBe(true);
    // 同值再写 = 原引用
    expect(setMobileCell(next, table.id, record.id, table.fields[0].id, "改过")).toBe(next);
  });

  it("addMobileField 追加字段（缺省名用类型名）；rename 空名/未变化都不写；delete 只剩一列时拒绝", () => {
    const table = tableWithText();
    const doc = docOf([table]);
    const withNumber = addMobileField(doc, table.id, "number");
    expect(withNumber.tables[0].fields.map((field) => field.type)).toEqual(["text", "number"]);
    expect(withNumber.tables[0].fields[1].name).toBe("数字");
    const named = addMobileField(withNumber, table.id, "date", "  截止日  ");
    expect(named.tables[0].fields[2].name).toBe("截止日");

    const fieldId = named.tables[0].fields[0].id;
    const renamed = renameMobileField(named, table.id, fieldId, "标题");
    expect(renamed.tables[0].fields[0].name).toBe("标题");
    expect(renameMobileField(renamed, table.id, fieldId, "   ")).toBe(renamed);
    expect(renameMobileField(renamed, table.id, fieldId, "标题")).toBe(renamed);

    const deleted = deleteMobileField(renamed, table.id, renamed.tables[0].fields[1].id);
    expect(deleted.tables[0].fields.length).toBe(2);
    const last = deleteMobileField(deleted, table.id, deleted.tables[0].fields[0].id);
    expect(last.tables[0].fields.length).toBe(1);
    // 只剩一个字段时 core 拒绝删除（返回原引用，UI 另给「至少保留一个字段」提示）
    expect(deleteMobileField(last, table.id, last.tables[0].fields[0].id)).toBe(last);
  });
});

describe("移动端多维表 · 记录与选项", () => {
  it("addMobileRecord 追加并按默认值填充；deleteMobileRecord 删除；不存在的 id 不产生空写入", () => {
    const table = tableWithText(2);
    const doc = docOf([table]);
    const added = addMobileRecord(doc, table.id);
    expect(added.doc.tables[0].records.length).toBe(3);
    expect(added.doc.tables[0].records.some((record) => record.id === added.recordId)).toBe(true);

    const removed = deleteMobileRecord(added.doc, table.id, added.recordId);
    expect(removed.tables[0].records.length).toBe(2);
    expect(deleteMobileRecord(removed, table.id, added.recordId)).toBe(removed);
  });

  it("addMobileOption：同名复用、新名建选项并返回 id；非单选/多选字段返回 null", () => {
    const table = tableWithText(1);
    const field = createBitableField("select", "状态");
    const doc = docOf([{ ...table, fields: [table.fields[0], field] }]);
    const first = addMobileOption(doc, table.id, field.id, "进行中");
    expect(first.optionId).toBeTruthy();
    const created = first.doc.tables[0].fields.find((item) => item.id === field.id);
    expect(created?.options?.map((option) => option.name)).toEqual(["进行中"]);
    // 同名复用：doc 不变、返回既有 id
    const again = addMobileOption(first.doc, table.id, field.id, "进行中");
    expect(again.doc).toBe(first.doc);
    expect(again.optionId).toBe(first.optionId);
    // 空名 / 非选项字段
    expect(addMobileOption(first.doc, table.id, field.id, "  ").optionId).toBeNull();
    expect(addMobileOption(first.doc, table.id, table.fields[0].id, "x").optionId).toBeNull();
  });
});

describe("移动端多维表 · 窗口与取值", () => {
  it("recordWindow 只切挂载段，总数不变（不静默裁剪）", () => {
    const table = tableWithText(1);
    const records = Array.from({ length: 250 }, (_, index) => ({ ...table.records[0], id: "r" + index }));
    const first = recordWindow(records, 100);
    expect(first.visible.length).toBe(100);
    expect(first.total).toBe(250);
    expect(first.remaining).toBe(150);
    const all = recordWindow(records, 1000);
    expect(all.visible.length).toBe(250);
    expect(all.remaining).toBe(0);
  });

  it("取值口径与桌面单元格一致（日期/数字/评分/进度/选项）", () => {
    expect(dateInputValue("2026-10-20T00:00:00.000Z")).toBe("2026-10-20");
    expect(dateInputValue(null)).toBe("");
    expect(textInputValue(60)).toBe("60");
    expect(textInputValue(undefined)).toBe("");
    expect(ratingValue(4.6)).toBe(5);
    expect(ratingValue(0)).toBe(0);
    expect(ratingValue(99)).toBe(5);
    expect(progressValue("")).toBe(0);
    expect(progressValue("150")).toBe(100);
    expect(progressValue(42.4)).toBe(42);
    expect(selectedOptionIds("a")).toEqual(["a"]);
    expect(selectedOptionIds(["a", 3, "b"])).toEqual(["a", "b"]);
    expect(selectedOptionIds(undefined)).toEqual([]);
  });

  it("可编辑字段清单 = P0 九种；其余类型给明确理由（不能静默不可点）", () => {
    for (const type of ["text", "number", "date", "select", "multiSelect", "boolean", "link", "rating", "progress"] as const) {
      expect(isMobileEditableField(createBitableField(type))).toBe(true);
    }
    const attachment = createBitableField("attachment");
    // 261030 P1：附件/图片改为可上传（表单 + 记录面板共用上传控件）
    expect(isMobileEditableField(attachment)).toBe(true);
    expect(isMobileEditableField(createBitableField("image"))).toBe(true);
    expect(mobileFieldNote(attachment)).toContain("附件");
    expect(mobileFieldNote(createBitableField("relationOneWay"))).toContain("关联");
    expect(mobileFieldNote(createBitableField("createdTime"))).toContain("自动生成");
  });
});
