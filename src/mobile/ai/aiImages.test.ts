import { describe, expect, it } from "vitest";
import { AI_IMAGES_MAX, canAddImage, imagePartsOf, type AiPendingImage } from "./aiImages";

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

  it("超过上限只取前 10 张", () => {
    const images: AiPendingImage[] = Array.from({ length: 12 }, (_, i) => ({ id: String(i), kind: "temp", dataUrl: "data:image/jpeg;base64,AA", mimeType: "image/jpeg", bytes: 1 }));
    expect(imagePartsOf(images)).toHaveLength(AI_IMAGES_MAX);
  });
});
