/**
 * 预览资产档位决策的单测（261112 R1 预览基础层）。
 *
 * 锁三件事（对应审计 02 报告 §1.5 / D4 / D6 与用户裁决 Q02）：
 * 1. display  = 本地可缩图片加离散档位 w=1024（token 等其它 query 必须保留）；
 * 2. original = 放大看大图：去 w/date、**保留 token**（与复制路径同一套规范化）；
 * 3. materialized = 复制/导出物化：original + base64=1。
 * 另外钉「非本地资源/非图片一律原样」——我们无权也无需缩放 data:/外链/PDF/GIF。
 */
import { describe, expect, it } from "vitest";
import { PREVIEW_DISPLAY_THUMB_WIDTH, resolvePreviewAssetRef, resolvePreviewAssetUrl } from "./previewAsset";

const BASE = "http://127.0.0.1:19876/note1/a.png";
const ref = (src: string, extra: Partial<{ noteId: string; filename: string; mimeType: string }> = {}) => ({
  noteId: extra.noteId ?? "note1",
  filename: extra.filename ?? "a.png",
  src,
  ...(extra.mimeType ? { mimeType: extra.mimeType } : {}),
});
const params = (url: string) => new URL(url).searchParams;

describe("resolvePreviewAssetRef", () => {
  it("有 src 用 src；没有 src 时按 noteId+filename 现拼 canonical URL", () => {
    expect(resolvePreviewAssetRef({ noteId: "note1", filename: "a.png", src: BASE })).toBe(BASE);
    expect(resolvePreviewAssetRef({ noteId: "note1", filename: "a.png" })).toBe(BASE);
    expect(resolvePreviewAssetRef({ noteId: "", filename: "", src: "  " })).toBe("");
  });
});

describe("display：列表/卡片显示档（?w=1024，保留 token）", () => {
  it("本地图片加档位且保留已有 query", () => {
    const out = resolvePreviewAssetUrl(ref(BASE + "?token=T"), "display");
    expect(PREVIEW_DISPLAY_THUMB_WIDTH).toBe(1024);
    expect(params(out).get("w")).toBe("1024");
    expect(params(out).get("token")).toBe("T");
  });

  it("非本地资源（外链/data/blob）原样——无权也无需缩放", () => {
    const external = "https://example.com/x.png";
    expect(resolvePreviewAssetUrl(ref(external), "display")).toBe(external);
    const dataUrl = "data:image/png;base64,AAAA";
    expect(resolvePreviewAssetUrl(ref(dataUrl), "display")).toBe(dataUrl);
  });

  it("本地非图片（PDF / GIF / SVG / 音视频）原样——资产服务只缩 png/jpg/webp", () => {
    const pdf = "http://127.0.0.1:19876/note1/a.pdf";
    expect(resolvePreviewAssetUrl(ref(pdf), "display")).toBe(pdf);
    const gif = "http://127.0.0.1:19876/note1/a.gif";
    expect(resolvePreviewAssetUrl(ref(gif), "display")).toBe(gif);
    const svg = "http://127.0.0.1:19876/note1/a.svg";
    expect(resolvePreviewAssetUrl(ref(svg), "display")).toBe(svg);
  });
});

describe("original：放大看大图（去 w/date、保留 token）", () => {
  it("去掉显示档与 date，其它 query（token）原样保留", () => {
    const out = resolvePreviewAssetUrl(ref(BASE + "?w=1024&date=123&token=T&x=1"), "original");
    expect(out).toBe(BASE + "?token=T&x=1");
  });

  it("没有 token 时不凭空造 token（token 由渲染层注入，不归本模块）", () => {
    const out = resolvePreviewAssetUrl(ref(BASE + "?w=1024"), "original");
    expect(out).toBe(BASE);
    expect(params(out).get("token")).toBeNull();
  });

  it("非本地资源原样返回", () => {
    const external = "https://example.com/x.png?w=1024";
    expect(resolvePreviewAssetUrl(ref(external), "original")).toBe(external);
  });
});

describe("materialized：复制/导出物化（original + base64=1）", () => {
  it("去显示档、加 base64=1、保留 token", () => {
    const out = resolvePreviewAssetUrl(ref(BASE + "?w=1024&date=9&token=T"), "materialized");
    expect(params(out).get("base64")).toBe("1");
    expect(params(out).get("token")).toBe("T");
    expect(params(out).get("w")).toBeNull();
    expect(params(out).get("date")).toBeNull();
  });

  it("已有 base64 参数会被规范成 1（幂等）", () => {
    const out = resolvePreviewAssetUrl(ref(BASE + "?base64=0"), "materialized");
    expect(params(out).get("base64")).toBe("1");
  });

  it("非本地资源原样（无法物化外部资源）", () => {
    expect(resolvePreviewAssetUrl(ref("https://example.com/x.png"), "materialized")).toBe("https://example.com/x.png");
  });
});
