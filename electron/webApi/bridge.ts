import type http from "node:http";
import { toIpcErrorPayload } from "../ipc/errors.js";
import { hasValidToken, json, readBody } from "./security.js";
import { EXPORT_DOWNLOAD_CHANNELS, attachDownloadOffer, type DownloadRegistry } from "./static.js";

/**
 * Web 客户端（最小验证 MVP）· `POST /api/<channel>` 桥接。
 *
 * 把 HTTP 请求转成与桌面 IPC 完全相同的「通道 + args」调用（数据仍是本机那一份 SQLite/文件）：
 * - 只认 POST + cookie/header 凭据（禁止 query token）；
 * - 业务错误走 200 envelope（与 IPC 一致，见 `toIpcErrorPayload`）；
 * - 导出类通道的产物登记进下载白名单（浏览器端据此走 /download）。
 */

export interface ApiRouteOptions {
  /** IPC 已注册通道 → handler（与桌面端共用同一份，见 electron/ipc/registrar.ts）。 */
  registry: ReadonlyMap<string, (args: unknown[]) => Promise<unknown>>;
  token: string;
  /** 浏览器下载白名单（只登记导出 handler 刚生成的产物）。 */
  downloads: DownloadRegistry;
}

export async function serveApiRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  opts: ApiRouteOptions,
): Promise<void> {
  const { registry, token, downloads } = opts;
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
}
