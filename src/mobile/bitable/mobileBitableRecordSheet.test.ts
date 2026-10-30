/**
 * 移动端多维表「记录」面板护栏（261020 P0）：**按字段类型给对控件**是这一层的核心承诺，
 * 用静态渲染钉住（触屏交互由设备验收覆盖）。
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createBitableField, createBitableFieldOptions, type BitableRecord, type BitableTable } from "../../core/bitableDoc.js";
import { MobileBitableRecordSheet } from "./MobileBitableRecordSheet";

const ts = "2026-10-20T00:00:00.000Z";
const fields = [
  createBitableField("text", "标题"),
  createBitableField("number", "数量"),
  createBitableField("date", "截止日"),
  { ...createBitableField("select", "状态"), options: createBitableFieldOptions(["进行中", "已完成"]) },
  { ...createBitableField("multiSelect", "标签"), options: createBitableFieldOptions(["重要", "紧急"]) },
  createBitableField("boolean", "已完成标志"),
  createBitableField("link", "链接"),
  createBitableField("rating", "评分"),
  createBitableField("progress", "进度"),
  createBitableField("attachment", "附件"),
  createBitableField("relationOneWay", "关联"),
];
const table: BitableTable = {
  id: "t1",
  name: "任务表",
  activeViewId: "v1",
  views: [{ id: "v1", name: "表格视图", type: "grid", rowHeight: "low" }],
  fields,
  records: [],
};
const selectField = fields[3];
const multiField = fields[4];
const record: BitableRecord = {
  id: "r1",
  createdAt: ts,
  updatedAt: ts,
  values: {
    [fields[0].id]: "写交接",
    [fields[1].id]: "3",
    [fields[2].id]: "2026-10-20",
    [selectField.id]: selectField.options?.[0].id ?? "",
    [multiField.id]: [multiField.options?.[1].id ?? ""],
    [fields[5].id]: true,
    [fields[6].id]: "https://example.com/x",
    [fields[7].id]: 4,
    [fields[8].id]: 60,
  },
};

const html = renderToStaticMarkup(createElement(MobileBitableRecordSheet, {
  noteId: "n1",
  table,
  fields,
  record,
  ctx: { tables: [table] },
  onPatch: () => {},
  onAddOption: () => null,
  onDelete: () => {},
  onClose: () => {},
}));

describe("MobileBitableRecordSheet", () => {
  it("按字段类型给控件：布尔=开关、单选/多选=选项 chips、评分=星、进度=滑杆", () => {
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("mbt-option-chips");
    expect(html).toContain("进行中");
    expect(html).toContain("mbt-option is-on"); // 已选中的单选
    expect(html).toContain('aria-label="新建选项"');
    expect(html).toContain("mbt-rating-btn");
    expect(html).toContain('type="range"');
    expect(html).toContain("60%");
  });

  it("文本/数字/日期/链接给输入框（日期走系统 date 控件）", () => {
    expect(html).toContain('aria-label="文本值"');
    expect(html).toContain('aria-label="数字值"');
    // 261030：日期改自有选择器（不再用系统 date 控件）
    expect(html).toContain("mbt-date-trigger");
    expect(html).toContain("2026-10-20");
    expect(html).toContain("https://example.com/x");
  });

  it("附件/图片可上传（261030 P1）；关联等不可编辑字段仍只读 + 明确理由", () => {
    expect(html).toContain("mbt-file-add");
    expect(html).toContain("上传附件");
    expect(html).not.toContain("附件字段：移动端暂只读");
    expect(html).toContain("mbt-record-readonly");
    expect(html).toContain("关联字段：移动端暂只读");
  });

  it("有删除记录入口，且面板标题带表名", () => {
    expect(html).toContain("删除记录");
    expect(html).toContain("编辑记录：任务表");
    // 滚动/返回手势依赖：面板必须挂 data-prevent-swipe，否则右滑会被外层抽屉抢走
    expect(html).toContain("data-prevent-swipe");
  });
});
