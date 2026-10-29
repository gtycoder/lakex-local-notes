import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { toIpcErrorPayload } from "./ipc/errors.js";
import { DIST_MIME } from "./appOrigin.js";
import { ZipWriter } from "../src/core/zipArchive.js";

/**
 * Web 客户端（最小验证 MVP）
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
 */

/** Web 客户端 API 端口（LAKE_WEB_PORT 可覆盖，多实例同机双开用）。 */
export const WEB_API_PORT = Number(process.env.LAKE_WEB_PORT) || 19880;

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
  exportBitableCsv: "export_bitable_csv",
  exportBitableZip: "export_bitable_zip",
  exportTableCsv: "export_table_csv",
  exportUsheetXlsx: "export_usheet_xlsx",
  pickImportCsv: "pick_import_csv",
  pickBackupDir: "pick_backup_dir",
  runWorkspaceBackup: "run_workspace_backup",
  prepareCloudRestore: "prepare_cloud_restore",
  confirmRelaunch: "confirm_relaunch",
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
  listTreeNodes: "list_tree_nodes",
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
  runS3DeepCleanup: "run_s3_deep_cleanup",
  getTrashReminder: "get_trash_reminder",
};

const MAX_BODY_BYTES = 256 * 1024 * 1024; // uploadResource 以 JSON number[] 传字节，留足余量

/** 浏览器端 API 凭据的 per-process cookie（值 = 现有 API token），只在文档响应里下发。 */
const WEB_TOKEN_COOKIE = "lake_web_token";
/**
 * 资产 token 的 cookie：**有意不加 HttpOnly**——页面要把资产 token 拼进资源 URL 的 `?token=`
 * （与桌面端 `?token=` 口径一致）。它与 IPC 凭据分离，泄漏不等于能调 /api；
 * 但仍只在文档响应下发，本机非浏览器客户端（curl 等）拿不到。
 */
const ASSET_TOKEN_COOKIE = "lake_asset_token";


export interface WebApiLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface WebApiServerOptions {
  distDir: string;
  registry: ReadonlyMap<string, (args: unknown[]) => Promise<unknown>>;
  token: string;
  /** 资产服务令牌（文档响应里以 lake_asset_token cookie 交给页面）；与 token 分离：资产 token 出现在 URL，泄漏不得等于 IPC 凭据。 */
  assetToken: string;
  assetPort: number;
  port?: number;
  log?: WebApiLogger;
}

function json(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

/** 常量时间比较（token 非空时避免时序侧信道；短 token 差异极小，仍比 !== 规范）。 */
function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const len = Math.max(a.length, b.length, 1);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** 同源两形态（127.0.0.1 与 localhost 的同端口）。**不放行**空端口 `http://127.0.0.1`——那等于 :80。 */
function sameOrigins(boundPort: number): string[] {
  return [`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`];
}

/** 读 Cookie（同名取第一个）；畸形百分号编码按原值返回，不让一个坏 cookie 打断鉴权。 */
function readCookie(req: http.IncomingMessage, name: string): string {
  const raw = req.headers.cookie;
  if (typeof raw !== "string" || raw === "") return "";
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    try { return decodeURIComponent(value); } catch { return value; }
  }
  return "";
}

/** 仅认请求头 token（query 会泄漏到日志/代理/Referer）。 */
function readTokenHeader(req: http.IncomingMessage): string {
  const raw = req.headers["x-lake-token"];
  return typeof raw === "string" ? raw : "";
}

/**
 * 凭据校验：**cookie 或 `x-lake-token` 头**（浏览器页面由浏览器自动带 cookie；CLI/单测保留原请求头）。
 * 常量时间比较；token 为空一律拒（避免"空 cookie 与空 token 相等"而放行）。
 */
function hasValidToken(req: http.IncomingMessage, token: string): boolean {
  if (!token) return false;
  return timingSafeEqual(readCookie(req, WEB_TOKEN_COOKIE), token)
    || timingSafeEqual(readTokenHeader(req), token);
}

