import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { injectNativeShim, renderNativeShim, startWebApiServer, WEB_METHODS, type WebApiServerOptions } from "./webApiServer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** preload.cjs 的 invoke 通道（名称与通道名都从源码提取，防两处漂移）。 */
function extractPreloadChannels(): Record<string, string> {
  const source = fs.readFileSync(path.join(__dirname, "preload.cjs"), "utf8");
  const map: Record<string, string> = {};
  const re = /^\s*(\w+):\s*(?:\([^)]*\))?\s*=>\s*invoke\("([a-z0-9_]+)"/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (m[1] in map) throw new Error(`preload.cjs 方法重复: ${m[1]}`);
    map[m[1]] = m[2];
  }
  return map;
}

async function listen(server: ReturnType<typeof startWebApiServer>): Promise<number> {
  if (!server.listening) await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const addr = server.address();
  if (typeof addr === "object" && addr) return addr.port;
  throw new Error("no address");
}

function makeOptions(distDir: string, overrides: Partial<WebApiServerOptions> = {}): WebApiServerOptions {
  return {
    distDir,
    registry: new Map(Object.entries({ echo: async (args) => args, boom: async () => { throw Object.assign(new Error("bad input"), { code: "INVALID_INPUT", name: "IpcError" }); } })),
    token: "test-token",
    assetToken: "test-asset-token",
    assetPort: 19876,
    ...overrides,
  };
}

