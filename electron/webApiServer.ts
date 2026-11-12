import type { WebApiServer, WebApiServerOptions, WebServerController } from "./webApi/index.js";
import { createWebServerController as createController, startWebApiServer as startServer } from "./webApi/index.js";
import { renderNativeShim as renderShim } from "./webApi/static.js";

/**
 * Web 客户端（最小验证 MVP）· **对外门面**。
 *
 * 浏览器页 = 桌面端的"附属窗口"：本进程额外起一个 HTTP 服务（默认 127.0.0.1:19880），
 * ① POST /api/<channel> 复用 IPC 注册表里的同一批 handler（数据仍是本机那一份 SQLite/文件，单一真相）；
 * ② 静态服务 dist/（桌面渲染层构建产物；prod CSP 只放行本机固定端口 19876/19880）；
 * ③ /__native.js 注入 window.lakeNative 的 HTTP shim（方法面与 preload.cjs 一致，有单测卡漂移）；
 * ④ GET /download：浏览器端导出产物的下载等价物（白名单只收主进程导出 handler 刚生成的产物）。
 *
 * 安全面（261028 SEC-07 收口；用户已裁决保留浏览器端，只做安全）：
 * - 只绑 127.0.0.1，不做出局网；
 * - `/api` 与 `/__events` 接受 **per-process cookie** `lake_web_token`（文档响应下发，
 *   HttpOnly + SameSite=Strict，值 = 现有 API token）**或** 原请求头 `x-lake-token`
 *   （CLI/测试兼容）；仍禁止 query token（会进日志/Referer，且配合 `text/plain`
 *   简单请求可绕过 preflight）；token 常量时间比较；
 * - `/__native.js` **不再下发任何令牌**：静态 JS 里没有 token，本机非浏览器客户端拿不到凭据；
 * - 来源判定**单一来源** `isAllowedRequest`：Origin 必须精确等于同源两形态；`Sec-Fetch-Site:
 *   cross-site` 一律拒；**不再放行 `Sec-Fetch-Site: none`**（本机进程可伪造，正是 SEC-07 缺口）；
 *   文档请求要求 `Sec-Fetch-Dest: document`（浏览器导航）或同源 Origin；
 * - 静态文件不含业务数据。
 *
 * **拆分（261112 S-4）**：实现分层在 `electron/webApi/` —— `security.ts`（凭据/来源/请求体）、
 * `static.ts`（shim/静态/下载）、`events.ts`（SSE）、`bridge.ts`（/api 桥接）、`index.ts`（装配）。
 * 本文件只保留**对外导出面**与 `WEB_METHODS` 契约（单一来源；门面注入方法表给装配层，避免循环依赖）。
 */

export { WEB_API_PORT } from "./webApi/index.js";
export type { WebApiLogger, WebApiServerOptions, WebApiServer, WebServerStatus, WebServerController } from "./webApi/index.js";
export { DOWNLOAD_ROUTE, createDownloadRegistry, injectNativeShim } from "./webApi/static.js";
export type { DownloadRegistry } from "./webApi/static.js";

