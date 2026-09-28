import http from "node:http";
import { APP_ORIGIN } from "./appOrigin.js";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { isSafePathSegment as isSafeSegment } from "../src/core/storeUtils.js";
import { mimeTypeForFilename } from "../src/core/assetNaming.js";

/** 只列「笔记资产表里没有」的 vendor 静态资源类型；其余一律走 core/assetNaming 的单一事实源
 *  （避免又一份与同步/上传/预览漂移的 MIME 表）。 */
const VENDOR_MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
};

/** 扩展名/MIME 判定：vendor 专有类型优先，其次共享表（未知扩展名 → octet-stream）。
 *  内联预览（PDF viewer / 音视频播放器）依赖正确的 Content-Type，共享表已覆盖附件全类。 */
function mimeForExtWith(filePath: string, ext: string): string | null {
  const vendor = VENDOR_MIME[ext];
  if (vendor) return vendor;
  const shared = mimeTypeForFilename(filePath);
  return shared === "application/octet-stream" ? null : shared;
}

export const ASSET_PORT = Number(process.env.LAKE_ASSET_PORT) || 19876;

function sniffMime(bytes: Buffer): string | null {
  const hex = bytes.subarray(0, 16).toString("hex");
  if (hex.startsWith("89504e47")) return "image/png";
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("474946")) return "image/gif";
  if (hex.startsWith("52494646")) return "image/webp";
  if (hex.startsWith("3c737667") || hex.startsWith("3c3f786d6c")) return "image/svg+xml";
  return null;
}

/** 只读取文件头部 16 字节做 MIME 嗅探，避免整文件读入内存（vendor 资源可达 MB 级）。 */
async function sniffMimeFromFile(filePath: string): Promise<string | null> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(filePath, "r");
    const head = Buffer.alloc(16);
    const { bytesRead } = await handle.read(head, 0, 16, 0);
    return sniffMime(head.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function statFile(filePath: string): Promise<fs.Stats | null> {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 按需缩略图（?w=<档位>）
//
// 为什么按需而不是预生成派生文件：`manifest.assets` 是磁盘实扫、GC 保护是正文 filename 正则，
// 落盘的派生文件会被当资产声明/上传，却又不在正文引用集里 ⇒ 注定被判孤儿回收。按需生成
// 「不落盘、不上传、可随时重建」，完全不碰数据格式、同步协议与 GC。
// 收益：渲染进程的图片内存 ≈ 像素 × 4B，一张 4000×3000（~48MB 位图）显示在 80px 宽的单元格里
// 就是纯浪费；按档位取 128px 只剩 ~65KB。
// ---------------------------------------------------------------------------

/** 允许的档位；非档位值一律当没传（防任意值把缓存打散/打满）。与 src/core/assetUrl.ts 的 ASSET_THUMB_WIDTHS 一致。 */
const THUMB_WIDTHS = new Set([128, 256, 512, 1024]);

/**
 * 可安全重编码的位图格式。刻意排除：
 * - GIF：多帧动画 resize 后只剩首帧（宁可不缩，也不能把动图弄坏）；
 * - SVG：矢量，本就没有解码内存问题，且 sharp 栅格化会丢掉矢量特性。
 */
const THUMB_RESIZABLE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".bmp", ".tif", ".tiff"]);

/** 缓存条目上限；键含 mtime+size，文件被替换即自然失效。 */
const THUMB_CACHE_LIMIT = 64;
/** 并发闸：sharp 解码一张大图的峰值就是像素 × 4B，突发几十张同时解码会直接把内存打爆。 */
const THUMB_CONCURRENCY = 4;

const thumbCache = new Map<string, Buffer>();
let thumbRunning = 0;
const thumbWaiters: Array<() => void> = [];

/** 取槽；满载则排队（槽位由 releaseThumbSlot 直接移交，交接期间不改变计数）。 */
async function acquireThumbSlot(): Promise<void> {
  if (thumbRunning < THUMB_CONCURRENCY) {
    thumbRunning += 1;
    return;
  }
  await new Promise<void>((resolve) => thumbWaiters.push(resolve));
}

function releaseThumbSlot(): void {
  const next = thumbWaiters.shift();
  if (next) next();
  else thumbRunning -= 1;
}

/** LRU：命中即移到队尾（Map 保持插入序）。 */
function readThumbCache(key: string): Buffer | null {
  const hit = thumbCache.get(key);
  if (!hit) return null;
  thumbCache.delete(key);
  thumbCache.set(key, hit);
  return hit;
}

