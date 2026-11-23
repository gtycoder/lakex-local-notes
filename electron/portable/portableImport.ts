/**
 * 桌面导入大统一迁移包（docs/PORTABLE-TRANSFER.md §3；261122 大统一 v2）。
 *
 * 选包（.zip.lln）→ 结构/清单校验（zipRead + core 单一校验器）→ 按 manifest.layout 分派：
 * - desktop-workspace：解包 staging → baseline 转换 → 校验两库 → 换位（隔离当前工作区 → staging 升格）；
 * - mobile-snapshot：反向映射（移动行 → 桌面两库），见 importMobileSnapshot.ts。
 * 失败原则：校验/解包阶段不碰本机数据；换位阶段失败回滚（原工作区移回）；staging 无条件清理。
 */
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  parsePortableManifest,
  PORTABLE_FILE_EXTENSION,
  PORTABLE_LIMIT_BYTES,
  type PortableManifest,
} from "../../src/core/portable/portableFormat.js";
import { readCentralDirectory, readEntryData, extractEntryToFile, type ZipDirectory } from "./zipRead.js";
import { inspectBackupDatabase, inspectQuickNotesDatabase } from "../workspaceRestoreFromBackup.js";
import { replaceWorkspaceWith } from "../workspaceBackup.js";
import { importMobileSnapshotPackageOnDesktop } from "./importMobileSnapshot.js";
import {
  buildBootstrapBaselineFromDesktopWorkspace,
  parseOfflineHashMaps,
  writeBootstrapBaselineGz,
} from "./bootstrapFromWorkspace.js";

const MANIFEST_NAME = "portable.json";
const DESKTOP_PREFIX = "desktop/";
/** 条目上限（导入端防炸弹闸）：261122 放宽到 50 万。 */
export const PORTABLE_MAX_ENTRIES = 500_000;

export interface PortablePackageInspection {
  manifest: PortableManifest;
  directory: ZipDirectory;
  entries: number;
  dataBytes: number;
  fileBytes: number;
}

/** 只读校验便携包（不触碰本机数据）：后缀/结构/上限/清单 v2。 */
export function inspectPortablePackage(zipPath: string, options: { maxEntries?: number } = {}): PortablePackageInspection {
  if (!zipPath.endsWith(PORTABLE_FILE_EXTENSION)) {
    throw new Error("不是便携包文件（只接受 " + PORTABLE_FILE_EXTENSION + " 后缀）");
  }
  const directory = readCentralDirectory(zipPath);
  const maxEntries = options.maxEntries ?? PORTABLE_MAX_ENTRIES;
  if (directory.entries.length > maxEntries) {
    throw new Error("便携包条目过多（" + directory.entries.length + " > " + maxEntries + "），文件可能已损坏");
  }
  if (directory.dataBytes > PORTABLE_LIMIT_BYTES) throw new Error("便携包内容超过 4GiB 上限");
  const manifestEntry = directory.entries.find((entry) => entry.name === MANIFEST_NAME);
  if (!manifestEntry) throw new Error("便携包缺少 portable.json");
  const manifest = parsePortableManifest(JSON.parse(readEntryData(zipPath, manifestEntry).toString("utf8")));
  return { manifest, directory, entries: directory.entries.length, dataBytes: directory.dataBytes, fileBytes: directory.fileBytes };
}

export interface PortableImportOptions {
  zipPath: string;
  workspaceRoot: string;
  /** staging 父目录（必须与工作区同卷：main 注入 <userData>/portable-import）。 */
  stagingParent: string;
  onProgress?: (filesDone: number, filesTotal: number) => void;
}

export interface PortableImportResult {
  ok: boolean;
  reason?: string;
  /** 换位失败时是否已把原工作区移回（false = 回滚也失败，需人工介入）。 */
  rolledBack?: boolean;
  /** 成功时原工作区的隔离目录（未删除；全新机器为 undefined）。 */
  quarantinePath?: string;
  quickNotesRestored?: boolean;
  requiresRestart?: boolean;
  message?: string;
}

