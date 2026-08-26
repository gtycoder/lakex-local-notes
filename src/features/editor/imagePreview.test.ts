import { describe, expect, it, vi } from "vitest";
import { closeImagePreview, navigateImagePreview, openImagePreview, subscribeImagePreview } from "./imagePreview.js";

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
