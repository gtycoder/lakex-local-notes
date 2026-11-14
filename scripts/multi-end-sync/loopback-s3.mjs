/**
 * 内存 S3 兼容服务（只监听 127.0.0.1）——仅供 scripts/multi-end-sync/regression.mjs --loopback 冒烟。
 *
 * 目的：本机没有真实 S3 凭据时，也能把「两个隔离桌面 + 同一唯一前缀 + 同步断言」整条链路跑通，
 * 从而验证回归脚本本身。**它不是 S3 模拟器**：
 *  - 无鉴权/无签名校验、无多版本、无一致性/并发保证（单进程 Map+同步写）；
 *  - 只实现产品传输层用到的子集：GetObject（含 Range）/HeadObject/PutObject/DeleteObject/
 *    ListObjectsV2（prefix + continuation-token + max-keys）/DeleteObjects（POST ?delete）；
 *  - 对象字节**原样存取**（产品侧元数据 gzip 由产品自己压/解，这里不做 Content-Encoding 处理）。
 *
 * 真实桶验收必须走 S3_* 环境变量；本服务结果不能替代真实桶结论。
 */
import http from "node:http";
import { createHash } from "node:crypto";

const XML_ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const xmlEscape = (value) => String(value).replace(/[&<>"']/g, (c) => XML_ESCAPE[c]);
const xmlUnescape = (value) =>
  String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

function sendXml(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/xml");
  res.end(body);
}

function errorXml(code, message) {
  return "<Error><Code>" + xmlEscape(code) + "</Code><Message>" + xmlEscape(message) + "</Message></Error>";
}

async function readBody(req, limitBytes = 256 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * @param {{ port?: number, bucket?: string }} [options] port=0 表示由系统分配。
 * @returns {Promise<{ endpoint: string, bucket: string, region: string, port: number, objects: Map<string, Buffer>, events: object[], count: (prefix?: string) => number, close: () => Promise<void> }>}
 */
export async function startLoopbackS3(options = {}) {
  const bucket = options.bucket || "regression";
  const objects = new Map();
  const events = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    // path-style：/{bucket}/{key...}；也容忍根路径（视为桶根）。
    let key = "";
    if (pathname === "/" || pathname === "") key = "";
    else if (pathname === "/" + bucket || pathname === "/" + bucket + "/") key = "";
    else if (pathname.startsWith("/" + bucket + "/")) key = pathname.slice(bucket.length + 2);
    else if (pathname.startsWith("/" + bucket)) key = pathname.slice(bucket.length + 1);
    else {
      // 非本桶路径：直接 404，避免隐藏地接受错误 endpoint。
      return sendXml(res, 404, errorXml("NoSuchBucket", "unknown bucket path " + pathname));
    }
    const entry = { method: req.method, key, query: url.search, status: 200, bytes: 0 };
    events.push(entry);
    try {
      if (req.method === "GET" && url.searchParams.has("list-type")) {
        const prefix = url.searchParams.get("prefix") || "";
        const maxKeysRaw = Number(url.searchParams.get("max-keys") || 1000);
        const maxKeys = Number.isFinite(maxKeysRaw) && maxKeysRaw > 0 ? Math.min(Math.floor(maxKeysRaw), 1000) : 1000;
        const token = url.searchParams.get("continuation-token");
        const start = token ? Number(token) : 0;
        if (!Number.isFinite(start) || start < 0) return sendXml(res, 400, errorXml("InvalidArgument", "bad continuation-token"));
        const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        const page = all.slice(start, start + maxKeys);
        const truncated = start + page.length < all.length;
        const contents = page
          .map((k) => {
            const data = objects.get(k);
            return (
              "<Contents><Key>" + xmlEscape(k) + "</Key>" +
              "<LastModified>" + new Date().toISOString() + "</LastModified>" +
              '<ETag>"' + createHash("md5").update(data).digest("hex") + '"</ETag>' +
              "<Size>" + data.length + "</Size><StorageClass>STANDARD</StorageClass></Contents>"
            );
          })
          .join("");
        const body =
          '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>' + xmlEscape(bucket) + "</Name>" +
          "<Prefix>" + xmlEscape(prefix) + "</Prefix><KeyCount>" + page.length + "</KeyCount>" +
          "<MaxKeys>" + maxKeys + "</MaxKeys><IsTruncated>" + (truncated ? "true" : "false") + "</IsTruncated>" +
          (truncated ? "<NextContinuationToken>" + String(start + page.length) + "</NextContinuationToken>" : "") +
          contents + "</ListBucketResult>";
        return sendXml(res, 200, body);
      }

      if (req.method === "POST" && url.searchParams.has("delete")) {
        const payload = (await readBody(req)).toString("utf8");
        const keys = [...payload.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((m) => xmlUnescape(m[1]));
        const deleted = [];
        for (const k of keys) {
          if (objects.delete(k)) deleted.push(k);
        }
        entry.bytes = payload.length;
        return sendXml(
          res,
          200,
          '<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
            deleted.map((k) => "<Deleted><Key>" + xmlEscape(k) + "</Key></Deleted>").join("") +
            "</DeleteResult>",
        );
      }

      if (req.method === "PUT") {
        const body = await readBody(req);
        objects.set(key, body);
        entry.bytes = body.length;
        res.statusCode = 200;
        res.setHeader("ETag", '"' + createHash("md5").update(body).digest("hex") + '"');
        return res.end();
      }

      if (req.method === "DELETE") {
        objects.delete(key);
        entry.status = 204;
        res.statusCode = 204;
        return res.end();
      }

      if (req.method === "GET" || req.method === "HEAD") {
        const data = objects.get(key);
        if (!data) {
          entry.status = 404;
          return sendXml(res, 404, errorXml("NoSuchKey", "not found"));
        }
        res.setHeader("ETag", '"' + createHash("md5").update(data).digest("hex") + '"');
        res.setHeader("Content-Type", "application/octet-stream");
        const range = req.headers.range;
        if (range) {
          const match = /^bytes=(\d+)-(\d*)$/.exec(String(range));
          if (match) {
            const from = Number(match[1]);
            const to = match[2] === "" ? data.length - 1 : Number(match[2]);
            const safeTo = Math.min(Math.max(from, to), data.length - 1);
            const slice = data.subarray(from, safeTo + 1);
            res.statusCode = 206;
            res.setHeader("Content-Range", "bytes " + from + "-" + safeTo + "/" + data.length);
            res.setHeader("Content-Length", slice.length);
            entry.bytes = slice.length;
            return res.end(req.method === "HEAD" ? undefined : slice);
          }
        }
        res.statusCode = 200;
        res.setHeader("Content-Length", data.length);
        entry.bytes = data.length;
        return res.end(req.method === "HEAD" ? undefined : data);
      }

      entry.status = 405;
      sendXml(res, 405, errorXml("MethodNotAllowed", String(req.method)));
    } catch (error) {
      entry.status = 500;
      sendXml(res, 500, errorXml("InternalError", error instanceof Error ? error.message : String(error)));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : Number(options.port) || 0;
  return {
    endpoint: "http://127.0.0.1:" + port,
    bucket,
    region: "us-east-1",
    port,
    objects,
    events,
    count(prefix = "") {
      let n = 0;
      for (const k of objects.keys()) if (k.startsWith(prefix)) n++;
      return n;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
