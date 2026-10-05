import { describe, expect, it } from "vitest";
import { AI_PROMPT_CUSTOM_ID, AI_PROMPT_CUSTOM_LABEL, AI_PROMPT_PRESETS } from "./aiPrompts";

/** AI 首轮预设提示词（261005）：每条都有文案、id 唯一；「自定义」是常量、不在这张表里。 */
describe("AI_PROMPT_PRESETS", () => {
  it("四条预设都有非空提示词、id 唯一", () => {
    expect(AI_PROMPT_PRESETS.map((p) => p.label)).toEqual(["总结", "续写", "摘要", "修正"]);
    const ids = AI_PROMPT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of AI_PROMPT_PRESETS) expect(p.prompt.trim().length).toBeGreaterThan(0);
  });

  it("「自定义」= 空输入（常量 id/label，放最后）", () => {
    expect(AI_PROMPT_CUSTOM_ID).toBe("custom");
    expect(AI_PROMPT_CUSTOM_LABEL).toBe("自定义");
    expect(AI_PROMPT_PRESETS.some((p) => p.id === AI_PROMPT_CUSTOM_ID)).toBe(false);
  });
});
