import { app, BrowserWindow, clipboard, ClipboardItem, dialog, nativeImage, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { DraftJournal } from "../draftJournal.js";
import { Store } from "../store.js";
import type { QuickNotesStore } from "../quickNotes.js";
import { MAX_ATTACHMENT_BYTES } from "../../src/core/storeLimits.js";
import { isSafePathSegment, isSafeShellOpenFilename, sanitizeFileName } from "../../src/core/storeUtils.js";
import { exportBitableCsv, exportBitableZip, exportInkPageSvg, exportNote, saveInkPagePng, type ExportFormat } from "../export.js";
import {
  IpcInputError,
  assertContentBytes,
  assertIcon,
  assertOptionalContentBytes,
  assertTitle,
  clampSearchLimit,
} from "../ipcLimits.js";
import type { IpcRegistrar } from "./registrar.js";
import { toUint8Array } from "./bytes.js";
import { ensureTrashNoteAssets } from "../syncEngineController.js";
import { prepareAttachmentOpen } from "../attachmentOpen.js";
import { exportWorkspaceBackup, prepareCloudRestore, relaunchApp, writeS3RestoreSeed } from "../workspaceBackup.js";
import { isRememberedRestoreCandidate, rememberRestoreCandidate, restoreMainDatabaseFromBackup } from "../workspaceRestoreFromBackup.js";
import { backupsDir } from "../autoBackup.js";
import { pickedExportDir, rememberPickedExportDir } from "./exportDirState.js";

/** 多维表 CSV 导入文件大小上限（本地优先、量级有限，防一次性读入超大文件）。 */
const MAX_CSV_IMPORT_BYTES = 20 * 1024 * 1024;

/**
 * 「从备份恢复」文件选择框（设置页 IPC 与启动恢复页共用，路径口径单一来源）：
 * - defaultPath = `autoBackup.backupsDir(userData)`（自动备份写在这里），不手拼字符串；
 * - **不检查目录是否存在、不抛**：目录还没建时 Electron 自行回落到父级/用户目录；
 * - 用户取消返回 null。
 */
export async function pickBackupDatabaseDialog(
  userDataDir: string,
  labels: { title?: string; buttonLabel?: string } = {},
): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  let defaultPath: string | undefined;
  try { defaultPath = backupsDir(userDataDir); } catch { defaultPath = undefined; }
  const result = await dialog.showOpenDialog(win, {
    title: labels.title ?? "选择整库备份（metadata*.sqlite3）",
    buttonLabel: labels.buttonLabel ?? "选择备份",
    properties: ["openFile"],
    filters: [{ name: "SQLite 备份", extensions: ["sqlite3"] }],
    ...(defaultPath ? { defaultPath } : {}),
  });
  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
}

/** 保存版本守卫的 baseHash：sha256 十六进制（64 位）；缺省/null/空串 = 不启用守卫（旧行为）。 */
function assertBaseHash(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) throw new IpcInputError("baseHash 参数无效");
  return value.toLowerCase();
}

interface ResourceUploadInput {
  bytes: Uint8Array;
  filename: string;
}

