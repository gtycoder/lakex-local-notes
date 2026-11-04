/**
 * 页内贴图操作集（纯函数）：插入默认值 / 命中测试 / 移动钳制 / 缩放 / 删除。
 */
import { describe, expect, it } from "vitest";
import { createInkPage } from "../../core/inkDoc";
import {
  INK_IMAGE_DEFAULT_WIDTH_RATIO,
  INK_IMAGE_MIN_EDGE,
  INK_PAGE_IMAGE_MIN_SOURCE_EDGE,
  hitTestPageImage,
  inkPageImageSourceError,
  movePageImage,
  placeInkPageImage,
  removePageImage,
  resizePageImage,
} from "./inkPageImages";

const url = "http://127.0.0.1:19877/note-1/1700000000000_abcdef12.png";

function page() {
  return { ...createInkPage("p1"), width: 1000, height: 1400 };
}

describe("页内贴图", () => {
  it("插入：页宽 40%、保持原图比例、居中", () => {
    const image = placeInkPageImage(page(), { id: "i1", url, naturalWidth: 800, naturalHeight: 400 });
    expect(image.width).toBe(1000 * INK_IMAGE_DEFAULT_WIDTH_RATIO);
    expect(image.height).toBe(image.width / 2);
    expect(image.x).toBe((1000 - image.width) / 2);
    expect(image.y).toBe((1400 - image.height) / 2);
  });

  it("插入：读不到原图尺寸按 4:3 估；异常尺寸不会产生 0", () => {
    const image = placeInkPageImage(page(), { id: "i1", url });
    expect(image.height).toBeCloseTo(image.width * 0.75, 2);
    const tiny = placeInkPageImage(page(), { id: "i2", url, naturalWidth: 0, naturalHeight: 0 });
    expect(tiny.width).toBeGreaterThanOrEqual(INK_IMAGE_MIN_EDGE);
  });

  it("命中测试：返回最上层（后画的在上），空页返回 null", () => {
    const page1 = page();
    const images = [
      { id: "bottom", url, x: 0, y: 0, width: 100, height: 100 },
      { id: "top", url, x: 50, y: 50, width: 100, height: 100 },
    ];
    expect(hitTestPageImage({ images }, { x: 60, y: 60 })).toBe("top");
    expect(hitTestPageImage({ images }, { x: 10, y: 10 })).toBe("bottom");
    expect(hitTestPageImage({ images }, { x: 500, y: 500 })).toBeNull();
    expect(hitTestPageImage({ ...page1, images: [] }, { x: 1, y: 1 })).toBeNull();
  });

  it("移动：目标不存在返回 null；拖出页外被钳到「至少 40px 留在页内」", () => {
    const page1 = { ...page(), images: [{ id: "i1", url, x: 100, y: 100, width: 200, height: 100 }] };
    expect(movePageImage(page1, "missing", 10, 10)).toBeNull();
    const moved = movePageImage(page1, "i1", 50, 20)!;
    expect(moved[0]).toMatchObject({ x: 150, y: 120 });
    const far = movePageImage(page1, "i1", -100000, -100000)!;
    expect(far[0].x).toBe(-(200 - 40));
    expect(far[0].y).toBe(-(100 - 40));
  });

  it("缩放：保持宽高比、最小边 24；删除后不再返回该图", () => {
    const page1 = { ...page(), images: [{ id: "i1", url, x: 100, y: 100, width: 200, height: 100 }] };
    const bigger = resizePageImage(page1, "i1", 2)!;
    expect(bigger[0]).toMatchObject({ width: 400, height: 200 });
    const smaller = resizePageImage(page1, "i1", 0.01)!;
    expect(smaller[0].width).toBe(INK_IMAGE_MIN_EDGE);
    const removed = removePageImage(page1, "i1");
    expect(removed).toEqual([]);
    // 删除不存在的 id 不炸
    expect(removePageImage(page1, "missing").length).toBe(1);
  });

  it("源图校验：1×1 占位图 / 探测失败都拒绝并说明（用户报「贴图仅有边框」的根因之一）", () => {
    expect(inkPageImageSourceError({ pixelWidth: 1, pixelHeight: 1 })).toContain("图片太小（1×1）");
    expect(inkPageImageSourceError(null)).toContain("无法识别");
    expect(inkPageImageSourceError({ pixelWidth: 0, pixelHeight: 100 })).toContain("无法识别");
    expect(inkPageImageSourceError({ pixelWidth: Number.NaN, pixelHeight: 10 })).toContain("无法识别");
    expect(inkPageImageSourceError({ pixelWidth: 8, pixelHeight: 8 })).toBeNull();
    expect(inkPageImageSourceError({ pixelWidth: 600, pixelHeight: 400 })).toBeNull();
    expect(INK_PAGE_IMAGE_MIN_SOURCE_EDGE).toBe(8);
  });
});
