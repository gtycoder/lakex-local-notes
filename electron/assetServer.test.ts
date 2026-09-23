/**
 * W-8：资源服务器安全边界集成测试（纯 Node http，无需 Electron）。
 * 覆盖：token 门禁、CORS Origin 过滤与 ACAO 回显（不用 "*"）、路径穿越、
 * quick-notes 前缀隔离、畸形编码兜底、base64 转换与 50MP 上限、按需缩略图（?w=）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import sharp from "sharp";

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
  // 缩略图素材：必须是 sharp 真能解码的图片（"png-bytes" 那种假字节解不了码，只能用来测直通）
  await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .png().toFile(path.join(noteAssetsDir, "note1", "big.png"));
  await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 30, g: 30, b: 200 } } })
    .png().toFile(path.join(noteAssetsDir, "note1", "swap.png"));
  // 扩展名不在可缩放白名单里（GIF 多帧）→ 内容无所谓，断言的是「直通不发虚」
  fs.writeFileSync(path.join(noteAssetsDir, "note1", "anim.gif"), Buffer.from("GIF89a-fake-bytes"));
  // 扩展名在白名单里但字节解不了码 → 必须落回原图，绝不能让图片显示不出来
  fs.writeFileSync(path.join(noteAssetsDir, "note1", "broken.png"), Buffer.from("not-really-a-png"));
  // 260923 A3：安全响应头素材（SVG 特别处理；其余类型只发 nosniff）
  fs.writeFileSync(path.join(noteAssetsDir, "note1", "evil.svg"), "<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>");
  fs.writeFileSync(path.join(noteAssetsDir, "note1", "doc.pdf"), Buffer.from("%PDF-1.4"));
  fs.writeFileSync(path.join(noteAssetsDir, "note1", "anim.mp4"), Buffer.from("mp4"));
  fs.writeFileSync(path.join(noteAssetsDir, "note1", "arch.zip"), Buffer.from("zip"));
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

describe("ACAO 回显（W-8：不再使用 \"*\"）", () => {
  it("dev origin (1421) + token → ACAO 回显该 Origin", async () => {
    const res = await fetch(`${BASE}/note1/img.png?token=${TOKEN}`, { headers: { Origin: "http://127.0.0.1:1421" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:1421");
    expect(res.headers.get("vary")).toContain("Origin");
  });

  it("Web 客户端 origin (19880) + token → ACAO 回显该 Origin", async () => {
    const res = await fetch(`${BASE}/note1/img.png?token=${TOKEN}`, { headers: { Origin: "http://127.0.0.1:19880" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:19880");
  });

  it("非 CORS 请求（无 Origin）不发 ACAO 头", async () => {
    const res = await fetch(`${BASE}/note1/img.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("Origin: null（生产 file:// 页）+ token → 200 且 ACAO 回显 null 字面值", async () => {
    const res = await fetch(`${BASE}/note1/img.png?token=${TOKEN}`, { headers: { Origin: "null" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("null");
  });

  it("vendor/cdn 免 token（内核资源加载），白名单 Origin 回显 ACAO", async () => {
    const res = await fetch(`${BASE}/vendor/cdn/os/lib/x.js`, { headers: { Origin: "http://127.0.0.1:1421" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:1421");
  });

  it("vendor/cdn 无 Origin → 不发 ACAO", async () => {
    const res = await fetch(`${BASE}/vendor/cdn/os/lib/x.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
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

describe("按需缩略图（?w=）", () => {
  const getBytes = async (url: string): Promise<{ res: Response; buf: Buffer }> => {
    const res = await fetch(url);
    return { res, buf: Buffer.from(await res.arrayBuffer()) };
  };

  it("?w=128 → 真缩到 128 宽，字节数远小于原图，并带 immutable 缓存头", async () => {
    const original = await getBytes(`${BASE}/note1/big.png`);
    const { res, buf } = await getBytes(`${BASE}/note1/big.png?w=128`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect((await sharp(buf).metadata()).width).toBe(128);
    expect(buf.length).toBeLessThan(original.buf.length);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("请求宽度超过原图（withoutEnlargement）→ 不放大，仍是原尺寸", async () => {
    const { buf } = await getBytes(`${BASE}/note1/big.png?w=1024`);
    expect((await sharp(buf).metadata()).width).toBe(400);
  });

  it("非档位值当没传（防连续值把缓存打散）→ 原字节直通", async () => {
    const original = await getBytes(`${BASE}/note1/big.png`);
    const { res, buf } = await getBytes(`${BASE}/note1/big.png?w=100`);
    expect(res.status).toBe(200);
    expect(buf.equals(original.buf)).toBe(true);
  });

  it("GIF 不缩放（resize 会把多帧动画压成首帧）→ 原字节直通", async () => {
    const original = await getBytes(`${BASE}/note1/anim.gif`);
    const { buf } = await getBytes(`${BASE}/note1/anim.gif?w=128`);
    expect(buf.equals(original.buf)).toBe(true);
  });

  it("字节解不了码 → 落回原图（缩略图是纯优化，不能让它把图弄没）", async () => {
    const original = await getBytes(`${BASE}/note1/broken.png`);
    const { res, buf } = await getBytes(`${BASE}/note1/broken.png?w=128`);
    expect(res.status).toBe(200);
    expect(buf.equals(original.buf)).toBe(true);
  });

  it("同一档位重复请求结果一致（走缓存）", async () => {
    const first = await getBytes(`${BASE}/note1/big.png?w=256`);
    const second = await getBytes(`${BASE}/note1/big.png?w=256`);
    expect(second.buf.equals(first.buf)).toBe(true);
  });

  it("换掉文件内容后，同一档位拿到新图的缩略图（缓存键含 mtime+size）", async () => {
    const before = await getBytes(`${BASE}/note1/swap.png?w=128`);
    expect((await sharp(before.buf).metadata()).width).toBe(128);
    // 换成绿色小图（尺寸不同 ⇒ size/mtime 变 ⇒ 缓存键变）
    await sharp({ create: { width: 90, height: 60, channels: 3, background: { r: 30, g: 200, b: 30 } } })
      .png().toFile(path.join(noteAssetsDir, "note1", "swap.png"));
    const after = await getBytes(`${BASE}/note1/swap.png?w=128`);
    const meta = await sharp(after.buf).metadata();
    expect(meta.width).toBe(90);
    expect(after.buf.equals(before.buf)).toBe(false);
  });
});

describe("安全响应头（260923 A3：nosniff + SVG CSP）", () => {
  it("SVG：image/svg+xml + nosniff + CSP(sandbox; img-src data:) + inline", async () => {
    const res = await fetch(`${BASE}/note1/evil.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    // 与 scripts/verify-svg-csp.mjs 浏览器实测的字符串逐字节一致（保证实证可迁移）
    expect(res.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'");
    expect(res.headers.get("content-disposition")).toBe("inline");
  });

  it("图/文档/媒体/压缩包：仅 nosniff，不带 CSP（不影响正常加载）", async () => {
    for (const [file, mime] of [["img.png", "image/png"], ["doc.pdf", "application/pdf"], ["anim.mp4", "video/mp4"], ["arch.zip", "application/zip"]]) {
      const res = await fetch(`${BASE}/note1/${file}`);
      expect(res.status, file).toBe(200);
      expect(res.headers.get("content-type"), file).toBe(mime);
      expect(res.headers.get("x-content-type-options"), file).toBe("nosniff");
      expect(res.headers.get("content-security-policy"), file).toBeNull();
    }
  });

  it("base64 直通返回 text/plain：只加 nosniff，不套 SVG CSP", async () => {
    const res = await fetch(`${BASE}/note1/evil.svg?base64=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBeNull();
  });
});
