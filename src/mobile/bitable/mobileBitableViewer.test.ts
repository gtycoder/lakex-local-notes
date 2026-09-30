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
        { id: "f-rel", name: "单向关联", type: "relationOneWay", relation: { tableId: "t2", allowMultiple: true } },
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

  it("附件字段用文档类型图标（图片字段仍是缩略图）", () => {
    const files = JSON.stringify({
      kind: "bitable",
      version: 1,
      activeTableId: "t1",
      tables: [
        {
          id: "t1",
          name: "表",
          activeViewId: "v1",
          views: [{ id: "v1", name: "表格视图", type: "grid", rowHeight: "low" }],
          fields: [
            { id: "f-att", name: "附件", type: "attachment" },
            { id: "f-img", name: "图片", type: "image" },
          ],
          records: [
            {
              id: "r1",
              createdAt: ts,
              updatedAt: ts,
              values: {
                "f-att": [
                  { file: "1790700946314_aaaa1111.pdf", name: "【期神笔记】2024.pdf", size: 1 },
                  { file: "1790700946314_bbbb2222.jpg", name: "阿贝多.jpg", size: 2 },
                ],
                "f-img": [{ file: "1790700946314_cccc3333.jpg", name: "阿贝多.jpg", size: 3 }],
              },
            },
          ],
        },
      ],
    });
    const html = render(files);
    // 附件字段：类型图标 + 名称（触屏没有 hover，名称不能收进气泡）
    expect(html).toContain("bt-file-icon--pdf");
    expect(html).toContain("bt-file-icon--image");
    expect(html).toContain("mbt-attachment-file is-kind");
    // 260930 大统一：截断走 kit 的 .ln-ellipsis（移动端也加载 themes/kit）
    expect(html).toContain('class="mbt-attachment-name ln-ellipsis"');
    // 计数口径：2 个类型图标（附件格里的 pdf + jpg），1 张缩略图（图片格，**不**变图标）
    // 每个图标类名形如 `lucide ... bt-file-icon bt-file-icon--pdf` ⇒ 用 `--` 形态计数（每个图标一次）
    expect((html.match(/bt-file-icon--/g) ?? []).length).toBe(2);
    expect((html.match(/class="mbt-attachment"/g) ?? []).length).toBe(1);
  });

  it("条件填色在移动端只读表格复用桌面投影（背景 + 行侧）", () => {
    const filled = JSON.stringify({
      kind: "bitable",
      version: 1,
      activeTableId: "t1",
      tables: [
        {
          id: "t1",
          name: "表",
          activeViewId: "v1",
          views: [{
            id: "v1",
            name: "表格视图",
            type: "grid",
            rowHeight: "low",
            fillRules: [
              { id: "f1", mode: "row", color: "#FFE8E6", condition: { fieldId: "f", operator: "contains", value: "x" } },
              { id: "f2", mode: "rowSide", color: "#FA541C", condition: { fieldId: "f", operator: "contains", value: "x" } },
            ],
          }],
          fields: [{ id: "f", name: "文本", type: "text" }],
          records: [{ id: "r", createdAt: ts, updatedAt: ts, values: { f: "x" } }],
        },
      ],
    });
    const html = render(filled);
    expect(html).toContain("linear-gradient(color-mix(in srgb, #FFE8E6 62%, transparent), color-mix(in srgb, #FFE8E6 62%, transparent))");
    expect(html).toContain('data-fill-side=""');
    expect(html).toContain("--mbt-fill-side:#FA541C");
  });
});
