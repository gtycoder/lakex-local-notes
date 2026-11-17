// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mountMediaCardResize } from "./mediaCardResize";

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect;
}

function videoCard(widthPercent = 50) {
  const value: Record<string, unknown> = { status: "done", __videoWidth: widthPercent, __videoAlign: "left" };
  const card = document.createElement("ne-card");
  card.setAttribute("data-card-name", "video");
  card.setAttribute("id", "video-1");
  const done = document.createElement("div");
  done.className = "ne-card-video-done";
  card.appendChild(done);
  const cardData = {
    getCardValue: vi.fn(() => ({ ...value })),
    resetCardValue: vi.fn((next: Record<string, unknown>) => Object.assign(value, next)),
    sync: vi.fn(() => true),
  };
  Object.defineProperty(card, "_neRef", { value: { _virtualNode: { _instance: { cardData } } } });
  const host = document.createElement("div");
  const hole = document.createElement("ne-hole");
  vi.spyOn(hole, "getBoundingClientRect").mockReturnValue(rect(0, 0, 500, 500));
  hole.appendChild(card);
  host.appendChild(hole);
  Object.defineProperty(card, "parentElement", {
    configurable: true,
    value: { getBoundingClientRect: () => rect(0, 0, 500, 500) },
  });
  return { card, host, cardData, value };
}

function imageCard(width = 300) {
  const card = document.createElement("ne-card");
  card.setAttribute("data-card-name", "image");
  card.setAttribute("id", "image-1");
  const img = document.createElement("img");
  img.style.width = `${width}px`;
  vi.spyOn(img, "getBoundingClientRect").mockReturnValue(rect(0, 0, width, 150));
  card.appendChild(img);
  const editor = { execCommand: vi.fn(() => true) };
  Object.defineProperty(card, "_neRef", { value: { _virtualNode: { _instance: { editor } } } });
  const host = document.createElement("div");
  const hole = document.createElement("ne-hole");
  vi.spyOn(hole, "getBoundingClientRect").mockReturnValue(rect(0, 0, 500, 500));
  hole.appendChild(card);
  host.appendChild(hole);
  return { card, host, img, editor };
}

describe("图片/视频共用边缘缩放器", () => {
  it("视频保留左右双把手，键盘每次 5% 并持久化", () => {
    const { card, host, cardData } = videoCard(50);
    const dispose = mountMediaCardResize(host, true);
    const handles = card.querySelectorAll<HTMLElement>(".lake-media-resize-handle");
    expect(handles).toHaveLength(2);
    handles[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(card.getAttribute("data-video-width")).toBe("55");
    expect(cardData.sync).toHaveBeenCalledWith(false);
    dispose();
  });

  it("视频拖动只做合成层缩放预览，不逐帧重排播放器；松手一次写回", () => {
    const { card, host, cardData } = videoCard(50);
    const dispose = mountMediaCardResize(host, true);
    const handle = card.querySelector<HTMLElement>('.lake-media-resize-handle[data-side="right"]')!;
    handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 0 }));
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX: 10 }));
    expect(card.style.transform).toBe("scale(1.08)");
    expect(cardData.sync).not.toHaveBeenCalled();
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX: 10 }));
    expect(card.style.transform).toBe("");
    expect(card.getAttribute("data-video-width")).toBe("54");
    expect(cardData.sync).toHaveBeenCalledWith(false);
    dispose();
  });

  it("图片使用右侧单把手，键盘走 updateImageData", () => {
    const { card, host, editor } = imageCard(300);
    const dispose = mountMediaCardResize(host, true);
    const handles = card.querySelectorAll<HTMLElement>(".lake-media-resize-handle");
    expect(handles).toHaveLength(1);
    expect(handles[0].dataset.side).toBe("right");
    handles[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(editor.execCommand).toHaveBeenCalledWith("updateImageData", "image-1", { width: 310 });
    dispose();
  });

  it("图片拖动实时预览，松手才写入；取消恢复原样式", () => {
    const { card, host, img, editor } = imageCard(300);
    const original = img.getAttribute("style");
    const dispose = mountMediaCardResize(host, true);
    const handle = card.querySelector<HTMLElement>('.lake-media-resize-handle[data-side="right"]')!;
    handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 0 }));
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX: 20 }));
    expect(img.style.width).toBe("320px");
    expect(editor.execCommand).not.toHaveBeenCalled();
    window.dispatchEvent(new MouseEvent("pointercancel", { bubbles: true, cancelable: true }));
    expect(img.getAttribute("style")).toBe(original);
    expect(editor.execCommand).not.toHaveBeenCalled();
    dispose();
  });

  it("图片新增边缘把手不替换内核原生四角 resizer", () => {
    const { card, host } = imageCard(300);
    for (const corner of ["tl", "tr", "br", "bl"]) {
      const resizer = document.createElement("div");
      resizer.className = `ne-ui-image-resizer ne-resizer-${corner}`;
      card.appendChild(resizer);
    }
    const dispose = mountMediaCardResize(host, true);
    expect(card.querySelectorAll(".ne-ui-image-resizer")).toHaveLength(4);
    expect(card.querySelectorAll(".lake-media-resize-handle")).toHaveLength(1);
    dispose();
  });

  it("阅读态不挂任何媒体缩放手柄", () => {
    const video = videoCard(50);
    const image = imageCard(300);
    const disposeVideo = mountMediaCardResize(video.host, false);
    const disposeImage = mountMediaCardResize(image.host, false);
    expect(video.card.querySelectorAll(".lake-media-resize-handle")).toHaveLength(0);
    expect(image.card.querySelectorAll(".lake-media-resize-handle")).toHaveLength(0);
    disposeVideo();
    disposeImage();
  });
});