/**
 * 来源判定**单一来源**（SEC-07；`/api`、`/__events`、`/__native.js`、文档与静态资源共用）。
 *
 * - `Sec-Fetch-Site: cross-site` 一律拒；
 * - Host 必须是 `127.0.0.1:<port>` / `localhost:<port>`（防 DNS rebinding：rebind 后 Host 是攻击者域名）；
 * - 有 Origin：必须**完整等于**同源两形态（`null`、空端口、其它端口一律拒）；
 * - 无 Origin：只认三种**可判定**来源
 *   ① `Sec-Fetch-Site: same-origin`（浏览器同源子资源：脚本/样式/SSE/同源 POST）；
 *   ② 文档请求的 `Sec-Fetch-Dest: document`（地址栏 / `shell.openExternal` 打开页面时浏览器必带）；
 *   ③ 合法 token（cookie 或 `x-lake-token`；CLI/测试兼容）；
 * - **不再放行 `Sec-Fetch-Site: none`**：它可被本机任意进程伪造，正是 SEC-07 的缺口；
 * - 文档请求既无 Origin 也无任何 Sec-Fetch-* ⇒ 拒（否则本机进程直接 curl `/` 就能拿 Set-Cookie）。
 */
function isAllowedRequest(
  req: http.IncomingMessage,
  opts: { boundPort: number; token: string; document: boolean },
): boolean {
  const sfs = String(req.headers["sec-fetch-site"] ?? "").toLowerCase();
  if (sfs === "cross-site") return false;

  const hosts = [`127.0.0.1:${opts.boundPort}`, `localhost:${opts.boundPort}`];
  const host = String(req.headers.host ?? "");
  if (host && !hosts.includes(host)) return false;

  const origin = req.headers.origin;
  if (origin) return sameOrigins(opts.boundPort).includes(origin);

  if (sfs === "same-origin") return true;
  const isDocumentNavigation = opts.document
    && (sfs === "" || sfs === "none")
    && String(req.headers["sec-fetch-dest"] ?? "").toLowerCase() === "document";
  if (isDocumentNavigation) return true;
  return hasValidToken(req, opts.token);
}

/** 文档响应下发的 per-process cookie（API 凭据 HttpOnly + SameSite=Strict；资产 token 页面要读）。 */
function documentSetCookies(token: string, assetToken: string): string[] {
  const cookies = [`${WEB_TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`];
  if (assetToken) cookies.push(`${ASSET_TOKEN_COOKIE}=${encodeURIComponent(assetToken)}; Path=/; SameSite=Strict`);
  return cookies;
}

function readBody(req: http.IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(null));
  });
}

/** dist/index.html 注入 shim：<script src="/__native.js"> 必须先于 bundle 执行。 */
export function injectNativeShim(html: string): string {
  const idx = html.indexOf("<script");
  if (idx < 0) return html;
  return `${html.slice(0, idx)}<script src="/__native.js"></script>${html.slice(idx)}`;
}

