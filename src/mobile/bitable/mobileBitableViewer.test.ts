import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MobileBitableViewer } from "./MobileBitableViewer";

const ts = "2026-09-01T00:00:00.000Z";
const body = JSON.stringify({
  kind: "bitable",
  version: 1,
  activeTableId: "t1",
  tables: [
    {
      id: "t1",
      name: "第一个",
      activeViewId: "v1",
      views: [{ id: "v1", name: "表格视图", type: "grid", rowHeight: "low" }],
      fields: [
        { id: "f-text", name: "文本", type: "text" },
        { id: "f-bool", name: "布尔值", type: "boolean" },
        { id: "f-link", name: "链接", type: "link" },
        { id: "f-rate", name: "评分", type: "rating" },
        { id: "f-prog", name: "进度", type: "progress" },
        { id: "f-rel", name: "关联", type: "relation", relation: { tableId: "t2", mode: "oneWay", allowMultiple: true } },
        { id: "f-created", name: "创建时间", type: "createdTime" },
      ],
      records: [
        {
          id: "r1",
          createdAt: ts,
          updatedAt: ts,
          values: {
            "f-text": "记录一",
            "f-bool": true,
            "f-link": "https://example.com/x",
            "f-rate": 4,
            "f-prog": 60,
            "f-rel": ["d1"],
          },
        },
      ],
    },
    {
      id: "t2",
      name: "目标表",
      activeViewId: "v2",
      views: [{ id: "v2", name: "表格视图", type: "grid", rowHeight: "low" }],
      fields: [{ id: "f-name", name: "名称", type: "text" }],
      records: [{ id: "d1", createdAt: ts, updatedAt: ts, values: { "f-name": "目标甲" } }],
    },
  ],
});

const render = (content: string) => renderToStaticMarkup(createElement(MobileBitableViewer, { noteId: "n1", content }));

describe("MobileBitableViewer 只读单元", () => {
  it("布尔/链接/评分/进度/关联都渲染只读控件（不是裸文本）", () => {
    const html = render(body);
    expect(html).toContain('class="mbt-bool"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('href="https://example.com/x"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("mbt-star is-on");
    expect(html).toContain("mbt-progress-bar");
    expect(html).toContain("60%");
    expect(html).toContain("mbt-relation-chip");
    expect(html).toContain("目标甲");
    // 系统时间仍走展示文本（到分钟）
    expect(html).toContain("2026-09-01 08:00");
  });

  it("非 grid 视图给明确只读回退提示（不空白）", () => {
    const kanban = JSON.stringify({
      kind: "bitable",
      version: 1,
      activeTableId: "t1",
      tables: [
        {
          id: "t1",
          name: "表",
          activeViewId: "vk",
          views: [{ id: "vk", name: "看板视图", type: "kanban", rowHeight: "low" }],
          fields: [{ id: "f", name: "文本", type: "text" }],
          records: [{ id: "r", createdAt: ts, updatedAt: ts, values: { f: "x" } }],
        },
      ],
    });
    const html = render(kanban);
    expect(html).toContain("mbt-view-notice");
    expect(html).toContain("移动端暂以表格只读展示");
  });
});