export function registerNotesIpc(
  ipc: IpcRegistrar,
  store: Store,
  quickNotes: QuickNotesStore,
  drafts: DraftJournal,
  workspaceRoot: string,
  backupDatabases: (targetRoot: string) => void,
  enqueueMaintenance: <T>(task: () => Promise<T>) => Promise<T>,
): void {
  /** 导出目录白名单：只接受本进程 pick_export_dir 系统选择框的返回值。 */
  // 261106：导出目录授权记录抽到 exportDirState（批量导出 IPC 与单条导出共用同一判据）。
  const lastPickedExportDir = (): string | null => pickedExportDir();

  ipc.handle("bootstrap_workspace", () => store.bootstrap());
  ipc.handle("read_note", (id: string) => {
    const note = store.readNote(id);
    // 按需资产（P0-4，与移动端同口径）：打开文档时后台补齐该篇声明里的缺失媒体。
    // best-effort：失败只记日志，下次打开/同步再补。
    if (store.getSyncSettings().deferAssets === true) {
      void ensureTrashNoteAssets(store, id).catch((error) => {
        console.warn("[sync] 打开文档时补拉资产失败（下次再试）:", (error as Error)?.message ?? error);
      });
    }
    return note;
  });
  ipc.handle("note_body_missing", (id: string) => store.isNoteBodyMissing(id));
  ipc.handle("list_missing_bodies", () => store.listMissingBodies());
  ipc.handle("purge_missing_body", (id: string) => store.purgeMissingBodyNote(id));
  ipc.handle("get_note_digest", (id: string) => store.getNoteDigest(id));
  ipc.handle("create_note", (title: unknown) => store.createNote(assertTitle(title)));
  // Batch4-D 保存版本守卫：可选第 5 参 baseHash（打开/上次保存时的正文 sha256）。
  // 不传 = 旧行为（逐字节一致）；传了且磁盘已变 ⇒ 返回 { ok:false, code:"external_changed", diskHash }，不写盘。
  ipc.handle("save_note", (id: string, title: unknown, content: unknown, caches?: { markdown?: string | null; plain?: string | null }, baseHash?: unknown) =>
    store.saveNoteVersioned(id, assertTitle(title), assertContentBytes(content), caches, assertBaseHash(baseHash)));
  ipc.handle("update_note_caches", (id: string, markdown: unknown, plain: unknown) => {
    // W-4：缓存文本同样可能达正文量级，统一走 32MiB 上限
    store.updateNoteCaches(id, assertOptionalContentBytes(markdown), assertOptionalContentBytes(plain));
  });
  ipc.handle("ensure_note_caches", (id: string, lakeContent?: unknown) =>
    store.ensureNoteCaches(id, assertOptionalContentBytes(lakeContent) ?? undefined));
  ipc.handle("read_note_caches", (id: string) => store.readNoteCaches(id));
  ipc.handle("list_draft_journals", () => drafts.list());
  ipc.handle("save_draft_journal", (entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new IpcInputError("草稿格式无效");
    const value = entry as Record<string, unknown>;
    if (typeof value.noteId !== "string" || typeof value.updatedAt !== "string") throw new IpcInputError("草稿字段无效");
    const updatedAt = new Date(value.updatedAt);
    if (Number.isNaN(updatedAt.getTime())) throw new IpcInputError("草稿时间无效");
    drafts.write({ noteId: value.noteId, title: assertTitle(value.title ?? "无标题"), content: assertContentBytes(value.content), updatedAt: updatedAt.toISOString() });
  });
  ipc.handle("delete_draft_journal", (id: string) => drafts.remove(id));
  ipc.handle("get_note_paths", (id: string) => store.getNotePaths(id));
  ipc.handle("get_note_info", (id: string) => store.getNoteInfo(id));
  /** 只改附件展示名（不动存储文件）。 */
  ipc.handle("rename_asset_display", (noteId: string, filename: string, newName: string) => {
    assertAttachmentSegments(noteId, filename);
    return store.renameAssetDisplay(noteId, filename, String(newName ?? ""));
  });
  ipc.handle("pick_export_dir", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: "选择导出位置",
      buttonLabel: "导出到此目录",
      properties: ["openDirectory", "createDirectory"],
    });
    rememberPickedExportDir(result.canceled ? null : (result.filePaths[0] ?? null));
    return pickedExportDir();
  });
  // 防渲染层任意路径写入：导出目录必须来自本进程的系统选择框。
  /** 目录可省略（= 主进程默认导出目录）；给了就必须是本进程系统选择框的返回值（防任意路径写入）。 */
  const optionalExportDir = (baseDir: unknown): string | undefined => {
    if (baseDir === undefined || baseDir === null || baseDir === "") return undefined;
    if (typeof baseDir !== "string" || baseDir !== lastPickedExportDir()) {
      throw new IpcInputError("导出目录无效：请先通过系统选择框选择目录");
    }
    return baseDir;
  };
  const inkPageIds = (pageIds: unknown): string[] =>
    Array.isArray(pageIds) ? pageIds.filter((item): item is string => typeof item === "string" && item.length > 0) : [];

  ipc.handle("export_note", (id: string, format: ExportFormat, baseDir?: string, options?: { pageIds?: string[] }) => {
    if (baseDir !== undefined && baseDir !== null && baseDir !== lastPickedExportDir()) {
      throw new IpcInputError("导出目录无效：请先通过系统选择框选择目录");
    }
    return exportNote(store, id, format, baseDir ?? undefined, { pageIds: inkPageIds(options?.pageIds) });
  });
  /** 单页手写板 → 自包含 SVG 文本（渲染层拿它栅格化成 PNG；不落盘）。 */
  ipc.handle("read_ink_page_svg", (id: string, pageIds: unknown) => store.readInkPageSvg(id, inkPageIds(pageIds)));
  /** 单页手写板 → SVG 文件。 */
  ipc.handle("export_ink_page_svg", (id: string, pageIds: unknown, baseDir: unknown) =>
    exportInkPageSvg(store, id, inkPageIds(pageIds), optionalExportDir(baseDir)));
  /** 单页手写板 → PNG 文件（字节由渲染层从 SVG 栅格化后回传）。 */
  ipc.handle("save_ink_page_png", (baseDir: unknown, title: unknown, bytes: unknown) => {
    const dir = optionalExportDir(baseDir);
    const data = bytes instanceof Uint8Array ? bytes : Array.isArray(bytes) ? Uint8Array.from(bytes as number[]) : null;
    if (!data || data.length === 0) throw new IpcInputError("PNG 字节无效");
    if (data.length > MAX_ATTACHMENT_BYTES) throw new IpcInputError("PNG 体积超出上限");
    return saveInkPagePng(dir, sanitizeFileName(String(title ?? "手写板")), data);
  });
  ipc.handle("export_bitable_csv", (id: string, baseDir?: string) => {
    if (baseDir !== undefined && baseDir !== null && baseDir !== lastPickedExportDir()) {
      throw new IpcInputError("导出目录无效：请先通过系统选择框选择目录");
    }
    return exportBitableCsv(store, id, baseDir ?? undefined);
  });
  ipc.handle("export_table_csv", (id: string, baseDir?: string, sheetId?: string) => {
    if (baseDir !== undefined && baseDir !== null && baseDir !== lastPickedExportDir()) {
      throw new IpcInputError("导出目录无效：请先通过系统选择框选择目录");
    }
    return store.exportTableCsv(id, baseDir ?? undefined, typeof sheetId === "string" && sheetId.length > 0 ? sheetId : undefined);
  });
  ipc.handle("export_usheet_xlsx", (id: string, baseDir?: string) => {
    if (baseDir !== undefined && baseDir !== null && baseDir !== lastPickedExportDir()) {
      throw new IpcInputError("导出目录无效：请先通过系统选择框选择目录");
    }
    return store.exportUsheetXlsx(id, baseDir ?? undefined);
  });
  ipc.handle("export_bitable_zip", (id: string, baseDir?: string) => {
    if (baseDir !== undefined && baseDir !== null && baseDir !== lastPickedExportDir()) {
      throw new IpcInputError("导出目录无效：请先通过系统选择框选择目录");
    }
    return exportBitableZip(store, id, baseDir ?? undefined);
  });
  ipc.handle("pick_import_csv", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: "选择要导入的 CSV 文件",
      buttonLabel: "导入",
      properties: ["openFile"],
      filters: [{ name: "CSV", extensions: ["csv", "txt"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    if (fs.statSync(filePath).size > MAX_CSV_IMPORT_BYTES) {
      throw new IpcInputError("CSV 文件过大（上限 " + Math.round(MAX_CSV_IMPORT_BYTES / 1024 / 1024) + "MB）");
    }
    return { name: path.basename(filePath), content: fs.readFileSync(filePath, "utf8") };
  });
  // ---- A1 整库备份 / A2 云端恢复 ----
  let lastPickedBackupDir: string | null = null;
  ipc.handle("pick_backup_dir", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: "选择备份保存位置",
      buttonLabel: "备份到此目录",
      properties: ["openDirectory", "createDirectory"],
    });
    lastPickedBackupDir = result.canceled ? null : (result.filePaths[0] ?? null);
    return lastPickedBackupDir;
  });
  ipc.handle("run_workspace_backup", (dir: string) => {
    if (dir !== lastPickedBackupDir) throw new IpcInputError("备份目录无效：请先通过系统选择框选择目录");
    return enqueueMaintenance(async () => {
      const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
      const target = path.join(dir, `lakex-local-notes-backup-${ts}`);
      const log = (msg: string) => store.logScopes.sync.info(msg);
      const result = exportWorkspaceBackup(workspaceRoot, target, backupDatabases, log);
      return { backupPath: result.backupPath, copiedDirs: result.copiedDirs };
    });
  });
  ipc.handle("prepare_cloud_restore", () => {
    // A2 机械安全（审计 §4.5）：隔离备份 → 全新空库 → 只拉不打（重启后首同步语义）→ 显式确认在渲染层。
    // 生产可用性 + 本地安全（审计修复）：S3 凭据随恢复保留——seed 存 settings 表原始行
    // （secretAccessKey 为 enc:v1: 密文，绝不解密成明文落盘）；重启后 main 原样写回新库。
    const s3Row = store.exportS3SettingsRow();
    const { quarantinePath } = prepareCloudRestore(workspaceRoot);
    if (s3Row) writeS3RestoreSeed(workspaceRoot, s3Row);
    return { quarantinePath };
  });
  ipc.handle("confirm_relaunch", () => {
    relaunchApp();
    return true;
  });
  // ---- Batch4-A 从备份导入恢复：选择框在主进程登记候选，IPC 只接受登记过的路径（防目录穿越/任意路径）----
  ipc.handle("pick_backup_database", async () => {
    const filePath = await pickBackupDatabaseDialog(app.getPath("userData"));
    if (!filePath) return null;
    if (!rememberRestoreCandidate(filePath)) {
      throw new IpcInputError("备份文件无效：仅支持应用「整库备份/导出」产生的 metadata*.sqlite3 文件");
    }
    return { path: filePath, name: path.basename(filePath) };
  });
  ipc.handle("restore_workspace_from_backup", (backupPath: string) => {
    if (!isRememberedRestoreCandidate(backupPath)) {
      throw new IpcInputError("备份文件无效：请先通过系统选择框选择备份文件");
    }
    const result = restoreMainDatabaseFromBackup({
      backupPath,
      currentDbPath: path.join(workspaceRoot, "metadata.sqlite3"),
      // 261107：小记库与主库同备份快照，必须一起恢复（标签关系已统一到小记库）。
      currentQuickNotesDbPath: path.join(workspaceRoot, "quick-notes", "metadata.sqlite3"),
      userDataDir: app.getPath("userData"),
    });
    if (!result.ok) {
      store.logScopes.store.error("[restore-backup] 失败 " + (result.reason ?? "") + (result.rolledBack ? "（已回滚）" : ""));
      throw new IpcInputError("从备份恢复失败：" + (result.message ?? result.reason ?? "未知原因"));
    }
    store.logScopes.store.info("[restore-backup] 成功，原库隔离到 " + result.quarantinePath);
    return { ok: true as const, quarantinePath: result.quarantinePath, message: result.message, requiresRestart: true as const };
  });
  ipc.handle("set_node_icon", (id: string, icon: unknown) => store.setNodeIcon(id, assertIcon(icon)));
  ipc.handle("search_notes", (query: unknown, limit?: unknown) => {
    if (typeof query !== "string") throw new IpcInputError("搜索词格式无效");
    const capped = clampSearchLimit(limit);
    // 文档在前、小记在后（SearchPanel 按 kind 分组）；小记最多 20 条，避免挤掉文档结果。
    const notes = store.searchNotes(query, capped);
    let quick: ReturnType<QuickNotesStore["search"]> = [];
    try { quick = quickNotes.search(query, Math.min(20, capped)); }
    catch { /* 小记索引异常不得拖垮文档搜索；设置页可重建 */ }
    return [...notes, ...quick];
  });
  // 手动重建全文索引（异常/换分词器后修复用；正常启动走增量对账）。
  ipc.handle("rebuild_search_index", () => {
    store.rebuildSearchIndex();
    quickNotes.rebuildSearchIndex();
    return true;
  });
  ipc.handle("delete_note", (id: string) => store.deleteNote(id));
  ipc.handle("set_note_locked", (id: string, locked: boolean) => { store.setNoteEditLocked(id, locked); return store.readNote(id); });
  ipc.handle("list_tree_nodes", () => store.listTreeNodes());
  ipc.handle("list_note_summaries", () => store.listNoteSummaries());
  // space（261109）= 日记本标记：只接受 "diary" / null，其余归一成 null（非日记）。
  ipc.handle("create_notebook", (title: unknown, space?: unknown) => store.createNotebook(assertTitle(title), space === "diary" ? "diary" : null));
  ipc.handle("create_group", (parentId: string, title: unknown) => store.createGroup(parentId, assertTitle(title)));
  ipc.handle("rename_tree_node", (id: string, title: unknown) => store.renameTreeNode(id, assertTitle(title)));
  ipc.handle("create_note_in", (parentId: string | null, title: unknown) => store.createNoteIn(parentId, assertTitle(title)));
  // v6：新建表格文档（kind=usheet）；正文落 usheets/{id}.usheet.json，其余复用文档管线
  ipc.handle("create_usheet_in", (parentId: string | null, title: unknown) => store.createUsheetIn(parentId, assertTitle(title)));
  ipc.handle("create_bitable_in", (parentId: string | null, title: unknown) => store.createBitableIn(parentId, assertTitle(title)));
  // v7：新建画板文档（kind=board）；正文落 boards/{id}.board.json，其余复用文档管线
  ipc.handle("create_board_in", (parentId: string | null, title: unknown) => store.createBoardIn(parentId, assertTitle(title)));
  ipc.handle("create_ink_in", (parentId: string | null, title: unknown) => store.createInkIn(parentId, assertTitle(title)));
  ipc.handle("move_tree_node", (id: string, parentId: string | null, sortOrder: number) => store.moveTreeNode(id, parentId, sortOrder));
  ipc.handle("move_tree_node_ordered", (id: string, parentId: string | null, orderedIds: string[]) => store.moveTreeNodeOrdered(id, parentId, orderedIds));
  ipc.handle("reorder_tree_nodes", (parentId: string | null, orderedIds: string[]) => store.reorderTreeNodes(parentId, orderedIds));
  ipc.handle("delete_tree_node", (id: string) => store.deleteTreeNode(id));
  ipc.handle("list_trash", () => store.listTrash());
  ipc.handle("restore_trash", (id: string) => {
    // 261006 B 方案：**恢复立刻生效、不等网络**（原先先 await 全量资产下载，慢网会让恢复像卡死）。
    // 缺失资源由渲染层随后调 ensure_trash_note_assets 在后台补拉（离线则直接 skipped、不出网）。
    store.restoreTrashItem(id);
  });
  ipc.handle("ensure_trash_note_assets", async (id: string) => {
    // 预览 / 恢复后台补拉：按需拉该笔记**缺失**的资源（best-effort，不恢复）。
    const { warnings, skipped } = await ensureTrashNoteAssets(store, id);
    for (const w of warnings) store.logScopes.sync.warn(`[assets] ${w}`);
    return { warnings, skipped: skipped ?? null };
  });
  ipc.handle("purge_trash", (id: string) => store.purgeTrashItem(id));
  ipc.handle("empty_trash", () => store.emptyTrash());
  ipc.handle("upload_resource", (input: ResourceUploadInput, noteId: string) => {
    // 桌面 IPC 传 Uint8Array；Web 客户端经 HTTP JSON 传 number[]（浏览器端插图/附件）。
    const bytes = toUint8Array(input?.bytes);
    if (!bytes) throw new Error("资源数据无效");
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`资源超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MiB 协议上限`);
    return store.uploadResource({ ...input, bytes }, noteId);
  });
  ipc.handle("download_remote_resource", (url: string, noteId: string) => store.downloadRemoteResource(url, noteId));
  ipc.handle("list_orphan_assets", () => store.listOrphanAssets());
  ipc.handle("clean_orphan_assets", () => store.cleanOrphanAssets());
  ipc.handle("delete_orphan_asset", (id: number) => store.deleteOrphanAsset(Number(id)));
  ipc.handle("read_orphan_preview", (id: number) => store.readOrphanPreview(Number(id)));
  ipc.handle("list_removed_assets", () => store.listRemovedAssets());
  ipc.handle("read_asset_preview", (noteId: string, filename: string) => store.readAssetPreview(noteId, filename));
  /** 附件操作（桌面本地优先：文件本来就在磁盘）：用系统默认应用打开 / 在文件夹中显示。
   * 路径安全：noteId + filename 双段校验（isSafePathSegment），只允许 note-assets 目录内。 */
  ipc.handle("open_attachment", async (noteId: string, filename: string) => {
    assertAttachmentSegments(noteId, filename);
    // 同步/导入附件名不可信：禁止 shell 打开可执行类（.command/.exe/.bat…）；未知扩展名 fail-closed
    if (!isSafeShellOpenFilename(filename)) {
      throw new IpcInputError("该附件类型不允许用系统应用打开（疑似可执行文件）");
    }
    const full = store.noteAssetsPathFor(noteId) ? path.join(store.noteAssetsPathFor(noteId), filename) : "";
    if (!fs.existsSync(full)) throw new IpcInputError("附件文件不存在（可能已清理）");
    // 压缩包不能直接交给系统：macOS 归档工具会**解压到压缩包同目录**（= 往 note-assets 里堆目录，
    // 那些目录不进 assets 表、也不进孤儿 GC ⇒ 永远清不掉）。先挪到临时目录再打开，见 core/attachmentOpen。
    const plan = await prepareAttachmentOpen({ noteId, filename, fullPath: full }, app.getPath("temp"), {
      removeDir: (target) => fs.rmSync(target, { recursive: true, force: true }),
      makeDir: (target) => { fs.mkdirSync(target, { recursive: true }); },
      link: (from, to) => fs.linkSync(from, to),
      copy: async (from, to) => { await fs.promises.copyFile(from, to); },
    });
    return shell.openPath(plan.openPath).then((err) =>
      err ? { ok: false, error: err, mode: plan.mode } : { ok: true, mode: plan.mode },
    );
  });
  ipc.handle("show_attachment_in_folder", (noteId: string, filename: string) => {
    assertAttachmentSegments(noteId, filename);
    const full = path.join(store.noteAssetsPathFor(noteId), filename);
    if (!fs.existsSync(full)) throw new IpcInputError("附件文件不存在（可能已清理）");
    shell.showItemInFolder(full);
    return { ok: true };
  });
  /** 复制资源文件绝对路径到系统剪贴板（孤儿/历史保护文件管理用）。 */
  ipc.handle("copy_asset_path", async (noteId: string, filename: string) => {
    assertAttachmentSegments(noteId, filename);
    const full = path.join(store.noteAssetsPathFor(noteId), filename);
    // Electron 44：clipboard 对齐 W3C 异步 API，await 确保 IPC 返回前已写入
    await clipboard.writeText(full);
    return full;
  });
  /** 复制图片到系统剪贴板（粘贴到聊天/文档直接出图）。 */
  ipc.handle("copy_asset_image", async (noteId: string, filename: string) => {
    assertAttachmentSegments(noteId, filename);
    const full = path.join(store.noteAssetsPathFor(noteId), filename);
    if (!fs.existsSync(full)) throw new IpcInputError("附件文件不存在（可能已清理）");
    // WebP/AVIF 必须先转 PNG 再进剪贴板：① Electron 的 nativeImage 解不了 webp（createFromPath
    // 返回空图 → 以前这里直接抛"不是可复制的图片"，用户看到的是"复制图片没反应"，因为调用处是
    // void）；② macOS 原生应用（微信）不认 webp pasteboard 类型。统一走 sharp 解成 PNG
    // （与 assetServer 的 webp→png 口径一致）。
    const ext = path.extname(filename).toLowerCase();
    let png: Buffer;
    if (ext === ".webp" || ext === ".avif") {
      const converted = await sharp(full).png().toBuffer().catch(() => null);
      if (!converted) throw new IpcInputError("图片解码失败（webp/avif 转 PNG 未成功）");
      png = converted;
    } else {
      const image = nativeImage.createFromPath(full);
      if (image.isEmpty()) throw new IpcInputError("该附件不是可复制的图片");
      png = image.toPNG();
    }
    // Electron 44：writeImage 已移除，改用 W3C ClipboardItem（MIME 制）写入 PNG
    await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }) })]);
    return { ok: true };
  });
  /** 另存为：把单个附件复制到用户选择的位置。默认文件名优先用卡片展示名，缺失则随机（不再用内部时间戳名）。 */
  ipc.handle("save_asset_as", async (noteId: string, filename: string, suggestedName?: string) => {
    assertAttachmentSegments(noteId, filename);
    const full = path.join(store.noteAssetsPathFor(noteId), filename);
    if (!fs.existsSync(full)) throw new IpcInputError("附件文件不存在（可能已清理）");
    const ext = path.extname(filename);
    let baseName = typeof suggestedName === "string" ? sanitizeFileName(suggestedName).trim() : "";
    // 没有展示名就用我们存的附件名（本身就是 时间戳_hash，等价"随机"），不另造名字。
    if (!baseName) baseName = filename;
    else if (path.extname(baseName) === "") baseName += ext;
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath("downloads"), baseName) });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.copyFileSync(full, result.filePath);
    return { ok: true, path: result.filePath };
  });
  /** 在文件管理器中显示笔记对应的 \`.lake\` 文件（.lake 的默认程序即本应用，不另做"用默认程序打开"）。 */
  ipc.handle("reveal_note_file", (id: string) => {
    const { lakePath } = store.getNotePaths(id);
    if (!fs.existsSync(lakePath)) throw new IpcInputError("笔记文件不存在（可能已清理）");
    shell.showItemInFolder(lakePath);
    return { ok: true };
  });
  /** 打开笔记的附件目录（note-assets/{id}；不存在则先建空目录再打开）。 */
  ipc.handle("open_note_assets", (id: string) => {
    const { assetsDir } = store.getNotePaths(id);
    fs.mkdirSync(assetsDir, { recursive: true });
    return shell.openPath(assetsDir).then((err) => (err ? { ok: false, error: err } : { ok: true }));
  });
}

/** 附件路径段校验：noteId + filename 都必须是安全单段（防穿越 note-assets 目录）。 */
function assertAttachmentSegments(noteId: string, filename: string): void {
  if (!isSafePathSegment(noteId) || !isSafePathSegment(filename)) {
    throw new IpcInputError("无效的附件路径");
  }
}
