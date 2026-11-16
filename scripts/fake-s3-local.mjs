/**
 * 本地假 S3（LAKE 同步验证专用；**不要**用于生产）。
 *
 * 只实现同步真正用到的那几个 S3 REST 操作（forcePathStyle=true 的路径风格）：
 *   PUT /<bucket>/<key>            存对象（含 ETag）
 *   GET /<bucket>/<key>            读对象（404 => NoSuchKey XML）
 *   HEAD /<bucket>/<key>           元信息
 *   DELETE /<bucket>/<key>         删除（204）
 *   GET /<bucket>?list-type=2...   ListObjectsV2（prefix/continuation-token/max-keys）
 *   GET /<bucket>?location=        地区（少数客户端会探，返回 us-east-1）
 *
 * 不校验签名（SigV4 只被忽略）——它只用于**本机**端到端验证，不监听外部地址。
 * 用法：node scripts/fake-s3-local.mjs --port 9400  → 打印 "FAKE_S3_READY <port>"
 *      也可 import { startFakeS3 } from "./fake-s3-local.mjs" 拿到 {port, objects, close}。
 */
import http from "node:http";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function noSuchKey(key) {
  return XML_HEADER + '<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message><Key>' + escapeXml(key) + '</Key></Error>';
}

export function startFakeS3({ port = 0, host = "127.0.0.1" } = {}) {
  /** key -> { body: Buffer, etag: string, lastModified: Date } */
  const objects = new Map();
  const listCalls = [];

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, "http://127.0.0.1");
      const segments = url.pathname.split("/").filter(Boolean);
      const bucket = segments[0] ? decodeURIComponent(segments[0]) : "";
      const key = segments.slice(1).map(decodeURIComponent).join("/");
      const method = (req.method || "GET").toUpperCase();
      const send = (status, headers, payload) => {
        res.writeHead(status, headers);
        res.end(payload);
      };
      const etagOf = (buf) => '"' + require_crypto_hash(buf) + '"';

      if (method === "GET" && !key && url.searchParams.get("location") !== null) {
        send(200, { "content-type": "application/xml" }, XML_HEADER + '<LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">us-east-1</LocationConstraint>');
        return;
      }

      if (method === "GET" && !key) {
        const listType = url.searchParams.get("list-type");
        if (listType !== "2") { send(400, { "content-type": "application/xml" }, XML_HEADER + "<Error><Code>InvalidRequest</Code><Message>list-type=2 only</Message></Error>"); return; }
        const prefix = url.searchParams.get("prefix") ?? "";
        const maxKeys = Number(url.searchParams.get("max-keys") ?? "1000") || 1000;
        const token = url.searchParams.get("continuation-token") ?? "";
        const startAfter = token || (url.searchParams.get("start-after") ?? "");
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix) && (startAfter ? k > startAfter : true)).sort();
        const page = keys.slice(0, maxKeys);
        const truncated = keys.length > page.length;
        listCalls.push({ prefix, count: page.length });
        const contents = page.map((k) => {
          const meta = objects.get(k);
          return "<Contents><Key>" + escapeXml(k) + "</Key><LastModified>" + meta.lastModified.toISOString() + "</LastModified><ETag>" + meta.etag + "</ETag><Size>" + meta.body.length + "</Size><StorageClass>STANDARD</StorageClass></Contents>";
        }).join("");
        const xml = XML_HEADER + '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>' + escapeXml(bucket) + "</Name><Prefix>" + escapeXml(prefix) + "</Prefix><KeyCount>" + page.length + "</KeyCount><MaxKeys>" + maxKeys + "</MaxKeys><IsTruncated>" + (truncated ? "true" : "false") + "</IsTruncated>"
          + (truncated ? "<NextContinuationToken>" + escapeXml(page[page.length - 1]) + "</NextContinuationToken>" : "") + contents + "</ListBucketResult>";
        send(200, { "content-type": "application/xml" }, xml);
        return;
      }

      if (!bucket) { send(400, {}, "bucket required"); return; }

      if (method === "PUT" && key) {
        const etag = etagOf(body);
        objects.set(key, { body, etag, lastModified: new Date() });
        send(200, { etag, "content-length": "0" }, "");
        return;
      }
      if (method === "GET" && key) {
        const meta = objects.get(key);
        if (!meta) { send(404, { "content-type": "application/xml" }, noSuchKey(key)); return; }
        send(200, { "content-type": "application/octet-stream", "content-length": String(meta.body.length), etag: meta.etag, "last-modified": meta.lastModified.toUTCString() }, meta.body);
        return;
      }
      if (method === "HEAD" && key) {
        const meta = objects.get(key);
        if (!meta) { res.writeHead(404, { "content-type": "application/xml" }); res.end(); return; }
        res.writeHead(200, { "content-length": String(meta.body.length), etag: meta.etag, "last-modified": meta.lastModified.toUTCString() });
        res.end();
        return;
      }
      if (method === "DELETE" && key) {
        objects.delete(key);
        send(204, {}, "");
        return;
      }
      send(405, {}, "unsupported " + method + " " + url.pathname);
    });
  });

  const ready = new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      resolve({ port: address.port, host, objects, listCalls, close: () => new Promise((done) => server.close(done)) });
    });
  });
  return ready;
}

/** 与 node:crypto 的 sha1 一致（ETag = MD5，但这里只需唯一稳定串，用 sha1 足够）。 */
function require_crypto_hash(buf) {
  return createHash("md5").update(buf).digest("hex");
}
import { createHash } from "node:crypto";

const isMain = process.argv[1] && process.argv[1].endsWith("fake-s3-local.mjs");
if (isMain) {
  const portArgIndex = process.argv.indexOf("--port");
  const port = portArgIndex > 0 ? Number(process.argv[portArgIndex + 1]) : 9400;
  const instance = await startFakeS3({ port });
  console.log("FAKE_S3_READY " + instance.port);
  process.on("SIGTERM", async () => { await instance.close(); process.exit(0); });
}