function writeThumbCache(key: string, buf: Buffer): void {
  thumbCache.set(key, buf);
  while (thumbCache.size > THUMB_CACHE_LIMIT) {
    const oldest = thumbCache.keys().next().value;
    if (oldest == null) break;
    thumbCache.delete(oldest);
  }
}

/** `?w=` → 档位；非法/缺省 → null（走原图）。 */
function thumbWidthOf(raw: string | null): number | null {
  if (raw == null) return null;
  const width = Number(raw);
  return THUMB_WIDTHS.has(width) ? width : null;
}

/**
 * 生成缩略图（保持原格式：我们的目标是解码内存，而内存只取决于像素数，与编码格式无关；
 * 保持原格式还能避开 alpha/动画/编解码器支持等一堆边界）。
 * 任何失败都返回 null，调用方落回原图——缩略图是纯优化，绝不能因为它让图片显示不出来。
 */
async function thumbnailBuffer(filePath: string, width: number, stat: fs.Stats): Promise<Buffer | null> {
  const key = `${filePath}:${stat.mtimeMs}:${stat.size}:${width}`;
  const cached = readThumbCache(key);
  if (cached) return cached;
  await acquireThumbSlot();
  try {
    // 等槽期间可能已被并发请求算好
    const again = readThumbCache(key);
    if (again) return again;
    try {
      const buf = await sharp(filePath).resize({ width, withoutEnlargement: true }).toBuffer();
      writeThumbCache(key, buf);
      return buf;
    } catch (error) {
      console.warn("[asset-server] 缩略图生成失败，落回原图:", filePath, error);
      return null;
    }
  } finally {
    releaseThumbSlot();
  }
}

function streamFile(
  res: http.ServerResponse,
  filePath: string,
  stat: fs.Stats,
  headers: Record<string, string>,
  rangeHeader?: string,
): void {
  // Range 支持（音频/视频 seek、PDF 分页）：浏览器 seek 需要 206 Partial Content + Accept-Ranges。
  // 无 Range 时 seekable 只有 [0,0]，进度条无法拖动。
  const size = stat.size;
  const rangeMatch = rangeHeader && /bytes=(\d*)-(\d*)/.exec(rangeHeader);
  if (rangeMatch && (rangeMatch[1] !== "" || rangeMatch[2] !== "")) {
    let start = rangeMatch[1] ? Number(rangeMatch[1]) : 0;
    let end = rangeMatch[2] ? Number(rangeMatch[2]) : size - 1;
    if (rangeMatch[1] === "" && rangeMatch[2] !== "") {
      // 后缀范围 bytes=-N → 最后 N 字节
      start = Math.max(0, size - Number(rangeMatch[2]));
      end = size - 1;
    }
    if (start > end || start >= size) {
      res.writeHead(416, { "Content-Range": "bytes */" + size });
      res.end();
      return;
    }
    end = Math.min(end, size - 1);
    res.writeHead(206, {
      ...headers,
      "Content-Length": String(end - start + 1),
      "Content-Range": "bytes " + start + "-" + end + "/" + size,
      "Accept-Ranges": "bytes",
    });
    const partial = fs.createReadStream(filePath, { start, end });
    partial.on("error", (error) => {
      console.warn("[asset-server] 文件流读取失败:", filePath, error);
      if (!res.headersSent) res.writeHead(404);
      res.destroy();
    });
    partial.pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, "Content-Length": String(size), "Accept-Ranges": "bytes" });
  const stream = fs.createReadStream(filePath);
  stream.on("error", (error) => {
    console.warn("[asset-server] 文件流读取失败:", filePath, error);
    if (!res.headersSent) res.writeHead(404);
    res.destroy();
  });
  stream.pipe(res);
}


