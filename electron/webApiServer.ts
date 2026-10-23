import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { toIpcErrorPayload } from "./ipc/errors.js";
import { DIST_MIME } from "./appOrigin.js";

/**
 * Web 客户端（最小验证 MVP）
 *
 * 浏览器页 = 桌面端的"附属窗口"：本进程额外起一个 HTTP 服务（默认 127.0.0.1:19880），
 * ① POST /api/<channel> 复用 IPC 注册表里的同一批 handler（数据仍是本机那一份 SQLite/文件，单一真相）；
 * ② 静态服务 dist/（桌面渲染层构建产物，CSP 已放行 127.0.0.1:*）；
 * ③ /__native.js 注入 window.lakeNative 的 HTTP shim（方法面与 preload.cjs 一致，有单测卡漂移）。
 *
 * 安全面（260923 加固）：
 * - 只绑 127.0.0.1，不做出局网；
 * - /api 仅接受 **请求头** `x-lake-token`（禁止 query token：会进日志/Referer，且配合
 *   `text/plain` 简单请求可绕过 preflight）；token 常量时间比较；
 * - 带 Origin / Sec-Fetch-Site=cross-site 的请求一律拒绝（跨站 `<script src=/__native.js>`
 *   可偷 token，跨站简单 POST 可直接调 IPC——两者都必须挡）；
 * - 静态文件不含业务数据。
 */

/** Web 客户端 API 端口（LAKE_WEB_PORT 可覆盖，多实例同机双开用）。 */
export const WEB_API_PORT = Number(process.env.LAKE_WEB_PORT) || 19880;

/** 方法名（与 preload.cjs 的键一致）→ IPC 通道名。漂移由 webApiServer.test.ts 卡住。 */
export const WEB_METHODS: Record<string, string> = {
  bootstrap: "bootstrap_workspace",
  readNote: "read_note",
  noteBodyMissing: "note_body_missing",
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
  createQuickNote: "create_quick_note",
  updateQuickNote: "update_quick_note",
  deleteQuickNote: "delete_quick_note",
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
  listS3GcPending: "list_s3_gc_pending",
  listS3GcLog: "list_s3_gc_log",
  runS3GcDiagnostics: "run_s3_gc_diagnostics",
  runDataHealthCheck: "run_data_health_check",
  readAppLog: "read_app_log",
  getSystemInfo: "get_system_info",
  revealDataFolder: "reveal_data_folder",
  runS3GcReconcile: "run_s3_gc_reconcile",
  runS3DeepCleanup: "run_s3_deep_cleanup",
  getTrashReminder: "get_trash_reminder",
};

const MAX_BODY_BYTES = 256 * 1024 * 1024; // uploadResource 以 JSON number[] 传字节，留足余量


