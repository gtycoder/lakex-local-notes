import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  readOnlyAttachments,
  readOnlyBoolean,
  readOnlyLink,
  readOnlyOptions,
  readOnlyProgress,
  readOnlyRating,
  readOnlyRelation,
} from "./bitableReadOnly.js";
import type { BitableDisplayContext, BitableField } from "./bitableDoc.js";

const field = (over: Partial<BitableField>): BitableField => ({ id: "f", name: "F", type: "text", ...over } as BitableField);

describe("多维表只读共享语义（C1-6）", () => {
  it("布尔：只有真正 boolean 才给值", () => {
    expect(readOnlyBoolean(true)).toBe(true);
    expect(readOnlyBoolean(false)).toBe(false);
    expect(readOnlyBoolean("true")).toBeNull();
    expect(readOnlyBoolean(null)).toBeNull();
  });

  it("链接：只认 http(s)，其余只当文本", () => {
    expect(readOnlyLink(" https://example.com ")).toEqual({ text: "https://example.com", href: "https://example.com" });
    expect(readOnlyLink("ftp://x")).toEqual({ text: "ftp://x", href: null });
    expect(readOnlyLink(42)).toEqual({ text: "", href: null });
  });

  it("评分/进度：clamp 到 0..5 / 0..100，非法值归 0", () => {
    expect(readOnlyRating(3.6)).toBe(4);
    expect(readOnlyRating(99)).toBe(5);
    expect(readOnlyRating(-2)).toBe(0);
    expect(readOnlyRating("4")).toBe(0);
    expect(readOnlyProgress(60.4)).toBe(60);
    expect(readOnlyProgress(999)).toBe(100);
    expect(readOnlyProgress("60")).toBe(60); // 与桌面 readOnly 的 Number(value) 口径一致
  });

  it("选项：按 field.options 顺序取已选", () => {
    const f = field({ type: "multiSelect", options: [{ id: "a", name: "A", color: "blue" }, { id: "b", name: "B", color: "green" }] } as Partial<BitableField>);
    expect(readOnlyOptions(f, ["b", "a"]).map((o) => o.name)).toEqual(["B", "A"]);
    expect(readOnlyOptions(f, ["z"])).toEqual([]);
  });

  it("附件：给 file/name 并标出是否图片", () => {
    expect(readOnlyAttachments([{ file: "a.png", name: "图" }, { file: "b.pdf", name: "文" }])).toEqual([
      { file: "a.png", name: "图", image: true },
      { file: "b.pdf", name: "文", image: false },
    ]);
  });

  it("两端都从本模块取只读语义（防再次各写一份）", () => {
    // 261030：字段值渲染抽到 MobileBitableValue.tsx（单一来源），两端语义守卫合并读这两份。
    const mobile = [
      readFileSync(path.join(process.cwd(), "src/mobile/bitable/MobileBitableViewer.tsx"), "utf8"),
      readFileSync(path.join(process.cwd(), "src/mobile/bitable/MobileBitableValue.tsx"), "utf8"),
    ].join("\n");
    const desktop = readFileSync(path.join(process.cwd(), "src/features/bitable/bitableCells.tsx"), "utf8");
    for (const name of ["readOnlyAttachments", "readOnlyBoolean", "readOnlyLink", "readOnlyOptions", "readOnlyProgress", "readOnlyRating", "readOnlyRelation"]) {
      expect(mobile, "移动端必须使用 " + name).toContain(name + "(");
    }
    for (const name of ["readOnlyBoolean", "readOnlyLink", "readOnlyProgress", "readOnlyRating"]) {
      expect(desktop, "桌面必须复用 " + name).toContain(name + "(");
    }
    expect(mobile, "移动端不得再自己 clamp 评分").not.toMatch(/Math\.max\(0, Math\.min\(BITABLE_RATING_MAX/);
    expect(mobile, "移动端不得再自己解析关联").not.toContain("relationTargetTable(");
  });

  it("关联：目标表不存在 / 记录失效时 invalid=true，chips 空", () => {
    const ctx: BitableDisplayContext = { tables: [] };
    const f = field({ type: "relation", relationTableId: "t1" } as Partial<BitableField>);
    expect(readOnlyRelation(ctx, f, ["r1"])).toEqual({ target: undefined, invalid: true, chips: [] });
    expect(readOnlyRelation(ctx, f, [])).toEqual({ target: undefined, invalid: false, chips: [] });
  });
});
