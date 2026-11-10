// @vitest-environment jsdom
/**
 * 设置归一（261110 用户定稿）：标签上限最大 16，撤掉「不限」与 24 档；
 * 旧存档里的 0（不限）/24 一律夹到硬上限，手改超限值同样夹住。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { loadSettings, MAX_OPEN_TAB_OPTIONS, MAX_OPEN_TABS_CAP, normalizeMaxOpenTabs, saveSettings } from "./settings";

const SETTINGS_KEY = "lakex-local-notes-v1.settings";

describe("最大同时打开标签数（上限 16）", () => {
  beforeEach(() => {
    localStorage.clear();
    // 清模块级缓存：重新读取
    // loadSettings 用内存缓存，这里通过 saveSettings 写默认值后再读
    saveSettings({ maxOpenTabs: 8 });
  });

  it("档位只到 16，且不含「不限」", () => {
    expect(MAX_OPEN_TABS_CAP).toBe(16);
    expect([...MAX_OPEN_TAB_OPTIONS]).toEqual([4, 6, 8, 12, 16]);
    expect(MAX_OPEN_TAB_OPTIONS).not.toContain(0);
    expect(MAX_OPEN_TAB_OPTIONS).not.toContain(24);
  });

  it("归一：旧「不限」(0/−1) 与超限（24/999）夹到 16，非法回落默认", () => {
    expect(normalizeMaxOpenTabs(0)).toBe(16);
    expect(normalizeMaxOpenTabs(-1)).toBe(16);
    expect(normalizeMaxOpenTabs(24)).toBe(16);
    expect(normalizeMaxOpenTabs(999)).toBe(16);
    expect(normalizeMaxOpenTabs(8)).toBe(8);
    expect(normalizeMaxOpenTabs("8")).toBe(8);
    expect(normalizeMaxOpenTabs(Number.NaN)).toBe(8);
  });

  it("保存时夹上限：即使调用点传 24 也只存 16", () => {
    const next = saveSettings({ maxOpenTabs: 24 });
    expect(next.maxOpenTabs).toBe(16);
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).maxOpenTabs).toBe(16);
    expect(loadSettings().maxOpenTabs).toBe(16);
  });
});