export interface WebApiLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface WebApiServerOptions {
  distDir: string;
  registry: ReadonlyMap<string, (args: unknown[]) => Promise<unknown>>;
  token: string;
  /** 资产服务令牌（仅用于 shim 暴露 assetToken）；与 token 分离：资产 token 出现在 URL，泄漏不得等于 IPC 凭据。 */
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

/**
 * 跨站判定（DS 复核 A1.1/A1.3：禁止空端口放行 + Host 白名单）。
 * - `Sec-Fetch-Site: cross-site` → 拒；
 * - `Origin: null` → 拒；
 * - Origin 必须**完整等于** `http://127.0.0.1:<boundPort>` 或 `http://localhost:<boundPort>`
 *   （**不**放行空端口 `http://127.0.0.1`——那是 :80 的 WHATWG 省略形态，同机 80 页面可偷 token）；
 * - Host 头必须是上述两形态（防 DNS rebinding：rebind 后 Host=攻击者域名）。
 * 缺 Origin 的同源 document/script 默认放行（由 Host + Sec-Fetch-Site 收口）。
 */
function isCrossSiteRequest(req: http.IncomingMessage, boundPort: number): boolean {
  const sfs = String(req.headers["sec-fetch-site"] ?? "").toLowerCase();
  if (sfs === "cross-site") return true;

  const allowedOrigins = [`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`];
  const allowedHosts = [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`];

  const host = String(req.headers.host ?? "");
  if (host && !allowedHosts.includes(host)) return true;

  const origin = req.headers.origin;
  if (!origin) return false;
  if (origin === "null") return true;
  return !allowedOrigins.includes(origin);
}

/**
 * `/__native.js` 会下发 TOKEN，比 `/api` 更严（DS 复核 A1.4）：
 * 仅允许 `Sec-Fetch-Site ∈ {same-origin, none}`。缺失/`same-site`/其它一律拒——
 * 同机其它端口页面用 `<script src>` 拉取时是 `same-site` 且无 Origin，不能放行。
 */
function isNativeShimAllowed(req: http.IncomingMessage): boolean {
  const sfs = String(req.headers["sec-fetch-site"] ?? "").toLowerCase();
  return sfs === "same-origin" || sfs === "none";
}

/** 仅认请求头 token（query 会泄漏到日志/代理/Referer）。 */
function readTokenHeader(req: http.IncomingMessage): string {
  const raw = req.headers["x-lake-token"];
  return typeof raw === "string" ? raw : "";
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

export function renderNativeShim(apiToken: string, assetToken: string, assetPort: number): string {
  return `/* 自动生成：window.lakeNative 的 HTTP 版（方法面 = preload.cjs，见 webApiServer.test.ts） */
(function () {
  "use strict";
  var METHODS = ${JSON.stringify(WEB_METHODS)};
  var API_TOKEN = ${JSON.stringify(apiToken)};
  var ASSET_TOKEN = ${JSON.stringify(assetToken)};
  function makeError(code, message) {
    var err = new Error("[LAKE_IPC_CODE:" + code + "] " + message);
    err.name = "IpcError";
    Object.defineProperty(err, "code", { value: code, enumerable: true });
    return err;
  }
  // SSE 推送：/__events 用 header token 鉴权（EventSource 不能带 header，故用 fetch 流自解析）。
  var EVENT_URL = "/__events";
  var EVENT_NAMES = ["sync-progress", "pending-summary-changed", "library-changed"];
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
    fetch(EVENT_URL, { headers: { "x-lake-token": API_TOKEN }, signal: ctrl.signal, cache: "no-store" })
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
    assetToken: ASSET_TOKEN,
    onSyncProgress: function (cb) { return subscribe("sync-progress", cb); },
    onPendingSummaryChanged: function (cb) { return subscribe("pending-summary-changed", cb); },
    onLibraryChanged: function (cb) { return subscribe("library-changed", cb); }
  };
  Object.keys(METHODS).forEach(function (name) {
    var channel = METHODS[name];
    native[name] = function () {
      var args = Array.prototype.slice.call(arguments);
      return fetch("/api/" + channel, {
        method: "POST",
        headers: { "content-type": "application/json", "x-lake-token": API_TOKEN },
        body: JSON.stringify({ args: args })
      }).then(function (res) {
        return res.json().catch(function () {
          throw makeError("INTERNAL", "web api bad response: HTTP " + res.status);
        });
      }).then(function (payload) {
        if (payload && payload.ok) return payload.data;
        throw makeError((payload && payload.code) || "INTERNAL", (payload && payload.message) || "web api error");
      });
    };
  });
  // 浏览器等价实现：宿主专属动作改成浏览器原生行为（不弹桌面对话框 / 不拉起桌面应用）。
  function assetURL(noteId, filename) {
    return "http://127.0.0.1:" + native.assetPort + "/" + encodeURIComponent(noteId) + "/" + encodeURIComponent(filename) + "?token=" + encodeURIComponent(ASSET_TOKEN);
  }
  native.capabilities = { browserClient: true, nativeDialog: false };
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
  window.lakeNative = native;
})();
`;
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

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      // 实际绑定端口（port:0 时 ≠ 配置端口）
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : port;

      // 跨站一律拒绝（含 /__native.js 偷 token 与 /api 简单请求 CSRF）
      if (isCrossSiteRequest(req, boundPort)) {
        json(res, 403, { ok: false, code: "NOT_CONFIGURED", message: "cross-site request rejected" });
        return;
      }

      // ⓪ SSE 推送通道（GET /__events）：与 /api 同一 header token；连接常驻，事件由 broadcast 下发。
      if (url.pathname === "/__events") {
        if (req.method !== "GET") { json(res, 405, { ok: false, code: "INVALID_INPUT", message: "method not allowed" }); return; }
        if (!timingSafeEqual(readTokenHeader(req), token)) {
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
        // 禁止 query token（泄漏面 + 可被 text/plain 简单请求 CSRF）；仅请求头
        if (!timingSafeEqual(readTokenHeader(req), token)) {
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
          const data = await handler(args);
          json(res, 200, { ok: true, data });
        } catch (error) {
          json(res, 200, { ok: false, ...toIpcErrorPayload(error) }); // 与 IPC 一致：业务错误走 200 envelope
        }
        return;
      }

      // ② 渲染层 shim（TOKEN 下发面：仅 same-origin / 用户导航）
      if (url.pathname === "/__native.js") {
        if (!isNativeShimAllowed(req)) {
          json(res, 403, { ok: false, code: "NOT_CONFIGURED", message: "native shim rejected" });
          return;
        }
        res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
        res.end(renderNativeShim(token, assetToken, assetPort));
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
        res.writeHead(200, { "content-type": DIST_MIME[".html"], "cache-control": "no-store", "x-content-type-options": "nosniff" });
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
              ? `端口 ${port} 已被占用：可能是另一个 LocalLakexNotes 实例或其它程序在用。`
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
