import { describe, expect, it } from "vitest";
import { imageThumbAllowFiles, imageThumbKey } from "./quickNoteImageThumb";

/** 按内核正文形态造一张 image 卡（data: + encodeURIComponent(JSON)）。 */
function card(value: Record<string, unknown>, name = "image"): string {
  const encoded = "data:" + encodeURIComponent(JSON.stringify(value));
  return `<p><card type="inline" name="${name}" value="${encoded}"></card></p>`;
}

const SRC = "http://127.0.0.1:19876/quick-notes/q1/1794_a.jpg";

describe("imageThumbAllowFiles（缩略 allowlist 解析）", () => {
  it("带正数 original 尺寸的 image 卡 → 收其 filename", () => {
    const body = card({ src: SRC, originWidth: 4032, originHeight: 3024 });
    expect(imageThumbAllowFiles(body)).toEqual(new Set(["1794_a.jpg"]));
  });

  it("有 origin 的卡带 token/w= 也按 filename 收", () => {
    const body = card({ src: SRC + "?token=t&w=512", originWidth: 4032, originHeight: 3024 });
    expect(imageThumbAllowFiles(body)).toEqual(new Set(["1794_a.jpg"]));
  });

  it("缺 original 的历史卡 → 不收（fail-safe：不加 w）", () => {
    expect(imageThumbAllowFiles(card({ src: SRC })).size).toBe(0);
    expect(imageThumbAllowFiles(card({ src: SRC, originWidth: 4032 })).size).toBe(0);
    expect(imageThumbAllowFiles(card({ src: SRC, originWidth: 0, originHeight: 0 })).size).toBe(0);
    expect(imageThumbAllowFiles(card({ src: SRC, originWidth: -1, originHeight: 10 })).size).toBe(0);
  });

  it("坏 JSON / 非 data: 值 → 跳过不抛", () => {
    expect(imageThumbAllowFiles('<p><card name="image" value="data:%7Bnot-json"></card></p>')).toEqual(new Set());
    expect(imageThumbAllowFiles('<p><card name="image" value="https://example.test/a.png"></card></p>')).toEqual(new Set());
  });

  it("多张 image 卡全收；非 image 卡忽略", () => {
    const body = [
      card({ src: "http://127.0.0.1:19876/quick-notes/q1/a.png", originWidth: 10, originHeight: 10 }),
      card({ src: "http://127.0.0.1:19876/quick-notes/q1/b.webp", originWidth: 20, originHeight: 30 }),
      card({ src: "http://127.0.0.1:19876/quick-notes/q1/c.jpg", originWidth: 30, originHeight: 40 }, "file"),
      card({ src: "https://example.test/d.png", originWidth: 10, originHeight: 10 }),
    ].join("");
    expect(imageThumbAllowFiles(body)).toEqual(new Set(["a.png", "b.webp"]));
  });

  it("空正文 → 空集合", () => {
    expect(imageThumbAllowFiles("")).toEqual(new Set());
  });
});

describe("imageThumbKey", () => {
  it("本地资产 URL（含 token/w=）→ filename", () => {
    expect(imageThumbKey(SRC)).toBe("1794_a.jpg");
    expect(imageThumbKey(SRC + "?token=t&w=1024")).toBe("1794_a.jpg");
    expect(imageThumbKey("http://127.0.0.1:19876/quick-notes/staging/d1/x.png")).toBe("x.png");
  });

  it("非本地/data URL → null", () => {
    expect(imageThumbKey("https://example.test/a.png")).toBeNull();
    expect(imageThumbKey("data:image/png;base64,AAAA")).toBeNull();
    expect(imageThumbKey("")).toBeNull();
  });
});
