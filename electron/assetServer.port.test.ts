import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

/**
 * 资源服务端口策略（261117 生产 bug 回归）。
 *
 * 现场：dev 实例占着 19876，打包版 listen 19876 失败后**静默继续**，渲染层图片继续请求 19876
 * ⇒ 命中 dev 的 assetServer ⇒ 该进程 token 与打包版注入的不匹配 ⇒ 403（且无 ACAO）
 * ⇒ Chromium 报 CORS「图片加载失败」。这里逐条钉住修复：
 * 1. 首选端口被占用 ⇒ 自动 +1..+10 回退，currentAssetServerPort() 反映真实端口，且**真能服务文件**；
 * 2. 非 EADDRINUSE 的监听错误**不吞**（抛出 + error 日志，由 main 记 error 并降级）；
 * 3. 早期 403 对**已允许 origin** 回显 ACAO（浏览器能给出可读错误），对未知 origin 不回显；
 * 4. 双实例同时跑：B 回退到 A 的端口 +1，各自 token 只在自己端口生效；
 * 5. main/preload 的端口接线（单测跑不到 Electron 运行时，用源码断言兜住）。
 *
 * 用高位端口，避开开发机上的 19876/19877 与既有测试文件的 19976。
 */

const { startAssetServer, currentAssetServerPort, ASSET_PORT_FALLBACK_RANGE } = await import("./assetServer.js");

const BASE_PORT = 20_001;
const logs: string[] = [];
const logger = {
  info: (message: string) => logs.push("I " + message),
  warn: (message: string) => logs.push("W " + message),
  error: (message: string) => logs.push("E " + message),
};

let tmpRoot = "";
const closers: Array<() => Promise<void>> = [];

function makeDirs(): { noteAssets: string; vendor: string; quick: string } {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lake-asset-port-"));
  const assetsRoot = path.join(tmpRoot, "note-assets");
  fs.mkdirSync(path.join(assetsRoot, "n1"), { recursive: true });
  fs.writeFileSync(path.join(assetsRoot, "n1", "a.png"), Buffer.from("png"));
  const vendor = path.join(tmpRoot, "vendor-cdn");
  const quick = path.join(tmpRoot, "quick-notes");
  fs.mkdirSync(vendor, { recursive: true });
  fs.mkdirSync(quick, { recursive: true });
  return { noteAssets: assetsRoot, vendor, quick };
}

/** 占住一个端口（模拟「另一个实例已经在跑」）。 */
async function occupy(port: number): Promise<void> {
  const server = http.createServer((_req, res) => { res.writeHead(200); res.end("occupied-by-other-instance"); });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
}

async function startAt(preferredPort: number, token = "tok") {
  const dirs = makeDirs();
  const server = await startAssetServer(dirs.noteAssets, dirs.vendor, dirs.quick, token, { preferredPort, log: logger });
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { dirs, server };
}

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = "";
  logs.length = 0;
});

describe("端口首选 + 回退（261117 生产 bug）", () => {
  it("首选端口空闲 ⇒ 就用它，currentAssetServerPort() 同步", async () => {
    await startAt(BASE_PORT);
    expect(currentAssetServerPort()).toBe(BASE_PORT);
    expect(logs.some((line) => line.startsWith("I [asset-server] listening") && line.includes(":" + BASE_PORT))).toBe(true);
    expect(logs.some((line) => line.includes("已回退"))).toBe(false);
  });

  it("首选端口被占用 ⇒ 自动 +1 回退并**真的能服务文件**（不再静默失败）", async () => {
    await occupy(BASE_PORT + 1);
    await startAt(BASE_PORT + 1);
    expect(currentAssetServerPort()).toBe(BASE_PORT + 2);
    expect(logs.some((line) => line.startsWith("W") && line.includes((BASE_PORT + 1) + " 已被占用"))).toBe(true);
    expect(logs.some((line) => line.includes("已回退"))).toBe(true);
    const res = await fetch("http://127.0.0.1:" + currentAssetServerPort() + "/n1/a.png?token=tok");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("png");
  });

  it("连续占用多个端口 ⇒ 逐个跳过去", async () => {
    await occupy(BASE_PORT + 10);
    await occupy(BASE_PORT + 11);
    await startAt(BASE_PORT + 10);
    expect(currentAssetServerPort()).toBe(BASE_PORT + 12);
  });

  it("非 EADDRINUSE 的监听错误**不吞**（非法端口 ⇒ reject + error 日志）", async () => {
    const dirs = makeDirs();
    await expect(startAssetServer(dirs.noteAssets, dirs.vendor, dirs.quick, "tok", {
      preferredPort: 99_999, // 超出合法端口范围 ⇒ ERR_SOCKET_BAD_PORT
      log: logger,
    })).rejects.toBeTruthy();
    expect(logs.some((line) => line.startsWith("E [asset-server] 监听失败")), "非端口占用错误必须记 error").toBe(true);
  });

  it("回退范围常量 = 10（+1..+10）", () => {
    expect(ASSET_PORT_FALLBACK_RANGE).toBe(10);
  });
});

