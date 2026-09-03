import { BrowserWindow, clipboard, dialog, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { DraftJournal } from "../draftJournal.js";
import { Store } from "../store.js";
import { MAX_ATTACHMENT_BYTES } from "../../src/core/storeLimits.js";
import { isSafePathSegment } from "../../src/core/storeUtils.js";
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

interface ResourceUploadInput {
  bytes: Uint8Array;
  filename: string;
}

export function registerNotesIpc(ipc: IpcRegistrar, store: Store, drafts: DraftJournal): void {
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
  ipc.handle("set_node_icon", (id: string, icon: unknown) => store.setNodeIcon(id, assertIcon(icon)));
  ipc.handle("search_notes", (query: unknown, limit?: unknown) => {
    if (typeof query !== "string") throw new IpcInputError("搜索词格式无效");
    return store.searchNotes(query, clampSearchLimit(limit));
  });
  ipc.handle("delete_note", (id: string) => store.deleteNote(id));
  ipc.handle("set_note_locked", (id: string, locked: boolean) => { store.setNoteLocked(id, locked); return store.readNote(id); });
  ipc.handle("list_tree_nodes", () => store.listTreeNodes());
  ipc.handle("list_note_summaries", () => store.listNoteSummaries());
  ipc.handle("create_notebook", (title: unknown) => store.createNotebook(assertTitle(title)));
  ipc.handle("create_group", (parentId: string, title: unknown) => store.createGroup(parentId, assertTitle(title)));
  ipc.handle("rename_tree_node", (id: string, title: unknown) => store.renameTreeNode(id, assertTitle(title)));
  ipc.handle("create_note_in", (parentId: string | null, title: unknown) => store.createNoteIn(parentId, assertTitle(title)));
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
  ipc.handle("copy_asset_path", (noteId: string, filename: string) => {
    assertAttachmentSegments(noteId, filename);
    const full = path.join(store.noteAssetsPathFor(noteId), filename);
    clipboard.writeText(full);
    return full;
  });
}

/** 附件路径段校验：noteId + filename 都必须是安全单段（防穿越 note-assets 目录）。 */
function assertAttachmentSegments(noteId: string, filename: string): void {
  if (!isSafePathSegment(noteId) || !isSafePathSegment(filename)) {
    throw new IpcInputError("无效的附件路径");
  }
}