export function renderNativeShim(assetPort: number): string {
  return `/* 自动生成：window.lakeNative 的 HTTP 版（方法面 = preload.cjs，见 webApiServer.test.ts）。
   **本文件不含任何令牌**（SEC-07）：/api 与 /__events 的凭据是文档响应下发的 HttpOnly +
   SameSite=Strict cookie（lake_web_token），页面 JS 根本读不到；资产 token 是另一枚 cookie
   （lake_asset_token，URL 口径、与 IPC 凭据分离）——本机非浏览器客户端两者都拿不到。 */
(function () {
  "use strict";
  var METHODS = ${JSON.stringify(WEB_METHODS)};
  var ASSET_TOKEN_COOKIE = "lake_asset_token";
  function readCookie(name) {
    var raw = String((typeof document !== "undefined" && document.cookie) || "");
    var parts = raw.split(";");
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].replace(/^\\s+/, "");
      var eq = part.indexOf("=");
      if (eq < 0 || part.slice(0, eq) !== name) continue;
      try { return decodeURIComponent(part.slice(eq + 1)); } catch (e) { return part.slice(eq + 1); }
    }
    return "";
  }
  function makeError(code, message) {
    var err = new Error("[LAKE_IPC_CODE:" + code + "] " + message);
    err.name = "IpcError";
    Object.defineProperty(err, "code", { value: code, enumerable: true });
    return err;
  }
  // SSE 推送：/__events 用同源 cookie 鉴权（EventSource 不能自定义凭据，故用 fetch 流 + credentials 自解析）。
  var EVENT_URL = "/__events";
  var EVENT_NAMES = ["sync-progress", "pending-summary-changed", "library-changed", "ai:stream"];
  var NL = String.fromCharCode(10);
  var listeners = {};
  EVENT_NAMES.forEach(function (n) { listeners[n] = []; });
  var streamAbort = null;
  var streamBuf = "";
  function hasListeners() {
    return EVENT_NAMES.some(function (n) { return listeners[n].length > 0; });
  }
  function dispatchEvent(event, raw) {
    var arr = listeners[event];
    if (!arr || !arr.length) return;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    arr.slice().forEach(function (cb) { try { cb(data); } catch (e) {} });
  }
  function handleFrame(frame) {
    var event = "message", raw = "";
    frame.split(NL).forEach(function (line) {
      if (line.slice(0, 6) === "event:") event = line.slice(6).trim();
      else if (line.slice(0, 5) === "data:") raw += (raw ? NL : "") + line.slice(5).trim();
    });
    dispatchEvent(event, raw);
  }
  function retryEventStream() {
    if (streamAbort) { try { streamAbort.abort(); } catch (e) {} }
    streamAbort = null;
    streamBuf = "";
    if (hasListeners()) setTimeout(openEventStream, 3000);
  }
  function openEventStream() {
    if (streamAbort || !hasListeners() || typeof fetch !== "function") return;
    var ctrl = new AbortController();
    streamAbort = ctrl;
    // 凭据走 HttpOnly cookie（同源 fetch 自动携带；JS 里不再持有 token）
    fetch(EVENT_URL, { credentials: "same-origin", signal: ctrl.signal, cache: "no-store" })
      .then(function (res) {
        if (!res.ok || !res.body) throw new Error("event stream HTTP " + res.status);
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var pump = function () {
          reader.read().then(function (chunk) {
            if (chunk.done) throw new Error("event stream ended");
            streamBuf += decoder.decode(chunk.value, { stream: true });
            var idx;
            while ((idx = streamBuf.indexOf(NL + NL)) >= 0) {
              var frame = streamBuf.slice(0, idx);
              streamBuf = streamBuf.slice(idx + 2);
              if (frame) handleFrame(frame);
            }
            pump();
          }).catch(retryEventStream);
        };
        pump();
      })
      .catch(retryEventStream);
  }
  function subscribe(event, cb) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(cb);
    openEventStream();
    return function () {
      var arr = listeners[event];
      var i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
      if (!hasListeners() && streamAbort) { try { streamAbort.abort(); } catch (e) {} streamAbort = null; streamBuf = ""; }
    };
  }
  var native = {
    assetPort: ${JSON.stringify(assetPort)},
    // 资产 token 从 cookie 读（不写进静态 JS）；文档响应一定先于本脚本下发
    assetToken: readCookie(ASSET_TOKEN_COOKIE),
    onSyncProgress: function (cb) { return subscribe("sync-progress", cb); },
    onPendingSummaryChanged: function (cb) { return subscribe("pending-summary-changed", cb); },
    onLibraryChanged: function (cb) { return subscribe("library-changed", cb); },
    // AI 流式：registerAi 的 event.sender.send("ai:stream") 在 HTTP 调用方经 registrar 注入的
    // httpSend 转到 SSE（见 main.ts），这里按 requestId 过滤交给 lib/ai。
    onAiStream: function (cb) { return subscribe("ai:stream", cb); }
  };
  // 统一 API 调用（浏览器等价实现复用同一序列化 / 鉴权路径）。
  function callApi(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    // 二进制入参：桌面 IPC 走结构化克隆（Uint8Array），HTTP JSON 只能传 number[] ⇒ 统一序列化。
    // 主进程侧由 electron/ipc/bytes.ts 的 toUint8Array 归一（单一来源）。
    var jsonReplacer = function (key, value) {
      if (value instanceof Uint8Array) return Array.prototype.slice.call(value);
      if (value instanceof ArrayBuffer) return Array.prototype.slice.call(new Uint8Array(value));
      if (ArrayBuffer.isView(value)) return Array.prototype.slice.call(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      return value;
    };
    return fetch("/api/" + METHODS[name], {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args: args }, jsonReplacer)
    }).then(function (res) {
      return res.json().catch(function () {
        throw makeError("INTERNAL", "web api bad response: HTTP " + res.status);
      });
    }).then(function (payload) {
      if (payload && payload.ok) return payload.data;
      throw makeError((payload && payload.code) || "INTERNAL", (payload && payload.message) || "web api error");
    });
  }
  Object.keys(METHODS).forEach(function (name) {
    native[name] = function () {
      return callApi.apply(null, [name].concat(Array.prototype.slice.call(arguments)));
    };
  });
  // 浏览器等价实现：宿主专属动作改成浏览器原生行为（不弹桌面对话框 / 不拉起桌面应用）。
  function assetURL(noteId, filename) {
    return "http://127.0.0.1:" + native.assetPort + "/" + encodeURIComponent(noteId) + "/" + encodeURIComponent(filename) + "?token=" + encodeURIComponent(readCookie(ASSET_TOKEN_COOKIE));
  }
  // 宿主能力矩阵（见 src/lib/hostCapabilities.ts）：浏览器端没有本机目录框/窗口控制/全局快捷键，
  // 但导出可用（主进程生成产物 → /download 下载）。
  native.capabilities = { browserClient: true, localFileSystem: false, importExport: true, nativeDialog: false, windowControls: false, globalShortcuts: false };
  native.saveAssetAs = function (noteId, filename, suggestedName) {
    return fetch(assetURL(noteId, filename)).then(function (res) {
      if (!res.ok) throw makeError("INVALID_INPUT", "asset HTTP " + res.status);
      return res.blob();
    }).then(function (blob) {
      var a = document.createElement("a");
      var href = URL.createObjectURL(blob);
      a.href = href;
      a.download = suggestedName || filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(href); }, 10000);
      return { ok: true };
    });
  };
  native.openAttachment = function (noteId, filename) {
    window.open(assetURL(noteId, filename), "_blank", "noopener");
    return Promise.resolve({ ok: true });
  };
  native.copyAssetPath = function (noteId, filename) {
    var url = assetURL(noteId, filename);
    return navigator.clipboard.writeText(url).then(function () { return url; });
  };
  // 导出等价物（P1）：先走现有 IPC 让主进程生成产物（默认导出目录），再经 /download 交给浏览器。
  // 不弹 Electron 对话框；主进程在 /api 响应里带 download={path,name}，path 只对白名单有效。
  function downloadURL(info) {
    var url = "/download?path=" + encodeURIComponent(info.path);
    if (info.name) url += "&name=" + encodeURIComponent(info.name);
    return url;
  }
  function saveDownload(data) {
    var info = data && data.download;
    if (!info || !info.path) return data;
    var a = document.createElement("a");
    a.href = downloadURL(info);
    a.download = info.name || "";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return data;
  }
  function exportWithDownload(method, args) {
    return callApi.apply(null, [method].concat(args)).then(saveDownload);
  }
  // 系统目录选择框在浏览器端不可用：返回 null（调用方按“取消/不支持”处理并给明确提示）。
  native.pickExportDir = function () { return Promise.resolve(null); };
  native.pickBackupDir = function () { return Promise.resolve(null); };
  native.exportNote = function (id, format) { return exportWithDownload("exportNote", [id, format]); };
  native.exportBitableCsv = function (id) { return exportWithDownload("exportBitableCsv", [id]); };
  native.exportBitableZip = function (id) { return exportWithDownload("exportBitableZip", [id]); };
  // 签名与桌面一致（id, baseDir, sheetId）；baseDir 在浏览器端无意义，传 null 让主进程走默认导出目录。
  native.exportTableCsv = function (id, baseDir, sheetId) { return exportWithDownload("exportTableCsv", [id, null, sheetId]); };
  native.exportUsheetXlsx = function (id) { return exportWithDownload("exportUsheetXlsx", [id]); };
  window.lakeNative = native;
})();
`;
}