export function startAssetServer(noteAssetsDir: string, vendorCdnDir: string, quickNotesDir?: string, assetToken?: string): http.Server {
  fs.mkdirSync(noteAssetsDir, { recursive: true });
  if (quickNotesDir) fs.mkdirSync(quickNotesDir, { recursive: true });

  // 审计 #16：本地资源服务仅允许应用自身页面跨域读取（dev origin / 私有协议 lake://app / Web 客户端 / 旧 file 页），
  // 拒绝任意网站的 CORS 读取（恶意网页无法 fetch 笔记图片）。非 CORS 请求（<img>/
  // 直接访问）不带 Origin，不构成可读数据泄露。
  const isAllowedOrigin = (origin: string | undefined): boolean => {
    if (!origin) return true; // 非 CORS 请求
    return origin === APP_ORIGIN                     // 桌面渲染层（打包版：lake://app，A1 起不再用 file://）
      || origin === "http://127.0.0.1:1421"
      || origin === "http://localhost:1421"
      || origin === "http://127.0.0.1:19880"   // Web 客户端（webApiServer）
      || origin === "http://localhost:19880"
      || origin === "null"
      || origin.startsWith("file://");
  };
  // W-8（AUDIT-260828）：ACAO 不再用 "*"——任意站点一旦拿到 assetToken 即可带 Origin
  // 跨源读走全部本地资源。改为只对「应用自身 origin」回显请求 Origin；非 CORS 请求
  // （<img>/<script> 等，无 Origin 头）不参与 CORS，不发 ACAO。生产页是 file://（loadFile），
  // 其 fetch 的 Origin 为字符串 "null"，回显该字面值；其余 Origin 已被 isAllowedOrigin 拦为 403。
  const corsOriginOf = (origin: string | undefined): string | null => {
    if (!origin) return null;
    if (origin === APP_ORIGIN) return APP_ORIGIN;
    if (origin === "http://127.0.0.1:1421" || origin === "http://localhost:1421") return origin;
    if (origin === "http://127.0.0.1:19880" || origin === "http://localhost:19880") return origin;
    if (origin === "null") return "null";
    if (origin.startsWith("file://")) return origin;
    return null;
  };
  const corsHeaders = (origin: string | undefined): Record<string, string> => {
    const value = corsOriginOf(origin);
    return value ? { "Access-Control-Allow-Origin": value, Vary: "Origin" } : {};
  };

  const server = http.createServer(async (req, res) => {
    try {
      if (!isAllowedOrigin(req.headers.origin)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("forbidden origin");
        return;
      }
      const parsed = new URL(req.url ?? "/", `http://127.0.0.1:${ASSET_PORT}`);
      // 畸形百分号编码（如 /%E0%A4%A）会让 decodeURIComponent 抛 URIError，统一兜底 400
      const urlPath = decodeURIComponent(parsed.pathname);
      // Lake 编辑器 CDN 资源的本地镜像：/vendor/cdn/<path>（主进程 onBeforeRequest 重定向过来）
      if (urlPath.startsWith("/vendor/cdn/")) {
        const rel = urlPath.slice("/vendor/cdn/".length);
        if (!rel || rel.split("/").some((seg) => seg === ".." || seg.includes("\\") || seg === "")) {
          res.writeHead(400); res.end("bad request"); return;
        }
        const vendorFile = path.join(vendorCdnDir, rel);
        const stat = await statFile(vendorFile);
        if (!stat) {
          res.writeHead(404); res.end("not found"); return;
        }
        const ext = path.extname(rel).toLowerCase();
        const mime = mimeForExtWith(vendorFile, ext) ?? await sniffMimeFromFile(vendorFile) ?? "application/octet-stream";
        streamFile(res, vendorFile, stat, {
          "Content-Type": mime,
          "Cache-Control": "public, max-age=31536000, immutable",
          ...corsHeaders(req.headers.origin),
        }, req.headers.range);
        return;
      }
      // 正式笔记资源：/{noteId}/{filename}
      // 小记资源：/quick-notes/{quickNoteId}/{filename}
      // 小记草稿资源：/quick-notes/staging/{draftId}/{filename}
      // 以 URL 前缀分隔两个数据空间，不能让普通笔记路径误读小记图片。
      // 审计：CORS 请求（带 Origin 头）访问正式资源必须带 ?token= 匹配启动令牌——
      // 外部网页（含 sandbox iframe 的 Origin: null）没有令牌，无法跨源读取本地图片；
      // <img> 等非 CORS 请求不带 Origin，不受影响（浏览器本就不允许跨源读 img 字节）。
      if (req.headers.origin && assetToken && parsed.searchParams.get("token") !== assetToken) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("forbidden: missing token");
        return;
      }
      const segments = urlPath.split("/").filter(Boolean);
      let filePath: string;
      let filename: string;
      if (segments[0] === "quick-notes") {
        if (!quickNotesDir) { res.writeHead(404); res.end("not found"); return; }
        if (segments.length === 3 && isSafeSegment(segments[1]) && isSafeSegment(segments[2])) {
          filename = segments[2];
          filePath = path.join(quickNotesDir, "assets", segments[1], filename);
        } else if (segments.length === 4 && segments[1] === "staging" && isSafeSegment(segments[2]) && isSafeSegment(segments[3])) {
          filename = segments[3];
          filePath = path.join(quickNotesDir, "staging", segments[2], filename);
        } else {
          res.writeHead(400); res.end("bad request"); return;
        }
      } else {
        if (segments.length !== 2 || !isSafeSegment(segments[0]) || !isSafeSegment(segments[1])) {
          res.writeHead(400); res.end("bad request"); return;
        }
        const noteId = segments[0];
        filename = segments[1];
        filePath = path.join(noteAssetsDir, noteId, filename);
      }
      const stat = await statFile(filePath);
      if (!stat) {
        res.writeHead(404); res.end("not found"); return;
      }

      const ext = path.extname(filename).toLowerCase();
      const mime = mimeForExtWith(filePath, ext) ?? "application/octet-stream";
      // 安全响应头：防 MIME 嗅探；SVG 以文档打开时禁止内嵌脚本（恶意附件 SVG 不得在
      // 127.0.0.1 源内执行——否则同源 fetch 可读走全部本地资产）。
      const securityHeaders: Record<string, string> = {
        "X-Content-Type-Options": "nosniff",
        // DS 复核 A3：默认 CSP 不要拦 SVG 内 data: 图/字；sandbox 防脚本，<img src=svg> 渲染需实机验证
        ...(mime === "image/svg+xml"
          ? {
              "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'",
              "Content-Disposition": "inline",
            }
          : {}),
      };

      if (parsed.searchParams.get("base64") === "1") {
        let buf = await fs.promises.readFile(filePath);
        let outMime = mime;
        // 微信等 macOS 原生应用不渲染 data:image/webp，复制到微信时统一转 PNG
        // （参照 Tauri 版 uploadWithWebpConversion；sharp 基于 libvips 支持 WebP/AVIF 解码）
        if (ext === ".webp" || ext === ".avif") {
          // 审计：解码前校验像素上限，防手工替换成超大尺寸文件导致转换 OOM
          const meta = await sharp(buf).metadata().catch(() => null);
          if (meta?.width && meta?.height && meta.width * meta.height > 50_000_000) {
            res.writeHead(400); res.end("image too large"); return;
          }
          try {
            buf = await sharp(buf).png().toBuffer();
            outMime = "image/png";
          } catch (error) {
            console.warn("[asset-server] webp→png 转换失败，返回原格式:", error);
          }
        }
        const b64 = buf.toString("base64");
        const body = `data:${outMime};base64,${b64}`;
        res.writeHead(200, {
          "Content-Type": "text/plain",
          "Content-Length": Buffer.byteLength(body),
          "X-Content-Type-Options": "nosniff",
          ...corsHeaders(req.headers.origin),
        });
        res.end(body);
        return;
      }

      // ?w=<档位>：按需缩略图（不落盘、不上传、可重建）。失败或格式不支持 → 落到下面的原图分支。
      const thumbWidth = THUMB_RESIZABLE_EXTS.has(ext) ? thumbWidthOf(parsed.searchParams.get("w")) : null;
      if (thumbWidth != null) {
        const thumb = await thumbnailBuffer(filePath, thumbWidth, stat);
        if (thumb) {
          res.writeHead(200, {
            "Content-Type": mime,
            "Content-Length": thumb.length,
            "Cache-Control": "public, max-age=31536000, immutable",
            ...securityHeaders,
            ...corsHeaders(req.headers.origin),
          });
          res.end(thumb);
          return;
        }
      }

      streamFile(res, filePath, stat, {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=31536000, immutable",
        ...securityHeaders,
        ...corsHeaders(req.headers.origin),
      }, req.headers.range);
    } catch (error) {
      console.warn("[asset-server] 请求处理失败:", req.url, error);
      if (!res.headersSent) res.writeHead(400);
      res.end("bad request");
    }
  });

  server.listen(ASSET_PORT, "127.0.0.1", () => {
    console.log(`[asset-server] listening on http://127.0.0.1:${ASSET_PORT}, dir=${noteAssetsDir}`);
  });

  return server;
}
