/**
 * 协议与资源服务接线（C-04 从 main.ts #3 + L + N 原样搬出）：可信页面判定、CDN 镜像重定向、
 * 资产 token 重定向、资产服务启动（固定端口按构建形态）、浏览器端（Web 客户端）服务装配。
 * 边界：只做「协议/端口/重定向」接线，不做同步/IPC 业务；IPC 注册仍归 boot/ipcWiring。
 * 时序（C-04 不可动③）：serveAppDist 必须先于 createWindow —— startWebClient 内 markAppDistServed，
 * window/createMainWindow 加载前 assertAppDistServed。
 * 契约：判页面来源禁比 URL.origin（非特殊 scheme 恒为 null）⇒ 比 scheme+host（isAppOriginUrl）；
 * 端口固定不做回退（dev 19877/19881、packaged 19876/19880，env 覆盖优先），见 AGENTS §7#1。
 */
import { app, session } from "electron";
import path from "node:path";
import { currentAssetServerPort, startAssetServer } from "../assetServer.js";
import { configurePreferredWebApiPort, createWebServerController, preferredWebApiPort, type WebServerController } from "../webApiServer.js";
import { resolveMirroredCdnRedirect, scanMirroredCdnFiles } from "../cdnRedirect.js";
import { log } from "../logger.js";
import { errorFields, formatLogFields } from "../../src/core/logFormat.js";
import { isAppOriginUrl } from "../appOrigin.js";
import { DEV_SERVER_URL, rendererDistDir, rendererMode, vendorCdnDir } from "./paths.js";
import { serveAppDist } from "../appProtocol.js";
import { markAppDistServed } from "./startupOrder.js";

/** 应用自身页面的 URL 判定：dev = 固定 dev server；prod = 打包 dist/index.html */
export function isAppPageUrl(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  // 私有协议：只信任 lakexlocalnotes://app 自己的页面（该 origin 下只有 dist 产物，无第三方内容）。
  // 判定走 isAppOriginUrl（比 scheme+host）——非特殊 scheme 在 Node 里 URL.origin 恒为 "null"。
  if (rendererMode === "scheme") return isAppOriginUrl(url);
  return parsed.origin === DEV_SERVER_URL;
}

/**
 * 资源本地化只接管已随应用镜像的 Lake 运行时资源。gw.alipayobjects.com 同时
 * 承载用户粘贴图片，若按 host 全量重定向，未镜像的 /zos/skylark/... 会变成本地 404。
 */
export function registerCdnRedirect(appDir: string): void {
  // W-5：镜像清单启动时一次性读入内存（目录随包固定），回调内零 I/O。
  const mirrored = scanMirroredCdnFiles(vendorCdnDir(appDir));
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["*://gw.alipayobjects.com/*"] },
    (details, callback) => {
      // 端口用实时值（固定端口，启动时解析一次）；回调内读，避免注册时机与端口解析耦合。
      const redirectURL = resolveMirroredCdnRedirect(details.url, currentAssetServerPort(), (relativePath) => mirrored.has(relativePath));
      // 未镜像的资源保持原请求：例如用户粘贴的 gw /zos/skylark 图片。
      callback(redirectURL ? { redirectURL } : {});
    }
  );
}

/**
 * Lake 会为部分图片预加载请求临时追加 `crossOrigin=true`，不会保留正文中的
 * 查询参数。主进程在受信任窗口发出的本地资源请求上补回当前启动 token，
 * 这样既保持正文 URL 稳定，又不让 CORS 预加载被资源服务器拒绝。
 */
export function registerAssetTokenRedirect(options: { assetToken: string; trustedWebContents: Set<number> }): void {
  session.defaultSession.webRequest.onBeforeRequest(
    // 必须是**实际**监听端口；本函数在 await startAssetServer 之后才注册。
    { urls: [`http://127.0.0.1:${currentAssetServerPort()}/*`] },
    (details, callback) => {
      if (details.webContentsId === undefined || !options.trustedWebContents.has(details.webContentsId)) {
        callback({});
        return;
      }
      try {
        const url = new URL(details.url);
        if (url.searchParams.get("token") !== options.assetToken) {
          url.searchParams.set("token", options.assetToken);
          callback({ redirectURL: url.toString() });
          return;
        }
      } catch {
        // 非法 URL 交给资源服务器按原有规则处理。
      }
      callback({});
    },
  );
}

