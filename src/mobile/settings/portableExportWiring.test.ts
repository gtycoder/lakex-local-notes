/** 261117 D 项接线护栏（源码断言）。 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("移动端导出便携包到文件（D 项）接线", () => {
  it("UI 入口挂在关于页，组件接导出编排", () => {
    const about = read("src/mobile/settings/BasicSettingsSections.tsx");
    expect(about).toContain("PortableExportBlock");
    expect(about).toContain("<PortableExportBlock />");
    const block = read("src/mobile/settings/PortableExportBlock.tsx");
    expect(block).toContain("exportPortableSnapshotToDownloads");
    expect(block).toContain("portableExportSummary");
  });

  it("导出编排：原生快照 → 自检 → saveAs(toDownloads)", () => {
    const flow = read("src/mobile/portable/exportPortable.ts");
    expect(flow).toContain("nativeExportPortableSnapshot()");
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
    const plugin = read("android/app/src/main/java/com/lakexlocalnotes/android/PortablePackagePlugin.kt");
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

  it("文档写清 D 已实现与操作步骤", () => {
    const docPath = path.join(ROOT, "docs/mobile/UNINSTALL-DATA.md");
    expect(existsSync(docPath)).toBe(true);
    const doc = read("docs/mobile/UNINSTALL-DATA.md");
    expect(doc).toContain("导出便携包到文件");
    expect(doc).toContain("Download");
    expect(doc).toContain("从便携包导入");
  });
});