/** 桌面端导入任意布局的便携包（按 manifest.layout 分派）。 */
export function importPortablePackageOnDesktop(options: PortableImportOptions): PortableImportResult {
  let inspection: PortablePackageInspection;
  try {
    inspection = inspectPortablePackage(options.zipPath);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (inspection.manifest.layout === "mobile-snapshot") {
    return importMobileSnapshotPackageOnDesktop(options, inspection);
  }
  return importDesktopWorkspacePackage(options, inspection);
}

/** desktop-workspace 包：staging 解包 → baseline 转换 → 校验 → 换位（原子 rename，失败回滚）。 */
export function importDesktopWorkspacePackage(options: PortableImportOptions, inspection?: PortablePackageInspection): PortableImportResult {
  const checked = inspection ?? inspectPortablePackage(options.zipPath);
  const stamp = new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 19);
  const stagingRoot = path.join(options.stagingParent, "import-" + stamp);
  try {
    fs.mkdirSync(stagingRoot, { recursive: true });
    // 1) 解包 desktop/*（其余条目不属于本布局，跳过；zip-slip 在 extractEntryToFile 拒绝）。
    const desktopEntries = checked.directory.entries.filter((entry) => entry.name.startsWith(DESKTOP_PREFIX));
    let filesDone = 0;
    for (const entry of desktopEntries) {
      extractEntryToFile(options.zipPath, entry, path.join(stagingRoot, entry.name));
      filesDone += 1;
      options.onProgress?.(filesDone, desktopEntries.length);
    }
    const stagingDesktop = path.join(stagingRoot, "desktop");
    const stagingMainDb = path.join(stagingDesktop, "metadata.sqlite3");
    if (!fs.existsSync(stagingMainDb)) throw new Error("包内缺少 desktop/metadata.sqlite3");

    // 2) baseline 转换（261201 P1-A 统一口径，PORTABLE-TRANSFER §3.1）：有云端基线 ⇒ JSON 解开后
    //    重新 gz 为 baseline.json.gz；纯离线包 = 内容哈希清单 ⇒ 合成合并底稿；**坏/缺基线不再
    //    「按无基线导入」**（首同步会落拉全轮：小记物删/文档假删除）⇒ 同样合成合并底稿 + 明示警告。
    const baselineJson = path.join(stagingDesktop, "sync-v3", "baseline.json");
    let baselineWarning = "";
    let baselineWritten = false;
    if (checked.manifest.baseline) {
      try {
        const raw = fs.readFileSync(baselineJson);
        JSON.parse(raw.toString("utf8")); // 自证可解析：坏基线不把坏字节写进工作区
        fs.mkdirSync(path.dirname(baselineJson), { recursive: true });
        fs.writeFileSync(baselineJson.replace(/\.json$/, ".json.gz"), gzipSync(raw));
        baselineWritten = true;
      } catch {
        baselineWarning = "（包内同步基线损坏，已按本地内容合成合并底稿：配好 S3 后按三方合并增量同步，不做云端优先收敛）";
      }
    }
    if (!baselineWritten) {
      // 261123（§3.1）：合成「合并底稿」基线（导出时刻快照当三方合并 base），首同步走三方合并不走拉全轮。
      try {
        const hashMaps = !checked.manifest.baseline && fs.existsSync(baselineJson)
          ? parseOfflineHashMaps(fs.readFileSync(baselineJson, "utf8"))
          : undefined;
        writeBootstrapBaselineGz(stagingDesktop, buildBootstrapBaselineFromDesktopWorkspace(stagingDesktop, hashMaps));
      } catch (error) {
        baselineWarning = "（合成合并底稿基线失败，已按无基线导入：" + (error instanceof Error ? error.message : String(error)) + "）";
      }
    }
    fs.rmSync(baselineJson, { force: true });

    // 3) 校验两库（与整库导入同口径）。
    const mainInspection = inspectBackupDatabase(stagingMainDb);
    if (!mainInspection.ok) throw new Error("包内主库校验未通过：" + (mainInspection.reason ?? "未知原因"));
    const stagingQuickDb = path.join(stagingDesktop, "quick-notes", "metadata.sqlite3");
    const hasQuick = fs.existsSync(stagingQuickDb);
    if (hasQuick) {
      const quickInspection = inspectQuickNotesDatabase(stagingQuickDb);
      if (!quickInspection.ok) throw new Error("包内小记库校验未通过：" + (quickInspection.reason ?? "未知原因"));
    }

    // 4) 换位：隔离当前工作区 → staging 升格为工作区（同一卷内 rename；隔离/回滚统一走 replaceWorkspaceWith）。
    const swapped = replaceWorkspaceWith({
      workspaceRoot: options.workspaceRoot,
      quickNotesRestored: hasQuick,
      describe: hasQuick ? "便携包已导入（主库 + 小记库）" : "便携包已导入（包内无小记库，恢复后标签/小记为空）",
      materialize: (freshRoot) => { fs.renameSync(stagingDesktop, freshRoot); },
    });
    if (!swapped.ok) {
      return { ok: false, reason: "换位失败（staging 与工作区需同磁盘）：" + (swapped.reason ?? ""), rolledBack: swapped.rolledBack };
    }
    return {
      ok: true,
      quarantinePath: swapped.quarantinePath,
      quickNotesRestored: swapped.quickNotesRestored,
      requiresRestart: true,
      message: (swapped.message ?? "") + baselineWarning,
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch { /* 尽力 */ }
  }
}


