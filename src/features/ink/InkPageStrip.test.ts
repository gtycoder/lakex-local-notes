/**
 * 页面缩略图条虚拟化（P5）：300 页 PDF 不再一次挂 300 份缩略图 DOM。
 * 纯函数 pageWindow 的行为由本文件钉住；组件内只负责量宽度 + 滚动时更新窗口。
 */
import { describe, expect, it } from "vitest";
import { PAGE_WINDOW_FALLBACK_PITCH, PAGE_WINDOW_MAX_ALL, PAGE_WINDOW_RADIUS, pageWindow } from "./InkPageStrip";

const base = { scrollLeft: 0, viewportWidth: 412, pitch: 72, activeIndex: 0 };

describe("InkPageStrip.pageWindow（±10 页窗口）", () => {
  it("小文档整条渲染（≤60 页，行为与旧实现一致）", () => {
    expect(pageWindow({ ...base, total: 3 })).toEqual({ start: 0, count: 3 });
    expect(pageWindow({ ...base, total: PAGE_WINDOW_MAX_ALL })).toEqual({ start: 0, count: PAGE_WINDOW_MAX_ALL });
  });

  it("空文档返回空窗口", () => {
    expect(pageWindow({ ...base, total: 0 })).toEqual({ start: 0, count: 0 });
  });

  it("300 页从头上开始：只挂「可见 + 前后各 10 页」，不含全部 300 页", () => {
    const window = pageWindow({ ...base, total: 300, activeIndex: 0 });
    expect(window.start).toBe(0);
    expect(window.count).toBeGreaterThanOrEqual(PAGE_WINDOW_RADIUS * 2 + 1);
    expect(window.count).toBeLessThan(300);
  });

  it("滚动到中间：窗口跟着滚动位置走（±10 页）", () => {
    const window = pageWindow({ ...base, total: 300, scrollLeft: 150 * 72, activeIndex: 150 });
    expect(window.start).toBeGreaterThan(100);
    expect(window.start + window.count).toBeGreaterThan(150);
    expect(window.count).toBeLessThan(300);
  });

  it("active 页必须落在窗口里（预览打开时 active 可能在第 250 页）", () => {
    const window = pageWindow({ ...base, total: 300, scrollLeft: 0, activeIndex: 250 });
    expect(250).toBeGreaterThanOrEqual(window.start);
    expect(250).toBeLessThan(window.start + window.count);
  });

  it("滚到末尾：start 被夹住，窗口不越界", () => {
    const window = pageWindow({ ...base, total: 300, scrollLeft: 400 * 72, activeIndex: 299 });
    expect(window.start).toBeGreaterThanOrEqual(0);
    expect(window.start + window.count).toBe(300);
  });

  it("量不到项宽时用兜底 pitch，不会算出 NaN/负数", () => {
    const window = pageWindow({ scrollLeft: 100, viewportWidth: 0, pitch: 0, total: 300, activeIndex: 0 });
    expect(Number.isInteger(window.start)).toBe(true);
    expect(Number.isInteger(window.count)).toBe(true);
    expect(window.start).toBeGreaterThanOrEqual(0);
    expect(window.count).toBeGreaterThanOrEqual(PAGE_WINDOW_RADIUS * 2 + 1);
    expect(PAGE_WINDOW_FALLBACK_PITCH).toBeGreaterThan(0);
  });
});
