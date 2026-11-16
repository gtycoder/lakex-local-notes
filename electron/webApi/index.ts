import http from "node:http";
import { hasValidToken, isAllowedRequest, json } from "./security.js";
import { DOWNLOAD_ROUTE, createDownloadRegistry, serveDownloadRoute, serveNativeShimRoute, serveStaticRoute } from "./static.js";
import { serveApiRoute } from "./bridge.js";
import { createEventHub } from "./events.js";

/**
 * Web 客户端（最小验证 MVP）· 装配层。
 *
 * 浏览器页 = 桌面端的"附属窗口"：本进程额外起一个 HTTP 服务（默认 127.0.0.1:19880），
 * ① POST /api/<channel> 复用 IPC 注册表里的同一批 handler（数据仍是本机那一份 SQLite/文件，单一真相）；
 * ② 静态服务 dist/（桌面渲染层构建产物；prod CSP 只放行本机固定端口 19876/19880）；
 * ③ /__native.js 注入 window.lakeNative 的 HTTP shim（方法面与 preload.cjs 一致，有单测卡漂移）；
 * ④ GET /download：浏览器端导出产物的下载等价物（白名单只收主进程导出 handler 刚生成的产物）。
 *
 * 安全面（261028 SEC-07 收口；用户已裁决保留浏览器端，只做安全）：判定全部在 `security.ts`，
 * 本文件只按固定顺序装配路由（⓪ SSE → ① API → ①-b 下载 → ② shim → ③ 静态）。
 */

/**
 * Web 客户端 API 端口。**默认按构建形态分开**（261117 用户要求：dev 与 packaged 所有本地端口互不重复）：
 * packaged 19880 / dev 19881，env `LAKE_WEB_PORT` 覆盖优先。main 在注册 IPC 前用
 * `configurePreferredWebApiPort()` 写入实际首选值。
 */
export const WEB_API_PORT = Number(process.env.LAKE_WEB_PORT) || 19880;

let preferredPort: number = WEB_API_PORT;

/** 当前首选端口（设置页 fallback / 控制器默认值都读它，而不是常量）。 */
export function preferredWebApiPort(): number {
  return preferredPort;
}

/** main 启动时按 `app.isPackaged ? 19880 : 19881`（env 覆盖优先）配置；非法值忽略。 */
export function configurePreferredWebApiPort(port: number): void {
  if (Number.isFinite(port) && port > 0 && port < 65536) preferredPort = Math.trunc(port);
}

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

export interface WebApiServer extends http.Server {
  /** 向所有已连接的 Web 客户端推送一条 SSE 事件（无客户端时 no-op）。 */
  broadcast(event: string, data: unknown): void;
}

/**
 * 起服务（`methods` = 浏览器方法名 → IPC 通道名，单一来源在 `webApiServer.ts` 的 `WEB_METHODS`；
 * 由薄门面注入，避免装配层反向依赖门面造成环）。
 */
export function startWebApiServer(opts: WebApiServerOptions, methods: Record<string, string>): WebApiServer {
  const { distDir, registry, token, assetToken, assetPort } = opts;
  const port = opts.port ?? WEB_API_PORT;
  const log = opts.log ?? { info: () => {}, warn: () => {} };
  /** 已连接的 SSE 客户端（/__events）与浏览器下载白名单（导出 handler 刚生成的产物）。 */
  const events = createEventHub();
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
        events.attach(res);
        return; // 保持连接，不 end
      }

      // ① 通用 API 通道（桥接层负责鉴权/args/envelope）
      if (url.pathname.startsWith("/api/")) {
        await serveApiRoute(req, res, url, { registry, token, downloads });
        return;
      }

      // ①-b 浏览器下载（导出的下载等价物）：只认白名单里、主进程刚生成的产物。
      if (url.pathname === DOWNLOAD_ROUTE) {
        serveDownloadRoute(req, res, url, downloads, token);
        return;
      }

      // ② 渲染层 shim：**不含任何令牌**（来源已在上面统一判定；Sec-Fetch-Site: none 不再放行）
      if (url.pathname === "/__native.js") {
        serveNativeShimRoute(res, assetPort, methods);
        return;
      }

      // ③ 静态服务 dist/（仅 GET/HEAD）
      serveStaticRoute(req, res, url, { distDir, token, assetToken, documentRequest });
    } catch (error) {
      log.warn(`[web-api] request error: ${(error as Error).message}`);
      if (!res.headersSent) json(res, 500, { ok: false, code: "INTERNAL", message: "internal error" });
      else res.end();
    }
  });

  const broadcast = (event: string, data: unknown): void => { events.broadcast(event, data); };
  (server as WebApiServer).broadcast = broadcast;

  server.on("error", (error) => {
    log.warn(`[web-api] 端口 ${port} 启动失败（桌面端不受影响）: ${(error as Error).message}`);
  });
  server.on("close", () => {
    events.closeAll();
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

export function createWebServerController(opts: WebApiServerOptions, methods: Record<string, string>): WebServerController {
  const preferredPort = opts.port ?? preferredWebApiPort();
  let server: WebApiServer | null = null;
  /** 固定端口：不做回退（dev 19881 / packaged 19880，双开时第二个实例会明确报错）。 */
  const boundPort = preferredPort;
  const urlOf = (port: number): string => "http://127.0.0.1:" + port + "/";
  const status = (): WebServerStatus => ({ enabled: server !== null && server.listening, port: boundPort, url: urlOf(boundPort) });

  /** 在固定端口起服务并等 listening；失败 reject（保留原始 error 以便区分 EADDRINUSE）。 */
  const listenOnce = (port: number): Promise<WebApiServer> => new Promise((resolve, reject) => {
    const s = startWebApiServer({ ...opts, port }, methods);
    if (s.listening) { resolve(s); return; }
    const onError = (error: Error) => {
      s.off("listening", onListening);
      try { s.close(); } catch { /* 未监听，close 可忽略 */ }
      reject(error);
    };
    const onListening = () => { s.off("error", onError); resolve(s); };
    s.once("error", onError);
    s.once("listening", onListening);
  });

  return {
    getStatus: status,
    broadcast(event: string, data: unknown): void { if (server) server.broadcast(event, data); },
    async setEnabled(enabled: boolean): Promise<WebServerStatus> {
      if (enabled) {
        if (server) return status();
        try {
          const s = await listenOnce(preferredPort);
          s.once("close", () => { if (server === s) server = null; });
          server = s;
          return status();
        } catch (error) {
          // 固定端口没有回退：占用就明确报错（旧实现吞 error 后 resolve 成 enabled:false，表现为开关弹回）。
          const code = (error as NodeJS.ErrnoException | null)?.code;
          const detail = code === "EADDRINUSE"
            ? "端口 " + preferredPort + " 已被占用：请关闭另一个 LakexLocalNotes 实例或占用该端口的程序后重试。"
            : "浏览器端服务启动失败：" + (error instanceof Error ? error.message : String(error));
          throw new Error(detail);
        }
      }
      if (server) { const s = server; server = null; s.close(); }
      return status();
    },
  };
}