describe("webApiServer", () => {
  it("WEB_METHODS 与 preload.cjs 的 invoke 通道完全一致", () => {
    const preload = extractPreloadChannels();
    expect(Object.keys(WEB_METHODS).sort()).toEqual(Object.keys(preload).sort());
    for (const [method, channel] of Object.entries(preload)) {
      expect(WEB_METHODS[method]).toBe(channel);
    }
    // 两个事件订阅走推送通道，MVP 由 shim 内置 no-op，不在 HTTP 表里
    expect("onSyncProgress" in preload).toBe(false);
    expect("onPendingSummaryChanged" in preload).toBe(false);
  });

  it("shim 注入到第一个 <script 之前", () => {
    const html = `<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script src="/assets/a.js"></script></body></html>`;
    const out = injectNativeShim(html);
    const shimIdx = out.indexOf(`<script src="/__native.js"></script>`);
    expect(shimIdx).toBeGreaterThan(0);
    expect(out.indexOf("<script src=\"/assets/a.js\"")).toBeGreaterThan(shimIdx);
  });

  it("shim 包含全部方法 + assetToken/assetPort + SSE 订阅", () => {
    const shim = renderNativeShim("api-tok", "asset-tok", 19877);
    expect(shim).toContain(`assetPort: 19877`);
    expect(shim).toContain(`var API_TOKEN = "api-tok"`);
    expect(shim).toContain(`var ASSET_TOKEN = "asset-tok"`);
    expect(shim).toContain(`assetToken: ASSET_TOKEN`);
    for (const method of Object.keys(WEB_METHODS)) {
      expect(shim).toContain(`"${method}":`);
    }
    expect(shim).toContain(`var EVENT_URL = "/__events"`);
    expect(shim).toContain(`onSyncProgress: function (cb) { return subscribe("sync-progress", cb); }`);
    expect(shim).toContain(`onPendingSummaryChanged: function (cb) { return subscribe("pending-summary-changed", cb); }`);
  });

  describe("HTTP 行为", () => {
    let server: ReturnType<typeof startWebApiServer>;
    let base: string;
    let distDir: string;

    beforeAll(async () => {
      distDir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-web-"));
      fs.writeFileSync(path.join(distDir, "index.html"), "<html><script src=\"/assets/a.js\"></script></html>");
      fs.mkdirSync(path.join(distDir, "assets"));
      fs.writeFileSync(path.join(distDir, "assets", "a.js"), "console.log(1)");
      server = startWebApiServer(makeOptions(distDir, { port: 0 }));
      base = `http://127.0.0.1:${await listen(server)}`;
    });

    afterAll(() => {
      server.close();
      fs.rmSync(distDir, { recursive: true, force: true });
    });

    it("POST /api/<channel> 带 token 转发 handler 参数", async () => {
      const res = await fetch(`${base}/api/echo`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-lake-token": "test-token" },
        body: JSON.stringify({ args: ["a", 2, { x: 1 }] }),
      });
      expect(res.status).toBe(200);
      const payload = await res.json() as { ok: boolean; data: unknown[] };
      expect(payload.ok).toBe(true);
      expect(payload.data).toEqual(["a", 2, { x: 1 }]);
    });

    it("错误 handler 返回 ok:false envelope（200）", async () => {
      const res = await fetch(`${base}/api/boom`, {
        method: "POST",
        headers: { "x-lake-token": "test-token" },
        body: JSON.stringify({ args: [] }),
      });
      expect(res.status).toBe(200);
      const payload = await res.json() as { ok: boolean; code: string; message: string };
      expect(payload.ok).toBe(false);
      expect(payload.code).toBe("INVALID_INPUT");
      expect(payload.message).toBe("bad input");
    });

    it("token 缺失/错误 → 403", async () => {
      const noToken = await fetch(`${base}/api/echo`, { method: "POST", body: JSON.stringify({ args: [] }) });
      expect(noToken.status).toBe(403);
      const badToken = await fetch(`${base}/api/echo`, { method: "POST", headers: { "x-lake-token": "wrong" }, body: JSON.stringify({ args: [] }) });
      expect(badToken.status).toBe(403);
    });

    it("query token 不再被接受（防泄漏 + 简单请求 CSRF）", async () => {
      const res = await fetch(`${base}/api/echo?token=test-token`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ args: ["x"] }),
      });
      expect(res.status).toBe(403);
    });

    it("跨站 Origin → 403（含 /__native.js 偷 token）", async () => {
      const api = await fetch(`${base}/api/echo`, {
        method: "POST",
        headers: { "x-lake-token": "test-token", origin: "http://evil.example" },
        body: JSON.stringify({ args: [] }),
      });
      expect(api.status).toBe(403);
      const shim = await fetch(`${base}/__native.js`, { headers: { origin: "http://evil.example" } });
      expect(shim.status).toBe(403);
    });

    it("Sec-Fetch-Site: cross-site → 403", async () => {
      const res = await fetch(`${base}/__native.js`, { headers: { "sec-fetch-site": "cross-site" } });
      expect(res.status).toBe(403);
    });

    it("同源 Origin → 200", async () => {
      const port = new URL(base).port;
      const res = await fetch(`${base}/api/echo`, {
        method: "POST",
        headers: { "x-lake-token": "test-token", origin: `http://127.0.0.1:${port}` },
        body: JSON.stringify({ args: [1] }),
      });
      expect(res.status).toBe(200);
    });

    it("空端口 Origin（127.0.0.1 默认 :80）→ 403（DS 复核 A1.1 旁路）", async () => {
      const res = await fetch(`${base}/api/echo`, {
        method: "POST",
        headers: { "x-lake-token": "test-token", origin: "http://127.0.0.1" },
        body: JSON.stringify({ args: [] }),
      });
      expect(res.status).toBe(403);
    });

    it("Sec-Fetch-Site: same-site → /__native.js 403（DS 复核 A1.4）", async () => {
      const res = await fetch(`${base}/__native.js`, { headers: { "sec-fetch-site": "same-site" } });
      expect(res.status).toBe(403);
    });

    it("缺失 Sec-Fetch-Site → /__native.js 403（token 下发面收口）", async () => {
      const res = await fetch(`${base}/__native.js`);
      expect(res.status).toBe(403);
    });

    it("Sec-Fetch-Site: same-origin → /__native.js 200", async () => {
      const res = await fetch(`${base}/__native.js`, { headers: { "sec-fetch-site": "same-origin" } });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("var API_TOKEN");
    });

    it("Host 头不符 → 403（DS 复核 A1.3 DNS rebinding）", async () => {
      // fetch 会忽略 Host 头，必须用 http.request 原样发出
      const portNum = Number(new URL(base).port);
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port: portNum, path: "/api/echo", method: "POST",
            headers: { "x-lake-token": "test-token", host: "evil.example", "content-type": "application/json" } },
          (res) => { res.resume(); resolve(res.statusCode ?? 0); },
        );
        req.on("error", reject);
        req.end(JSON.stringify({ args: [] }));
      });
      expect(status).toBe(403);
    });

    it("资产 token 不能调 /api（token 拆分：assetToken ≠ webApiToken）", async () => {
      const res = await fetch(`${base}/api/echo`, {
        method: "POST",
        headers: { "x-lake-token": "test-asset-token", "content-type": "application/json" },
        body: JSON.stringify({ args: [] }),
      });
      expect(res.status).toBe(403);
    });

    it("未知通道 → 404 envelope", async () => {
      const res = await fetch(`${base}/api/nope`, { method: "POST", headers: { "x-lake-token": "test-token" }, body: JSON.stringify({ args: [] }) });
      expect(res.status).toBe(404);
      const payload = await res.json() as { ok: boolean; code: string };
      expect(payload.ok).toBe(false);
      expect(payload.code).toBe("NOT_FOUND");
    });

    it("index.html 被注入 shim；静态资源可取；路径穿越被拒", async () => {
      const page = await fetch(`${base}/`);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain(`<script src="/__native.js"></script>`);

      const asset = await fetch(`${base}/assets/a.js`);
      expect(asset.status).toBe(200);
      expect(await asset.text()).toBe("console.log(1)");

      const evil = await fetch(`${base}/../secret.txt`);
      expect([403, 404]).toContain(evil.status);
    });

    it("SSE /__events：无 token → 403；带 token → 200 text/event-stream 且收到 broadcast 帧", async () => {
      expect((await fetch(`${base}/__events`)).status).toBe(403);
      expect((await fetch(`${base}/__events`, { headers: { "x-lake-token": "wrong" } })).status).toBe(403);

      const ctrl = new AbortController();
      const res = await fetch(`${base}/__events`, { headers: { "x-lake-token": "test-token" }, signal: ctrl.signal });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let received = "";
      const framePromise = (async () => {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          received += decoder.decode(chunk.value, { stream: true });
          if (received.includes("event: sync-progress")) break;
        }
        return received;
      })().catch(() => received);
      await new Promise((r) => setTimeout(r, 50)); // 等连接注册进 sseClients
      server.broadcast("sync-progress", { phase: "done", message: "ok" });
      await Promise.race([
        framePromise,
        new Promise((_, rej) => setTimeout(() => rej(new Error("sse timeout")), 2000)),
      ]);
      expect(received).toContain("event: sync-progress");
      expect(received).toContain(`"phase":"done"`);
      ctrl.abort();
    });
  });
});
