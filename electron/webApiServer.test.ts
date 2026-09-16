import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
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

  it("shim 包含全部方法 + assetToken/assetPort + 事件 no-op", () => {
    const shim = renderNativeShim("tok", 19877);
    expect(shim).toContain(`assetPort: 19877`);
    expect(shim).toContain(`var TOKEN = "tok"`);
    for (const method of Object.keys(WEB_METHODS)) {
      expect(shim).toContain(`"${method}":`);
    }
    expect(shim).toContain("onSyncProgress");
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
  });
});
