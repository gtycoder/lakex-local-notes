// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 图片原图档位（用户裁决 Q02）：Lightbox 打开时**先显示调用方给的档位图**，原图预加载完成后替换。
 *
 * 为什么要这个行为：列表/卡片里的图片 URL 是资产服务的离散缩略（?w=1024，省内存）；
 * 如果放大时直接拿它，用户看到的是"糊的"——与 02 报告 D4 的用户可见后果一致。
 * 修法不是换 URL（会白屏/等待），而是：档位图上屏 → 隐藏 Image 预加载原图 → onload 替换。
 *
 * 本文件锁四件事：
 * 1. 打开即有图（档位图），不等待原图；
 * 2. 原图 onload 后替换为 originalSrc；
 * 3. 原图 onerror 保持档位图（不消失、不报错）；
 * 4. 切换画廊按 index 对齐（不会把上一张的原图错配到当前张）；只传 src 的旧调用行为不变。
 */
const images = vi.hoisted(() => ({ created: [] as FakeImage[] }));

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { images.created.push(this); }
  set src(_value: string) { /* 记录在实例上便于断言 */ }
}

import { ImageLightbox } from "./ImageLightbox";
import { closeImagePreview, navigateImagePreview, openImagePreview } from "./imagePreview";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Image", FakeImage as unknown as typeof Image);
  images.created = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => { root.render(createElement(ImageLightbox, null)); });
});

afterEach(() => {
  act(() => closeImagePreview());
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const shownSrc = () => document.querySelector(".image-lightbox img")?.getAttribute("src") ?? null;

describe("ImageLightbox：先档位图，原图就绪后替换（Q02）", () => {
  it("打开即显示档位图；原图 onload 后替换为 originalSrc", () => {
    act(() => openImagePreview([{ src: "display-1.png", originalSrc: "original-1.png" }], 0));
    expect(shownSrc()).toBe("display-1.png");
    expect(images.created).toHaveLength(1);

    act(() => images.created[0].onload?.());
    expect(shownSrc()).toBe("original-1.png");
  });

  it("原图加载失败：保持档位图（不消失、不抛错）", () => {
    act(() => openImagePreview([{ src: "display-2.png", originalSrc: "original-2.png" }], 0));
    act(() => images.created[0].onerror?.());
    expect(shownSrc()).toBe("display-2.png");
  });

  it("只传 src（旧调用点）：不预加载、不替换，行为完全不变", () => {
    act(() => openImagePreview([{ src: "plain.png" }], 0));
    expect(shownSrc()).toBe("plain.png");
    expect(images.created).toHaveLength(0);
  });

  it("切换画廊按 index 对齐：原图不会错配到另一张", () => {
    act(() => openImagePreview([
      { src: "display-a.png", originalSrc: "original-a.png" },
      { src: "display-b.png" },
    ], 0));
    act(() => images.created[0].onload?.());
    expect(shownSrc()).toBe("original-a.png");

    act(() => navigateImagePreview(1));
    expect(shownSrc()).toBe("display-b.png");

    act(() => navigateImagePreview(-1));
    // 第一张原图已就绪且在缓存里 ⇒ 回到它时直接用原图。
    expect(shownSrc()).toBe("original-a.png");
  });
});
