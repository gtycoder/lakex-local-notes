import { describe, expect, it } from "vitest";
import { segmentText, segmentToIndexText } from "./segment.js";

describe("search segment", () => {
  it("中文逐字、拉丁/数字整词", () => {
    expect(segmentText("欢迎使用Lake编辑器2024版")).toEqual([
      "欢", "迎", "使", "用", "Lake", "编", "辑", "器", "2024", "版",
    ]);
  });
  it("标点/空白为分隔符", () => {
    expect(segmentText("a-b，c.d")).toEqual(["a", "b", "c", "d"]);
  });
  it("indexText 以空格连接", () => {
    expect(segmentToIndexText("Lake编辑器")).toBe("Lake 编 辑 器");
  });
  it("日文假名/韩文也按单字", () => {
    expect(segmentText("テスト")).toEqual(["テ", "ス", "ト"]);
    expect(segmentText("한글")).toEqual(["한", "글"]);
  });
  it("空串/纯符号 → 空", () => {
    expect(segmentText("")).toEqual([]);
    expect(segmentText("!!! ...")).toEqual([]);
  });
  it("非 BMP 汉字（代理对）单字", () => {
    expect(segmentText("𠀀𠀁")).toEqual(["𠀀", "𠀁"]);
  });
});
