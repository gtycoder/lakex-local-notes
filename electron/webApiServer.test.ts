import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDownloadRegistry, createWebServerController, injectNativeShim, renderNativeShim, startWebApiServer, WEB_METHODS, type WebApiServerOptions } from "./webApiServer.js";

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

  it("shim 包含全部方法 + assetPort + SSE 订阅，且**不含任何令牌**（SEC-07）", () => {
    const shim = renderNativeShim(19877);
    expect(shim).toContain(`assetPort: 19877`);
    // 静态 JS 里不再出现 token：API 凭据只在 HttpOnly cookie 里，请求用 credentials 自带
    expect(shim).not.toContain("x-lake-token");
    expect(shim).not.toContain("API_TOKEN");
    expect(shim).toContain(`credentials: "same-origin"`);
    expect(shim).toContain("assetToken: readCookie(ASSET_TOKEN_COOKIE)");
    // 生成的 JS 必须可解析（readCookie 里的正则转义最容易写坏）
    expect(() => new Function(shim)).not.toThrow();
    expect(shim).toContain("/^\\s+/");
    for (const method of Object.keys(WEB_METHODS)) {
      expect(shim).toContain(`"${method}":`);
    }
    expect(shim).toContain(`var EVENT_URL = "/__events"`);
    expect(shim).toContain(`onSyncProgress: function (cb) { return subscribe("sync-progress", cb); }`);
    expect(shim).toContain(`onPendingSummaryChanged: function (cb) { return subscribe("pending-summary-changed", cb); }`);
    expect(shim).toContain(`onLibraryChanged: function (cb) { return subscribe("library-changed", cb); }`);
    // AI 流式（261028）：ai:stream 加入 SSE 事件白名单，shim 提供 onAiStream
    expect(shim).toContain(`onAiStream: function (cb) { return subscribe("ai:stream", cb); }`);
    // 二进制入参（浏览器端插图/附件）：JSON 序列化把 TypedArray 转 number[]，主进程再归一
    expect(shim).toContain("ArrayBuffer.isView(value)");
    // 宿主能力矩阵（显式字段，见 src/lib/hostCapabilities.ts）+ 浏览器等价实现
    expect(shim).toContain("native.capabilities = { browserClient: true, localFileSystem: false, importExport: true, nativeDialog: false, windowControls: false, globalShortcuts: false }");
    expect(shim).toContain("native.saveAssetAs = function");
    expect(shim).toContain("native.openAttachment = function");
    expect(shim).toContain("native.copyAssetPath = function");
    // 导出等价物：shim 覆盖导出方法（走 /download 下载，不弹 Electron 对话框）
    for (const method of ["exportNote", "exportBitableCsv", "exportBitableZip", "exportTableCsv", "exportUsheetXlsx"]) {
      expect(shim).toContain(`native.${method} = function`);
    }
    expect(shim).toContain("native.pickExportDir = function () { return Promise.resolve(null); }");
    expect(shim).toContain("native.pickBackupDir = function () { return Promise.resolve(null); }");
    expect(shim).toContain('"/download?path="');
  });

  describe("HTTP 行为", () => {
    let server: ReturnType<typeof startWebApiServer>;
    let base: string;
    let distDir: string;
    /** 模拟浏览器顶层导航（地址栏 / shell.openExternal 打开）：Chrome 带 Sec-Fetch-* 且无 Origin。 */
    const navigationHeaders = { "sec-fetch-site": "none", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };

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

    it("无 Origin + 无 token 的 /api → 403（SEC-07：不再默认放行）", async () => {
      const noToken = await fetch(`${base}/api/echo`, { method: "POST", body: JSON.stringify({ args: [] }) });
      expect(noToken.status).toBe(403);
      const badToken = await fetch(`${base}/api/echo`, { method: "POST", headers: { "x-lake-token": "wrong" }, body: JSON.stringify({ args: [] }) });
      expect(badToken.status).toBe(403);
    });

    it("cookie 可调 /api；错误 cookie → 403", async () => {
      const ok = await fetch(`${base}/api/echo`, {
        method: "POST",
        headers: { cookie: "lake_web_token=test-token", "content-type": "application/json" },
        body: JSON.stringify({ args: ["via-cookie"] }),
      });
      expect(ok.status).toBe(200);
      expect((await ok.json() as { data: unknown[] }).data).toEqual(["via-cookie"]);

      const bad = await fetch(`${base}/api/echo`, {
        method: "POST",
        headers: { cookie: "lake_web_token=nope", "content-type": "application/json" },
        body: JSON.stringify({ args: [] }),
      });
      expect(bad.status).toBe(403);
    });

    it("query token 不再被接受（防泄漏 + 简单请求 CSRF）", async () => {
      const res = await fetch(`${base}/api/echo?token=test-token`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ args: ["x"] }),
      });
      expect(res.status).toBe(403);
    });

    it("跨站 Origin → 403（含 /__native.js）", async () => {
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

    it("Sec-Fetch-Site: none 不再放行（SEC-07 原缺口）", async () => {
      const shim = await fetch(`${base}/__native.js`, { headers: { "sec-fetch-site": "none" } });
      expect(shim.status).toBe(403);
      const api = await fetch(`${base}/api/echo`, {
        method: "POST",
        headers: { "sec-fetch-site": "none" },
        body: JSON.stringify({ args: [] }),
      });
      expect(api.status).toBe(403);
    });

    it("同源脚本加载 /__native.js → 200，且响应体不含任何令牌", async () => {
      const res = await fetch(`${base}/__native.js`, { headers: { "sec-fetch-site": "same-origin" } });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain(`credentials: "same-origin"`);
      // ① shim 不得下发 API token / 资产 token（本机非浏览器客户端拿到的只是空壳）
      expect(body).not.toContain("test-token");
      expect(body).not.toContain("test-asset-token");
      expect(body).not.toContain("x-lake-token");
    });

    it("浏览器导航打开文档 → Set-Cookie（HttpOnly + SameSite=Strict），随后 cookie 可调 /api", async () => {
      const page = await fetch(`${base}/`, { headers: navigationHeaders });
      expect(page.status).toBe(200);
      const cookies = page.headers.getSetCookie();
      const apiCookie = cookies.find((c) => c.startsWith("lake_web_token="));
      expect(apiCookie).toBeDefined();
      expect(apiCookie).toContain("HttpOnly");
      expect(apiCookie).toContain("SameSite=Strict");
      // 资产 token 另走一枚 cookie（页面要拼 URL，故不加 HttpOnly），与 IPC 凭据分离
      expect(cookies.some((c) => c.startsWith("lake_asset_token=test-asset-token"))).toBe(true);
      expect(await page.text()).toContain(`<script src="/__native.js"></script>`);

      const api = await fetch(`${base}/api/echo`, {
        method: "POST",
        headers: { cookie: apiCookie!.split(";")[0], "content-type": "application/json" },
        body: JSON.stringify({ args: ["via-cookie"] }),
      });
      expect(api.status).toBe(200);
      expect((await api.json() as { data: unknown[] }).data).toEqual(["via-cookie"]);
    });

    it("无 Sec-Fetch-* 的文档请求（curl 形态）→ 403 且不下发 Set-Cookie", async () => {
      const res = await fetch(`${base}/`);
      expect(res.status).toBe(403);
      expect(res.headers.getSetCookie()).toEqual([]);
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

    it("index.html 被注入 shim；同源静态资源可取；路径穿越被拒", async () => {
      const page = await fetch(`${base}/`, { headers: navigationHeaders });
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain(`<script src="/__native.js"></script>`);

      const asset = await fetch(`${base}/assets/a.js`, { headers: { "sec-fetch-site": "same-origin" } });
      expect(asset.status).toBe(200);
      expect(await asset.text()).toBe("console.log(1)");

      const evil = await fetch(`${base}/../secret.txt`, { headers: { "sec-fetch-site": "same-origin" } });
      expect([403, 404]).toContain(evil.status);
    });

    it("SSE /__events：无凭据 → 403；cookie 凭据 → 200 text/event-stream 且收到 broadcast 帧（header 仍兼容）", async () => {
      expect((await fetch(`${base}/__events`)).status).toBe(403);
      expect((await fetch(`${base}/__events`, { headers: { "x-lake-token": "wrong" } })).status).toBe(403);
      // 原 header token 保留（CLI/测试兼容）
      const viaHeader = await fetch(`${base}/__events`, { headers: { "x-lake-token": "test-token" } });
      expect(viaHeader.status).toBe(200);
      await viaHeader.body?.cancel().catch(() => undefined);

      const ctrl = new AbortController();
      const res = await fetch(`${base}/__events`, { headers: { cookie: "lake_web_token=test-token" }, signal: ctrl.signal });
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

describe("IPC 注册表 ↔ WEB_METHODS 一致性（A2）", () => {
  it("WEB_METHODS 的每个通道都真实注册过，否则浏览器端 404 而桌面端照常可用", () => {
    const ipcDir = path.join(__dirname, "ipc");
    const sources = [
      ...fs.readdirSync(ipcDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => path.join(ipcDir, f)),
      path.join(__dirname, "main.ts"),
    ].map((f) => fs.readFileSync(f, "utf8")).join("\n");
    const registered = new Set<string>();
    const re = /ipc\.(?:handle|handleEvent)\(\s*"([a-z0-9_]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sources))) registered.add(m[1]);
    // 反向断言，避免匹配失败时静默通过（正则改坏了应该红，而不是"没有 missing"）
    expect(registered.size).toBeGreaterThan(50);
    const missing = Object.values(WEB_METHODS).filter((channel) => !registered.has(channel));
    expect(missing).toEqual([]);
  });
});

describe("浏览器端服务启动失败必须给出原因（A3）", () => {
  it("端口被占用时 setEnabled(true) 抛出可读错误，而不是静默返回 enabled:false", async () => {
    const blocker = http.createServer(() => {});
    const port = await new Promise<number>((resolve) => {
      blocker.listen(0, "127.0.0.1", () => {
        const addr = blocker.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-web-a3-"));
    try {
      const ctrl = createWebServerController(makeOptions(distDir, { port }));
      await expect(ctrl.setEnabled(true)).rejects.toThrow(/已被占用/);
      expect(ctrl.getStatus().enabled).toBe(false);
    } finally {
      fs.rmSync(distDir, { recursive: true, force: true });
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});

describe("浏览器下载路由（导出等价物）", () => {
  let server: ReturnType<typeof startWebApiServer>;
  let base: string;
  let distDir: string;
  let exportRoot: string;
  let nextExportPath: string;
  const fileHeaders = { cookie: "lake_web_token=test-token" };

  beforeAll(async () => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-web-dl-"));
    exportRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lake-export-"));
    // 单文件产物（HTML）与目录产物（Markdown 资料包：正文 + images）各一份
    fs.mkdirSync(path.join(exportRoot, "标题"), { recursive: true });
    fs.writeFileSync(path.join(exportRoot, "标题", "index.html"), "<html>导出</html>");
    fs.mkdirSync(path.join(exportRoot, "资料包", "images"), { recursive: true });
    fs.writeFileSync(path.join(exportRoot, "资料包", "index.md"), "# 正文");
    fs.writeFileSync(path.join(exportRoot, "资料包", "images", "a.png"), "png-bytes");
    nextExportPath = path.join(exportRoot, "标题", "index.html");
    const registry = new Map<string, (args: unknown[]) => Promise<unknown>>([
      // 真实主进程的 export_note handler 返回 { exportPath, ... }
      ["export_note", async () => ({ format: "html", exportPath: nextExportPath, imageCount: 1, skipped: 0, size: 12 })],
    ]);
    server = startWebApiServer(makeOptions(distDir, { port: 0, registry }));
    base = `http://127.0.0.1:${await listen(server)}`;
  });

  afterAll(() => {
    server.close();
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.rmSync(exportRoot, { recursive: true, force: true });
  });

  /** 走 /api 导出 → 拿 download 相对路径（模拟浏览器 shim）。 */
  async function offerDownload(exportPath: string): Promise<{ path: string; name: string }> {
    nextExportPath = exportPath;
    const res = await fetch(`${base}/api/export_note`, {
      method: "POST",
      headers: { ...fileHeaders, "content-type": "application/json" },
      body: JSON.stringify({ args: ["note-1"] }),
    });
    const payload = await res.json() as { ok: boolean; data: { download: { path: string; name: string } } };
    expect(payload.ok).toBe(true);
    return payload.data.download;
  }

  it("导出结果带白名单相对路径；GET /download 下发 Content-Disposition: attachment", async () => {
    const offer = await offerDownload(path.join(exportRoot, "标题", "index.html"));
    // 相对路径：不含宿主机绝对路径
    expect(offer.path).not.toContain(exportRoot);
    // HTML 资料包产物是 <标题>/index.html ⇒ 下载名用标题（不是 index.html）
    expect(offer.name).toBe("标题.html");

    const res = await fetch(`${base}/download?path=${encodeURIComponent(offer.path)}`, { headers: fileHeaders });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain(`filename*=UTF-8''${encodeURIComponent("标题.html")}`);
    expect(await res.text()).toBe("<html>导出</html>");
  });

  it("下载路由要 cookie/header 凭据：无凭据/错 cookie → 403", async () => {
    const offer = await offerDownload(path.join(exportRoot, "标题", "index.html"));
    expect((await fetch(`${base}/download?path=${encodeURIComponent(offer.path)}`)).status).toBe(403);
    expect((await fetch(`${base}/download?path=${encodeURIComponent(offer.path)}`, { headers: { cookie: "lake_web_token=nope" } })).status).toBe(403);
    // header 凭据仍兼容（CLI/测试）
    const viaHeader = await fetch(`${base}/download?path=${encodeURIComponent(offer.path)}`, { headers: { "x-lake-token": "test-token" } });
    expect(viaHeader.status).toBe(200);
  });

  it("路径校验：白名单外的相对路径 / 绝对路径 / 穿越一律 404", async () => {
    await offerDownload(path.join(exportRoot, "标题", "index.html"));
    for (const evil of [`${exportRoot}/标题/index.html`, "../../etc/passwd", "/etc/passwd", "nope/index.html"]) {
      const res = await fetch(`${base}/download?path=${encodeURIComponent(evil)}`, { headers: fileHeaders });
      expect(res.status).toBe(404);
      expect((await res.json() as { code: string }).code).toBe("NOT_FOUND");
    }
  });

  it("目录产物（Markdown/HTML 资料包）打包成 zip 下发，正文与图片都在包里", async () => {
    const offer = await offerDownload(path.join(exportRoot, "资料包"));
    expect(offer.name).toBe("资料包.zip");
    const res = await fetch(`${base}/download?path=${encodeURIComponent(offer.path)}`, { headers: fileHeaders });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''%E8%B5%84%E6%96%99%E5%8C%85.zip");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    const raw = bytes.toString("latin1");
    expect(raw).toContain("index.md");
    expect(raw).toContain("images/a.png");
  });

  it("Content-Disposition 的 name 参数被清洗（不出现 CRLF 头注入）", async () => {
    const offer = await offerDownload(path.join(exportRoot, "标题", "index.html"));
    const res = await fetch(`${base}/download?path=${encodeURIComponent(offer.path)}&name=${encodeURIComponent('a"b\r\nX-Evil: 1.txt')}`, { headers: fileHeaders });
    expect(res.status).toBe(200);
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).not.toContain("\r");
    expect(disposition).not.toContain("\n");
    expect(res.headers.get("x-evil")).toBeNull();
    await res.arrayBuffer();
  });

  it("符号链接逃出登记根目录 → 404（realpath 校验）", async () => {
    const outside = path.join(exportRoot, "..", `lake-dl-outside-${process.pid}.txt`);
    fs.writeFileSync(outside, "secret");
    const linkPath = path.join(exportRoot, "escape.html");
    try {
      fs.symlinkSync(outside, linkPath);
    } catch {
      fs.rmSync(outside, { force: true });
      return; // 平台不支持符号链接（Windows 无权限）时跳过
    }
    try {
      const offer = await offerDownload(linkPath);
      const res = await fetch(`${base}/download?path=${encodeURIComponent(offer.path)}`, { headers: fileHeaders });
      expect(res.status).toBe(404);
      await res.arrayBuffer();
    } finally {
      fs.rmSync(linkPath, { force: true });
      fs.rmSync(outside, { force: true });
    }
  });
});

describe("shim 浏览器导出等价物（走 /download）", () => {
  it("exportNote 先 POST /api/export_note，再按返回的 download 触发 /download 下载", async () => {
    const shim = renderNativeShim(19877);
    const apiCalls: string[] = [];
    const anchors: Array<{ href: string; download: string; clicked: boolean }> = [];
    const fakeDocument = {
      cookie: "",
      body: { appendChild: () => {} },
      createElement: () => {
        const el = {
          href: "",
          download: "",
          style: {} as Record<string, string>,
          clicked: false,
          click() { el.clicked = true; },
          remove() {},
        };
        anchors.push(el);
        return el;
      },
    };
    const fakeFetch = async (url: string) => {
      apiCalls.push(url);
      return {
        json: async () => ({
          ok: true,
          data: { exportPath: "/host/export/x.html", download: { path: "1/x.html", name: "x.html" } },
        }),
      };
    };
    const fakeWindow: { lakeNative?: Record<string, (...args: unknown[]) => Promise<unknown>> & { capabilities?: Record<string, boolean> } } = {};
    new Function("window", "document", "fetch", shim)(fakeWindow, fakeDocument, fakeFetch);
    const result = await fakeWindow.lakeNative!.exportNote("n1", "html") as { exportPath: string };
    expect(apiCalls).toEqual(["/api/export_note"]);
    expect(result.exportPath).toBe("/host/export/x.html");
    // 浏览器下载：<a download> 指向 /download（Content-Disposition 由主进程给）
    expect(anchors).toHaveLength(1);
    expect(anchors[0].href).toBe("/download?path=1%2Fx.html&name=x.html");
    expect(anchors[0].download).toBe("x.html");
    expect(anchors[0].clicked).toBe(true);
    // 系统目录选择框在浏览器端返回 null（不弹 Electron 对话框）
    await expect(fakeWindow.lakeNative!.pickExportDir()).resolves.toBeNull();
    await expect(fakeWindow.lakeNative!.pickBackupDir()).resolves.toBeNull();
  });
});

describe("下载白名单（createDownloadRegistry）", () => {
  it("offer → lookup 命中；过期后失效；产物不存在时不登记", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-dl-reg-"));
    const file = path.join(dir, "a.csv");
    fs.writeFileSync(file, "x");
    try {
      const registry = createDownloadRegistry();
      const offer = registry.offer(file, 1000);
      expect(offer).not.toBeNull();
      expect(registry.lookup(offer!.path, 1000)?.name).toBe("a.csv");
      // 过期（TTL 10 分钟）
      expect(registry.lookup(offer!.path, 1000 + 10 * 60 * 1000)).toBeNull();
      expect(registry.offer(path.join(dir, "missing.csv"), 1000)).toBeNull();
      expect(registry.lookup("../../etc/passwd", 1000)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
