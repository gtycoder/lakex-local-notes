import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_ORIGIN, APP_SCHEME, DIST_MIME, isAppOriginUrl, resolveAppDistFile } from "./appOrigin.js";

/**
 * locallakexnotes://app 的静态解析（A1）：打包版渲染层不再跑 file://。
 * 这里只测纯逻辑（不依赖 electron）：映射、目录穿越、编码绕过、缺失与目录。
 */
describe("locallakexnotes://app 静态解析", () => {
  let dist: string;
  beforeAll(() => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), "lake-appdist-"));
    fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
    fs.writeFileSync(path.join(dist, "index.html"), "<html></html>");
    fs.writeFileSync(path.join(dist, "assets", "index-abc.js"), "export {};");
    fs.writeFileSync(path.join(dist, "assets", "i.woff2"), "x");
  });
  afterAll(() => { fs.rmSync(dist, { recursive: true, force: true }); });

  it("协议常量：scheme/host/origin 与 MIME 表可用", () => {
    expect(APP_SCHEME).toBe("locallakexnotes");
    expect(APP_ORIGIN).toBe("locallakexnotes://app");
    expect(DIST_MIME[".html"]).toContain("text/html");
    expect(DIST_MIME[".woff2"]).toBe("font/woff2");
  });

  it("页面来源判定不能依赖 URL.origin（Node 对非特殊 scheme 返回 \"null\"，Chromium 返回 locallakexnotes://app）", () => {
    expect(new URL("locallakexnotes://app/index.html").origin).toBe("null"); // 这条正是踩过的坑
    expect(isAppOriginUrl("locallakexnotes://app/index.html")).toBe(true);
    expect(isAppOriginUrl("locallakexnotes://app/")).toBe(true);
    expect(isAppOriginUrl("locallakexnotes://other/index.html")).toBe(false);
    expect(isAppOriginUrl("http://127.0.0.1:1421/")).toBe(false);
    expect(isAppOriginUrl("not a url")).toBe(false);
  });

  it("/ 与 /index.html 都落到 dist/index.html", () => {
    expect(resolveAppDistFile(dist, "/")).toEqual({ ok: true, filePath: path.join(dist, "index.html"), size: 13 });
    expect(resolveAppDistFile(dist, "/index.html").ok).toBe(true);
  });

  it("子路径资源可解析（构建产物的 assets/*）", () => {
    const r = resolveAppDistFile(dist, "/assets/index-abc.js");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.filePath).toBe(path.join(dist, "assets", "index-abc.js"));
  });

  it("目录穿越被拒（含 %2e%2e%2f 编码绕过）→ 403", () => {
    expect(resolveAppDistFile(dist, "/../secret.txt")).toEqual({ ok: false, status: 403 });
    expect(resolveAppDistFile(dist, "/assets/%2e%2e%2f%2e%2e%2fetc%2fpasswd")).toEqual({ ok: false, status: 403 });
    expect(resolveAppDistFile(dist, "/%E0%A4%A")).toEqual({ ok: false, status: 403 });
  });

  it("不存在 / 目录 → 404（不泄露是否存在）", () => {
    expect(resolveAppDistFile(dist, "/nope.js")).toEqual({ ok: false, status: 404 });
    expect(resolveAppDistFile(dist, "/assets")).toEqual({ ok: false, status: 404 });
  });
});
