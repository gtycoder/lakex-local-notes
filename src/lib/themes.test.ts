import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DEFAULT_THEME_ID, LAKE_THEMES, isLakeThemeId, themeById } from "./themes";

/**
 * 主题注册表护栏（261116）：新增主题 = 加一个 CSS 文件 + 注册表一行（见 themes.ts 注释）。
 * 这里把「注册了但没 CSS」和「预览色写坏」挡在门禁里 —— 否则切主题会静默退回 light。
 */
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const HEX = /^#[0-9a-f]{6}$/i;

describe("LAKE_THEMES 注册表", () => {
  it("id 唯一、默认主题存在", () => {
    const ids = LAKE_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_THEME_ID);
    expect(isLakeThemeId(DEFAULT_THEME_ID)).toBe(true);
    expect(isLakeThemeId("nope")).toBe(false);
  });

  it("每个主题都有桌面 CSS；移动端支持的主题也有移动 CSS", () => {
    // 移动端目前只有 light/dark/chat 三套（warm 是桌面专属，移动端选到它时会退回 light —— 既有行为）。
    const MOBILE_SUPPORTED = new Set(["light", "dark", "chat"]);
    for (const theme of LAKE_THEMES) {
      const desktop = path.join(ROOT, "styles/themes", theme.id + ".css");
      expect(existsSync(desktop), desktop).toBe(true);
      if (!MOBILE_SUPPORTED.has(theme.id)) continue;
      const mobile = path.join(ROOT, "mobile/theme", theme.id + ".css");
      expect(existsSync(mobile), mobile).toBe(true);
    }
  });

  it("预览色是合法 hex，未知 id 回退到默认主题", () => {
    for (const theme of LAKE_THEMES) {
      for (const value of Object.values(theme.preview)) expect(value).toMatch(HEX);
      expect(theme.label.length).toBeGreaterThan(0);
    }
    expect(themeById("nope").id).toBe(DEFAULT_THEME_ID);
  });
});