/** 浏览器下载路由（P1：导出产物的下载等价物）。 */
export const DOWNLOAD_ROUTE = "/download";
/** 下载白名单有效期：导出是用户当场发起的动作，过了窗口就重新导一次（不留长期可下载面）。 */
const DOWNLOAD_TTL_MS = 10 * 60 * 1000;
const DOWNLOAD_MAX_ENTRIES = 64;
/** 导出类 IPC 通道：handler 返回的 exportPath 登记进下载白名单（浏览器端不弹系统对话框）。 */
const EXPORT_DOWNLOAD_CHANNELS = new Set([
  "export_note",
  "export_bitable_csv",
  "export_bitable_zip",
  "export_table_csv",
  "export_usheet_xlsx",
]);

/** 一次导出的下载条目（只由主进程导出 handler 的返回值登记，见 createDownloadRegistry）。 */
interface DownloadEntry {
  /** 给浏览器用的相对路径键（`<序号>/<文件名>`）——不是真实路径。 */
  path: string;
  /** Content-Disposition 里的下载名。 */
  name: string;
  absPath: string;
  rootDir: string;
  directory: boolean;
  expiresAt: number;
}

export interface DownloadRegistry {
  /** 登记主进程刚生成的导出产物；返回给浏览器 shim 的相对路径 + 下载名。 */
  offer(absPath: string, now?: number): { path: string; name: string } | null;
  /** 按相对路径键取条目（过期即失效）。 */
  lookup(rel: string, now?: number): DownloadEntry | null;
}

