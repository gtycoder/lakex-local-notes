import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { MobileBitableRecordPage } from "./MobileBitableRecordPage";
import { orderedTableFields, createBitableField, createBitableRecord, createBitableView, createDefaultBitableTable } from "../../core/bitableDoc";

const ts = "2026-09-01T00:00:00.000Z";

function fixture() {
  const table = createDefaultBitableTable("收集表");
  table.fields = [
    createBitableField("text", "标题", "f-title"),
    createBitableField("text", "内容", "f-content"),
  ];
  const view = createBitableView("grid", "内容", "v1");
  table.views = [view];
  table.activeViewId = view.id;
  const record = { ...createBitableRecord("r1"), createdAt: ts, updatedAt: ts, values: { "f-title": "记录一", "f-content": "正文" } };
  table.records = [record];
  return { table, view, record };
}

describe("MobileBitableRecordPage（只读详情）", () => {
  it("整页展示：标题 = 主字段值、只读徽标、字段逐行、1/N 翻页", () => {
    const { table, view, record } = fixture();
    const html = renderToStaticMarkup(createElement(MobileBitableRecordPage, {
      noteId: "n1", table, fields: orderedTableFields(table, view), record, ctx: { tables: [table] },
      index: 0, total: 3, onPrev: () => {}, onNext: () => {}, onClose: () => {},
    }));
    expect(html).toContain("mbt-page");
    expect(html).toContain("记录详情");
    expect(html).toContain(">只读<");
    expect(html).toContain("mbt-page-title");
    expect(html).toContain("记录一");
    expect(html).toContain("mbt-detail-row");
    expect(html).toContain("1/3");
    expect(html).toContain('aria-label="下一条"');
  });
});