/** L：资产服务启动 + 端口固定 + CDN/资产 token 重定向（原 main.ts 912-947，顺序原样）。 */
export async function startAssetServices(options: { workspaceRoot: () => string; appDir: string; assetToken: string; trustedWebContents: Set<number> }): Promise<void> {
  // 资源服务端口（261117 生产 bug 修复）：
  // ① 默认端口按构建形态分开 —— dev 19877 / packaged 19876（同机双开不再互抢）；env 覆盖优先（隔离测试用）。
  // ② 固定端口（261118 简化）：同一构建形态双开时第二个实例明确报错，不做自动回退。
  // ③ **必须 await 到 listening** 才继续：固定端口写回 env 供 preload/渲染层使用（
  //    src/lib/assetPort 从 process.env.LAKE_ASSET_PORT 取），webRequest 过滤器与 assetPort 注入也要用实际值。
  // ④ 失败不再静默：监听失败在这里记 error，主窗口照常启动（图片降级，其余可用）。
  const preferredAssetPort = Number(process.env.LAKE_ASSET_PORT) || (app.isPackaged ? 19876 : 19877);
  // 先写回 env（即使监听失败也保持固定端口一致）：preload/渲染层在创建窗口时读它。
  process.env.LAKE_ASSET_PORT = String(preferredAssetPort);
  try {
    await startAssetServer(
      path.join(options.workspaceRoot(), "note-assets"),
      vendorCdnDir(options.appDir),
      path.join(options.workspaceRoot(), "quick-notes"),
      options.assetToken,
      {
        preferredPort: preferredAssetPort,
        log: {
          info: (message) => log.app.info(message),
          warn: (message) => log.app.warn(message),
          error: (message) => log.app.error(message),
        },
      },
    );
    // 端口已在 listen 前固定并写回 env（见上）；这里只确认模块级值一致。
  } catch (error) {
    // 降级：服务没起来时图片/附件不可用，但文档、同步、编辑全部照常（别让启动卡死）。
    log.app.error("[asset-server] 启动失败，图片/附件将不可用" + formatLogFields(errorFields(error)));
  }
  // 浏览器端（Web 客户端）端口同样按构建形态分开：packaged 19880 / dev 19881（env LAKE_WEB_PORT 优先）。
  // 真实监听发生在设置页打开开关时（默认关闭）；固定端口，占用则设置页明确报错。
  const preferredWebApiPortValue = Number(process.env.LAKE_WEB_PORT) || (app.isPackaged ? 19880 : 19881);
  configurePreferredWebApiPort(preferredWebApiPortValue);
  log.app.info("[ports] asset=" + currentAssetServerPort() + " webApi=" + preferredWebApiPortValue + "（dev 19877/19881，packaged 19876/19880）");
  registerCdnRedirect(options.appDir);
  registerAssetTokenRedirect({ assetToken: options.assetToken, trustedWebContents: options.trustedWebContents });
}

/** N：浏览器端（桌面附属窗口）服务装配（原 main.ts 972-983，顺序原样）。
 * 默认不启动（纯内存态，不落盘；每次启动都从关闭开始）。设置里打开/关闭即时起停服务；
 * 只绑 127.0.0.1、不做局域网伺服；复用同一批 IPC handler。 */
export function startWebClient(options: {
  appDir: string;
  registry: Parameters<typeof createWebServerController>[0]["registry"];
  webApiToken: string;
  assetToken: string;
}): WebServerController {
  serveAppDist(rendererDistDir(options.appDir));
  markAppDistServed();
  return createWebServerController({
    distDir: rendererDistDir(options.appDir),
    registry: options.registry,
    token: options.webApiToken,
    assetToken: options.assetToken,
    assetPort: currentAssetServerPort(),
    port: preferredWebApiPort(),
    log: { info: (m) => log.app.info(m), warn: (m) => log.app.warn(m) },
  });
}
