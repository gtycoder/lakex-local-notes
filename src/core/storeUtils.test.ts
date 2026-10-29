import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractAssetRefs, isSafePathSegment, sanitizeFileName, selectHistoryDrops } from "./storeUtils.js";
import { assertSafeSegment } from "./s3v3/protocol/s3v3Keys.js";
import { validateQuickNoteContent } from "./quickNoteModel.js";

describe("storeUtils", () => {
  it("extracts unique Lake asset references without matching unrelated filenames", () => {
    const content = [
      "1234567890123_deadbeef.png",
      "1234567890123_deadbeef.png",
      "1234567890123_deadbeef.webp",
      "not-a-lake-asset.png",
      "1234567890123_DEADBEEF.png",
    ].join(" ");
    expect([...extractAssetRefs(content)]).toEqual([
      "1234567890123_deadbeef.png",
      "1234567890123_deadbeef.webp",
    ]);
  });

  it("sanitizes filenames and keeps a non-empty fallback", () => {
    expect(sanitizeFileName(' a/b:c*?"d<>| ')).toBe("a_b_c___d___");
    expect(sanitizeFileName("  ")).toBe("未命名");
  });


  it("does not drop the only snapshot when timestamps repeat", () => {
    // CORE-10：nowMs 可注入 ⇒ 用例用固定时钟，结果不再依赖"跑测试的那一刻"。
    const nowMs = Date.parse("2026-03-01T00:00:00.000Z");
    const timestamp = new Date(nowMs - 2 * 24 * 3600 * 1000).toISOString();
    expect(selectHistoryDrops([timestamp, timestamp], { maxSnapshots: 10, retentionDays: 30 }, nowMs).has(timestamp)).toBe(false);
  });

  it("同一输入 + 同一 nowMs ⇒ 逐字节同结果（纯函数，CORE-10）", () => {
    const nowMs = Date.parse("2026-03-01T00:00:00.000Z");
    const list = [
      new Date(nowMs - 3 * 24 * 3600 * 1000).toISOString(),
      new Date(nowMs - 20 * 24 * 3600 * 1000).toISOString(),
      new Date(nowMs - 40 * 24 * 3600 * 1000).toISOString(),
    ];
    const config = { maxSnapshots: 2, retentionDays: 90 };
    const first = selectHistoryDrops(list, config, nowMs);
    expect(selectHistoryDrops(list, config, nowMs)).toEqual(first);
    expect([...first]).toEqual([...first].sort());
  });

  it("accepts a single safe path segment and rejects traversal separators", () => {
    expect(isSafePathSegment("note-123")).toBe(true);
    expect(isSafePathSegment(".")).toBe(false);
    expect(isSafePathSegment("..")).toBe(false);
    expect(isSafePathSegment("a/b")).toBe(false);
    expect(isSafePathSegment("a\\b")).toBe(false);
    expect(isSafePathSegment("")).toBe(false);
  });

  it("路径段边界矩阵：.. / 绝对路径 / 反斜杠 / 空 / 控制字符", () => {
    // 合法：id 与资产文件名形态、点号、Unicode、空格（基线判据只管「是不是一段」，
    // 字符集收紧由具体层负责，例如 S3 key 段另有白名单）。
    for (const ok of ["note-123", "1786123456789_abc12345.png", "a.b", "...", "笔记", "a b"]) {
      expect(isSafePathSegment(ok), ok).toBe(true);
    }
    // 非法：遍历、绝对路径、两种分隔符、空、控制字符（NUL/换行/Tab/DEL）
    for (const bad of ["", ".", "..", "../x", "/etc/passwd", "a/b", "a\\b", "C:\\tmp", "a\u0000b", "a\nb", "a\tb", "\u007f"]) {
      expect(isSafePathSegment(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("CORE-09 路径段判据单一来源", () => {
  const unsafeSegments = ["", ".", "..", "../x", "/etc/passwd", "a/b", "a\\b", "a\u0000b", "a\nb"];
  const image = {
    id: "img-1",
    filename: "1786123456789_abc12345.png",
    mimeType: "image/png",
    width: 16,
    height: 12,
    size: 4,
    hash: "a".repeat(64),
  };

  it("三处入口对同一批边界给出同一结论（布尔 / 抛错 / 远端内容校验）", () => {
    for (const seg of unsafeSegments) {
      expect(isSafePathSegment(seg), JSON.stringify(seg)).toBe(false);
      expect(() => assertSafeSegment(seg), JSON.stringify(seg)).toThrow("非法路径段");
      expect(
        () => validateQuickNoteContent({ version: 3, text: "x", body: "<p><br></p>", images: [{ ...image, id: seg }] }),
        JSON.stringify(seg),
      ).toThrow("小记资源元数据无效");
    }
    // 同一个合法段三处都放行
    expect(() => assertSafeSegment("note-123")).not.toThrow();
    expect(validateQuickNoteContent({ version: 3, text: "x", body: "<p><br></p>", images: [image] }).images[0].id).toBe(image.id);
  });

  it("S3 key 段比基线更严（另加字符集白名单）", () => {
    expect(() => assertSafeSegment("a b")).toThrow("非法路径段");   // 基线允许空格，v3 key 段不允许
    expect(() => assertSafeSegment("笔记")).toThrow("非法路径段");   // 基线允许 Unicode
    expect(() => assertSafeSegment("a.b_c-d")).not.toThrow();
  });

  it("结构护栏：另外两份实现只 import 基线判据，不再自带一份", () => {
    const quick = readFileSync(new URL("./quickNoteModel.ts", import.meta.url), "utf8");
    expect(quick).toMatch(/import \{ isSafePathSegment \} from "\.\/storeUtils\.js"/);
    expect(quick).toMatch(/function isSafeSegment\(value: string\): boolean \{\s*return isSafePathSegment\(value\);\s*\}/);
    const keys = readFileSync(new URL("./s3v3/protocol/s3v3Keys.ts", import.meta.url), "utf8");
    expect(keys).toMatch(/import \{ isSafePathSegment \} from "\.\.\/\.\.\/storeUtils\.js"/);
    expect(keys).toMatch(/!isSafePathSegment\(seg\)/);
  });
});