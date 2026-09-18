import { app, BrowserWindow, clipboard, ClipboardItem, dialog, nativeImage, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { DraftJournal } from "../draftJournal.js";
import { Store } from "../store.js";
import { MAX_ATTACHMENT_BYTES } from "../../src/core/storeLimits.js";
import { isSafePathSegment, sanitizeFileName } from "../../src/core/storeUtils.js";
import { exportNote, type ExportFormat } from "../export.js";
import {
  IpcInputError,
  assertContentBytes,
  assertIcon,
  assertOptionalContentBytes,
  assertTitle,
  clampSearchLimit,
} from "../ipcLimits.js";
import type { IpcRegistrar } from "./registrar.js";
import { restoreTrashWithAssets, ensureTrashNoteAssets } from "../syncEngineController.js";
import { exportWorkspaceBackup, prepareCloudRestore, relaunchApp, writeS3RestoreSeed } from "../workspaceBackup.js";

interface ResourceUploadInput {
  bytes: Uint8Array;
  filename: string;
}

export function registerNotesIpc(
  ipc: IpcRegistrar,
  store: Store,
  drafts: DraftJournal,
  workspaceRoot: string,
  backupDatabases: (targetRoot: string) => void,
  enqueueMaintenance: <T>(task: () => Promise<T>) => Promise<T>,
): void {
  /** 导出目录白名单：只接受本进程 pick_export_dir 系统选择框的返回值。 */
  let lastPickedExportDir: string | null = null;

  ipc.handle("bootstrap_workspace", () => store.bootstrap());
  ipc.handle("read_note", (id: string) => store.readNote(id));
  ipc.handle("get_note_digest", (id: string) => store.getNoteDigest(id));
  ipc.handle("create_note", (title: unknown) => store.createNote(assertTitle(title)));
  ipc.handle("save_note", (id: string, title: unknown, content: unknown, caches?: { markdown?: string | null; plain?: string | null }) =>
    store.saveNote(id, assertTitle(title), assertContentBytes(content), caches));
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
  ipc.handle("duplicate_note", (id: string) => store.duplicateNote(id));
  ipc.handle("pick_export_dir", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: "选择导出位置",
      buttonLabel: "导出到此目录",
      properties: ["openDirectory", "createDirectory"],
    });
    lastPickedExportDir = result.canceled ? null : (result.filePaths[0] ?? null);
    return lastPickedExportDir;
  });
  ipc.handle("export_note", (id: string, format: ExportFormat, baseDir?: string) => {
    // 防渲染层任意路径写入：导出目录必须来自本进程的系统选择框。
    if (baseDir !== undefined && baseDir !== null && baseDir !== lastPickedExportDir) {
      throw new IpcInputError("导出目录无效：请先通过系统选择框选择目录");
    }
    return exportNote(store, id, format, baseDir ?? undefined);
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
      const target = path.join(dir, `lake-notes-backup-${ts}`);
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
  ipc.handle("set_node_icon", (id: string, icon: unknown) => store.setNodeIcon(id, assertIcon(icon)));
  ipc.handle("search_notes", (query: unknown, limit?: unknown) => {
    if (typeof query !== "string") throw new IpcInputError("搜索词格式无效");
    return store.searchNotes(query, clampSearchLimit(limit));
  });
  // 手动重建全文索引（异常/换分词器后修复用；正常启动走增量对账）。
  ipc.handle("rebuild_search_index", () => { store.rebuildSearchIndex(); return true; });
  ipc.handle("delete_note", (id: string) => store.deleteNote(id));
  ipc.handle("set_note_locked", (id: string, locked: boolean) => { store.setNoteLocked(id, locked); return store.readNote(id); });
  ipc.handle("list_tree_nodes", () => store.listTreeNodes());
  ipc.handle("list_note_summaries", () => store.listNoteSummaries());
  ipc.handle("create_notebook", (title: unknown) => store.createNotebook(assertTitle(title)));
  ipc.handle("create_group", (parentId: string, title: unknown) => store.createGroup(parentId, assertTitle(title)));
  ipc.handle("rename_tree_node", (id: string, title: unknown) => store.renameTreeNode(id, assertTitle(title)));
  ipc.handle("create_note_in", (parentId: string | null, title: unknown) => store.createNoteIn(parentId, assertTitle(title)));
  // v6：新建表格文档（kind=sheet）；正文落 sheets/{id}.sheet.json，其余复用文档管线
  ipc.handle("create_sheet_in", (parentId: string | null, title: unknown) => store.createSheetIn(parentId, assertTitle(title)));
  ipc.handle("move_tree_node", (id: string, parentId: string | null, sortOrder: number) => store.moveTreeNode(id, parentId, sortOrder));
  ipc.handle("move_tree_node_ordered", (id: string, parentId: string | null, orderedIds: string[]) => store.moveTreeNodeOrdered(id, parentId, orderedIds));
  ipc.handle("reorder_tree_nodes", (parentId: string | null, orderedIds: string[]) => store.reorderTreeNodes(parentId, orderedIds));
  ipc.handle("delete_tree_node", (id: string) => store.deleteTreeNode(id));
  ipc.handle("list_trash", () => store.listTrash());
  ipc.handle("restore_trash", async (id: string) => {
    // 回收站惰性下载的补偿：恢复前强拉全量资产（best-effort，失败仍恢复）。
    const { warnings } = await restoreTrashWithAssets(store, id);
    for (const w of warnings) store.logScopes.sync.warn(`[restore] ${w}`);
  });
  ipc.handle("ensure_trash_note_assets", async (id: string) => {
    // 回收站预览的补偿：预览前按需补拉该笔记缺失资源（best-effort，不恢复）。
    const { warnings } = await ensureTrashNoteAssets(store, id);
    for (const w of warnings) store.logScopes.sync.warn(`[preview] ${w}`);
  });
  ipc.handle("purge_trash", (id: string) => store.purgeTrashItem(id));
  ipc.handle("empty_trash", () => store.emptyTrash());
  ipc.handle("upload_resource", (input: ResourceUploadInput, noteId: string) => {
    if (!input || !(input.bytes instanceof Uint8Array)) throw new Error("资源数据无效");
    if (input.bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`资源超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MiB 协议上限`);
    return store.uploadResource(input, noteId);
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
  ipc.handle("open_attachment", (noteId: string, filename: string) => {
    assertAttachmentSegments(noteId, filename);
    const full = store.noteAssetsPathFor(noteId) ? path.join(store.noteAssetsPathFor(noteId), filename) : "";
    if (!fs.existsSync(full)) throw new IpcInputError("附件文件不存在（可能已清理）");
    return shell.openPath(full).then((err) => (err ? { ok: false, error: err } : { ok: true }));
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
