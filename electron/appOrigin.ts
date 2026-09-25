import fs from "node:fs";
import path from "node:path";

/**
 * 应用私有协议常量与纯逻辑（**不依赖 electron**：assetServer 与单测都要用）。
 *
 * 对齐 DSH 的做法（其桌面端用 dsh-app://app 而非 file://）：打包版渲染层跑在
 * `lake://app` 这个 standard + secure 的真实 origin 上，桌面端与浏览器端
 * （http://127.0.0.1:19880）在 localStorage / CSP / fetch / clipboard 权限 / secure context
 * 上语义一致，不再出现「桌面行、浏览器不行」这类只有一端复现的差异。
 * 只服务构建产物 dist/；业务数据仍走 IPC（preload）与 127.0.0.1 资产服务。
 */
export const APP_SCHEME = "lake";
export const APP_HOST = "app";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** 构建产物 MIME 表（唯一来源：私有协议静态服务与 Web 客户端静态服务共用，避免两份漂移）。 */
export const DIST_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * 判断某个 URL 是否属于应用自身页面。
 *
 * ⚠️ **不能比较 \`URL.origin\`**：非特殊 scheme（\`lake://\`）在 **Node 的 URL 实现**里 origin 恒为
 * 字符串 \`"null"\`（Chromium 侧才计算成 \`"lake://app"\`）——用 origin 比较会让 IPC 的
 * "来源是否受信任"判定永远失败（实测：page 能加载、preload 在，但每个 IPC 都报"来源不受信任"）。
 * 必须显式比 protocol + host。
 */
export function isAppOriginUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  return parsed.protocol === `${APP_SCHEME}:` && parsed.hostname === APP_HOST;
}

export type AppDistResolution =
  | { ok: true; filePath: string; size: number }
  | { ok: false; status: 403 | 404 };

/**
 * `lake://app/<path>` 的 pathname → dist 下的真实文件。
 * 目录穿越（含 %2e%2e%2f 这类**编码后**才成为 .. 的形态）→ 403；不存在/目录 → 404。
 * 之所以先 decodeURIComponent 再校验：URL 只会规范化字面 `..`，编码形态能绕过朴素判断。
 */
export function resolveAppDistFile(distDir: string, pathname: string): AppDistResolution {
  const root = path.resolve(distDir);
  let rel: string;
  try {
    rel = decodeURIComponent(pathname.replace(/^\/+/, ""));
  } catch {
    return { ok: false, status: 403 }; // 畸形百分号编码
  }
  if (rel === "" || rel === "index.html" || rel === "./index.html") rel = "index.html";
  const filePath = path.resolve(root, rel);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return { ok: false, status: 403 };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { ok: false, status: 404 };
  }
  if (!stat.isFile()) return { ok: false, status: 404 };
  return { ok: true, filePath, size: stat.size };
}
