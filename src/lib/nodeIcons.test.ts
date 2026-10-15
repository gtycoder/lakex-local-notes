import { describe, expect, it } from "vitest";
import {
  NODE_ICONS,
  NODE_ICON_TINTS,
  NODE_ICON_VALUE_MAX_LENGTH,
  encodeNodeIcon,
  parseNodeIcon,
  nodeIconPickerMode,
} from "./nodeIcons";

describe("nodeIcons（第二类目「图标」的值编解码）", () => {
  it("笔记本/分组默认图标，文档（含表格/数据表/画板）默认表情", () => {
    expect(nodeIconPickerMode("notebook")).toBe("icon");
    expect(nodeIconPickerMode("group")).toBe("icon");
    expect(nodeIconPickerMode("note")).toBe("emoji");
  });
  it("每个图标 × 每个色号的落库值都 ≤ 两端校验的 16 字符上限", () => {
    for (const def of NODE_ICONS) {
      for (const tint of NODE_ICON_TINTS) {
        expect(encodeNodeIcon(def.id, tint.id).length).toBeLessThanOrEqual(NODE_ICON_VALUE_MAX_LENGTH);
      }
    }
  });

  it("id 唯一、≤10 字符、不含冒号（冒号是分隔符）", () => {
    const ids = NODE_ICONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.length).toBeLessThanOrEqual(10);
      expect(id).not.toContain(":");
      expect(id).not.toBe("");
    }
  });

  it("目录规模 = 40 个图标 / 8 个色（面板 8 列 × 5 行）", () => {
    expect(NODE_ICONS).toHaveLength(40);
    expect(NODE_ICON_TINTS).toHaveLength(8);
  });

  it("色板展示顺序不改变落库色号，蓝/青绿/绿/紫仍是0/2/3/7", () => {
    expect(NODE_ICON_TINTS.map((t) => t.code).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const [tint, code] of [["blue", 0], ["teal", 2], ["green", 3], ["violet", 7]] as const) {
      expect(encodeNodeIcon("zap", tint)).toBe(`i:zap:${code}`);
      expect(parseNodeIcon(`i:zap:${code}`)).toMatchObject({ kind: "icon", tint });
    }
  });

  it("往返一致：目录里每一项都能编出去再解析回同一个 id/色", () => {
    for (const def of NODE_ICONS) {
      for (const tint of NODE_ICON_TINTS) {
        const parsed = parseNodeIcon(encodeNodeIcon(def.id, tint.id));
        expect(parsed?.kind).toBe("icon");
        expect(parsed?.kind === "icon" && parsed.icon.id).toBe(def.id);
        expect(parsed?.kind === "icon" && parsed.tint).toBe(tint.id);
      }
    }
  });

  it("历史值（表情符号）走 emoji 分支且原样保留", () => {
    expect(parseNodeIcon("😀")).toEqual({ kind: "emoji", char: "😀" });
    expect(parseNodeIcon("📚")).toEqual({ kind: "emoji", char: "📚" });
    expect(parseNodeIcon("star")).toEqual({ kind: "emoji", char: "star" });
  });

  it("null / undefined / 空串 ⇒ null（= 用默认图标）", () => {
    expect(parseNodeIcon(null)).toBeNull();
    expect(parseNodeIcon(undefined)).toBeNull();
    expect(parseNodeIcon("")).toBeNull();
  });

  it("目录里没有的 id ⇒ unknown，绝不回落成原始串显示", () => {
    expect(parseNodeIcon("i:nope:3")).toEqual({ kind: "unknown", id: "nope" });
    expect(parseNodeIcon("i:")).toEqual({ kind: "unknown", id: "" });
  });

  it("色号缺失 / 越界 / 非数字 ⇒ 回落蓝色，不抛错", () => {
    expect(parseNodeIcon("i:zap")).toMatchObject({ kind: "icon", tint: "blue" });
    expect(parseNodeIcon("i:zap:99")).toMatchObject({ kind: "icon", tint: "blue" });
    expect(parseNodeIcon("i:zap:x")).toMatchObject({ kind: "icon", tint: "blue" });
    expect(parseNodeIcon("i:zap:-1")).toMatchObject({ kind: "icon", tint: "blue" });
    expect(parseNodeIcon("i:zap:7")).toMatchObject({ kind: "icon", tint: "violet" });
  });
});
