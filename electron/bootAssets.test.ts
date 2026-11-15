import { readFileSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * 启动页资源契约（261115，MODERN-WEB-AUDIT A08/A26/A27）。
 *
 * 背景：`electron/boot.html` 曾是 **476KB**（两张图以内联 data URI 写在 HTML 里）。
 * 现在图片是独立文件；这个测试把「不回到内联」「文件确实存在且是 PNG」「打包清单包含它们」
 * 「启动页声明 color-scheme」四件事钉住。
 */
const here = new URL(".", import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, here), "utf8");

const HTML = read("./boot.html");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("boot.html 资源", () => {
  it("不再内联 base64 图片；<= 8KB", () => {
    expect(HTML).not.toContain("data:image");
    expect(Buffer.byteLength(HTML, "utf8")).toBeLessThan(8 * 1024);
  });

  it("引用两份独立图片，且文件存在、是 PNG、尺寸合理", () => {
    expect(HTML).toContain('src="boot-anim.apng"');
    expect(HTML).toContain('src="boot-poster.png"');
    for (const rel of ["boot-anim.apng", "boot-poster.png"]) {
      const buf = readFileSync(new URL(rel, here));
      expect(buf.subarray(0, 8).equals(PNG_MAGIC), rel + " 必须是 PNG").toBe(true);
      expect(statSync(new URL(rel, here)).size).toBeGreaterThan(10 * 1024);
    }
  });

  it("打包清单包含启动页图片（electron-builder files）", () => {
    const pkg = JSON.parse(read("../package.json")) as { build?: { files?: string[] } };
    const files = pkg.build?.files ?? [];
    for (const rel of ["electron/boot.html", "electron/boot-anim.apng", "electron/boot-poster.png"]) {
      expect(files, rel + " 必须在 build.files 里，否则打包后启动页 404").toContain(rel);
    }
  });

  it("声明 color-scheme 并用 light-dark() 取色（深色系统不掉浅色）", () => {
    expect(HTML).toContain('name="color-scheme" content="light dark"');
    expect(HTML).toContain("color-scheme: light dark");
    expect(HTML).toContain("light-dark(");
    expect(HTML).toContain("prefers-reduced-motion");
  });

  it("装饰图 alt 为空（状态由 role=status 的文字播报）", () => {
    expect(HTML).toMatch(/<img class="boot__anim"[^>]*alt=""/);
    expect(HTML).toMatch(/<img class="boot__poster"[^>]*alt=""/);
  });
});
