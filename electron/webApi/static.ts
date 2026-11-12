import fs from "node:fs";
import path from "node:path";
import type http from "node:http";
import { DIST_MIME } from "../appOrigin.js";
import { ZipWriter } from "../../src/core/zipArchive.js";
import { documentSetCookies, hasValidToken, json } from "./security.js";

/**
 * Web 客户端（最小验证 MVP）· 静态面与下载等价物。
 *
 * - `/__native.js`：把 `window.lakeNative` 的 HTTP shim 注入页面（方法面 = preload.cjs，
 *   **本文件不含任何令牌**；凭据是文档响应下发的 HttpOnly cookie）；
 * - 静态服务 `dist/`（仅 GET/HEAD；凭据只在文档响应下发，静态子资源不带 Set-Cookie）；
 * - `GET /download`：导出产物的下载等价物（白名单只收主进程导出 handler 刚生成的产物）。
 */

/** dist/index.html 注入 shim：<script src="/__native.js"> 必须先于 bundle 执行。 */
export function injectNativeShim(html: string): string {
  const idx = html.indexOf("<script");
  if (idx < 0) return html;
  return `${html.slice(0, idx)}<script src="/__native.js"></script>${html.slice(idx)}`;
}

export function renderNativeShim(assetPort: number, methods: Record<string, string>): string {
  return `/* 自动生成：window.lakeNative 的 HTTP 版（方法面 = preload.cjs，见 webApiServer.test.ts）。
   **本文件不含任何令牌**（SEC-07）：/api 与 /__events 的凭据是文档响应下发的 HttpOnly +
   SameSite=Strict cookie（lake_web_token），页面 JS 根本读不到；资产 token 是另一枚 cookie
   （lake_asset_token，URL 口径、与 IPC 凭据分离）——本机非浏览器客户端两者都拿不到。 */
(function () {
  "use strict";
  var METHODS = ${JSON.stringify(methods)};
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
  var EVENT_NAMES = ["sync-progress", "pending-summary-changed", "library-changed", "note-body-changed", "ai:stream"];
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
    // 261110：正文保存广播（另一端/桌面端保存后刷新已打开的正文；未打开不读盘）。
    onNoteBodyChanged: function (cb) { return subscribe("note-body-changed", cb); },
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
export const EXPORT_DOWNLOAD_CHANNELS = new Set([
  "export_note",
  "export_ink_page_svg",
  "save_ink_page_png",
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
export function attachDownloadOffer(data: unknown, downloads: DownloadRegistry): unknown {
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

/** `GET /__native.js`：下发不含令牌的 shim（来源判定已在入口统一完成）。 */
export function serveNativeShimRoute(res: http.ServerResponse, assetPort: number, methods: Record<string, string>): void {
  res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
  res.end(renderNativeShim(assetPort, methods));
}

/**
 * `GET /download`：只认白名单里、主进程刚生成的产物。
 * 凭据与 /api 同口径（cookie 或 x-lake-token）；path 只接受相对键，绝不接受绝对路径。
 */
export function serveDownloadRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  downloads: DownloadRegistry,
  token: string,
): void {
  if (req.method !== "GET") { json(res, 405, { ok: false, code: "INVALID_INPUT", message: "method not allowed" }); return; }
  // 凭据与 /api 同口径（cookie 或 x-lake-token）；**方法判定在凭据之前**（与原实现一致）。
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
}

export interface StaticRouteOptions {
  distDir: string;
  token: string;
  assetToken: string;
  /** 顶层导航请求（`/` 或 `/index.html`）：只有这里下发 per-process cookie。 */
  documentRequest: boolean;
}

/** 静态服务 `dist/`（仅 GET/HEAD；越界路径 403、不存在 404、缺 index.html 503）。 */
export function serveStaticRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  opts: StaticRouteOptions,
): void {
  const { distDir, token, assetToken, documentRequest } = opts;
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
}
