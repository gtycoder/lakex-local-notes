import { BrowserWindow, dialog } from "electron";
import type { DraftJournal } from "../draftJournal.js";
import { MAX_IMAGE_BYTES, Store } from "../store.js";
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

interface ResourceUploadInput {
  bytes: number[];
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
    if (typeof value.noteId !== "string" || typeof value.title !== "string" || typeof value.content !== "string" || typeof value.updatedAt !== "string") throw new IpcInputError("草稿字段无效");
    drafts.write({ noteId: value.noteId, title: value.title, content: value.content, updatedAt: value.updatedAt });
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
  ipc.handle("restore_trash", (id: string) => store.restoreTrashItem(id));
  ipc.handle("purge_trash", (id: string) => store.purgeTrashItem(id));
  ipc.handle("empty_trash", () => store.emptyTrash());
  ipc.handle("upload_resource", (input: ResourceUploadInput, noteId: string) => {
    if (!input || !Array.isArray(input.bytes)) throw new Error("资源数据无效");
    if (input.bytes.length > MAX_IMAGE_BYTES) throw new Error("图片超过 25 MiB");
    return store.uploadResource(input, noteId);
  });
  ipc.handle("download_remote_resource", (url: string, noteId: string) => store.downloadRemoteResource(url, noteId));
  ipc.handle("list_orphan_assets", () => store.listOrphanAssets());
  ipc.handle("clean_orphan_assets", () => store.cleanOrphanAssets());
}
