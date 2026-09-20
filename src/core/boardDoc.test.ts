import { describe, expect, it } from "vitest";
import {
  boardDocFromCardValue,
  boardToBody,
  boardToSearchText,
  cardValueFromBoardDoc,
  createBoardDoc,
  emptyBoardBody,
  normalizeBoardPreset,
  parseBoardBody,
} from "./boardDoc.js";

describe("画板文档正文（kind=board）", () => {
  it("空正文 = 空白画板（preset=drawing，0 元素）", () => {
    const doc = parseBoardBody(emptyBoardBody());
    expect(doc.kind).toBe("board");
    expect(doc.preset).toBe("drawing");
    expect(doc.elements).toEqual([]);
    expect(doc.viewport).toBeNull();
  });

  it("序列化 → 解析往返保持场景与视口", () => {
    const doc = createBoardDoc("flowchart");
    doc.elements = [{ id: "n1", type: "geometry" }];
    doc.viewport = { x: -120, y: 48, zoom: 1.25 };
    const parsed = parseBoardBody(boardToBody(doc));
    expect(parsed.preset).toBe("flowchart");
    expect(parsed.elements).toEqual(doc.elements);
    expect(parsed.viewport).toEqual({ x: -120, y: 48, zoom: 1.25 });
  });

  it("坏数据 / 非画板正文一律退化成空白画板（不抛错，避免文档打不开）", () => {
    expect(parseBoardBody("{ 不是 json").elements).toEqual([]);
    expect(parseBoardBody("<p>这是一篇 Lake 文档</p>").preset).toBe("drawing");
    expect(parseBoardBody("[1,2,3]").elements).toEqual([]);
    // 非法视口（缺字段 / zoom=0）不落盘，也不影响打开
    expect(parseBoardBody('{"kind":"board","viewport":{"x":1,"y":2,"zoom":0}}').viewport).toBeNull();
    expect(parseBoardBody('{"kind":"board","viewport":{"x":1}}').viewport).toBeNull();
  });

  it("preset 白名单：未知取值回退 drawing", () => {
    expect(normalizeBoardPreset("mindmap")).toBe("mindmap");
    expect(normalizeBoardPreset("uml")).toBe("uml");
    expect(normalizeBoardPreset("gantt")).toBe("drawing");
    expect(normalizeBoardPreset(undefined)).toBe("drawing");
  });

  it("presetInitialized 只在为 true 时写出（避免无意义字段）", () => {
    const doc = createBoardDoc("mindmap");
    expect(boardToBody(doc)).not.toContain("presetInitialized");
    doc.presetInitialized = true;
    expect(parseBoardBody(boardToBody(doc)).presetInitialized).toBe(true);
  });

  it("搜索文本抽取形状标签 / 文本块 / 思维导图节点文字，空画布为空串", () => {
    const doc = createBoardDoc("drawing");
    doc.elements = [
      { id: "a", text: "开始" },
      { id: "b", data: { topic: { children: [{ text: "中心主题" }] } } },
      { id: "c", label: "是" },
    ];
    const text = boardToSearchText(boardToBody(doc));
    expect(text).toContain("开始");
    expect(text).toContain("中心主题");
    expect(text).toContain("是");
    expect(boardToSearchText(emptyBoardBody())).toBe("");
    expect(boardToSearchText("<p>doc</p>")).toBe("");
  });

  it("卡片 ↔ 独立画板文档互搬（元素与视口无损）", () => {
    const card = {
      version: 2,
      engine: "drawnix",
      preset: "uml",
      presetInitialized: true,
      plaitValue: [{ id: "x" }],
      plaitViewport: { x: 10, y: 20, zoom: 2 },
      // 卡片专用字段：互搬时丢弃
      previewImage: "data:image/png;base64,AAAA",
      cardHeight: 560,
    };
    const doc = boardDocFromCardValue(card);
    expect(doc.preset).toBe("uml");
    expect(doc.elements).toEqual([{ id: "x" }]);
    expect(doc.viewport).toEqual({ x: 10, y: 20, zoom: 2 });
    expect(doc.presetInitialized).toBe(true);

    const back = cardValueFromBoardDoc(doc) as Record<string, unknown>;
    expect(back.plaitValue).toEqual([{ id: "x" }]);
    expect(back.plaitViewport).toEqual({ x: 10, y: 20, zoom: 2 });
    expect(back.previewImage).toBeUndefined();
    expect(back.cardHeight).toBeUndefined();
    expect(back.version).toBe(2);
  });
});
