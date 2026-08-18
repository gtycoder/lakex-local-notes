import { BrowserWindow, dialog } from "electron";
import { MAX_IMAGE_BYTES, Store } from "../store.js";
import { exportNote, type ExportFormat } from "../export.js";
import type { IpcRegistrar } from "./registrar.js";

interface ResourceUploadInput {
  bytes: number[];
  filename: string;
}

export function registerNotesIpc(ipc: IpcRegistrar, store: Store): void {
  ipc.handle("bootstrap_workspace", () => store.bootstrap());
  ipc.handle("read_note", (id: string) => store.readNote(id));
  ipc.handle("get_note_digest", (id: string) => store.getNoteDigest(id));
  ipc.handle("create_note", (title: string) => store.createNote(title));
  ipc.handle("save_note", (id: string, title: string, content: string, caches?: { markdown?: string | null; plain?: string | null }) => store.saveNote(id, title, content, caches));
  ipc.handle("update_note_caches", (id: string, markdown: string | null, plain: string | null) => {
    store.updateNoteCaches(id, markdown ?? null, plain ?? null);
  });
  ipc.handle("ensure_note_caches", (id: string, lakeContent?: string) => store.ensureNoteCaches(id, lakeContent));
  ipc.handle("read_note_caches", (id: string) => store.readNoteCaches(id));
  ipc.handle("get_note_paths", (id: string) => store.getNotePaths(id));
  ipc.handle("pick_export_dir", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: "选择导出位置",
      buttonLabel: "导出到此目录",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipc.handle("export_note", (id: string, format: ExportFormat, baseDir?: string) => exportNote(store, id, format, baseDir));
  ipc.handle("set_node_icon", (id: string, icon: string | null) => store.setNodeIcon(id, icon));
  ipc.handle("search_notes", (query: string, limit?: number) => store.searchNotes(query, limit));
  ipc.handle("delete_note", (id: string) => store.deleteNote(id));
  ipc.handle("set_note_locked", (id: string, locked: boolean) => { store.setNoteLocked(id, locked); return store.readNote(id); });
  ipc.handle("list_tree_nodes", () => store.listTreeNodes());
  ipc.handle("list_note_summaries", () => store.listNoteSummaries());
  ipc.handle("create_notebook", (title: string) => store.createNotebook(title));
  ipc.handle("create_group", (parentId: string, title: string) => store.createGroup(parentId, title));
  ipc.handle("rename_tree_node", (id: string, title: string) => store.renameTreeNode(id, title));
  ipc.handle("create_note_in", (parentId: string | null, title: string) => store.createNoteIn(parentId, title));
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
