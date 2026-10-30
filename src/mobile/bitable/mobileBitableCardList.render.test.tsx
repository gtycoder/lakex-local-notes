import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { MobileBitableCardList } from "./MobileBitableCardList";
import { resolveRecordLayout } from "../../core/bitableRecordLayout";
import { createBitableField, createBitableRecord, createBitableView, createDefaultBitableTable } from "../../core/bitableDoc";

const ts = "2026-09-01T00:00:00.000Z";

function fixture() {
  const table = createDefaultBitableTable("收集表");
  table.id = "t1";
  table.fields = [
    createBitableField("select", "类型", "f-type"),
    createBitableField("text", "内容", "f-content"),
    createBitableField("attachment", "附件", "f-file"),
    createBitableField("date", "日期", "f-date"),
  ];
  table.fields[0].options = [{ id: "o1", name: "复盘", color: "#2b7350" }];
  const view = { ...createBitableView("grid", "内容", "v1"), groups: [{ fieldId: "f-date" }] };
  table.views = [view];
  table.activeViewId = view.id;
  table.records = [
    { ...createBitableRecord("r1"), createdAt: ts, updatedAt: ts, values: { "f-type": "o1", "f-content": "内容一", "f-date": "2026-06-09" } },
    { ...createBitableRecord("r2"), createdAt: ts, updatedAt: ts, values: { "f-type": "o1", "f-content": "内容二", "f-date": "2026-06-10" } },
  ];
  return { table, view };
}

const render = (table: ReturnType<typeof fixture>["table"], view: ReturnType<typeof fixture>["view"], prefs: Parameters<typeof resolveRecordLayout>[2]) =>
  renderToStaticMarkup(createElement(MobileBitableCardList, {
    noteId: "n1", table, view, records: table.records,
    layout: resolveRecordLayout(table, view, prefs), ctx: { tables: [table] }, onOpen: () => {},
  }));

describe("MobileBitableCardList（卡片布局）", () => {
  it("按视图分组成卡片；卡片含主标题、副标题与展示字段行", () => {
    const { table, view } = fixture();
    const html = render(table, view, { mode: "card", subtitleFieldId: "f-content" });
    expect(html).toContain("mbt-cards__ghead");
    expect(html).toContain("2026-06-09");
    expect(html).toContain("内容一");
    expect(html).toContain("mbt-card__k");
    expect(html).toContain(">日期<");
    expect(html).toContain('aria-label="查看记录"');
  });

  it("列数 1/2 走不同 grid 类；2 列时标签改成上下排布（由 CSS 承担，这里只验类名）", () => {
    const { table, view } = fixture();
    expect(render(table, view, { mode: "card", columns: 1 })).toContain("mbt-cards__list cols-1");
    expect(render(table, view, { mode: "card", columns: 2 })).toContain("mbt-cards__list cols-2");
  });

  it("封面开关打开且存在附件字段时渲染封面区", () => {
    const { table, view } = fixture();
    const withFile = {
      ...table,
      records: table.records.map((record, index) => index === 0
        ? { ...record, values: { ...record.values, "f-file": [{ file: "a.jpg", name: "封面.jpg", size: 1 }] } }
        : record),
    };
    const html = renderToStaticMarkup(createElement(MobileBitableCardList, {
      noteId: "n1", table: withFile, view, records: withFile.records,
      layout: resolveRecordLayout(withFile, view, { mode: "card", cover: true }), ctx: { tables: [withFile] }, onOpen: () => {},
    }));
    expect(html).toContain("mbt-card__cover");
  });
});
