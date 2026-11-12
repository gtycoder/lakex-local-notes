import http from "node:http";

/**
 * Web 客户端（最小验证 MVP）· 安全面与请求/响应原语（SEC-07 收口）。
 *
 * 只做四件事：
 *  - 请求体读取（含 256MB 上限，uploadResource 以 JSON number[] 传字节）；
 *  - 统一 JSON 响应封包（各路由共用，避免第二份）；
 *  - 凭据校验：per-process cookie `lake_web_token`（HttpOnly + SameSite=Strict）
 *    或原请求头 `x-lake-token`（CLI/测试兼容）；仍禁止 query token；
 *  - 来源判定**单一来源** `isAllowedRequest`：Origin 必须精确等于同源两形态、
 *    `Sec-Fetch-Site: cross-site` 一律拒、**不放行 `Sec-Fetch-Site: none`**、
 *    文档请求要求 `Sec-Fetch-Dest: document` 或同源 Origin。
 *
 * 本文件不依赖 electron / 业务模块；只被 `webApi/{bridge,events,static,index}.ts` 使用。
 */

export const MAX_BODY_BYTES = 256 * 1024 * 1024;

/** 浏览器端 API 凭据的 per-process cookie（值 = 现有 API token），只在文档响应里下发。 */
export const WEB_TOKEN_COOKIE = "lake_web_token";
/**
 * 资产 token 的 cookie：**有意不加 HttpOnly**——页面要把资产 token 拼进资源 URL 的 `?token=`
 * （与桌面端 `?token=` 口径一致）。它与 IPC 凭据分离，泄漏不等于能调 /api；
 * 但仍只在文档响应下发，本机非浏览器客户端（curl 等）拿不到。
 */
export const ASSET_TOKEN_COOKIE = "lake_asset_token";

/** 统一 JSON 响应（路由/鉴权失败/404 共用这一份封包）。 */
export function json(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

/** 常量时间比较（token 非空时避免时序侧信道；短 token 差异极小，仍比 !== 规范）。 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const len = Math.max(a.length, b.length, 1);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** 同源两形态（127.0.0.1 与 localhost 的同端口）。**不放行**空端口 `http://127.0.0.1`——那等于 :80。 */
export function sameOrigins(boundPort: number): string[] {
  return [`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`];
}

/** 读 Cookie（同名取第一个）；畸形百分号编码按原值返回，不让一个坏 cookie 打断鉴权。 */
export function readCookie(req: http.IncomingMessage, name: string): string {
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
export function readTokenHeader(req: http.IncomingMessage): string {
  const raw = req.headers["x-lake-token"];
  return typeof raw === "string" ? raw : "";
}

/**
 * 凭据校验：**cookie 或 `x-lake-token` 头**（浏览器页面由浏览器自动带 cookie；CLI/单测保留原请求头）。
 * 常量时间比较；token 为空一律拒（避免"空 cookie 与空 token 相等"而放行）。
 */
export function hasValidToken(req: http.IncomingMessage, token: string): boolean {
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
export function isAllowedRequest(
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
export function documentSetCookies(token: string, assetToken: string): string[] {
  const cookies = [`${WEB_TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`];
  if (assetToken) cookies.push(`${ASSET_TOKEN_COOKIE}=${encodeURIComponent(assetToken)}; Path=/; SameSite=Strict`);
  return cookies;
}

/** 读请求体（超过 MAX_BODY_BYTES 或中断返回 null，由调用方回 413）。 */
export function readBody(req: http.IncomingMessage): Promise<Buffer | null> {
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
