import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const NOTES = readFileSync(new URL("./bridge/notes.ts", import.meta.url), "utf8");
const CONTRACT = readFileSync(new URL("./native/lakeNativeContract.ts", import.meta.url), "utf8");
const AUTO = readFileSync(new URL("./hooks/useAutoSync.ts", import.meta.url), "utf8");
const STORE = readFileSync(new URL("./v3/mobileDeviceStore.ts", import.meta.url), "utf8");

describe("派生索引后台自愈（261026）", () => {
  it("bridge 暴露 ensureSearchIndex，且已注册进 lakeNative 契约", () => {
    expect(NOTES).toContain("async ensureSearchIndex()");
    expect(NOTES).toContain("reconcileIndex(d)");
    expect(CONTRACT).toContain('"ensureSearchIndex"');
  });

  it("冷启动/回前台会自动补齐（不阻塞、失败静默）", () => {
    expect(AUTO).toContain("ensureSearchIndex()");
    expect(AUTO).toMatch(/ensureSearchIndex\(\)\.catch/);
  });

  it("同步导入跳过逐篇 FTS（由后台补），但保留孤儿扫描/正文比较的关闭注释", () => {
    expect(STORE).toContain("skipSearchIndex: true");
    expect(STORE).toContain("skipOrphanScan: true");
    expect(STORE).toContain("skipChangeCheck: true");
  });
});
