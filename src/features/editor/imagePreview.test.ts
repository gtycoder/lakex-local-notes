import { describe, expect, it, vi } from "vitest";
import { closeImagePreview, extractImagesFromContent, navigateImagePreview, openImagePreview, previewImageKey, subscribeImagePreview } from "./imagePreview.js";

/** 内核产出的图片卡片形态：<card name="image" value="data:{encodeURIComponent(JSON)}">。 */
function imageCard(src: string): string {
  return '<card type="inline" name="image" value="data:' + encodeURIComponent(JSON.stringify({ src, name: "x", size: 1 })) + '"></card>';
}

describe("imagePreview controller", () => {
  it("opens with gallery and clamps out-of-range index", () => {
    const listener = vi.fn();
    const unsub = subscribeImagePreview(listener);
    openImagePreview([{ src: "a" }, { src: "b" }, { src: "c" }], 99);
    expect(listener).toHaveBeenLastCalledWith({ images: [{ src: "a" }, { src: "b" }, { src: "c" }], index: 2 });
    openImagePreview([{ src: "a" }], -5);
    expect(listener).toHaveBeenLastCalledWith({ images: [{ src: "a" }], index: 0 });
    unsub();
  });

  it("ignores empty input", () => {
    const listener = vi.fn();
    subscribeImagePreview(listener);
    openImagePreview([], 0);
    expect(listener).not.toHaveBeenCalled();
    closeImagePreview();
    expect(listener).toHaveBeenLastCalledWith(null);
  });

  it("navigates within bounds without wrapping", () => {
    const listener = vi.fn();
    subscribeImagePreview(listener);
    openImagePreview([{ src: "a" }, { src: "b" }], 0);
    navigateImagePreview(1);
    expect(listener).toHaveBeenLastCalledWith({ images: [{ src: "a" }, { src: "b" }], index: 1 });
    navigateImagePreview(1); // 越界不循环
    expect(listener).toHaveBeenLastCalledWith({ images: [{ src: "a" }, { src: "b" }], index: 1 });
    navigateImagePreview(-2); // 负向越界：拒绝跳转，索引不变
    expect(listener).toHaveBeenLastCalledWith({ images: [{ src: "a" }, { src: "b" }], index: 1 });
  });
});

describe("extractImagesFromContent（正文才是权威图片列表）", () => {
  it("按文档顺序取全部图片卡片（虚拟渲染下 DOM 不全，正文才全）", () => {
    const content = "<p>t</p>" + Array.from({ length: 10 }, (_, i) => imageCard("http://127.0.0.1:19876/n/" + i + ".png")).join("");
    const images = extractImagesFromContent(content);
    expect(images).toHaveLength(10);
    expect(images.map((i) => i.src)).toContain("http://127.0.0.1:19876/n/9.png");
    expect(images[0].src).toBe("http://127.0.0.1:19876/n/0.png");
  });

  it("同一张图出现两次不去重（预览张数不能少）；裸 <img> 也收", () => {
    const content = imageCard("http://x/a.png") + imageCard("http://x/a.png") + '<img src="http://x/b.png">';
    expect(extractImagesFromContent(content).map((i) => i.src)).toEqual(["http://x/a.png", "http://x/a.png", "http://x/b.png"]);
  });

  it("value 是裸 URL 的旧形态也能取；空正文 / 无图片返回空", () => {
    expect(extractImagesFromContent('<card name="image" value="http://x/c.png"></card>')).toEqual([{ src: "http://x/c.png" }]);
    expect(extractImagesFromContent("")).toEqual([]);
    expect(extractImagesFromContent("<p>没有图片</p>")).toEqual([]);
  });

  it("previewImageKey：本地资产只比磁盘名（正文无令牌、DOM 带令牌）", () => {
    expect(previewImageKey("http://127.0.0.1:19876/note1/1700000000000_ab12cd34.png?token=abc")).toBe("1700000000000_ab12cd34.png");
    expect(previewImageKey("https://example.com/a.png?x=1#h")).toBe("https://example.com/a.png");
  });
});
