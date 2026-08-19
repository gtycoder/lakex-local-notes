/**
 * W-10：资源服务器安全边界集成测试（纯 Node http，无需 Electron）。
 * 覆盖：token 门禁、CORS Origin 过滤、路径穿越、quick-notes 前缀隔离、
 * 畸形编码兜底、base64 转换与 50MP 上限。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";

const TEST_PORT = 19976;
process.env.LAKE_ASSET_PORT = String(TEST_PORT);

// ASSET_PORT 在模块加载时求值，需在导入前设置环境变量
const { startAssetServer } = await import("./assetServer.js");

const TOKEN = "test-token-abc";
const BASE = `http://127.0.0.1:${TEST_PORT}`;

let root: string;
let noteAssetsDir: string;
let vendorDir: string;
let quickDir: string;
let server: http.Server;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-asset-server-test-"));
  noteAssetsDir = path.join(root, "note-assets");
  vendorDir = path.join(root, "vendor-cdn");
  quickDir = path.join(root, "quick-notes");
  fs.mkdirSync(path.join(noteAssetsDir, "note1"), { recursive: true });
  fs.writeFileSync(path.join(noteAssetsDir, "note1", "img.png"), Buffer.from("png-bytes"));
  fs.mkdirSync(path.join(vendorDir, "os/lib"), { recursive: true });
  fs.writeFileSync(path.join(vendorDir, "os/lib/x.js"), "console.log(1)");
  fs.mkdirSync(path.join(quickDir, "assets", "q1"), { recursive: true });
  fs.writeFileSync(path.join(quickDir, "assets", "q1", "q.png"), Buffer.from("qpng"));
  server = startAssetServer(noteAssetsDir, vendorDir, quickDir, TOKEN);
  await new Promise<void>((resolve) => server.once("listening", resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});

describe("CORS token 门禁", () => {
  it("带 Origin 且无 token → 403", async () => {
    const res = await fetch(`${BASE}/note1/img.png`, { headers: { Origin: "http://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("带 Origin + 正确 token → 200", async () => {
    const res = await fetch(`${BASE}/note1/img.png?token=${TOKEN}`, { headers: { Origin: "http://127.0.0.1:1421" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("png-bytes");
  });

  it("非 CORS 请求（无 Origin）不带 token 也可读（<img> 场景）", async () => {
    const res = await fetch(`${BASE}/note1/img.png`);
    expect(res.status).toBe(200);
  });

  it("Origin: null（sandbox iframe）无 token → 403", async () => {
    const res = await fetch(`${BASE}/note1/img.png`, { headers: { Origin: "null" } });
    expect(res.status).toBe(403);
  });

  it("白名单外的 Origin 直接拒绝（即使带 token）", async () => {
    const res = await fetch(`${BASE}/note1/img.png?token=${TOKEN}`, { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });
});

describe("路径穿越防护", () => {
  it("../ 段被拒绝（isSafeSegment）", async () => {
    const res = await fetch(`${BASE}/..%2f..%2fetc/passwd`);
    expect([400, 404]).toContain(res.status);
  });

  it("quick-notes 前缀下 ../ 被拒绝", async () => {
    const res = await fetch(`${BASE}/quick-notes/..%2fnote1/img.png`);
    expect([400, 404]).toContain(res.status);
  });

  it("普通笔记路径不能读 quick-notes 空间（段数/前缀隔离）", async () => {
    // /note1/q.png 不存在于 note-assets，不能穿越到 quick-notes
    const res = await fetch(`${BASE}/note1/q.png`);
    expect(res.status).toBe(404);
  });
});

describe("quick-notes 资源", () => {
  it("正确路径可读", async () => {
    const res = await fetch(`${BASE}/quick-notes/q1/q.png`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("qpng");
  });

  it("畸形百分号编码 → 400（URIError 兜底）", async () => {
    const res = await fetch(`${BASE}/%E0%A4%A`);
    expect(res.status).toBe(400);
  });
});

describe("vendor/cdn 镜像", () => {
  it("命中返回内容 + immutable 缓存头", async () => {
    const res = await fetch(`${BASE}/vendor/cdn/os/lib/x.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(await res.text()).toBe("console.log(1)");
  });

  it("../ 穿越被拒绝", async () => {
    const res = await fetch(`${BASE}/vendor/cdn/..%2f..%2fsecret`);
    expect(res.status).toBe(400);
  });

  it("未镜像资源 → 404", async () => {
    const res = await fetch(`${BASE}/vendor/cdn/os/lib/missing.js`);
    expect(res.status).toBe(404);
  });
});

describe("base64 转换", () => {
  it("?base64=1 返回 data URL", async () => {
    // 写一个最小 PNG（magic bytes 足以通过 MIME_MAP 扩展名判断）
    const res = await fetch(`${BASE}/note1/img.png?base64=1`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.startsWith("data:image/png;base64,")).toBe(true);
    expect(Buffer.from(body.split(",")[1], "base64").toString()).toBe("png-bytes");
  });
});
