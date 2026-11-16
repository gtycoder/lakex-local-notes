import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

/**
 * 资源服务端口策略（261118 简化定稿：固定端口 + 测试/正式分开）。
 *
 * 用户裁决：不做端口回退、不做 URL 归一化那套复杂机制；正式 19876 / 开发 19877（Web 端 19880/19881）。
 * 固定端口的直接收益：同一构建形态下正文里的资产 URL 永远指向同一端口 ⇒ 换实例/重启不改
 * contentHash ⇒ 不会触发同步更新；代价 = 同形态双开时第二个实例资源服务监听失败（明确报错，不静默降级）。
 */
const { startAssetServer, currentAssetServerPort } = await import("./assetServer.js");

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

async function occupy(port: number): Promise<void> {
  const server = http.createServer((_req, res) => { res.writeHead(200); res.end("occupied"); });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
}

async function startAt(port: number, token = "tok") {
  const dirs = makeDirs();
  const server = await startAssetServer(dirs.noteAssets, dirs.vendor, dirs.quick, token, { preferredPort: port, log: logger });
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { dirs, server };
}

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = "";
  logs.length = 0;
});

describe("固定端口（261118 简化）", () => {
  it("在指定端口监听并可服务文件；currentAssetServerPort() 同步", async () => {
    await startAt(BASE_PORT);
    expect(currentAssetServerPort()).toBe(BASE_PORT);
    expect(logs.some((line) => line.startsWith("I [asset-server] listening") && line.includes(":" + BASE_PORT))).toBe(true);
    const res = await fetch("http://127.0.0.1:" + BASE_PORT + "/n1/a.png?token=tok");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("png");
  });

  it("端口被占用 ⇒ 直接 reject + 可读 error（不回退到 +1）", async () => {
    await occupy(BASE_PORT + 1);
    const dirs = makeDirs();
    await expect(startAssetServer(dirs.noteAssets, dirs.vendor, dirs.quick, "tok", { preferredPort: BASE_PORT + 1, log: logger })).rejects.toBeTruthy();
    expect(logs.some((line) => line.startsWith("E [asset-server] 端口 " + (BASE_PORT + 1) + " 监听失败") && line.includes("已被占用"))).toBe(true);
    // 没有回退：+2 不应被本测试覆盖（占住 +1 后直接报错，+2 仍空闲）
    await expect(fetch("http://127.0.0.1:" + (BASE_PORT + 2) + "/n1/a.png?token=tok")).rejects.toBeTruthy();
  });

  it("占用失败后 currentAssetServerPort() 仍是固定端口（降级时 URL 不退回别的端口）", async () => {
    await occupy(BASE_PORT + 3);
    const dirs = makeDirs();
    await expect(startAssetServer(dirs.noteAssets, dirs.vendor, dirs.quick, "tok", { preferredPort: BASE_PORT + 3, log: logger })).rejects.toBeTruthy();
    expect(currentAssetServerPort()).toBe(BASE_PORT + 3);
  });

  it("非法端口 ⇒ reject + error 日志", async () => {
    const dirs = makeDirs();
    await expect(startAssetServer(dirs.noteAssets, dirs.vendor, dirs.quick, "tok", { preferredPort: 99_999, log: logger })).rejects.toBeTruthy();
    expect(logs.some((line) => line.startsWith("E [asset-server]"))).toBe(true);
  });

  it("403 对已允许 origin 回显 ACAO（浏览器能报真因），未知 origin 不回显", async () => {
    await startAt(BASE_PORT + 5);
    const allowed = await fetch("http://127.0.0.1:" + (BASE_PORT + 5) + "/n1/a.png?token=wrong", { headers: { Origin: "http://127.0.0.1:1421" } });
    expect(allowed.status).toBe(403);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:1421");
    const unknown = await fetch("http://127.0.0.1:" + (BASE_PORT + 5) + "/n1/a.png?token=wrong", { headers: { Origin: "http://evil.example" } });
    expect(unknown.status).toBe(403);
    expect(unknown.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("端口配置接线（main / preload / 下游 URL 构造）", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

  it("main：正式 19876 / 开发 19877，Web 19880/19881；写回 env；无回退逻辑", () => {
    const main = read("electron/main.ts");
    expect(main).toContain("Number(process.env.LAKE_ASSET_PORT) || (app.isPackaged ? 19876 : 19877)");
    expect(main).toContain("Number(process.env.LAKE_WEB_PORT) || (app.isPackaged ? 19880 : 19881)");
    // env 必须在启动监听之前写回（即使失败/降级，渲染层构造的也是本形态固定端口）
    expect(main.indexOf("process.env.LAKE_ASSET_PORT = String(preferredAssetPort)")).toBeLessThan(main.indexOf("await startAssetServer("));
    expect(main).not.toContain("ASSET_PORT_FALLBACK_RANGE");
    expect(main).not.toContain("+1..+10");
  });

  it("preload：直接从 env 读固定端口（不再靠 additionalArguments）", () => {
    const preload = read("electron/preload.cjs");
    expect(preload).toContain("process.env.LAKE_ASSET_PORT");
    expect(preload).not.toContain("--lake-asset-port");
  });

  it("下游 URL 构造读取 currentAssetServerPort()（store/导出/小记），不硬编码 19876", () => {
    const store = read("electron/store.ts");
    const exportSrc = read("electron/noteExport.ts");
    // 模块级端口在 listen 之前就固定，失败时也不退回默认常量
    const assetServer = read("electron/assetServer.ts");
    expect(assetServer.indexOf("ASSET_PORT = preferredPort")).toBeLessThan(assetServer.indexOf("await listenFixed("));
    expect(store).toContain("currentAssetServerPort()");
    expect(exportSrc).toContain("currentAssetServerPort()");
  });
});
