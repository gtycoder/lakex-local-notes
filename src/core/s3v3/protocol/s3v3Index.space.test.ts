import { describe, expect, it } from "vitest";
import { indexHashOf, serializeLakeIndex, validateLakeIndex } from "./index.js";

/**
 * 日记 wire 往返（261109，docs/DIARY.md 硬规则 1/2 + 护栏 §3 wire 片）：
 * - 发布时 **space 必须显式写**（非日记 = null，不是省略字段）；
 * - 读取时 **未知值/缺字段一律当非日记**（向前兼容，且不改写未知值语义 → 归一成 null）。
 */
const folder = (id: string, space?: unknown): Record<string, unknown> => ({
  id,
  title: id,
  parentId: null,
  sortOrder: 0,
  nodeType: "notebook",
  icon: null,
  updatedAt: "2026-11-09T00:00:00.000Z",
  ...(space === undefined ? {} : { space }),
});

const index = (folders: Array<Record<string, unknown>>) => ({ v: 3, space: "lake", notes: [], folders });

describe("folders[].space 往返（日记标记）", () => {
  it("缺字段 / 显式 null / \"diary\" / 未知值：解析后分别是 null / null / diary / null", () => {
    const parsed = validateLakeIndex(index([
      folder("f-missing"),          // 缺字段（旧索引）
      folder("f-null", null),       // 显式 null（非日记）
      folder("f-diary", "diary"),   // 日记本
      folder("f-unknown", "private"), // 未知值 ⇒ 当非日记
    ]));
    expect(parsed.folders.map((f) => f.space)).toEqual([null, null, "diary", null]);
  });

  it("序列化后非日记是显式 \"space\":null（不是省略字段）", () => {
    const parsed = validateLakeIndex(index([folder("f-null", null), folder("f-diary", "diary")]));
    const text = serializeLakeIndex(parsed);
    expect(text).toContain('"space":null');
    expect(text).toContain('"space":"diary"');
    // 缺字段在解析时被补成 null ⇒ 序列化同样写实
    expect(serializeLakeIndex(validateLakeIndex(index([folder("f-missing")])))).toContain('"space":null');
  });

  it("space 进索引 hash：同一目录 有/无日记标记 的 hash 不同，且往返稳定", () => {
    const withDiary = serializeLakeIndex(validateLakeIndex(index([folder("f1", "diary")])));
    const without = serializeLakeIndex(validateLakeIndex(index([folder("f1", null)])));
    expect(indexHashOf(withDiary)).not.toBe(indexHashOf(without));
    expect(serializeLakeIndex(validateLakeIndex(index([folder("f1", "diary")])))).toBe(withDiary);
  });
});
