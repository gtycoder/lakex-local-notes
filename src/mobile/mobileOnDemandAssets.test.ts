import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const BRIDGE = readFileSync(new URL("./bridge/sync.ts", import.meta.url), "utf8");
const V3 = readFileSync(new URL("./v3/sync.ts", import.meta.url), "utf8");
const DRAWER = readFileSync(new URL("./settings/SettingsDrawer.tsx", import.meta.url), "utf8");
const NOTES = readFileSync(new URL("./bridge/notes.ts", import.meta.url), "utf8");
const TYPES = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");

describe("移动端按需资产（P0-4，261026）", () => {
  it("设置项 deferAssets 贯通：类型 → 同步选项 → 引擎", () => {
    expect(TYPES).toContain("deferAssets?: boolean");
    expect(V3).toContain("deferAssets?: boolean");
    expect(V3).toContain("deferAssets: true");
    expect(BRIDGE).toContain("readSyncSettings().deferAssets");
  });

  it("设置页有「按需下载附件」开关", () => {
    expect(DRAWER).toContain("按需下载附件");
    expect(DRAWER).toContain("deferAssets");
  });

  it("打开文档时按需补拉该篇资产（复用维护域操作）", () => {
    expect(NOTES).toMatch(/readSyncSettings\(\)\.deferAssets === true/);
    expect(NOTES).toContain("downloadDeclaredAssetsFor([id], true)");
  });
});
