import { describe, expect, it } from "vitest";
import {
  parseLocalAssetUrl,
  isLocalAssetUrl,
  lakeAssetToHttp,
  httpToLakeAsset,
  localAssetHttpUrl,
  assetThumbWidthFor,
  withAssetWidth,
  ASSET_THUMB_WIDTHS,
} from "./assetUrl.js";

describe("AssetUrlResolver (src/core/assetUrl.ts)", () => {
  describe("parseLocalAssetUrl", () => {
    it("解析 http 形态（note）", () => {
      expect(parseLocalAssetUrl("http://127.0.0.1:19876/n1/a.png")).toEqual({ space: "note", noteId: "n1", filename: "a.png" });
    });
    it("解析 http 形态（quick-notes）", () => {
      expect(parseLocalAssetUrl("http://127.0.0.1:19876/quick-notes/q1/b.png")).toEqual({ space: "quick-notes", noteId: "q1", filename: "b.png" });
    });
    it("解析 http 形态（quick-notes staging 草稿）", () => {
      expect(parseLocalAssetUrl("http://127.0.0.1:19876/quick-notes/staging/d1/c.png")).toEqual({ space: "quick-notes", noteId: "d1", filename: "c.png", staging: true });
    });
    it("解析 lake-asset 形态（note）", () => {
      expect(parseLocalAssetUrl("lake-asset://n1/a.png")).toEqual({ space: "note", noteId: "n1", filename: "a.png" });
    });
    it("解析 lake-asset 形态（quick-notes）", () => {
      expect(parseLocalAssetUrl("lake-asset://quick-notes/q1/b.png")).toEqual({ space: "quick-notes", noteId: "q1", filename: "b.png" });
    });
    it("带查询参数也能解析（Lake 会加 ?date=）", () => {
      expect(parseLocalAssetUrl("lake-asset://n1/a.png?date=123")?.filename).toBe("a.png");
    });
    it("远程 URL 返回 null", () => {
      expect(parseLocalAssetUrl("https://example.com/x.png")).toBeNull();
      expect(parseLocalAssetUrl("data:image/png;base64,xxx")).toBeNull();
      expect(parseLocalAssetUrl("blob:http://127.0.0.1:1421/u")).toBeNull();
    });
    it("非法输入返回 null", () => {
      expect(parseLocalAssetUrl("")).toBeNull();
      expect(parseLocalAssetUrl(null as unknown as string)).toBeNull();
    });
  });

  describe("isLocalAssetUrl", () => {
    it("识别两种形态", () => {
      expect(isLocalAssetUrl("http://127.0.0.1:19876/n1/a.png")).toBe(true);
      expect(isLocalAssetUrl("lake-asset://n1/a.png")).toBe(true);
      expect(isLocalAssetUrl("https://example.com/x.png")).toBe(false);
    });
  });

  describe("localAssetHttpUrl（桌面/移动端统一 canonical URL 生成）", () => {
    it("note 资源", () => {
      expect(localAssetHttpUrl("n1", "a.png")).toBe("http://127.0.0.1:19876/n1/a.png");
    });
    it("quick-notes 资源", () => {
      expect(localAssetHttpUrl("q1", "b.png", { space: "quick-notes" })).toBe("http://127.0.0.1:19876/quick-notes/q1/b.png");
    });
    it("自定义端口（桌面 LAKE_ASSET_PORT 可覆盖）", () => {
      expect(localAssetHttpUrl("n1", "a.png", { port: 19877 })).toBe("http://127.0.0.1:19877/n1/a.png");
    });
    it("生成结果可被 parseLocalAssetUrl 解析（两端语义闭环）", () => {
      const url = localAssetHttpUrl("q1", "b.png", { space: "quick-notes" });
      expect(parseLocalAssetUrl(url)).toEqual({ space: "quick-notes", noteId: "q1", filename: "b.png" });
    });
  });

  describe("lakeAssetToHttp / httpToLakeAsset", () => {
    it("lake-asset → http（note）", () => {
      expect(lakeAssetToHttp("lake-asset://n1/a.png", 19876)).toBe("http://127.0.0.1:19876/n1/a.png");
    });
    it("lake-asset → http（quick-notes）", () => {
      expect(lakeAssetToHttp("lake-asset://quick-notes/q1/b.png", 19876)).toBe("http://127.0.0.1:19876/quick-notes/q1/b.png");
    });
    it("http → lake-asset", () => {
      expect(httpToLakeAsset("http://127.0.0.1:19876/n1/a.png")).toBe("lake-asset://n1/a.png");
      expect(httpToLakeAsset("http://127.0.0.1:19876/quick-notes/q1/b.png")).toBe("lake-asset://quick-notes/q1/b.png");
    });
    it("非本地 URL 原样返回", () => {
      expect(lakeAssetToHttp("https://example.com/x.png", 19876)).toBe("https://example.com/x.png");
      expect(httpToLakeAsset("https://example.com/x.png")).toBe("https://example.com/x.png");
    });
  });

  describe("缩略图档位（ASSET_THUMB_WIDTHS / assetThumbWidthFor / withAssetWidth）", () => {
    it("档位是离散的固定几个值（连续值会把浏览器缓存与服务端缓存一起打散）", () => {
      expect([...ASSET_THUMB_WIDTHS]).toEqual([128, 256, 512, 1024]);
    });

    it("取不小于目标的最接近档位（宁可略大、绝不小到发虚）", () => {
      expect(assetThumbWidthFor(1)).toBe(128);
      expect(assetThumbWidthFor(128)).toBe(128);
      expect(assetThumbWidthFor(129)).toBe(256);
      expect(assetThumbWidthFor(1024)).toBe(1024);
    });

    it("超过最大档位 → null（直接用原图，不为一张几乎等于原图的图白编一次码）", () => {
      expect(assetThumbWidthFor(1025)).toBeNull();
      expect(assetThumbWidthFor(4000)).toBeNull();
    });

    it("非法宽度 → null", () => {
      expect(assetThumbWidthFor(0)).toBeNull();
      expect(assetThumbWidthFor(-5)).toBeNull();
      expect(assetThumbWidthFor(Number.NaN)).toBeNull();
      expect(assetThumbWidthFor(Number.POSITIVE_INFINITY)).toBeNull();
    });

    it("加档位，且保留其它 query（token 不能被冲掉）", () => {
      expect(withAssetWidth("http://127.0.0.1:19876/n1/a.png", 128)).toBe("http://127.0.0.1:19876/n1/a.png?w=128");
      expect(withAssetWidth("http://127.0.0.1:19876/n1/a.png?token=t", 128)).toBe("http://127.0.0.1:19876/n1/a.png?token=t&w=128");
    });

    it("已有档位则改写（不叠加），传 null 则去掉", () => {
      expect(withAssetWidth("http://127.0.0.1:19876/n1/a.png?w=512", 256)).toBe("http://127.0.0.1:19876/n1/a.png?w=256");
      expect(withAssetWidth("http://127.0.0.1:19876/n1/a.png?w=128&token=t", null)).toBe("http://127.0.0.1:19876/n1/a.png?token=t");
    });

    it("非本地资产原样返回（外部图我们无权也无需缩放）", () => {
      expect(withAssetWidth("https://example.com/x.png", 128)).toBe("https://example.com/x.png");
      expect(withAssetWidth("data:image/png;base64,AAAA", 128)).toBe("data:image/png;base64,AAAA");
      expect(withAssetWidth("blob:http://127.0.0.1:1421/u", 128)).toBe("blob:http://127.0.0.1:1421/u");
    });

    it("带档位的 URL 仍能被 parseLocalAssetUrl 解析（落盘/复制/GC 全链路不看 query）", () => {
      expect(parseLocalAssetUrl("http://127.0.0.1:19876/n1/a.png?w=128")).toEqual({ space: "note", noteId: "n1", filename: "a.png" });
    });
  });
});
