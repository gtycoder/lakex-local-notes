import { describe, expect, it } from "vitest";
import { ASSET_THUMB_WIDTHS, withAssetWidth } from "../../core/assetUrl.js";
import {
  CARD_IMAGE_THUMB_PX,
  cardImageThumbWidths,
  imageBoxAttrs,
  quickNoteImageUrl,
  quickNotePreviewAssetUrl,
} from "./quickNoteImage";

/**
 * 移动端卡片图片（261111）：缩略 URL 的**离散档位 / 可复用性**与比例盒判据。
 * 这里锁的是"同一张图只解码一次"的前提：同输入必须得到同一个 URL（浏览器按 src 复用解码结果）。
 */
const local = (filename = "a.png", token = "tok") =>
  "http://127.0.0.1:19876/quick-notes/n1/" + filename + "?token=" + token;

describe("quickNoteImage（卡片图片缩略/比例盒）", () => {
  it("卡片内图片统一加最大离散档位 ?w=1024，且保留 token；重复计算结果稳定（可复用同一解码）", () => {
    const url = quickNoteImageUrl(local());
    expect(url).toContain("w=" + CARD_IMAGE_THUMB_PX);
    expect(url).toContain("token=tok");
    // 同一张图反复渲染/封面+正文两个调用点：URL 必须逐字节一致（浏览器只解码一次）。
    expect(quickNoteImageUrl(local())).toBe(url);
    expect(quickNoteImageUrl(url)).toBe(url); // 幂等：已带档位不会叠第二个 w
    expect(new URL(url).searchParams.getAll("w")).toEqual([String(CARD_IMAGE_THUMB_PX)]);
  });

  it("只给图片加档位：视频/音频/附件 URL 原样返回（不制造无意义的 query 变体）", () => {
    for (const mime of ["video/mp4", "audio/mpeg", "application/pdf", "text/plain"]) {
      expect(quickNotePreviewAssetUrl(local(), mime)).toBe(local());
    }
    for (const mime of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      expect(quickNotePreviewAssetUrl(local(), mime)).toBe(quickNoteImageUrl(local()));
    }
  });

  it("非本地资产 URL 原样返回（外部图无权也无需缩）", () => {
    const external = "https://example.com/a.png";
    expect(quickNoteImageUrl(external)).toBe(external);
    expect(quickNotePreviewAssetUrl(external, "image/png")).toBe(external);
  });

  it("档位是有限的离散集合（不会按连续宽度打散缓存）", () => {
    expect(cardImageThumbWidths()).toBe(ASSET_THUMB_WIDTHS);
    // 服务端只认这 4 个离散值；卡片固定取最大档，不会随显示宽度产生连续 URL。
    const widths = new Set(ASSET_THUMB_WIDTHS.map((w) => withAssetWidth("http://127.0.0.1:19876/n1/a.png?token=t", w)));
    expect(widths.size).toBe(ASSET_THUMB_WIDTHS.length);
    // 卡片图片只落在一个档位 ⇒ 同一张图在列表里的 URL 集合大小恒为 1。
    const urls = new Set(Array.from({ length: 20 }, () => quickNoteImageUrl(local())));
    expect(urls.size).toBe(1);
  });

  it("比例盒：只接受正整数宽高（老数据/附件 null 不写属性，避免 0×0 钉死布局）", () => {
    expect(imageBoxAttrs({ width: 4032, height: 3024 })).toEqual({ width: 4032, height: 3024 });
    expect(imageBoxAttrs({ width: 12.6, height: 7.2 })).toEqual({ width: 13, height: 7 });
    for (const bad of [null, undefined, { width: null, height: null }, { width: 0, height: 10 }, { width: 10, height: -1 }, { width: Number.NaN, height: 10 }, {}]) {
      expect(imageBoxAttrs(bad as never)).toBeNull();
    }
  });
});
