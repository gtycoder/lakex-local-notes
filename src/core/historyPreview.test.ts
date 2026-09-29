import { describe, expect, it } from "vitest";
import { boardToBody, createBoardDoc, emptyBoardBody } from "./boardDoc.js";
import { bitablesToBody, createBitableRecord, createDefaultBitableTable } from "./bitableDoc.js";
import { sheetsToBody } from "./sheetDoc.js";
import { snapshotPreview } from "./historyPreview.js";

/**
 * 历史快照结构化预览模型（260926）。
 * 用户报「历史快照里画板/数据表/表格预览还是 json」——根因是预览按 Lake HTML 处理 JSON 正文。
 * 这里覆盖三种类型的派生结果与兜底（坏正文不能渲染成误导性的"空内容"）。
 */
const sheetBody = () => sheetsToBody([
  { name: "Sheet1", row: 50, column: 15, celldata: [
    { r: 0, c: 0, v: { m: "姓名" } },
    { r: 0, c: 1, v: { m: "分数" } },
    { r: 1, c: 0, v: { m: "小明" } },
    { r: 1, c: 1, v: { m: "95" } },
  ] },
  { name: "Sheet2", row: 50, column: 15, celldata: [] },
]);

describe("历史快照结构化预览", () => {
  it("表格：工作表数 + 前几行的值（不是 JSON）", () => {
    const blocks = snapshotPreview("sheet", sheetBody());
    const facts = blocks.find((b) => b.type === "facts");
    expect(facts && facts.type === "facts" ? facts.items[0][1] : "").toBe("2 个");
    const table = blocks.find((b) => b.type === "table");
    expect(table).toBeTruthy();
    if (table?.type === "table") {
      expect(table.head.slice(0, 2)).toEqual(["A", "B"]);
      expect(table.rows[0].slice(0, 2)).toEqual(["姓名", "分数"]);
      expect(table.rows[1].slice(0, 2)).toEqual(["小明", "95"]);
      expect(table.more).toContain("2 行 × 2 列");
    }
    const emptyText = blocks.filter((b) => b.type === "empty").map((b) => (b.type === "empty" ? b.text : "")).join(" ");
    expect(emptyText).toContain("空表");
    expect(JSON.stringify(blocks)).not.toContain('"kind":"sheet"');
  });

  it("多维表：字段/记录数 + 头几条记录", () => {
    const table = createDefaultBitableTable("任务");
    const first = createBitableRecord("rec-1");
    first.values[table.fields[0].id] = "写文档";
    const second = createBitableRecord("rec-2");
    second.values[table.fields[0].id] = "查快照";
    table.records = [first, second];
    const blocks = snapshotPreview("bitable", bitablesToBody([table], table.id));
    const preview = blocks.find((b) => b.type === "table");
    expect(preview).toBeTruthy();
    if (preview?.type === "table") {
      expect(preview.head).toContain(table.fields[0].name);
      expect(preview.rows[0]).toContain("写文档");
      expect(preview.more).toContain("2 条记录");
    }
    // 产品默认表现在自带 3 行空白，所以「空表」文案要显式清空记录来验
    const blank = { ...createDefaultBitableTable("空表"), records: [] };
    const emptyText = snapshotPreview("bitable", bitablesToBody([blank], blank.id)).map((b) => (b.type === "empty" ? b.text : "")).join(" ");
    expect(emptyText).toContain("还没有记录");
  });

  it("画板：元素统计 + 场景文字（不渲染画布）", () => {
    const doc = createBoardDoc("flowchart");
    doc.elements = [
      { id: "a", type: "geometry", text: "开始" },
      { id: "b", type: "arrow", text: "条件" },
      { id: "c", type: "geometry", text: "结束" },
    ];
    const blocks = snapshotPreview("board", boardToBody(doc));
    const facts = blocks.find((b) => b.type === "facts");
    expect(facts && facts.type === "facts" ? facts.items.map((x) => x[1]) : []).toContain("3 个");
    const text = blocks.find((b) => b.type === "text");
    const body = text && text.type === "text" ? text.text : "";
    expect(body).toContain("开始");
    expect(body).toContain("结束");
  });

  it("兜底：坏正文/非本类型正文都给「无法解析」提示，绝不渲染成误导性的空内容", () => {
    expect(snapshotPreview("sheet", "<p>这是一篇 Lake 文档</p>")[0]).toEqual({ type: "empty", text: "无法解析这份表格快照（可能是较早的格式）。" });
    expect(snapshotPreview("bitable", "not json")[0].type).toBe("empty");
    expect(snapshotPreview("bitable", sheetBody())[0].type).toBe("empty");
    expect(snapshotPreview("board", "<p>Lake 文档</p>")[0]).toEqual({ type: "empty", text: "无法解析这份画板快照（可能是较早的格式）。" });
    const emptyBlocks = snapshotPreview("board", emptyBoardBody());
    expect(emptyBlocks.some((b) => b.type === "facts")).toBe(true);
  });

  it("doc 不产出结构化块（正文由只读 viewer 渲染）", () => {
    expect(snapshotPreview("doc", "<p>hello</p>")).toEqual([{ type: "empty", text: "这份快照的正文用文档预览查看。" }]);
  });
});
