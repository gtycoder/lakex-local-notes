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
  moveTreeNodeOrdered: (id, parentId, orderedIds) => invoke("move_tree_node_ordered", id, parentId, orderedIds),
  reorderTreeNodes: (parentId, orderedIds) => invoke("reorder_tree_nodes", parentId, orderedIds),
  deleteTreeNode: (id) => invoke("delete_tree_node", id),
  uploadResource: (input, noteId) => invoke("upload_resource", input, noteId),
  downloadRemoteResource: (url, noteId) => invoke("download_remote_resource", url, noteId),
  listOrphanAssets: () => invoke("list_orphan_assets"),
  cleanOrphanAssets: () => invoke("clean_orphan_assets"),
  getS3Settings: () => invoke("get_s3_settings"),
  saveS3Settings: (settings) => invoke("save_s3_settings", settings),
  testS3Connection: () => invoke("test_s3_connection"),
  syncNow: () => invoke("sync_now"),
  getSyncStatus: () => invoke("get_sync_status"),
  onSyncProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("sync-progress", listener);
    return () => { ipcRenderer.removeListener("sync-progress", listener); };
  },
});
