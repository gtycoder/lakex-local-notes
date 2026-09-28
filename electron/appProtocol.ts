import { protocol } from "electron";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { APP_SCHEME, APP_HOST, DIST_MIME, resolveAppDistFile } from "./appOrigin.js";

/**
 * `lake://app` 的协议注册与静态服务（真正的实现在 appOrigin.ts，本文件只做 electron 接线）。
 *
 * 为什么不用 file://（打包版旧做法）：file:// 的 origin 是 opaque/可变的，localStorage、
 * CSP 的 'self'、fetch 的 CORS 行为都与浏览器端的 http://127.0.0.1:19880 不一致，
 * 容易产出「只在某一端复现」的问题。私有协议给渲染层一个稳定的 secure origin。
 */

/** 必须在 app ready **之前**调用（Electron 要求）。 */
export function registerAppSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
    },
  ]);
}

/** app ready 之后调用：把 `lake://app/<path>` 映射到 distDir 下的真实文件（只读、仅 GET/HEAD）。 */
export function serveAppDist(distDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response(null, { status: 400 });
    }
    if (url.hostname !== APP_HOST) return new Response(null, { status: 404 });
    const resolved = resolveAppDistFile(distDir, url.pathname);
    if (!resolved.ok) return new Response(null, { status: resolved.status });
    const headers: Record<string, string> = {
      "content-type": DIST_MIME[path.extname(resolved.filePath).toLowerCase()] ?? "application/octet-stream",
      "content-length": String(resolved.size),
      // 与 Web 客户端静态服务同口径：产物随版本变化，不做长缓存
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    };
    if (request.method === "HEAD") return new Response(null, { status: 200, headers });
    const body = Readable.toWeb(fs.createReadStream(resolved.filePath)) as unknown as ReadableStream<Uint8Array>;
    return new Response(body, { status: 200, headers });
  });
}
