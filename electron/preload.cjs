const { contextBridge, ipcRenderer } = require("electron");

const IPC_ERROR_MARKER = "__LAKE_IPC_ERROR__";
const parseIpcError = (rawMessage) => {
  const marker = rawMessage.lastIndexOf(IPC_ERROR_MARKER);
  if (marker >= 0) {
    try {
      const payload = JSON.parse(rawMessage.slice(marker + IPC_ERROR_MARKER.length));
      if (payload && typeof payload.message === "string" && payload.code) return payload;
    } catch { /* fall through to the prefix fallback */ }
  }
  const match = rawMessage.match(/\[LAKE_IPC_CODE:(NOT_FOUND|INVALID_INPUT|NOT_CONFIGURED|INTERNAL)\]\s*([\s\S]*?)(?:\s+__LAKE_IPC_ERROR__.*)?$/);
  return match ? { name: "IpcError", message: match[2], code: match[1] } : null;
};
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args).catch((raw) => {
  const rawMessage = typeof raw?.message === "string" ? raw.message : String(raw);
  const payload = parseIpcError(rawMessage);
  const code = payload?.code || raw?.code;
  const message = typeof payload?.message === "string" ? payload.message : rawMessage;
  const error = new Error(code ? `[LAKE_IPC_CODE:${code}] ${message}` : message);
  error.name = typeof payload?.name === "string" ? payload.name : (typeof raw?.name === "string" ? raw.name : "IpcError");
  if (code) Object.defineProperty(error, "code", { value: code, enumerable: true });
  throw error;
});

