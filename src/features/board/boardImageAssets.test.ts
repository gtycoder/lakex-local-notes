import { describe, expect, it } from "vitest";
import {
  collectBoardAssetUrls,
  collectInlineImageUrls,
  hasInlineImages,
  isInlineImageDataUrl,
  replaceInlineImageUrls,
} from "./boardImageAssets.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==";
const CANONICAL = "http://127.0.0.1:19876/note-1/1789000000000_deadbeef.png";

describe("画板图片提升（内联 data URL → 资产文件）", () => {
  it("识别内联图片 data URL：仅限 image/*;base64，其它 data URL 与 http URL 不碰", () => {
    expect(isInlineImageDataUrl(PNG)).toBe(true);
    expect(isInlineImageDataUrl("data:image/svg+xml;base64,PHN2Zy8+")).toBe(true);
    expect(isInlineImageDataUrl("data:text/plain;base64,aGk=")).toBe(false);
    expect(isInlineImageDataUrl("data:image/png,notbase64")).toBe(false);
    expect(isInlineImageDataUrl(CANONICAL)).toBe(false);
    expect(isInlineImageDataUrl(null)).toBe(false);
  });

  it("深度收集场景里的内联图片（图片元素 url / 思维导图节点 / 嵌套 groups）", () => {
    const elements = [
      { id: "img", type: "image", url: PNG, width: 120, height: 80 },
      { id: "g", type: "group", children: [{ id: "img2", type: "image", url: JPG }] },
      { id: "mind", type: "mind", data: { image: { url: PNG } } },
      { id: "shape", type: "geometry", text: { children: [{ text: "不是图片" }] } },
    ];
    const found = collectInlineImageUrls(elements);
    expect([...found].sort()).toEqual([PNG, JPG].sort());
    expect(hasInlineImages(elements)).toBe(true);
    expect(hasInlineImages([{ id: "s", type: "geometry" }])).toBe(false);
  });

  it("替换只动命中的字符串叶子，其它字段（坐标/文字/尺寸）逐字节保留", () => {
    const elements = [
      { id: "img", type: "image", url: PNG, width: 120, height: 80, text: { children: [{ text: "保留我" }] } },
      { id: "img2", type: "image", url: JPG },
      { id: "other", type: "image", url: "https://example.com/a.png" },
    ];
    const mapping = new Map([[PNG, CANONICAL]]);
    const next = replaceInlineImageUrls(elements, mapping) as typeof elements;
    expect(next[0].url).toBe(CANONICAL);
    expect(next[0].width).toBe(120);
    expect(next[0].text).toEqual({ children: [{ text: "保留我" }] });
    // 没进 mapping 的内联图（上传失败/超限）保持原样 ⇒ 不丢图
    expect(next[1].url).toBe(JPG);
    expect(next[2].url).toBe("https://example.com/a.png");
    // 原数组不被就地改写（React 状态比较依赖引用变化）
    expect(elements[0].url).toBe(PNG);
    expect(next).not.toBe(elements);
    expect(collectInlineImageUrls(next).size).toBe(1);
  });

  it("空 mapping 直接返回原引用（避免无意义的 re-render）", () => {
    const elements = [{ id: "a" }];
    expect(replaceInlineImageUrls(elements, new Map())).toBe(elements);
  });

  it("收集本笔记的资产 URL（用于打开时换回 data URL），别的笔记/小记/外链一律不算", () => {
    const elements = [
      { id: "a", type: "image", url: CANONICAL },
      { id: "b", type: "image", url: "http://127.0.0.1:19876/other-note/1789000000000_deadbeef.png" },
      { id: "c", type: "image", url: "http://127.0.0.1:19876/quick-notes/quick-1/1789000000000_deadbeef.png" },
      { id: "d", type: "image", url: "https://example.com/x.png" },
      { id: "e", type: "image", url: PNG },
    ];
    const found = collectBoardAssetUrls(elements, "note-1");
    expect([...found]).toEqual([CANONICAL]);
    expect(collectBoardAssetUrls(elements, "note-2").size).toBe(0);   // 别的笔记的 URL 不算
    expect(collectBoardAssetUrls(elements, "other-note").size).toBe(1);
    expect(collectBoardAssetUrls(elements, "note-999").size).toBe(0);
  });
});
