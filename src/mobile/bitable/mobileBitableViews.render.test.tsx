import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MobileBitableKanbanView } from "./MobileBitableKanbanView";
import { MobileBitableGalleryView } from "./MobileBitableGalleryView";
import { MobileBitableCalendarView } from "./MobileBitableCalendarView";
import { createBitableField, createBitableRecord, createBitableView, createDefaultBitableTable, localDateString } from "../../core/bitableDoc";

const ts = "2026-09-01T00:00:00.000Z";
const today = localDateString(new Date());

function fixture() {
  const table = createDefaultBitableTable("收集表");
  table.fields = [
    { ...createBitableField("select", "类型", "f-type"), options: [{ id: "o1", name: "复盘", color: "green" }, { id: "o2", name: "提问", color: "blue" }] },
    createBitableField("text", "内容", "f-content"),
    createBitableField("attachment", "附件", "f-file"),
    createBitableField("date", "日期", "f-date"),
  ];
  table.records = [
    { ...createBitableRecord("r1"), createdAt: ts, updatedAt: ts, values: { "f-type": "o1", "f-content": "内容一", "f-date": today } },
    { ...createBitableRecord("r2"), createdAt: ts, updatedAt: ts, values: { "f-content": "内容二", "f-date": "2026-06-10" } },
    { ...createBitableRecord("r3"), createdAt: ts, updatedAt: ts, values: { "f-content": "未分组的一条" } },
  ];
  const kanban = { ...createBitableView("kanban", "看板", "v-kanban"), kanbanGroupFieldId: "f-type", kanbanFieldIds: ["f-content"] };
  const gallery = { ...createBitableView("gallery", "画册", "v-gallery"), galleryCoverFieldId: "f-file", galleryFieldIds: ["f-content"] };
  const calendar = { ...createBitableView("calendar", "日历", "v-calendar"), calendarStartFieldId: "f-date" };
  table.views = [kanban, gallery, calendar];
  table.activeViewId = kanban.id;
  return { table, kanban, gallery, calendar };
}

describe("移动端多维表 P2 视图", () => {
  it("看板：选项即分栏（空栏保留）+ 未分组垫底 + 卡片显示配置字段", () => {
    const { table, kanban } = fixture();
    const html = renderToStaticMarkup(createElement(MobileBitableKanbanView, {
      noteId: "n1", table, view: kanban, records: table.records, ctx: { tables: [table] }, onOpen: () => {},
    }));
    expect(html).toContain("mbt-kanban");
    expect(html).toContain("复盘");
    expect(html).toContain("提问");
    expect(html).toContain("未分组");
    expect(html).toContain("mbt-kanban-card__title"); // 卡片标题 = 主字段（类型）
    expect(html).toContain("mbt-kanban-card__k");
    expect(html).toContain("空"); // 提问栏当前没有记录
  });

  it("看板未配置分组字段时给明确指引（不留空白）", () => {
    const { table } = fixture();
    const html = renderToStaticMarkup(createElement(MobileBitableKanbanView, {
      noteId: "n1", table, view: createBitableView("kanban", "看板", "v2"), records: table.records, ctx: { tables: [table] }, onOpen: () => {},
    }));
    expect(html).toContain("mbt-view-empty");
    expect(html).toContain("分组字段");
  });

  it("画册：两列网格 + 无封面时给占位块与配置提示", () => {
    const { table, gallery } = fixture();
    const html = renderToStaticMarkup(createElement(MobileBitableGalleryView, {
      noteId: "n1", table, view: gallery, records: table.records, ctx: { tables: [table] }, onOpen: () => {},
    }));
    expect(html).toContain("mbt-gallery");
    expect(html).toContain("mbt-gallery-card__cover--empty");
    expect(html).toContain("mbt-gallery-card__title");
    expect(html).toContain("mbt-gallery-card__k");
  });

  it("日历：月网格（周一起始）+ 今天高亮 + 选中日日程", () => {
    const { table, calendar } = fixture();
    const html = renderToStaticMarkup(createElement(MobileBitableCalendarView, {
      table, view: calendar, records: table.records, ctx: { tables: [table] }, onOpen: () => {},
    }));
    expect(html).toContain("mbt-calendar");
    expect(html).toContain("年");
    expect(html).toContain("月");
    expect(html).toContain("is-today");
    expect(html).toMatch(/mbt-calendar-day[^"]*is-on/);
    expect(html).toContain("mbt-calendar-event__title"); // 今天那条日程（标题 = 主字段「类型」）
    expect(html).toContain("个日程");
  });

  it("日历未配置开始日期字段时给明确指引", () => {
    const { table } = fixture();
    const html = renderToStaticMarkup(createElement(MobileBitableCalendarView, {
      table, view: createBitableView("calendar", "日历", "v2"), records: table.records, ctx: { tables: [table] }, onOpen: () => {},
    }));
    expect(html).toContain("开始日期字段");
  });
});
