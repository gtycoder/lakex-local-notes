import { describe, expect, it } from "vitest";
import { parseLocalAssetUrl, isLocalAssetUrl, lakeAssetToHttp, httpToLakeAsset } from "./assetUrl.js";

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
});
