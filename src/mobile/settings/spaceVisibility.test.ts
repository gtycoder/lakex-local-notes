import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOBILE_HIDDEN_SPACES_KEY, isMobileHideableTab, visibleHomeTabsFrom } from "./spaceVisibility";
import { HOME_TABS } from "../home/tabPager";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * 移动端「空间关闭」接线护栏（261114）：仅日记 / AI 可关闭；关闭 = 隐藏底部 Dock + 分页页 +
 * 默认空间选项（数据保留）。知识库 / 小记 / 标签固定。
 */
describe("移动端空间关闭（仅日记 / AI）", () => {
  it("可关闭集合与顺序：仅 diary / ai；可见 tab 仍是 HOME_TABS 的子集且保序", () => {
    expect(isMobileHideableTab("diary")).toBe(true);
    expect(isMobileHideableTab("ai")).toBe(true);
    expect(isMobileHideableTab("library")).toBe(false);
    expect(isMobileHideableTab("quick")).toBe(false);
    expect(isMobileHideableTab("tags")).toBe(false);
    expect(visibleHomeTabsFrom(["diary", "ai"])).toEqual(["library", "quick", "tags"]);
    expect(visibleHomeTabsFrom(["ai"])).toEqual(["library", "quick", "tags", "diary"]);
    expect(visibleHomeTabsFrom([])).toEqual([...HOME_TABS]);
    expect(MOBILE_HIDDEN_SPACES_KEY).toBe("lakex-local-notes-mobile.hidden-spaces");
  });

  it("Dock 与分页器都按可见 tab 渲染；被关闭的整页隐藏", () => {
    const home = read("../home/HomePage.tsx");
    expect(home).toContain("visibleTabs.map((id)");
    expect(home).toContain("tabs: visibleTabs");
    expect(home).toContain('hidden={!visibleTabs.includes("diary")}');
    expect(home).toContain('hidden={!visibleTabs.includes("ai")}');
    expect(read("../home/useTabPager.ts")).toContain('{ type: "tabs"');
  });

  it("App / 设置页接线：当前页被关闭时回落；默认空间只列可见项", () => {
    const app = read("../MobileApp.tsx");
    expect(app).toContain("useHiddenHomeTabs()");
    expect(app).toContain("tabs={visibleHomeTabs}");
    expect(app).toContain("visibleHomeTabs[0] ?? \"quick\"");
    const drawer = read("./SettingsDrawer.tsx");
    expect(drawer).toContain('itemId="space-diary"');
    expect(drawer).toContain('itemId="space-ai"');
    expect(drawer).toContain("visibleHomeTabs.includes(option.value)");
    expect(drawer).toContain("writeDefaultHomeTab(DEFAULT_HOME_TAB)");
  });
});
