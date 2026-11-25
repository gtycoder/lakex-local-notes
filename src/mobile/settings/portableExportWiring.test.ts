/** 261117 D 项接线护栏（源码断言）。 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("移动端导出便携包到文件（D 项）接线", () => {
  it("UI 入口 = 备份与恢复 → 迁入迁出（261122 唯一出入口），组件接导出编排", () => {
    const drawer = read("src/mobile/settings/SettingsDrawer.tsx");
    expect(drawer).toContain('title="迁入迁出（便携包）"');
    expect(drawer).toContain("<PortableExportBlock />");
    expect(drawer).toContain("<PortableImportSection");
    // 唯一出入口：导出块不再散落在「关于 → 卸载与换机」（只留跳转指引）
    const about = read("src/mobile/settings/BasicSettingsSections.tsx");
    expect(about).not.toContain("<PortableExportBlock />");
    expect(about).toContain("迁入迁出");
    const block = read("src/mobile/settings/PortableExportBlock.tsx");
    expect(block).toContain("exportPortableSnapshotToDownloads");
    expect(block).toContain("portableExportSummary");
  });

  it("关闭数据库前 wal_checkpoint：陈旧主库不再误报缺正文（261117 恢复演练实锤）", () => {
    const context = read("src/mobile/bridge/context.ts");
    expect(context).toContain("PRAGMA wal_checkpoint(TRUNCATE)");
    // checkpoint 必须发生在 close 之前（原生快照只复制主库文件）
    expect(context.indexOf("wal_checkpoint")).toBeLessThan(context.indexOf("await current.close()"));
  });

  it("导出编排：原生快照 → 自检 → saveAs(toDownloads)", () => {
    const flow = read("src/mobile/portable/exportPortable.ts");
    // v2（261122）：导出前读基线并把 ref 传给原生（清单 baseline 字段）
    expect(flow).toContain("readBaselineFile()");
    expect(flow).toContain("nativeExportPortableSnapshot(baselineRef)");
    expect(flow).toContain("nativeInspectPortableSnapshot(exported.path)");
    expect(flow).toContain("saveFileToUserVisible(");
    expect(flow).toContain("toDownloads: true");
    expect(flow).toContain("missingBodies");
    // MediaStore 会给 application/zip 的显示名追加 .zip（实测 API36）⇒ 用自定义 MIME 保住 .zip.lln 后缀；
    // 回报大小用实际落盘字节（zip 压缩后），不用导出前累计字节。
    expect(flow).toContain("application/x-lakex-portable");
    expect(flow).toContain("saved.bytes ?? exported.bytes");
    const openFile = read("android/app/src/main/java/com/lakexlocalnotes/android/OpenFilePlugin.kt");
    expect(openFile).toContain('put("bytes", src.length())');
    const save = read("src/mobile/native/openFileSave.ts");
    expect(save).toContain("OpenFile.saveAs");
    expect(save).toContain("isOpenFileNativeAvailable");
  });

  it("原生：OpenFile 写 MediaStore Downloads；PortableImport 有 export/inspect/restore", () => {
    const openFile = read("android/app/src/main/java/com/lakexlocalnotes/android/OpenFilePlugin.kt");
    expect(openFile).toContain("MediaStore.Downloads.EXTERNAL_CONTENT_URI");
    expect(openFile).toContain("MediaStore.MediaColumns.RELATIVE_PATH");
    expect(openFile).toContain("Environment.DIRECTORY_DOWNLOADS");
    expect(openFile).toContain("fun saveToDownloads");
    expect(openFile).toContain('getBoolean("toDownloads")');
    // M-16②：条目名/上限/后缀闸纯规则拆到 PortablePackageRules.kt ⇒ 按「便携包插件面」聚合读两文件。
    const plugin = read("android/app/src/main/java/com/lakexlocalnotes/android/PortablePackagePlugin.kt") + read("android/app/src/main/java/com/lakexlocalnotes/android/PortablePackageRules.kt");
    expect(plugin).toContain("fun exportSnapshot");
    expect(plugin).toContain("fun inspectSnapshot");
    expect(plugin).toContain("fun restoreSnapshot");
    expect(plugin).toContain("SNAPSHOT_LAYOUT");
    expect(plugin).toContain('"sync-v3"');
  });

  it("导入路径能接住手机整机快照（否则备份不可恢复）", () => {
    const flow = read("src/mobile/portable/importPortable.ts");
    expect(flow).toContain("isMobileSnapshotManifest");
    expect(flow).toContain("nativeRestorePortableSnapshot");
    expect(flow).toContain("restoreMobileSnapshot");
    const ui = read("src/mobile/settings/PortableImportSection.tsx");
    expect(ui).toContain("手机整机快照");
  });

  it("v2 大统一口径（261122）：formatVersion 2 / 500k 条目 / 历史不进包 / 导出清 note_history / 清单无 hasHistory", () => {
    // M-16②：条目名/上限/后缀闸纯规则拆到 PortablePackageRules.kt ⇒ 按「便携包插件面」聚合读两文件。
    const plugin = read("android/app/src/main/java/com/lakexlocalnotes/android/PortablePackagePlugin.kt") + read("android/app/src/main/java/com/lakexlocalnotes/android/PortablePackageRules.kt");
    expect(plugin).toContain("PORTABLE_FORMAT_VERSION = 2");
    expect(plugin).toContain("MAX_ENTRIES = 500_000");
    // 历史快照不进导入导出（261122 裁决）：快照目录不含 history，导出端清 note_history 索引行
    expect(plugin).toContain('SNAPSHOT_DIRS = PAYLOAD_DIRS + listOf("sync-v3")');
    // 仅本机数据不随包：历史索引/AI 会话/同步记录账本/GC 审计/孤儿资产派生表（导出端逐表清行）
    expect(plugin).toContain('scrubDb.execSQL("DELETE FROM $table")');
    expect(plugin).toContain('"note_history", "ai_conversations", "sync_conflicts"');
    expect(plugin).toContain('"s3_gc_pending", "s3_gc_log", "orphan_assets"');
    // counts 六键齐全（core 严格校验；缺 assets/bytes 会被拒包）
    expect(plugin).toContain('out.put("assets"');
    expect(plugin).toContain('out.put("bytes"');
    // v2 清单：无 hasHistory 字段，带 layout 配对与 baseline ref
    expect(plugin).not.toContain('.put("hasHistory"');
    expect(plugin).not.toContain('optBoolean("hasHistory"');
    expect(plugin).toContain('.put("baseline", baselineRef ?: JSONObject.NULL)');
    expect(plugin).toContain('"desktop-workspace"');
    // 草稿/素材随包（数据覆盖全面）
    expect(plugin).toContain('"quick-notes/staging"');
    expect(plugin).toContain('"materials"');
    // 包内手机库文件名：桌面导入端 importMobileSnapshot.MOBILE_DB_NAME 必须与之同值
    expect(plugin).toContain('MOBILE_DB_FILE = "lakex-local-notes-mobileSQLite.db"');
  });

  it("文档写清 D 已实现与操作步骤", () => {
    const docPath = path.join(ROOT, "docs/mobile/UNINSTALL-DATA.md");
    expect(existsSync(docPath)).toBe(true);
    const doc = read("docs/mobile/UNINSTALL-DATA.md");
    expect(doc).toContain("导出便携包到文件");
    expect(doc).toContain("Download");
    expect(doc).toContain("从便携包导入");
  });
});
