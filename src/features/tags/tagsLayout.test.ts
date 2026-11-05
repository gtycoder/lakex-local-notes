import { describe, expect, it } from "vitest";
import {
  TAG_AGG_MIN,
  TAG_DIR_DEFAULT,
  TAG_DIR_MAX,
  TAG_DIR_MIN,
  TAG_HANDLE_TOTAL,
  TAG_LAYOUT_DEFAULTS,
  TAG_LAYOUT_MIN_CONTAINER,
  TAG_LAYOUT_STORAGE_KEY,
  TAG_PREVIEW_DEFAULT,
  TAG_PREVIEW_MAX,
  TAG_PREVIEW_MIN,
  clampTagDirWidth,
  clampTagPreviewWidth,
  isTagSpaceResizable,
  parseStoredTagLayout,
  resolveTagColumns,
  serializeTagLayout,
} from "./tagsLayout";

describe("标签空间三栏布局（纯逻辑）", () => {
  it("默认值 / 存储键 / 容器下限", () => {
    expect(TAG_LAYOUT_DEFAULTS).toEqual({ dir: TAG_DIR_DEFAULT, preview: TAG_PREVIEW_DEFAULT });
    expect(TAG_LAYOUT_STORAGE_KEY.startsWith("lakex-local-notes-v3.")).toBe(true);
    expect(TAG_LAYOUT_MIN_CONTAINER).toBe(200 + 360 + 240 + 10);
  });

  it("左栏 clamp：200–480，且给中栏留 ≥360、给右栏留当前宽", () => {
    expect(clampTagDirWidth(10, 0, 380)).toBe(TAG_DIR_MIN);
    expect(clampTagDirWidth(9999, 0, 380)).toBe(TAG_DIR_MAX);
    expect(clampTagDirWidth(300, 0, 380)).toBe(300);
    // 容器 1000、右栏 380 ⇒ 上界 = 1000-380-360-10 = 250
    expect(clampTagDirWidth(400, 1000, 380)).toBe(250);
    // 容器未知（0）只做静态夹取
    expect(clampTagDirWidth(Number.NaN, 0, 380)).toBe(TAG_DIR_DEFAULT);
  });

  it("右栏 clamp：240–720，且给中栏留 ≥360、给左栏留当前宽", () => {
    expect(clampTagPreviewWidth(10, 0, 260)).toBe(TAG_PREVIEW_MIN);
    expect(clampTagPreviewWidth(9999, 0, 260)).toBe(TAG_PREVIEW_MAX);
    expect(clampTagPreviewWidth(500, 0, 260)).toBe(500);
    // 容器 1000、左栏 260 ⇒ 上界 = 1000-260-360-10 = 370
    expect(clampTagPreviewWidth(700, 1000, 260)).toBe(370);
  });

  it("持久化解析：坏 JSON / 缺字段 / 负数 / 非数字 ⇒ null（回默认）", () => {
    expect(parseStoredTagLayout(null)).toBeNull();
    expect(parseStoredTagLayout("")).toBeNull();
    expect(parseStoredTagLayout("{not json")).toBeNull();
    expect(parseStoredTagLayout(JSON.stringify({ dir: 300 }))).toBeNull();
    expect(parseStoredTagLayout(JSON.stringify({ dir: -1, preview: 300 }))).toBeNull();
    expect(parseStoredTagLayout(JSON.stringify({ dir: "300", preview: 380 }))).toBeNull();
    expect(parseStoredTagLayout(JSON.stringify({ dir: 300, preview: 380 }))).toEqual({ dir: 300, preview: 380 });
    // 往返：序列化只保留两个整数
    expect(parseStoredTagLayout(serializeTagLayout({ dir: 300.4, preview: 380.6 }))).toEqual({ dir: 300, preview: 381 });
  });

  it("容器过窄 ⇒ fallback（固定比例、无 template）；够宽 ⇒ split（px + 中栏 1fr）", () => {
    expect(isTagSpaceResizable(TAG_LAYOUT_MIN_CONTAINER - 1)).toBe(false);
    expect(isTagSpaceResizable(TAG_LAYOUT_MIN_CONTAINER)).toBe(true);
    const narrow = resolveTagColumns(600, { dir: 300, preview: 380 });
    expect(narrow.mode).toBe("fallback");
    expect(narrow.templateColumns).toBeNull();
    const wide = resolveTagColumns(1600, { dir: 300, preview: 380 });
    expect(wide.mode).toBe("split");
    expect(wide.templateColumns).toBe("300px 5px minmax(360px, 1fr) 5px 380px");
    // 过宽的值在 split 下被夹到上界（1600-380-360-10=850 > 480 ⇒ 480）
    const clamped = resolveTagColumns(1600, { dir: 9999, preview: 9999 });
    expect(clamped.dir).toBe(TAG_DIR_MAX);
    expect(clamped.preview).toBe(TAG_PREVIEW_MAX);
    expect(TAG_HANDLE_TOTAL).toBe(10);
    expect(TAG_AGG_MIN).toBe(360);
  });

  it("极端窄容器下左右栏仍各自 ≥ 最小值（不出现负宽）", () => {
    for (const width of [0, 100, 300, 500, 809]) {
      const columns = resolveTagColumns(width, { dir: 380, preview: 500 });
      expect(columns.dir).toBeGreaterThanOrEqual(TAG_DIR_MIN);
      expect(columns.preview).toBeGreaterThanOrEqual(TAG_PREVIEW_MIN);
    }
  });
});
