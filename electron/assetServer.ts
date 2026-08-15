import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

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

/** 只读取文件头部 16 字节做 MIME 嗅探，避免整文件读入内存（vendor 资源可达 MB 级） */
function sniffMimeFromFile(filePath: string): string | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, "r");
    const head = Buffer.alloc(16);
    const read = fs.readSync(fd, head, 0, 16, 0);
    return sniffMime(head.subarray(0, read));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function isSafeSegment(segment: string): boolean {
  return segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes("/") && !segment.includes("\\");
}

export function startAssetServer(noteAssetsDir: string, vendorCdnDir: string, quickNotesDir?: string, assetToken?: string): http.Server {
  fs.mkdirSync(noteAssetsDir, { recursive: true });
  if (quickNotesDir) fs.mkdirSync(quickNotesDir, { recursive: true });

  // 审计 #16：本地资源服务仅允许应用自身页面跨域读取（dev origin / file 页），
  // 拒绝任意网站的 CORS 读取（恶意网页无法 fetch 笔记图片）。非 CORS 请求（<img>/
  // 直接访问）不带 Origin，不构成可读数据泄露。
  const isAllowedOrigin = (origin: string | undefined): boolean => {
    if (!origin) return true; // 非 CORS 请求
    return origin === "http://127.0.0.1:1421" || origin === "null" || origin.startsWith("file://");
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
        if (!fs.existsSync(vendorFile) || !fs.statSync(vendorFile).isFile()) {
          res.writeHead(404); res.end("not found"); return;
        }
        const ext = path.extname(rel).toLowerCase();
        let mime = MIME_MAP[ext];
        if (!mime) {
          mime = sniffMimeFromFile(vendorFile) ?? "application/octet-stream";
        }
        const stat = fs.statSync(vendorFile);
        res.writeHead(200, {
          "Content-Type": mime,
          "Content-Length": stat.size,
          "Cache-Control": "public, max-age=31536000, immutable",
          "Access-Control-Allow-Origin": "*",
        });
        fs.createReadStream(vendorFile).pipe(res);
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
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404); res.end("not found"); return;
      }

      const ext = path.extname(filename).toLowerCase();
      const mime = MIME_MAP[ext] ?? "application/octet-stream";

      if (parsed.searchParams.get("base64") === "1") {
        let buf = fs.readFileSync(filePath);
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
          "Access-Control-Allow-Origin": "*",
        });
        res.end(body);
        return;
      }

      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": stat.size,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      });
      fs.createReadStream(filePath).pipe(res);
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
