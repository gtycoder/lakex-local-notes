import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const NOTES = readFileSync(new URL("./bridge/notes.ts", import.meta.url), "utf8");
const CONTRACT = readFileSync(new URL("./native/lakeNativeContract.ts", import.meta.url), "utf8");
const AUTO = readFileSync(new URL("./hooks/useAutoSync.ts", import.meta.url), "utf8");
const STORE = readFileSync(new URL("./v3/mobileDeviceStore.ts", import.meta.url), "utf8");
const SYNC = readFileSync(new URL("./bridge/sync.ts", import.meta.url), "utf8");

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

  it("导入不写 text_cache，后台先补纯文本再建 FTS（261027）", () => {
    expect(STORE).toContain("text_cache,doc_kind");
    expect(STORE).toContain("INSERT INTO notes (id,title,parent_id,updated_at,content_hash,is_dirty,text_cache,doc_kind,trashed_at,deleted_from_parent_id)");
    expect(STORE).toContain("1,NULL,");
    expect(SYNC).toContain("backfillTextCache(db)");
    expect(NOTES).toContain("backfillTextCache(d)");
  });

  it("关闭「按需下载附件」时后台补齐全部缺失附件（261027）", () => {
    expect(SYNC).toContain("previous.deferAssets === true && next.deferAssets !== true");
    expect(SYNC).toContain("materializeAllDeclaredAssetsChunked");
    expect(SYNC).toContain("runMaintenance(\"ensureTrashNoteAssets\", () => ensureAssetsNative(chunk");
  });
});
