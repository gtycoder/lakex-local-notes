import { contextBridge, ipcRenderer } from "electron";

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("lakeNative", {
  bootstrap: () => invoke("bootstrap_workspace"),
  readNote: (id: string) => invoke("read_note", id),
  createNote: (title: string) => invoke("create_note", title),
  saveNote: (id: string, title: string, content: string) => invoke("save_note", id, title, content),
  deleteNote: (id: string) => invoke("delete_note", id),
  listTreeNodes: () => invoke("list_tree_nodes"),
  createNotebook: (title: string) => invoke("create_notebook", title),
  createGroup: (parentId: string, title: string) => invoke("create_group", parentId, title),
  renameTreeNode: (id: string, title: string) => invoke("rename_tree_node", id, title),
  createNoteIn: (parentId: string | null, title: string) => invoke("create_note_in", parentId, title),
  moveTreeNode: (id: string, parentId: string | null, sortOrder: number) => invoke("move_tree_node", id, parentId, sortOrder),
  reorderTreeNodes: (parentId: string | null, orderedIds: string[]) => invoke("reorder_tree_nodes", parentId, orderedIds),
  deleteTreeNode: (id: string) => invoke("delete_tree_node", id),
  uploadResource: (input: { bytes: number[]; filename: string }) => invoke("upload_resource", input),
  downloadRemoteResource: (url: string) => invoke("download_remote_resource", url),
});
