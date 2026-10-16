import { describe, expect, it } from "vitest";
import { findMatchOffsets, nextMatchIndex } from "./mobileFind.js";

describe("findMatchOffsets（移动端文档内查找的纯匹配）", () => {
  it("中文按字符匹配且非重叠", () => {
    expect(findMatchOffsets("人类为什么没有进化", "人类")).toEqual([0]);
    expect(findMatchOffsets("啊啊啊", "啊")).toEqual([0, 1, 2]);
    expect(findMatchOffsets("aaaa", "aa")).toEqual([0, 2]);
  });

  it("大小写不敏感", () => {
    expect(findMatchOffsets("Hello hello HELLO", "hello")).toEqual([0, 6, 12]);
  });

  it("空查询/无命中 → 空数组", () => {
    expect(findMatchOffsets("abc", "")).toEqual([]);
    expect(findMatchOffsets("abc", "zzz")).toEqual([]);
    expect(findMatchOffsets("", "a")).toEqual([]);
  });
});

describe("nextMatchIndex（环形步进）", () => {
  it("无命中 → -1", () => {
    expect(nextMatchIndex(-1, 1, 0)).toBe(-1);
  });
  it("从头开始 / 回绕", () => {
    expect(nextMatchIndex(-1, 1, 5)).toBe(0);
    expect(nextMatchIndex(-1, -1, 5)).toBe(4);
    expect(nextMatchIndex(4, 1, 5)).toBe(0);
    expect(nextMatchIndex(0, -1, 5)).toBe(4);
  });
});
