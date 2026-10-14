/** Test-only S3 transport. Loopback binding and synthetic keys; no external network/credentials. */
import http from "node:http";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
export async function loopbackS3(fixture, port = 19872) {
  const prefix = "perf-audit",
    bucket = "synthetic";
  const original = JSON.parse(
    fs.readFileSync(path.join(fixture, "remote-manifest.json"), "utf8"),
  );
  const objects = new Map([
    [
      prefix + "/manifests/latest.json",
      zlib.gzipSync(Buffer.from(JSON.stringify(original))),
    ],
    [
      prefix + "/manifests/perf-initial.json",
      zlib.gzipSync(Buffer.from(JSON.stringify(original))),
    ],
  ]);
  const events = [];
  let delayMs = 0;
  const server = http.createServer(async (req, res) => {
    const start = performance.now(),
      url = new URL(req.url, "http://127.0.0.1");
    const key = decodeURIComponent(url.pathname).replace(/^\/synthetic\/?/, "");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    let status = 200;
    try {
      if (!key.startsWith(prefix + "/") && key !== "")
        throw Error("unexpected object key");
      if (url.searchParams.has("list-type")) {
        const queryPrefix = url.searchParams.get("prefix") || "",
          keys = [...objects.keys()]
            .filter((k) => k.startsWith(queryPrefix))
            .sort();
        res.setHeader("Content-Type", "application/xml");
        res.end(
          `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucket}</Name><Prefix>${escape(queryPrefix)}</Prefix><KeyCount>${keys.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${keys.map((k) => `<Contents><Key>${escape(k)}</Key><LastModified>2026-10-13T00:00:00.000Z</LastModified><ETag>"perf"</ETag><Size>${objects.get(k).length}</Size><StorageClass>STANDARD</StorageClass></Contents>`).join("")}</ListBucketResult>`,
        );
      } else if (req.method === "PUT") {
        objects.set(key, body);
        res.setHeader(
          "ETag",
          '"' + createHash("md5").update(body).digest("hex") + '"',
        );
        res.end();
      } else if (req.method === "DELETE") {
        objects.delete(key);
        status = 204;
        res.statusCode = status;
        res.end();
      } else if (req.method === "POST" && url.searchParams.has("delete")) {
        const keys = [...body.toString().matchAll(/<Key>(.*?)<\/Key>/g)].map(
          (m) => m[1],
        );
        for (const k of keys) objects.delete(k);
        res.setHeader("Content-Type", "application/xml");
        res.end(
          `<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${keys.map((k) => `<Deleted><Key>${escape(k)}</Key></Deleted>`).join("")}</DeleteResult>`,
        );
      } else {
        let data = objects.get(key);
        if (!data && key.startsWith(prefix + "/objects/")) {
          const entry = original.notes.find(
            (n) => key === `${prefix}/objects/${n.id}-${n.contentHash}.lake`,
          );
          if (entry) {
            const ext = {
              doc: ["notes", "lake"],
              usheet: ["usheets", "usheet.json"],
              bitable: ["bitables", "bitable.json"],
              board: ["boards", "board.json"],
            }[entry.kind || "doc"];
            data = fs.readFileSync(
              path.join(
                fixture,
                "workspace-default",
                ext[0],
                entry.id + "." + ext[1],
              ),
            );
          }
        }
        if (data) {
          res.setHeader("Content-Length", data.length);
          res.setHeader("Content-Type", "application/octet-stream");
          res.end(req.method === "HEAD" ? undefined : data);
        } else {
          status = 404;
          res.statusCode = status;
          res.setHeader("Content-Type", "application/xml");
          res.end(
            "<Error><Code>NoSuchKey</Code><Message>Not found in synthetic fixture</Message></Error>",
          );
        }
      }
    } catch (e) {
      status = 500;
      res.statusCode = status;
      res.end(String(e));
    }
    events.push({
      method: req.method,
      key,
      query: url.search,
      bytes: body.length,
      status,
      ms: Math.round(performance.now() - start),
    });
  });
  await new Promise((r, j) => {
    server.once("error", j);
    server.listen(port, "127.0.0.1", r);
  });
  return {
    endpoint: `http://127.0.0.1:${port}`,
    prefix,
    bucket,
    events,
    objects,
    setDelay(ms) {
      delayMs = ms;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