/**
 * 下载白名单：只登记**主进程导出 handler 刚刚返回的产物**。
 * - key 是相对路径（`<序号>/<文件名>`），路由不接受任意绝对路径，也不做目录遍历；
 * - 每条带登记时的根目录 + 过期时间，下载前再校验 realpath 仍在根目录内（防符号链接逃逸）；
 * - 目录产物（Markdown 资料包 / HTML 资料包）打包成 zip 后下发，正文与图片都不丢。
 */
export function createDownloadRegistry(): DownloadRegistry {
  const entries = new Map<string, DownloadEntry>();
  let seq = 0;
  const prune = (now: number): void => {
    for (const [key, entry] of entries) if (entry.expiresAt <= now) entries.delete(key);
  };
  return {
    offer(absPath: string, now: number = Date.now()): { path: string; name: string } | null {
      let stat: fs.Stats;
      try { stat = fs.statSync(absPath); } catch { return null; }
      prune(now);
      while (entries.size >= DOWNLOAD_MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      const directory = stat.isDirectory();
      const baseName = path.basename(absPath);
      // HTML 资料包的产物是 <标题>/index.html：下载名用标题（否则用户拿到一堆 index.html）。
      const name = directory
        ? `${baseName}.zip`
        : baseName === "index.html"
          ? `${path.basename(path.dirname(absPath))}.html`
          : baseName;
      const rel = `${++seq}/${baseName}`;
      entries.set(rel, {
        path: rel,
        name,
        absPath: path.resolve(absPath),
        rootDir: path.resolve(path.dirname(absPath)),
        directory,
        expiresAt: now + DOWNLOAD_TTL_MS,
      });
      return { path: rel, name };
    },
    lookup(rel: string, now: number = Date.now()): DownloadEntry | null {
      prune(now);
      return entries.get(rel) ?? null;
    },
  };
}

/** 导出 handler 结果补一个 download 字段（浏览器 shim 据此触发下载；桌面端不走这条通道）。 */
function attachDownloadOffer(data: unknown, downloads: DownloadRegistry): unknown {
  if (!data || typeof data !== "object") return data;
  const exportPath = (data as { exportPath?: unknown }).exportPath;
  if (typeof exportPath !== "string" || exportPath === "") return data;
  const offer = downloads.offer(exportPath);
  if (!offer) return data;
  return { ...(data as Record<string, unknown>), download: offer };
}

/** 下载用的 MIME（dist 表没有导出格式，这里补上；两表都没有按二进制流）。 */
const DOWNLOAD_MIME: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".zip": "application/zip",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".json": "application/json",
};

function downloadContentType(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return DOWNLOAD_MIME[ext] ?? DIST_MIME[ext] ?? "application/octet-stream";
}

