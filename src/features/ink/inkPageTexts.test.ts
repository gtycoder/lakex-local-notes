/**
 * 页内文字块纯函数（261104 二十三批）：落点 / 换行估算 / 高度 / 命中 / 移动 / 改文 / 删除。
 */
import { describe, expect, it } from "vitest";
import { createInkPage } from "../../core/inkDoc";
import {
  INK_TEXT_DEFAULT_WIDTH_RATIO,
  INK_TEXT_LINE_HEIGHT,
  INK_TEXT_MIN_WIDTH,
  bumpPageTextFontSize,
  resizePageText,
  estimateInkCharWidth,
  hitTestPageText,
  inkTextHeight,
  movePageText,
  placeInkPageText,
  removePageText,
  updatePageText,
  wrapInkTextLines,
} from "./inkPageTexts";

function page() {
  return { ...createInkPage("p1"), width: 1000, height: 1400 };
}

describe("页内文字块", () => {
  it("插入：页宽 50%、水平居中、落在页面 15% 高度、初始空文本", () => {
    const item = placeInkPageText(page(), { id: "t1", width: 0, fontSize: 16, color: "#262626" });
    expect(item.width).toBe(1000 * INK_TEXT_DEFAULT_WIDTH_RATIO);
    expect(item.x).toBe((1000 - item.width) / 2);
    expect(item.y).toBe(1400 * 0.15);
    expect(item.text).toBe("");
  });

  it("换行：CJK 按 1em、拉丁按 0.55em 估算；保留显式换行", () => {
    expect(estimateInkCharWidth("中", 20)).toBe(20);
    expect(estimateInkCharWidth("a", 20)).toBeCloseTo(11, 1);
    const lines = wrapInkTextLines("中文折行测试", 40, 20);       // 宽 40 ⇒ 每行 2 个汉字
    expect(lines).toEqual(["中文", "折行", "测试"]);
    expect(wrapInkTextLines("a\nb", 100, 20)).toEqual(["a", "b"]);
    expect(wrapInkTextLines("", 100, 20)).toEqual([]);
  });

  it("高度 = 行数 × 字号 × 行高（至少 1 行）；命中按矩形（后加的在上）", () => {
    const item = { id: "t1", x: 100, y: 100, width: 200, fontSize: 20, color: "#000", text: "一行" };
    expect(inkTextHeight(item)).toBe(1 * 20 * INK_TEXT_LINE_HEIGHT);
    const two = { ...item, text: "a".repeat(40) };                 // 40 × 11 = 440 > 200 ⇒ 3 行
    expect(wrapInkTextLines(two.text, two.width, two.fontSize).length).toBeGreaterThan(1);
    const bottom = { ...item, id: "t2", y: 100, text: "" };
    expect(hitTestPageText({ texts: [item] }, { x: 150, y: 110 })).toBe("t1");
    expect(hitTestPageText({ texts: [item] }, { x: 900, y: 900 })).toBeNull();
    expect(hitTestPageText({ texts: [item, bottom] }, { x: 150, y: 105 })).toBe("t2");
    expect(hitTestPageText({ texts: [] }, { x: 1, y: 1 })).toBeNull();
  });

  it("移动：目标不存在返回 null；拖出页面被钳制", () => {
    const page1 = { ...page(), texts: [{ id: "t1", x: 100, y: 100, width: 200, fontSize: 16, color: "#000", text: "x" }] };
    expect(movePageText(page1, "missing", 1, 1)).toBeNull();
    expect(movePageText(page1, "t1", 20, 30)![0]).toMatchObject({ x: 120, y: 130 });
    const far = movePageText(page1, "t1", -99999, -99999)![0];
    expect(far.x).toBeGreaterThan(-99999);
    expect(far.y).toBeGreaterThan(-99999);
  });

  it("拖宽与字号 ±：宽度夹在最小宽度与页面右边界之间；字号夹 6..96", () => {
    const page1 = { ...page(), texts: [{ id: "t1", x: 800, y: 100, width: 200, fontSize: 16, color: "#000", text: "x" }] };
    // 右边只剩 200 ⇒ 最大也就 1000-800-8=192
    expect(resizePageText(page1, "t1", 500)![0].width).toBe(192);
    expect(resizePageText(page1, "t1", 1)![0].width).toBe(INK_TEXT_MIN_WIDTH);
    expect(resizePageText(page1, "missing", 100)).toBeNull();
    expect(bumpPageTextFontSize(page1, "t1", 2)![0].fontSize).toBe(18);
    expect(bumpPageTextFontSize({ ...page1, texts: [{ ...page1.texts![0], fontSize: 96 }] }, "t1", 2)![0].fontSize).toBe(96);
    expect(bumpPageTextFontSize({ ...page1, texts: [{ ...page1.texts![0], fontSize: 6 }] }, "t1", -2)![0].fontSize).toBe(6);
  });

  it("改文与删除", () => {
    const page1 = { ...page(), texts: [{ id: "t1", x: 100, y: 100, width: 200, fontSize: 16, color: "#000", text: "旧" }] };
    expect(updatePageText(page1, "t1", "新内容")![0].text).toBe("新内容");
    expect(updatePageText(page1, "missing", "x")).toBeNull();
    expect(removePageText(page1, "t1")).toEqual([]);
    expect(removePageText(page1, "missing").length).toBe(1);
    expect(INK_TEXT_MIN_WIDTH).toBeGreaterThan(0);
  });
});