describe("双实例同时跑（生产 bug 的忠实复现）", () => {
  it("A 占 P、B 首选 P ⇒ B 回退 P+1；各自 token 只在自己端口生效", async () => {
    const dirsA = makeDirs();
    const a = await startAssetServer(dirsA.noteAssets, dirsA.vendor, dirsA.quick, "token-A", { preferredPort: BASE_PORT + 40, log: logger });
    const portA = currentAssetServerPort();
    closers.push(() => new Promise<void>((resolve) => a.close(() => resolve())));

    const dirsB = makeDirs();
    const b = await startAssetServer(dirsB.noteAssets, dirsB.vendor, dirsB.quick, "token-B", { preferredPort: BASE_PORT + 40, log: logger });
    const portB = currentAssetServerPort();
    closers.push(() => new Promise<void>((resolve) => b.close(() => resolve())));

    expect(portA).toBe(BASE_PORT + 40);
    expect(portB).toBe(BASE_PORT + 41); // 不再「静默复用同一个端口」
    const okB = await fetch("http://127.0.0.1:" + portB + "/n1/a.png?token=token-B");
    expect(okB.status).toBe(200);
    // 事故形态：拿 B 的 token 打到 A 的端口 ⇒ 403（且现在带 ACAO，浏览器能报真因）
    const wrong = await fetch("http://127.0.0.1:" + portA + "/n1/a.png?token=token-B", { headers: { Origin: "http://127.0.0.1:1421" } });
    expect(wrong.status).toBe(403);
    expect(wrong.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:1421");
  });
});

describe("回退端口全链路生效（导出 HTML / 小记 URL 不能再用旧常量）", () => {
  it("回退到 P+1 后：noteExport 的资产正则与 quickNotes 的 URL 都用**实际**端口", async () => {
    await occupy(BASE_PORT + 60);
    await startAt(BASE_PORT + 60);
    const actual = currentAssetServerPort();
    expect(actual).toBe(BASE_PORT + 61);

    const { localAssetHtmlImgRe, localAssetMdImgRe } = await import("./noteExport.js");
    const htmlUrl = "http://127.0.0.1:" + actual + "/note-1/a.png";
    expect('<img src="' + htmlUrl + '">').toMatch(localAssetHtmlImgRe(currentAssetServerPort()));
    // 261118 端口无关（见 core/assetUrl.normalizeLocalAssetPorts）：正文一律按规范端口 19876 落盘，
    // 而导出跑在任意实例端口上（dev 19877 / 回退 19878…），所以正则必须认**任意本地端口**；
    // 取文件只用路径段（noteId/filename），与端口无关。下面两条同时钉住这一点。
    expect('<img src="http://127.0.0.1:19876/note-1/a.png">').toMatch(localAssetHtmlImgRe(currentAssetServerPort()));
    expect('<img src="http://127.0.0.1:' + (BASE_PORT + 60) + '/note-1/a.png">').toMatch(localAssetHtmlImgRe(currentAssetServerPort()));
    expect("![x](" + htmlUrl + ")").toMatch(localAssetMdImgRe(currentAssetServerPort()));
    expect("![x](http://127.0.0.1:19876/note-1/a.png)").toMatch(localAssetMdImgRe(currentAssetServerPort()));

    const { quickImageUrlOf, stagingImageUrlOf } = await import("./quickNotes/context.js");
    expect(quickImageUrlOf("n1", "q.png")).toBe("http://127.0.0.1:" + actual + "/quick-notes/n1/q.png");
    expect(stagingImageUrlOf("d1", "s.png")).toBe("http://127.0.0.1:" + actual + "/quick-notes/staging/d1/s.png");

    // 实际端口真的能取到该图（服务侧一致）
    const probe = await fetch("http://127.0.0.1:" + actual + "/n1/a.png?token=tok");
    expect(probe.status).toBe(200);
  });

  it("Web 客户端端口同样分开：packaged 19880 / dev 19881（两端 origin 都允许读资产）", async () => {
    await startAt(BASE_PORT + 70);
    const port = currentAssetServerPort();
    for (const origin of ["http://127.0.0.1:19880", "http://127.0.0.1:19881"]) {
      const res = await fetch("http://127.0.0.1:" + port + "/n1/a.png?token=wrong", { headers: { Origin: origin } });
      expect(res.status).toBe(403);
      expect(res.headers.get("access-control-allow-origin"), origin + " 必须被允许（否则各自端口的 Web 客户端读不到图）").toBe(origin);
    }
  });
});

describe("接线回归（main / preload 的端口来源）", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

  it("main：首选端口按构建形态分开；await 到实际端口后写回 env 并传给 preload（且都在建窗之前）", () => {
    const main = read("electron/main.ts");
    expect(main).toContain("Number(process.env.LAKE_ASSET_PORT) || (app.isPackaged ? 19876 : 19877)");
    // webApi 端口同样按构建形态分开（packaged 19880 / dev 19881）
    expect(main).toContain("Number(process.env.LAKE_WEB_PORT) || (app.isPackaged ? 19880 : 19881)");
    expect(main).toContain("configurePreferredWebApiPort(");
    expect(main).toContain("await startAssetServer(");
    expect(main).toContain("process.env.LAKE_ASSET_PORT = String(currentAssetServerPort())");
    expect(main).toContain("additionalArguments: [");
    expect(main).toContain("--lake-asset-port=");
    expect(main).toContain("assetPort: currentAssetServerPort()");
    const start = main.indexOf("await startAssetServer(");
    const writeBack = main.indexOf("process.env.LAKE_ASSET_PORT = String(currentAssetServerPort())");
    const createWindow = main.indexOf("createWindow();");
    expect(start).toBeGreaterThan(-1);
    expect(writeBack).toBeGreaterThan(start);
    // 顺序不变量：端口解析/env 写回必须在建主窗口之前（否则 preload 与渲染层拿到旧端口）
    expect(writeBack).toBeLessThan(createWindow);
  });

  it("preload：端口优先读 --lake-asset-port 开关（env 只兜底）", () => {
    const preload = read("electron/preload.cjs");
    expect(preload).toContain("--lake-asset-port=");
    expect(preload).toContain("assetPort: lakeAssetPort()");
  });
});

describe("403 早期响应带 ACAO（避免浏览器把它显示成 CORS 失败）", () => {
  const ALLOWED = "http://127.0.0.1:1421"; // dev server origin（isAllowedOrigin 白名单内）
  const EVIL = "https://evil.example";

  it("已允许 origin + token 不匹配 ⇒ 403 且回显 ACAO", async () => {
    await startAt(BASE_PORT + 30);
    const res = await fetch("http://127.0.0.1:" + currentAssetServerPort() + "/n1/a.png?token=wrong", {
      headers: { Origin: ALLOWED },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(await res.text()).toContain("forbidden: missing token");
  });

  it("未知 origin ⇒ 仍然 403 且**不回显** ACAO", async () => {
    await startAt(BASE_PORT + 30);
    const res = await fetch("http://127.0.0.1:" + currentAssetServerPort() + "/n1/a.png?token=wrong", {
      headers: { Origin: EVIL },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