/** `Content-Disposition: attachment`（中文名走 RFC 5987；去掉控制符与路径分隔符防头注入）。 */
function contentDisposition(name: string): string {
  const clean = (name || "download")
    .replace(/[\u0000-\u001f\u007f"\\/:*?<>|]/g, "_")
    .slice(0, 200) || "download";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  // RFC 5987 的 attr-char 不含 ' ( ) *：encodeURIComponent 不会编码它们，这里补齐（标题常带括号）。
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** 递归列出目录内文件（zip 条目名统一用 "/" 分隔）。 */
function* listFilesRecursive(dir: string, prefix = ""): Generator<{ rel: string; abs: string }> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* listFilesRecursive(abs, rel);
    else if (entry.isFile()) yield { rel, abs };
  }
}

/** 真实路径；不存在/无权限返回 null（下载路由统一按 404 处理）。 */
function realpathOrNull(target: string): string | null {
  try { return fs.realpathSync(target); } catch { return null; }
}

/** 目标是否仍在该根目录内（realpath 比较，防符号链接把白名单指到别处）。 */
function isInsideRoot(target: string, root: string): boolean {
  const realRoot = realpathOrNull(root);
  const realTarget = realpathOrNull(target);
  if (!realRoot || !realTarget) return false;
  return realTarget === realRoot || realTarget.startsWith(realRoot + path.sep);
}

export interface WebApiServer extends http.Server {
  /** 向所有已连接的 Web 客户端推送一条 SSE 事件（无客户端时 no-op）。 */
  broadcast(event: string, data: unknown): void;
}

export function startWebApiServer(opts: WebApiServerOptions): WebApiServer {
  const { distDir, registry, token, assetToken, assetPort } = opts;
  const port = opts.port ?? WEB_API_PORT;
  const log = opts.log ?? { info: () => {}, warn: () => {} };
  /** 已连接的 SSE 客户端（/__events）。 */
  const sseClients = new Set<http.ServerResponse>();
  /** 浏览器下载白名单（只登记导出 handler 刚生成的产物）。 */
  const downloads = createDownloadRegistry();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      // 实际绑定端口（port:0 时 ≠ 配置端口）
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : port;

      // 来源判定**唯一入口**（SEC-07）：跨站 / 伪造来源 / 无凭据一律拒。
      // document = 顶层导航（dist 入口只有 / 与 /index.html；无 SPA fallback 路由）。
      const documentRequest = url.pathname === "/" || url.pathname === "/index.html";
      if (!isAllowedRequest(req, { boundPort, token, document: documentRequest })) {
        json(res, 403, { ok: false, code: "NOT_CONFIGURED", message: "request origin rejected" });
        return;
      }

      // ⓪ SSE 推送通道（GET /__events）：与 /api 同一凭据（cookie 或 header）；事件由 broadcast 下发。
      if (url.pathname === "/__events") {
        if (req.method !== "GET") { json(res, 405, { ok: false, code: "INVALID_INPUT", message: "method not allowed" }); return; }
        if (!hasValidToken(req, token)) {
          json(res, 403, { ok: false, code: "NOT_CONFIGURED", message: "web api token invalid" });
          return;
        }
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          "connection": "keep-alive",
          "x-accel-buffering": "no",
        });
        res.write(": connected\n\n");
        sseClients.add(res);
        const drop = (): void => { sseClients.delete(res); };
        res.on("close", drop);
        res.on("error", drop);
        return; // 保持连接，不 end
      }

      // ① 通用 API 通道
      if (url.pathname.startsWith("/api/")) {
        if (req.method !== "POST") { json(res, 405, { ok: false, code: "INVALID_INPUT", message: "method not allowed" }); return; }
        // 禁止 query token（泄漏面 + 可被 text/plain 简单请求 CSRF）；只认 cookie 或请求头
        if (!hasValidToken(req, token)) {
          json(res, 403, { ok: false, code: "NOT_CONFIGURED", message: "web api token invalid" });
          return;
        }
        const channel = decodeURIComponent(url.pathname.slice("/api/".length));
        const handler = registry.get(channel);
        if (!handler) { json(res, 404, { ok: false, code: "NOT_FOUND", message: `unknown channel: ${channel}` }); return; }
        const raw = await readBody(req);
        if (raw === null) { json(res, 413, { ok: false, code: "INVALID_INPUT", message: "body too large or aborted" }); return; }
        let args: unknown[] = [];
        if (raw.length > 0) {
          try {
            const parsed: unknown = JSON.parse(raw.toString("utf8"));
            args = Array.isArray((parsed as { args?: unknown[] })?.args) ? (parsed as { args: unknown[] }).args : [];
          } catch {
            json(res, 400, { ok: false, code: "INVALID_INPUT", message: "invalid JSON body" });
            return;
          }
        }
        try {
          let data = await handler(args);
          // 导出类通道：产物登记进下载白名单，返回体多带一个 download（浏览器 shim 据此下载）。
          if (EXPORT_DOWNLOAD_CHANNELS.has(channel)) data = attachDownloadOffer(data, downloads);
          json(res, 200, { ok: true, data });
        } catch (error) {
          json(res, 200, { ok: false, ...toIpcErrorPayload(error) }); // 与 IPC 一致：业务错误走 200 envelope
        }
        return;
      }

      // ①-b 浏览器下载（导出的下载等价物）：只认白名单里、主进程刚生成的产物。
      // 凭据与 /api 同口径（cookie 或 x-lake-token）；path 只接受相对键，绝不接受绝对路径。
      if (url.pathname === DOWNLOAD_ROUTE) {
        if (req.method !== "GET") { json(res, 405, { ok: false, code: "INVALID_INPUT", message: "method not allowed" }); return; }
        if (!hasValidToken(req, token)) {
          json(res, 403, { ok: false, code: "NOT_CONFIGURED", message: "web api token invalid" });
          return;
        }
        const entry = downloads.lookup(url.searchParams.get("path") ?? "");
        // 白名单外 / 已过期 / realpath 逃出登记根目录 ⇒ 一律 404（不区分，避免探测）。
        if (!entry || !isInsideRoot(entry.absPath, entry.rootDir)) {
          json(res, 404, { ok: false, code: "NOT_FOUND", message: "download not found" });
          return;
        }
        // name 只影响 Content-Disposition 的下载名（客户端传什么都改变不了实际路径）。
        const requestedName = (url.searchParams.get("name") ?? "").trim();
        const name = requestedName || entry.name;
        if (entry.directory) {
          // 目录产物（Markdown / HTML 资料包）：即时打包 zip（正文 + images 一起下发）。
          res.writeHead(200, {
            "content-type": "application/zip",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "content-disposition": contentDisposition(name),
          });
          const writer = new ZipWriter((chunk) => { res.write(Buffer.from(chunk)); });
          for (const file of listFilesRecursive(entry.absPath)) {
            writer.addFile(file.rel, fs.readFileSync(file.abs), fs.statSync(file.abs).mtime);
          }
          writer.finish();
          res.end();
          return;
        }
        let stat: fs.Stats;
        try { stat = fs.statSync(entry.absPath); } catch {
          json(res, 404, { ok: false, code: "NOT_FOUND", message: "download not found" });
          return;
        }
        if (!stat.isFile()) { json(res, 404, { ok: false, code: "NOT_FOUND", message: "download not found" }); return; }
        res.writeHead(200, {
          "content-type": downloadContentType(name),
          "content-length": stat.size,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "content-disposition": contentDisposition(name),
        });
        fs.createReadStream(entry.absPath).pipe(res);
        return;
      }

      // ② 渲染层 shim：**不含任何令牌**（来源已在上面统一判定；Sec-Fetch-Site: none 不再放行）
      if (url.pathname === "/__native.js") {
        res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
        res.end(renderNativeShim(assetPort));
        return;
      }

      // ③ 静态服务 dist/（仅 GET）
      if (req.method !== "GET" && req.method !== "HEAD") {
        json(res, 405, { ok: false, code: "INVALID_INPUT", message: "method not allowed" });
        return;
      }
      const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const filePath = path.normalize(path.join(distDir, rel));
      if (!filePath.startsWith(path.normalize(distDir) + path.sep)) {
        json(res, 403, { ok: false, code: "INVALID_INPUT", message: "forbidden path" });
        return;
      }
      if (rel === "index.html") {
        let html: string;
        try { html = fs.readFileSync(filePath, "utf8"); } catch {
          json(res, 503, { ok: false, code: "NOT_CONFIGURED", message: "dist/index.html 不存在：请先运行 vite build（Web 客户端走构建产物）" });
          return;
        }
        const headers: http.OutgoingHttpHeaders = {
          "content-type": DIST_MIME[".html"],
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        };
        // 凭据只在**文档响应**下发（per-process cookie）；静态子资源不带 Set-Cookie。
        if (documentRequest) headers["set-cookie"] = documentSetCookies(token, assetToken);
        res.writeHead(200, headers);
        res.end(injectNativeShim(html));
        return;
      }
      let stat: fs.Stats;
      try { stat = fs.statSync(filePath); } catch {
        json(res, 404, { ok: false, code: "NOT_FOUND", message: "not found" });
        return;
      }
      if (stat.isDirectory()) {
        json(res, 404, { ok: false, code: "NOT_FOUND", message: "not found" });
        return;
      }
      res.writeHead(200, {
        "content-type": DIST_MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
        "content-length": stat.size,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      if (req.method === "HEAD") { res.end(); return; }
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      log.warn(`[web-api] request error: ${(error as Error).message}`);
      if (!res.headersSent) json(res, 500, { ok: false, code: "INTERNAL", message: "internal error" });
      else res.end();
    }
  });

  const broadcast = (event: string, data: unknown): void => {
    if (sseClients.size === 0) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
      try { res.write(frame); } catch { sseClients.delete(res); }
    }
  };
  (server as WebApiServer).broadcast = broadcast;

  server.on("error", (error) => {
    log.warn(`[web-api] 端口 ${port} 启动失败（桌面端不受影响）: ${(error as Error).message}`);
  });
  server.on("close", () => {
    for (const res of sseClients) { try { res.end(); } catch { /* 忽略 */ } }
    sseClients.clear();
  });
  server.listen(port, "127.0.0.1", () => {
    log.info(`[web-api] Web 客户端已就绪: http://127.0.0.1:${port}/`);
  });
  return server as WebApiServer;
}