/** 方法名（与 preload.cjs 的键一致）→ IPC 通道名。漂移由 webApiServer.test.ts 卡住。 */
export const WEB_METHODS: Record<string, string> = {
  bootstrap: "bootstrap_workspace",
  readNote: "read_note",
  noteBodyMissing: "note_body_missing",
  listMissingBodies: "list_missing_bodies",
  restoreMissingBodyFromCloud: "restore_missing_body_from_cloud",
  purgeMissingBody: "purge_missing_body",
  listMissingQuickNotes: "list_missing_quick_notes",
  restoreMissingQuickNoteFromCloud: "restore_missing_quick_note_from_cloud",
  restoreMissingQuickNoteFromText: "restore_missing_quick_note_from_text",
  purgeMissingQuickNote: "purge_missing_quick_note",
  getNoteDigest: "get_note_digest",
  createNote: "create_note",
  saveNote: "save_note",
  updateNoteCaches: "update_note_caches",
  readNoteCaches: "read_note_caches",
  listDraftJournals: "list_draft_journals",
  saveDraftJournal: "save_draft_journal",
  deleteDraftJournal: "delete_draft_journal",
  ensureNoteCaches: "ensure_note_caches",
  getNotePaths: "get_note_paths",
  getNoteInfo: "get_note_info",
  renameAssetDisplay: "rename_asset_display",
  pickExportDir: "pick_export_dir",
  exportNote: "export_note",
  readInkPageSvg: "read_ink_page_svg",
  exportInkPageSvg: "export_ink_page_svg",
  saveInkPagePng: "save_ink_page_png",
  exportBitableCsv: "export_bitable_csv",
  exportBitableZip: "export_bitable_zip",
  exportTableCsv: "export_table_csv",
  exportUsheetXlsx: "export_usheet_xlsx",
  pickImportCsv: "pick_import_csv",
  pickBackupDir: "pick_backup_dir",
  runWorkspaceBackup: "run_workspace_backup",
  prepareCloudRestore: "prepare_cloud_restore",
  confirmRelaunch: "confirm_relaunch",
  pickBackupDatabase: "pick_backup_database",
  restoreWorkspaceFromBackup: "restore_workspace_from_backup",
  getFileScanSettings: "get_file_scan_settings",
  saveFileScanSettings: "save_file_scan_settings",
  scanRebuildCandidates: "scan_rebuild_candidates",
  rebuildOrphanNotes: "rebuild_orphan_notes",
  getBackupSettings: "get_backup_settings",
  saveBackupSettings: "save_backup_settings",
  runBackupNow: "run_backup_now",
  getBackupUsage: "get_backup_usage",
  batchNotes: "batch_notes",
  duplicateNotes: "duplicate_notes",
  cancelDuplicateNotes: "cancel_duplicate_notes",
  pickMarkdownFiles: "pick_markdown_files",
  pickImportFiles: "pick_import_files",
  readImportImage: "read_import_image",
  exportNotesBatch: "export_notes_batch",
  writeBatchExportFile: "write_batch_export_file",
  openExportDir: "open_export_dir",
  listNoteTagLinks: "list_note_tag_links",
  setNoteTags: "set_note_tags",
  listSyncConflicts: "list_sync_conflicts",
  ackSyncConflicts: "ack_sync_conflicts",
  restoreSyncConflict: "restore_sync_conflict",
  setNodeIcon: "set_node_icon",
  searchNotes: "search_notes",
  rebuildSearchIndex: "rebuild_search_index",
  deleteNote: "delete_note",
  setNoteLocked: "set_note_locked",
  aiGetSettings: "ai_get_settings",
  aiSaveSettings: "ai_save_settings",
  aiTestConnection: "ai_test_connection",
  aiListModels: "ai_list_models",
  aiChat: "ai_chat",
  aiCancel: "ai_cancel",
  aiWritingList: "ai_writing_list",
  aiWritingGet: "ai_writing_get",
  aiWritingCreate: "ai_writing_create",
  aiWritingRename: "ai_writing_rename",
  aiWritingComposer: "ai_writing_composer",
  aiWritingDelete: "ai_writing_delete",
  aiWritingAppendMessage: "ai_writing_append_message",
  aiWritingUpdateMessage: "ai_writing_update_message",
  aiWritingDeleteLastAssistant: "ai_writing_delete_last_assistant",
  listTreeNodes: "list_tree_nodes",
  diaryOpenDate: "diary_open_date",
  listNoteSummaries: "list_note_summaries",
  createNotebook: "create_notebook",
  createGroup: "create_group",
  renameTreeNode: "rename_tree_node",
  createNoteIn: "create_note_in",
  createUsheetIn: "create_usheet_in",
  createBitableIn: "create_bitable_in",
  createBoardIn: "create_board_in",
  createInkIn: "create_ink_in",
  moveTreeNode: "move_tree_node",
  moveTreeNodeOrdered: "move_tree_node_ordered",
  reorderTreeNodes: "reorder_tree_nodes",
  deleteTreeNode: "delete_tree_node",
  listTrash: "list_trash",
  restoreTrash: "restore_trash",
  ensureTrashNoteAssets: "ensure_trash_note_assets",
  purgeTrash: "purge_trash",
  emptyTrash: "empty_trash",
  createHistorySnapshot: "create_history_snapshot",
  listNoteHistory: "list_note_history",
  restoreHistory: "restore_history",
  deleteHistory: "delete_history",
  cleanupHistory: "cleanup_history",
  getLastHistoryCleanup: "get_last_history_cleanup",
  getHistorySettings: "get_history_settings",
  saveHistorySettings: "save_history_settings",
  getHistoryStats: "get_history_stats",
  getWebStatus: "get_web_status",
  setWebEnabled: "set_web_enabled",
  openWebClient: "open_web_client",
  listNoteOrphans: "list_note_orphans",
  previewHistorySnapshot: "preview_history_snapshot",
  previewNoteOrphan: "preview_note_orphan",
  cleanNoteOrphans: "clean_note_orphans",
  uploadResource: "upload_resource",
  downloadRemoteResource: "download_remote_resource",
  listOrphanAssets: "list_orphan_assets",
  cleanOrphanAssets: "clean_orphan_assets",
  deleteOrphanAsset: "delete_orphan_asset",
  readOrphanPreview: "read_orphan_preview",
  listRemovedAssets: "list_removed_assets",
  readAssetPreview: "read_asset_preview",
  openAttachment: "open_attachment",
  showAttachmentInFolder: "show_attachment_in_folder",
  copyAssetPath: "copy_asset_path",
  copyAssetImage: "copy_asset_image",
  saveAssetAs: "save_asset_as",
  revealNoteFile: "reveal_note_file",
  openNoteAssets: "open_note_assets",
  getS3Settings: "get_s3_settings",
  saveS3Settings: "save_s3_settings",
  exportS3ConfigFile: "export_s3_config_file",
  importS3ConfigFile: "import_s3_config_file",
  importS3Config: "import_s3_config",
  testS3Connection: "test_s3_connection",
  getSyncSettings: "get_sync_settings",
  saveSyncSettings: "save_sync_settings",
  syncNow: "sync_now",
  getSyncStatus: "get_sync_status",
  getSyncPendingSummary: "get_sync_pending_summary",
  listQuickNotes: "list_quick_notes",
  readQuickNote: "read_quick_note",
  createQuickNote: "create_quick_note",
  updateQuickNote: "update_quick_note",
  setQuickNoteTags: "set_quick_note_tags",
  deleteQuickNote: "delete_quick_note",
  listQuickNoteTags: "list_quick_note_tags",
  createQuickNoteTag: "create_quick_note_tag",
  updateQuickNoteTag: "update_quick_note_tag",
  reorderQuickNoteTags: "reorder_quick_note_tags",
  mergeQuickNoteTags: "merge_quick_note_tags",
  deleteQuickNoteTag: "delete_quick_note_tag",
  stageQuickNoteImage: "stage_quick_note_image",
  stageQuickNoteFile: "stage_quick_note_file",
  discardQuickNoteDraft: "discard_quick_note_draft",
  discardStagedQuickNoteImage: "discard_staged_quick_note_image",
  convertQuickNote: "convert_quick_note",
  syncQuickNote: "sync_quick_note",
  listQuickNoteTrash: "list_quick_note_trash",
  restoreQuickNote: "restore_quick_note",
  purgeQuickNote: "purge_quick_note",
  getS3GcSettings: "get_s3_gc_settings",
  saveS3GcSettings: "save_s3_gc_settings",
  listS3GcLog: "list_s3_gc_log",
  runDataHealthCheck: "run_data_health_check",
  readAppLog: "read_app_log",
  getSystemInfo: "get_system_info",
  revealDataFolder: "reveal_data_folder",
  // 261109 更新中心（桌面）；状态推送走 SSE 事件 update-state，不在 HTTP 方法表里。
  updateGetState: "update_get_state",
  updateCheck: "update_check",
  updateDownload: "update_download",
  updateOpenFile: "update_open_file",
  updateOpenReleasePage: "update_open_release_page",
  updateGetSettings: "update_get_settings",
  updateSetSettings: "update_set_settings",
  updateIgnoreVersion: "update_ignore_version",
  // 261109 便携包导出（桌面）；进度推送走 SSE 事件 portable-export-progress。
  portableExportStatus: "portable_export_status",
  portableExportPickDir: "portable_export_pick_dir",
  portableExportRun: "portable_export_run",
  runS3DeepCleanup: "run_s3_deep_cleanup",
  getTrashReminder: "get_trash_reminder",
  // Batch3-B 安全模式（桌面诊断态；Web 客户端同一批 handler）
  getSafeModeState: "get_safe_mode_state",
  exitSafeMode: "exit_safe_mode",
  copySafeModeDiagnostics: "copy_safe_mode_diagnostics",
};

/** 生成 window.lakeNative 的 HTTP shim（方法面 = preload.cjs）。 */
export function renderNativeShim(assetPort: number): string {
  return renderShim(assetPort, WEB_METHODS);
}

/** 起 Web 客户端 HTTP 服务（内部装配在 `webApi/index.ts`；方法表由本门面注入）。 */
export function startWebApiServer(opts: WebApiServerOptions): WebApiServer {
  return startServer(opts, WEB_METHODS);
}

/** 运行期起停控制器（不落盘；方法表由本门面注入）。 */
export function createWebServerController(opts: WebApiServerOptions): WebServerController {
  return createController(opts, WEB_METHODS);
}
