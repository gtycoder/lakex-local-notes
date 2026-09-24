import { describe, expect, it } from "vitest";
import { colorApplyCommand, computeToolbarPosition, imageSizeWidth, isCommandExecuted, isCommandUnavailable, isMarkActive, parseAssetRef, toFontSize, unwrapValue } from "./selectionToolbarModel";

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