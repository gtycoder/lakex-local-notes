import { describe, expect, it } from "vitest";
import {
  LEGACY_ICON_VALUE_PREFIX,
  NODE_ICON_VALUE_MAX_LENGTH,
  nodeIconPickerMode,
  parseNodeIcon,
} from "./nodeIcons";
import { NOTEBOOK_ICONS, encodeNotebookIcon } from "./notebookIcons";

describe("nodeIcons（261020 精简：只剩表情 + 语雀插画两种方言）", () => {
  it("笔记本/分组 = 图标，所有文档类型 = 表情（两端同一条判据）", () => {
    expect(nodeIconPickerMode("notebook")).toBe("icon");
    expect(nodeIconPickerMode("group")).toBe("icon");
    expect(nodeIconPickerMode("note")).toBe("emoji");
  });

  it("语雀插画方言 n:<id>：17 个、id 唯一且不含冒号、编码 ≤ 16 字符、往返一致", () => {
    expect(NOTEBOOK_ICONS).toHaveLength(17);
    const ids = NOTEBOOK_ICONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of NOTEBOOK_ICONS) {
      const value = encodeNotebookIcon(def.id);
      expect(value.startsWith("n:")).toBe(true);
      expect(value.length).toBeLessThanOrEqual(NODE_ICON_VALUE_MAX_LENGTH);
      expect(def.id).not.toContain(":");
      expect(def.id.length).toBeGreaterThan(0);
      expect(def.label.length).toBeGreaterThan(0);
      const parsed = parseNodeIcon(value);
      expect(parsed?.kind).toBe("notebook");
      expect(parsed?.kind === "notebook" && parsed.icon.id).toBe(def.id);
    }
  });

  it("目录里没有的插画 id ⇒ unknown（跨端版本差），不回落成表情文本", () => {
    expect(parseNodeIcon("n:nope")).toEqual({ kind: "unknown", id: "nope" });
    expect(parseNodeIcon("n:")).toEqual({ kind: "unknown", id: "" });
  });

  it("旧线性图标方言 i:<id>:<色号> 已删除：只认得出、画中性图形，绝不回显原始串", () => {
    expect(LEGACY_ICON_VALUE_PREFIX).toBe("i:");
    expect(parseNodeIcon("i:star:0")).toEqual({ kind: "unknown", id: "star:0" });
    expect(parseNodeIcon("i:")).toEqual({ kind: "unknown", id: "" });
    // 关键：不能因为「目录里没有」就被当成表情原样显示
    expect(parseNodeIcon("i:notebook:3")?.kind).toBe("unknown");
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
});
