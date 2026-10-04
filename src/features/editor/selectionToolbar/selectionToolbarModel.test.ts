import { describe, expect, it } from "vitest";
import { colorApplyCommand, computeToolbarPosition, imageSizeWidth, isCommandExecuted, isCommandUnavailable, isMarkActive, lineBoxRects, parseAssetRef, toFontSize, unwrapValue } from "./selectionToolbarModel";

describe("selectionToolbarModel", () => {
  it("锚点上方空间足够时放上方并水平居中", () => {
    const p = computeToolbarPosition({ left: 400, top: 300, right: 500, bottom: 320, width: 100, height: 20 }, { width: 200, height: 36 }, { width: 1000, height: 800 });
    expect(p.placement).toBe("above");
    expect(p.left).toBe(350);
    expect(p.top).toBe(256);
  });

  it("顶部空间不足时翻到下方", () => {
    const p = computeToolbarPosition({ left: 10, top: 10, right: 60, bottom: 30, width: 50, height: 20 }, { width: 200, height: 36 }, { width: 1000, height: 800 });
    expect(p.placement).toBe("below");
    expect(p.top).toBe(38);
  });

  it("顶界（内核固定工具栏底边）低于上方空间时翻到下方", () => {
    const p = computeToolbarPosition({ left: 100, top: 160, right: 300, bottom: 180, width: 200, height: 20 }, { width: 200, height: 36 }, { width: 1000, height: 800 }, 140);
    expect(p.placement).toBe("below");
  });

  it("选区滚到顶部时浮栏不下穿顶界（用户 261004：滚动后「干到顶栏」）", () => {
    const size = { width: 200, height: 36 };
    const viewport = { width: 1000, height: 800 };
    const topLimit = 140;
    // 选区首行钻到顶界下方（bottom=120 < 140）：下方档也必须夹到 140，不能落在 128
    expect(computeToolbarPosition({ left: 100, top: 100, right: 300, bottom: 120, width: 200, height: 20 }, size, viewport, topLimit).top).toBe(140);
    // 选区被滚出视口上方（bottom 为负）：同样夹到顶界，不出现负坐标
    expect(computeToolbarPosition({ left: 100, top: -60, right: 300, bottom: -40, width: 200, height: 20 }, size, viewport, topLimit).top).toBe(140);
    // 选区在顶界之下但空间仍不足以上翻：贴着选区下方、不被顶界顶走
    expect(computeToolbarPosition({ left: 100, top: 150, right: 300, bottom: 170, width: 200, height: 20 }, size, viewport, topLimit).top).toBe(178);
  });

  it("allowBelow=false：只放选区上方，上方放不下也返回上方坐标（由调用方收起，不翻下方）", () => {
    const size = { width: 200, height: 36 };
    const viewport = { width: 1000, height: 800 };
    const topLimit = 140;
    // 上方有空间：正常上方
    const ok = computeToolbarPosition({ left: 100, top: 300, right: 300, bottom: 320, width: 200, height: 20 }, size, viewport, topLimit, false);
    expect(ok.placement).toBe("above");
    expect(ok.top).toBe(256);
    // 上方放不下（150-36-8=106 < 140）：仍返回上方坐标 106，让调用方收起；**不得**翻下方
    const no = computeToolbarPosition({ left: 100, top: 150, right: 300, bottom: 170, width: 200, height: 20 }, size, viewport, topLimit, false);
    expect(no.placement).toBe("above");
    expect(no.top).toBe(106);
    expect(no.top).toBeLessThan(topLimit);
  });

  it("左右越界时钳制到视口内", () => {
    const left = computeToolbarPosition({ left: -50, top: 300, right: -10, bottom: 300, width: 40, height: 0 }, { width: 200, height: 36 }, { width: 1000, height: 800 });
    expect(left.left).toBe(8);
    const right = computeToolbarPosition({ left: 980, top: 300, right: 1000, bottom: 300, width: 20, height: 0 }, { width: 200, height: 36 }, { width: 1000, height: 800 });
    expect(right.left).toBe(792);
  });

  it("active 态解析兼容 true/1/\"true\"/\"1\"", () => {
    for (const v of [true, 1, "true", "1"]) expect(isMarkActive(v)).toBe(true);
    for (const v of [false, 0, "", "false", null, undefined]) expect(isMarkActive(v)).toBe(false);
  });

  it("active 态解析内核返回的数组口径（[true] 生效 / [null] / [] 不生效）", () => {
    expect(isMarkActive([true])).toBe(true);
    expect(isMarkActive(["true"])).toBe(true);
    expect(isMarkActive([null])).toBe(false);
    expect(isMarkActive([])).toBe(false);
  });

  it("内核 CommandState 判据：仅 1=生效、-1=不可用（0/2 都不算）", () => {
    expect(isCommandExecuted(1)).toBe(true);
    for (const v of [0, 2, -1, "1", true, null, undefined]) expect(isCommandExecuted(v)).toBe(false);
    expect(isCommandUnavailable(-1)).toBe(true);
    for (const v of [0, 1, 2, "-1", false, null, undefined]) expect(isCommandUnavailable(v)).toBe(false);
  });

  it("unwrapValue 取数组首项", () => {
    expect(unwrapValue(["center"])).toBe("center");
    expect(unwrapValue([])).toBeUndefined();
    expect(unwrapValue("p")).toBe("p");
  });

  it("字号解析", () => {
    expect(toFontSize(22)).toBe(22);
    expect(toFontSize("16")).toBe(16);
    expect(toFontSize("null")).toBeNull();
    expect(toFontSize("")).toBeNull();
  });

  it("lineBoxRects：字形盒撑到行盒高度（复刻内核原生选区，修「行间距没处理」）", () => {
    // 文字盒 21px + 行高 30 ⇒ 垂直居中撑成 30px（top 4 - (30-21)/2 = -0.5）
    expect(lineBoxRects([{ left: 0, top: 4, width: 300, height: 21 }], 30)).toEqual([{ left: 0, top: -0.5, width: 300, height: 30 }]);
    // line-height 拿不到（normal）时按 0 处理：不撑、原样返回
    expect(lineBoxRects([{ left: 1, top: 2, width: 3, height: 4 }], Number.NaN)).toEqual([{ left: 1, top: 2, width: 3, height: 4 }]);
  });

  it("lineBoxRects：按行合并（同一行只留一个并集，避免一块深一块浅/列表小方块）", () => {
    // 同一行的「行盒 + 文字盒」⇒ 并成一个
    expect(lineBoxRects([
      { left: 0, top: 0, width: 300, height: 30 },
      { left: 0, top: 4, width: 280, height: 21 },
    ], 30)).toEqual([{ left: 0, top: 0, width: 300, height: 30 }]);
    // 列表项：项目符号与文字（中心对齐）⇒ 合成一个行盒，不再出现小方块
    const merged = lineBoxRects([
      { left: 0, top: 10, width: 8, height: 8 },
      { left: 20, top: 4, width: 200, height: 21 },
    ], 30);
    expect(merged).toHaveLength(1);
    expect(merged[0].left).toBe(0);
    expect(merged[0].width).toBe(220);
    expect(merged[0].height).toBe(30);
    // 不同行不合并
    expect(lineBoxRects([
      { left: 0, top: 0, width: 100, height: 21 },
      { left: 0, top: 40, width: 100, height: 21 },
    ], 30)).toHaveLength(2);
    // ⚠️ 回归（用户 261004：高亮跨了 2~4 行）：相邻两行只隔**一个行高**，撑开后首尾相接，
    //    绝不能因为「相交」就把它们并成一大块。
    const twoLines = lineBoxRects([
      { left: 0, top: 0, width: 100, height: 21 },
      { left: 0, top: 29.6, width: 100, height: 21 },
      { left: 0, top: 59.2, width: 100, height: 21 },
    ], 29.6);
    expect(twoLines).toHaveLength(3);
    expect(twoLines[0].height).toBeCloseTo(29.6, 5);
    // 行盒(30) 与文字盒(21) 中心一致 ⇒ 仍归同一行（每行只留一个）
    const mixed = lineBoxRects([
      { left: 0, top: 0, width: 300, height: 30 },
      { left: 0, top: 4.5, width: 280, height: 21 },
      { left: 0, top: 30, width: 300, height: 30 },
      { left: 0, top: 34.5, width: 280, height: 21 },
    ], 30);
    expect(mixed).toHaveLength(2);
  });

  it("lineBoxRects：逐片段行高（标题 / 列表 / 正文各不相同，不能用统一行高）", () => {
    const mixed = lineBoxRects([
      { left: 0, top: 0, width: 100, height: 24, lineHeight: 37 },
      { left: 0, top: 37, width: 100, height: 21, lineHeight: 30 },
    ], 30);
    expect(mixed).toHaveLength(2);
    expect(mixed[0].height).toBeCloseTo(37, 5);
    expect(mixed[1].height).toBeCloseTo(30, 5);
  });

  it("图片尺寸档位按原宽比例", () => {
    expect(imageSizeWidth("small", 1000)).toBe(300);
    expect(imageSizeWidth("medium", 1000)).toBe(500);
    expect(imageSizeWidth("large", 1000)).toBe(800);
    expect(imageSizeWidth("original", 1000)).toBe(1000);
  });

  it("文字色本体：所选=正文色 ⇒ clearColor，否则 color(持久值)", () => {
    const base = { normalText: "#262626" };
    expect(colorApplyCommand("text", { ...base, visual: "#262626", persistent: "#262626" })).toEqual({ command: "clearColor" });
    expect(colorApplyCommand("text", { ...base, visual: "#DF2A3F", persistent: "p-red" })).toEqual({ command: "color", arg: "p-red" });
  });

  it("背景色本体：空/无填充/已等于当前 ⇒ clearBgColor，否则 bgColor(持久值)", () => {
    expect(colorApplyCommand("bg", { visual: "", persistent: "", normalText: "#262626" })).toEqual({ command: "clearBgColor" });
    expect(colorApplyCommand("bg", { visual: "transparent", persistent: "transparent", normalText: "#262626" })).toEqual({ command: "clearBgColor" });
    expect(colorApplyCommand("bg", { visual: "#FBDE28", persistent: "#FBDE28", normalText: "#262626", currentBg: "#FBDE28" })).toEqual({ command: "clearBgColor" });
    expect(colorApplyCommand("bg", { visual: "#FBDE28", persistent: "#FBDE28", normalText: "#262626", currentBg: "#FFFFFF" })).toEqual({ command: "bgColor", arg: "#FBDE28" });
  });

  it("从 canonical URL 解析资源引用", () => {
    expect(parseAssetRef("http://127.0.0.1:19876/9fe30c7b-1cd5-426b-8969-3cae1da18674/1789030045000_cfc0641d.png?token=abc")).toEqual({
      noteId: "9fe30c7b-1cd5-426b-8969-3cae1da18674", filename: "1789030045000_cfc0641d.png",
    });
    expect(parseAssetRef("data:image/png;base64,AAAA")).toBeNull();
  });
});