export interface WebServerStatus {
  enabled: boolean;
  port: number;
  url: string;
}

/**
 * 运行期起停控制器（**不落盘**）：进程启动时默认不监听；
 * 设置里打开/关闭即时起停服务，无需重启应用；应用重启后恢复为关闭。
 */
export interface WebServerController {
  getStatus(): WebServerStatus;
  setEnabled(enabled: boolean): Promise<WebServerStatus>;
  /** 向已连接的 Web 客户端推送事件（Web 未开启 / 无客户端时 no-op）。 */
  broadcast(event: string, data: unknown): void;
}

export function createWebServerController(opts: WebApiServerOptions): WebServerController {
  const port = opts.port ?? WEB_API_PORT;
  const url = `http://127.0.0.1:${port}/`;
  let server: WebApiServer | null = null;
  const status = (): WebServerStatus => ({ enabled: server !== null && server.listening, port, url });
  return {
    getStatus: status,
    broadcast(event: string, data: unknown): void { if (server) server.broadcast(event, data); },
    setEnabled(enabled: boolean): Promise<WebServerStatus> {
      if (enabled) {
        if (server) return Promise.resolve(status());
        const s = startWebApiServer(opts);
        s.once("close", () => { if (server === s) server = null; });
        server = s;
        return new Promise((resolve, reject) => {
          if (s.listening) { resolve(status()); return; }
          // 启动失败必须**抛出原因**：旧实现把 error 吞掉后 resolve 成 enabled:false，
          // 表现为「开关打开又弹回、且没有任何错误信息」（端口被占用是最常见原因）。
          const onError = (error: Error) => {
            if (server === s) server = null;
            try { s.close(); } catch { /* 未监听，close 可忽略 */ }
            const detail = (error as NodeJS.ErrnoException).code === "EADDRINUSE"
              ? `端口 ${port} 已被占用：可能是另一个 LakexLocalNotes 实例或其它程序在用。`
              : `浏览器端服务启动失败：${error.message}`;
            reject(new Error(detail));
          };
          s.once("error", onError);
          s.once("listening", () => { s.off("error", onError); resolve(status()); });
        });
      }
      if (server) { const s = server; server = null; s.close(); }
      return Promise.resolve(status());
    },
  };
}