contextBridge.exposeInMainWorld("lakeNative", {
  rendererReady: () => ipcRenderer.send("renderer-ready"),
  assetPort: Number(process.env.LAKE_ASSET_PORT) || 19876,
  assetToken: process.env.LAKE_ASSET_TOKEN ?? "",
  bootstrap: () => invoke("bootstrap_workspace"),
  readNote: (id) => invoke("read_note", id),
  noteBodyMissing: (id) => invoke("note_body_missing", id),
  listMissingBodies: () => invoke("list_missing_bodies"),
  restoreMissingBodyFromCloud: (id) => invoke("restore_missing_body_from_cloud", id),
  purgeMissingBody: (id) => invoke("purge_missing_body", id),
  getNoteDigest: (id) => invoke("get_note_digest", id),
  createNote: (title) => invoke("create_note", title),
  saveNote: (id, title, content, caches) => invoke("save_note", id, title, content, caches),
  updateNoteCaches: (id, markdown, plain) => invoke("update_note_caches", id, markdown, plain),
  readNoteCaches: (id) => invoke("read_note_caches", id),
  listDraftJournals: () => invoke("list_draft_journals"),
  saveDraftJournal: (entry) => invoke("save_draft_journal", entry),
  deleteDraftJournal: (id) => invoke("delete_draft_journal", id),
  ensureNoteCaches: (id, lakeContent) => invoke("ensure_note_caches", id, lakeContent),
  getNotePaths: (id) => invoke("get_note_paths", id),
  getNoteInfo: (id) => invoke("get_note_info", id),
  renameAssetDisplay: (noteId, filename, newName) => invoke("rename_asset_display", noteId, filename, newName),
  pickExportDir: () => invoke("pick_export_dir"),
  exportNote: (id, format, baseDir) => invoke("export_note", id, format, baseDir),
  exportBitableCsv: (id, baseDir) => invoke("export_bitable_csv", id, baseDir),
  exportBitableZip: (id, baseDir) => invoke("export_bitable_zip", id, baseDir),
  exportTableCsv: (id, baseDir, sheetId) => invoke("export_table_csv", id, baseDir, sheetId),
  exportUsheetXlsx: (id, baseDir) => invoke("export_usheet_xlsx", id, baseDir),
  pickImportCsv: () => invoke("pick_import_csv"),
  pickBackupDir: () => invoke("pick_backup_dir"),
  runWorkspaceBackup: (dir) => invoke("run_workspace_backup", dir),
  prepareCloudRestore: () => invoke("prepare_cloud_restore"),
  confirmRelaunch: () => invoke("confirm_relaunch"),
  setNodeIcon: (id, icon) => invoke("set_node_icon", id, icon),
  searchNotes: (query, limit) => invoke("search_notes", query, limit),
  rebuildSearchIndex: () => invoke("rebuild_search_index"),
  deleteNote: (id) => invoke("delete_note", id),
  setNoteLocked: (id, locked) => invoke("set_note_locked", id, locked),
  listTreeNodes: () => invoke("list_tree_nodes"),
  listNoteSummaries: () => invoke("list_note_summaries"),
  createNotebook: (title) => invoke("create_notebook", title),
  createGroup: (parentId, title) => invoke("create_group", parentId, title),
  renameTreeNode: (id, title) => invoke("rename_tree_node", id, title),
  createNoteIn: (parentId, title) => invoke("create_note_in", parentId, title),
  createUsheetIn: (parentId, title) => invoke("create_usheet_in", parentId, title),
  createBitableIn: (parentId, title) => invoke("create_bitable_in", parentId, title),
  createBoardIn: (parentId, title) => invoke("create_board_in", parentId, title),
  createInkIn: (parentId, title) => invoke("create_ink_in", parentId, title),
  moveTreeNode: (id, parentId, sortOrder) => invoke("move_tree_node", id, parentId, sortOrder),
  moveTreeNodeOrdered: (id, parentId, orderedIds) => invoke("move_tree_node_ordered", id, parentId, orderedIds),
  reorderTreeNodes: (parentId, orderedIds) => invoke("reorder_tree_nodes", parentId, orderedIds),
  deleteTreeNode: (id) => invoke("delete_tree_node", id),
  listTrash: () => invoke("list_trash"),
  restoreTrash: (id) => invoke("restore_trash", id),
  ensureTrashNoteAssets: (id) => invoke("ensure_trash_note_assets", id),
  purgeTrash: (id) => invoke("purge_trash", id),
  emptyTrash: () => invoke("empty_trash"),
  createHistorySnapshot: (noteId, content, force) => invoke("create_history_snapshot", noteId, content, force),
  listNoteHistory: (noteId) => invoke("list_note_history", noteId),
  restoreHistory: (historyId) => invoke("restore_history", historyId),
  deleteHistory: (historyId) => invoke("delete_history", historyId),
  cleanupHistory: () => invoke("cleanup_history"),
  getLastHistoryCleanup: () => invoke("get_last_history_cleanup"),
  getHistorySettings: () => invoke("get_history_settings"),
  saveHistorySettings: (settings) => invoke("save_history_settings", settings),
  getHistoryStats: () => invoke("get_history_stats"),
  listNoteOrphans: (noteId) => invoke("list_note_orphans", noteId),
  previewHistorySnapshot: (historyId) => invoke("preview_history_snapshot", historyId),
  previewNoteOrphan: (noteId, filename) => invoke("preview_note_orphan", noteId, filename),
  cleanNoteOrphans: (noteId, filenames) => invoke("clean_note_orphans", noteId, filenames),
  uploadResource: (input, noteId) => invoke("upload_resource", input, noteId),
  downloadRemoteResource: (url, noteId) => invoke("download_remote_resource", url, noteId),
  listOrphanAssets: () => invoke("list_orphan_assets"),
  cleanOrphanAssets: () => invoke("clean_orphan_assets"),
  deleteOrphanAsset: (id) => invoke("delete_orphan_asset", id),
  readOrphanPreview: (id) => invoke("read_orphan_preview", id),
  listRemovedAssets: () => invoke("list_removed_assets"),
  readAssetPreview: (noteId, filename) => invoke("read_asset_preview", noteId, filename),
  openAttachment: (noteId, filename) => invoke("open_attachment", noteId, filename),
  showAttachmentInFolder: (noteId, filename) => invoke("show_attachment_in_folder", noteId, filename),
  copyAssetPath: (noteId, filename) => invoke("copy_asset_path", noteId, filename),
  copyAssetImage: (noteId, filename) => invoke("copy_asset_image", noteId, filename),
  saveAssetAs: (noteId, filename, suggestedName) => invoke("save_asset_as", noteId, filename, suggestedName),
  revealNoteFile: (id) => invoke("reveal_note_file", id),
  openNoteAssets: (id) => invoke("open_note_assets", id),
  getS3Settings: () => invoke("get_s3_settings"),
  saveS3Settings: (settings) => invoke("save_s3_settings", settings),
  exportS3ConfigFile: () => invoke("export_s3_config_file"),
  importS3ConfigFile: () => invoke("import_s3_config_file"),
  importS3Config: (code) => invoke("import_s3_config", code),
  testS3Connection: () => invoke("test_s3_connection"),
  getSyncSettings: () => invoke("get_sync_settings"),
  saveSyncSettings: (settings) => invoke("save_sync_settings", settings),
  syncNow: () => invoke("sync_now"),
  getSyncStatus: () => invoke("get_sync_status"),
  getSyncPendingSummary: () => invoke("get_sync_pending_summary"),
  listQuickNotes: () => invoke("list_quick_notes"),
  createQuickNote: (input) => invoke("create_quick_note", input),
  updateQuickNote: (id, input) => invoke("update_quick_note", id, input),
  setQuickNoteTags: (id, tagIds) => invoke("set_quick_note_tags", id, tagIds),
  deleteQuickNote: (id) => invoke("delete_quick_note", id),
  listQuickNoteTags: () => invoke("list_quick_note_tags"),
  createQuickNoteTag: (name) => invoke("create_quick_note_tag", name),
  updateQuickNoteTag: (id, patch) => invoke("update_quick_note_tag", id, patch),
  reorderQuickNoteTags: (ids) => invoke("reorder_quick_note_tags", ids),
  mergeQuickNoteTags: (sourceId, targetId) => invoke("merge_quick_note_tags", sourceId, targetId),
  deleteQuickNoteTag: (id) => invoke("delete_quick_note_tag", id),
  stageQuickNoteImage: (draftId, input) => invoke("stage_quick_note_image", draftId, input),
  stageQuickNoteFile: (draftId, input) => invoke("stage_quick_note_file", draftId, input),
  discardQuickNoteDraft: (draftId) => invoke("discard_quick_note_draft", draftId),
  discardStagedQuickNoteImage: (draftId, imageId) => invoke("discard_staged_quick_note_image", draftId, imageId),
  convertQuickNote: (quickNoteId, notebookId) => invoke("convert_quick_note", quickNoteId, notebookId),
  syncQuickNote: (id) => invoke("sync_quick_note", id),
  listQuickNoteTrash: () => invoke("list_quick_note_trash"),
  restoreQuickNote: (id) => invoke("restore_quick_note", id),
  purgeQuickNote: (id) => invoke("purge_quick_note", id),
  listMissingQuickNotes: () => invoke("list_missing_quick_notes"),
  restoreMissingQuickNoteFromCloud: (id) => invoke("restore_missing_quick_note_from_cloud", id),
  restoreMissingQuickNoteFromText: (id) => invoke("restore_missing_quick_note_from_text", id),
  purgeMissingQuickNote: (id) => invoke("purge_missing_quick_note", id),
  getS3GcSettings: () => invoke("get_s3_gc_settings"),
  saveS3GcSettings: (settings) => invoke("save_s3_gc_settings", settings),
  listS3GcPending: () => invoke("list_s3_gc_pending"),
  listS3GcLog: () => invoke("list_s3_gc_log"),
  runS3GcDiagnostics: () => invoke("run_s3_gc_diagnostics"),
  runDataHealthCheck: () => invoke("run_data_health_check"),
  readAppLog: (opts) => invoke("read_app_log", opts),
  getSystemInfo: () => invoke("get_system_info"),
  revealDataFolder: (kind) => invoke("reveal_data_folder", kind),
  runS3GcReconcile: (ignoreRetention = false) => invoke("run_s3_gc_reconcile", ignoreRetention),
  runS3DeepCleanup: (dryRun, ignoreRetention = false) => invoke("run_s3_deep_cleanup", dryRun, ignoreRetention),
  getTrashReminder: () => invoke("get_trash_reminder"),
  getWebStatus: () => invoke("get_web_status"),
  setWebEnabled: (enabled) => invoke("set_web_enabled", enabled),
  openWebClient: () => invoke("open_web_client"),
  aiGetSettings: () => invoke("ai_get_settings"),
  aiSaveSettings: (patch) => invoke("ai_save_settings", patch),
  aiTestConnection: (draft) => invoke("ai_test_connection", draft),
  aiListModels: (draft) => invoke("ai_list_models", draft),
  aiChat: (requestId, messages) => invoke("ai_chat", requestId, messages),
  aiCancel: (requestId) => invoke("ai_cancel", requestId),
  onAiStream: (callback) => {
    const listener = (_event, chunk) => callback(chunk);
    ipcRenderer.on("ai:stream", listener);
    return () => { ipcRenderer.removeListener("ai:stream", listener); };
  },
  onSyncProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("sync-progress", listener);
    return () => { ipcRenderer.removeListener("sync-progress", listener); };
  },
  onPendingSummaryChanged: (callback) => {
    const listener = (_event, summary) => callback(summary);
    ipcRenderer.on("pending-summary-changed", listener);
    return () => { ipcRenderer.removeListener("pending-summary-changed", listener); };
  },
  onLibraryChanged: (callback) => {
    const listener = (_event, detail) => callback(detail);
    ipcRenderer.on("library-changed", listener);
    return () => { ipcRenderer.removeListener("library-changed", listener); };
  },
  /** 窗口全屏状态（macOS 独立 Space）→ 顶栏据此决定是否保留红绿灯让位。 */
  onWindowFullscreen: (callback) => {
    const listener = (_event, fullscreen) => callback(Boolean(fullscreen));
    ipcRenderer.on("window-fullscreen", listener);
    return () => { ipcRenderer.removeListener("window-fullscreen", listener); };
  },
});
