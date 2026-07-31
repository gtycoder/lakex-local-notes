const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("lakeNative", {
  bootstrap: () => invoke("bootstrap_workspace"),
  readNote: (id) => invoke("read_note", id),
  createNote: (title) => invoke("create_note", title),
  saveNote: (id, title, content) => invoke("save_note", id, title, content),
  deleteNote: (id) => invoke("delete_note", id),
  listTreeNodes: () => invoke("list_tree_nodes"),
  createNotebook: (title) => invoke("create_notebook", title),
  createGroup: (parentId, title) => invoke("create_group", parentId, title),
  renameTreeNode: (id, title) => invoke("rename_tree_node", id, title),
  createNoteIn: (parentId, title) => invoke("create_note_in", parentId, title),
  moveTreeNode: (id, parentId, sortOrder) => invoke("move_tree_node", id, parentId, sortOrder),
  reorderTreeNodes: (parentId, orderedIds) => invoke("reorder_tree_nodes", parentId, orderedIds),
  deleteTreeNode: (id) => invoke("delete_tree_node", id),
  uploadResource: (input) => invoke("upload_resource", input),
  downloadRemoteResource: (url) => invoke("download_remote_resource", url),
});
