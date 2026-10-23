import { describe, expect, it } from "vitest";
import { AI_IMAGES_MAX, appendPendingImages, canAddImage, imagePartsOf, type AiPendingImage } from "./aiImages";

describe("AI 图片附件（限额 + 内容块）", () => {
  it("上限 10 张", () => {
    expect(canAddImage(0)).toBeNull();
    expect(canAddImage(AI_IMAGES_MAX)).toContain("最多");
  });

  it("资源图 → 引用；临时图 → data URL", () => {
    const images: AiPendingImage[] = [
      { id: "a", kind: "asset", noteId: "n1", filename: "x.png", title: "文档" },
      { id: "b", kind: "temp", dataUrl: "data:image/jpeg;base64,AAA", mimeType: "image/jpeg", bytes: 3 },
    ];
    expect(imagePartsOf(images)).toEqual([
      { type: "image", asset: { noteId: "n1", filename: "x.png" } },
      { type: "image", dataUrl: "data:image/jpeg;base64,AAA" },
    ]);
  });

  it("合并时按剩余名额截断并报告跳过数", () => {
    const img = (i: number): AiPendingImage => ({ id: String(i), kind: "temp", dataUrl: "data:image/jpeg;base64,AA", mimeType: "image/jpeg", bytes: 1 });
    const first = appendPendingImages([], [img(1), img(2)]);
    expect(first.images).toHaveLength(2);
    expect(first.skipped).toBe(0);
    const second = appendPendingImages(first.images, Array.from({ length: 10 }, (_, i) => img(100 + i)));
    expect(second.images).toHaveLength(AI_IMAGES_MAX);
    expect(second.skipped).toBe(2);
  });

  it("超过上限只取前 10 张", () => {
    const images: AiPendingImage[] = Array.from({ length: 12 }, (_, i) => ({ id: String(i), kind: "temp", dataUrl: "data:image/jpeg;base64,AA", mimeType: "image/jpeg", bytes: 1 }));
    expect(imagePartsOf(images)).toHaveLength(AI_IMAGES_MAX);
  });
});
