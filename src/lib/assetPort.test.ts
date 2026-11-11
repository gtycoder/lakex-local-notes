import { afterEach, describe, expect, it, vi } from "vitest";
import { addAssetAccessToken, stripAssetAccessToken, assetThumbWidthForCss, withLocalImageThumb } from "./assetPort";

afterEach(() => {
  vi.resetModules();
  if ("window" in globalThis) delete (globalThis as { window?: unknown }).window;
});

describe("asset access token rewriting", () => {
  it("keeps persisted content token-free while adding a runtime token", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { lakeNative: { assetPort: 19876, assetToken: "runtime-secret" } },
    });
    vi.resetModules();
    const runtimeAssetPort = await import("./assetPort");
    const content = '<p><img src="http://127.0.0.1:19876/note/image.webp?date=1"></p> and https://example.test/a.png';
    const runtime = runtimeAssetPort.addAssetAccessToken(content);

    expect(runtime).toContain("token=runtime-secret");
    expect(runtimeAssetPort.stripAssetAccessToken(runtime)).toBe(content);
  });

  it("does not rewrite external URLs", () => {
    const content = "![x](https://example.test/image.png)";
    expect(addAssetAccessToken(content)).toBe(content);
    expect(stripAssetAccessToken(content)).toBe(content);
  });

  it("uses the Android runtime token interface for direct asset URLs", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { lakeAssetToken: { getToken: () => "android-secret" } },
    });
    vi.resetModules();
    const runtimeAssetPort = await import("./assetPort");

    const url = "http://127.0.0.1:19876/note/image.webp";
    const externalUrl = "https://example.test/image.png";
    expect(runtimeAssetPort.withAssetAccessToken(url)).toContain("token=android-secret");
    expect(runtimeAssetPort.withAssetAccessToken(externalUrl)).toBe(externalUrl);
  });
});

describe("withLocalImageThumb（task-26 显示缩略）", () => {
  const base = "http://127.0.0.1:19876/quick-notes/q1/a";

  it("本地 png/jpg/jpeg/webp → 加 ?w=", () => {
    expect(withLocalImageThumb(base + ".png", 1024)).toBe(base + ".png?w=1024");
    expect(withLocalImageThumb(base + ".jpg", 1024)).toBe(base + ".jpg?w=1024");
    expect(withLocalImageThumb(base + ".jpeg", 512)).toBe(base + ".jpeg?w=512");
    expect(withLocalImageThumb(base + ".webp", 256)).toBe(base + ".webp?w=256");
  });

  it("保留 token/其它 query，已有 w 替换", () => {
    expect(withLocalImageThumb(base + ".jpg?token=t", 1024)).toBe(base + ".jpg?token=t&w=1024");
    expect(withLocalImageThumb(base + ".jpg?w=256&token=t", 1024)).toBe(base + ".jpg?w=1024&token=t");
  });

  it("GIF/SVG/非图片扩展名 → 原样（资产服务不缩）", () => {
    expect(withLocalImageThumb(base + ".gif", 1024)).toBe(base + ".gif");
    expect(withLocalImageThumb(base + ".svg", 1024)).toBe(base + ".svg");
    expect(withLocalImageThumb(base + ".pdf", 1024)).toBe(base + ".pdf");
  });

  it("非本地资产（外部 URL/data/blob/lake-asset）→ 原样", () => {
    const external = "https://example.test/a.png";
    expect(withLocalImageThumb(external, 1024)).toBe(external);
    expect(withLocalImageThumb("data:image/png;base64,AAAA", 1024)).toBe("data:image/png;base64,AAAA");
    expect(withLocalImageThumb("blob:http://127.0.0.1:1421/u", 1024)).toBe("blob:http://127.0.0.1:1421/u");
    expect(withLocalImageThumb("lake-asset://q1/a.png", 1024)).toBe("lake-asset://q1/a.png");
  });

  it("width 非正/非法 → 原样", () => {
    expect(withLocalImageThumb(base + ".png", 0)).toBe(base + ".png");
    expect(withLocalImageThumb(base + ".png", -1)).toBe(base + ".png");
    expect(withLocalImageThumb(base + ".png", Number.NaN)).toBe(base + ".png");
  });
});

describe("缩略图档位（CSS 宽度 × DPR，封顶 3×）", () => {
  /** 这个函数读 devicePixelRatio ⇒ 必须在 src/lib（core 层禁 DOM，check:core 会卡）。 */
  const withDpr = (dpr: number, fn: () => void) => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { devicePixelRatio: dpr } });
    try { fn(); } finally { delete (globalThis as { window?: unknown }).window; }
  };

  it("按 CSS 宽度选档", () => {
    withDpr(1, () => {
      expect(assetThumbWidthForCss(80)).toBe(128);
      expect(assetThumbWidthForCss(200)).toBe(256);
      expect(assetThumbWidthForCss(0)).toBeNull();
    });
  });

  it("DPR 计入", () => {
    withDpr(2, () => {
      expect(assetThumbWidthForCss(80)).toBe(256); // 160 设备像素 → 256
    });
  });

  it("超过最大档位 → null（用原图）", () => {
    withDpr(3, () => {
      expect(assetThumbWidthForCss(100)).toBe(512); // 300 → 512
      expect(assetThumbWidthForCss(400)).toBeNull(); // 1200 > 1024
    });
  });

  it("DPR 封顶 3×（不封顶会算成 1000 → 1024）", () => {
    withDpr(10, () => {
      expect(assetThumbWidthForCss(100)).toBe(512);
    });
  });
});
