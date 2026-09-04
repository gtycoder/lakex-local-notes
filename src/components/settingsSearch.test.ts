import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { filterSettingsNav, SETTING_ITEMS, searchSettingItems } from "./settingsSearch";

describe("settings search", () => {
  it("matches labels and semantic keywords", () => {
    const items = [{ id: "editor" as const, label: "编辑器", keywords: "字号 大纲 工具栏" }, { id: "sync" as const, label: "云端与同步", keywords: "S3 上传" }];
    expect(filterSettingsNav(items, "字号").map((item) => item.id)).toEqual(["editor"]);
    expect(filterSettingsNav(items, "s3").map((item) => item.id)).toEqual(["sync"]);
  });
});

describe("条目级设置搜索", () => {
  it("标题与同义词都能命中；多词要求全部命中", () => {
    expect(searchSettingItems("回收窗口").map((h) => h.id)).toContain("gc-retention-days");
    expect(searchSettingItems("sk").map((h) => h.id)).toContain("s3-secret-key");
    expect(searchSettingItems("路径").map((h) => h.id)).toContain("about-data-dir");
    expect(searchSettingItems("回收 窗口").map((h) => h.id)).toContain("gc-retention-days");
    expect(searchSettingItems("回收 不存在的词")).toEqual([]);
  });

  it("空查询返回全量，limit 生效", () => {
    expect(searchSettingItems("   ").length).toBe(SETTING_ITEMS.length);
    expect(searchSettingItems("同步", 3).length).toBeLessThanOrEqual(3);
  });

  it("注册表与 SettingsPanel 的 itemId 不漂移（改名/删行必须同步这里）", () => {
    const src = fs.readFileSync(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
    const inJsx = new Set([...src.matchAll(/itemId="([^"]+)"/g)].map((m) => m[1]));
    const inRegistry = new Set(SETTING_ITEMS.map((item) => item.id));
    expect([...inRegistry].filter((id) => !inJsx.has(id))).toEqual([]);
    expect([...inJsx].filter((id) => !inRegistry.has(id))).toEqual([]);
    expect(inRegistry.size).toBe(SETTING_ITEMS.length); // id 唯一
  });

  it("每条都有分类、标题与定位锚点", () => {
    const categories = new Set(["editor", "appearance", "shortcuts", "history", "sync", "resources", "trash", "logs", "about"]);
    for (const item of SETTING_ITEMS) {
      expect(categories.has(item.category)).toBe(true);
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.id).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
