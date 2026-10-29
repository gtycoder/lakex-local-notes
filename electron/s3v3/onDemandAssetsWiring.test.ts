import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const PANEL = readFileSync(new URL("../../src/components/app/SettingsPanel.tsx", import.meta.url), "utf8");
const SYNC = readFileSync(new URL("./desktopSync.ts", import.meta.url), "utf8");
const NOTES = readFileSync(new URL("../ipc/registerNotes.ts", import.meta.url), "utf8");
const REPO = readFileSync(new URL("../settingsRepository.ts", import.meta.url), "utf8");
// CORE-14：SyncSettings 归一已下沉到 core/syncSettings（桌面只传 fallback）⇒ deferAssets 保留判据跟着单一来源走。
const SYNC_SETTINGS = readFileSync(new URL("../../src/core/syncSettings.ts", import.meta.url), "utf8");

describe("桌面端按需资产接线（P0-4，261026）", () => {
  it("设置页开关 + 设置读写保留 deferAssets", () => {
    expect(PANEL).toContain("sync-defer-assets");
    expect(PANEL).toContain("按需下载附件");
    expect(REPO).toContain("normalizeSyncSettings(JSON.parse(row.value), def)");
    expect(SYNC_SETTINGS).toContain("parsed.deferAssets === true");
  });
  it("同步把 deferAssets 传给引擎；打开文档后台补拉该篇", () => {
    expect(SYNC).toContain("store.getSyncSettings().deferAssets");
    expect(SYNC).toContain("deferAssets: true");
    expect(NOTES).toContain("ensureTrashNoteAssets(store, id)");
    expect(NOTES).toContain("deferAssets === true");
  });
});
