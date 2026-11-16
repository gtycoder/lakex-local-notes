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
  CANONICAL_ASSET_PORT,
  normalizeLocalAssetPorts,
  canonicalizeNoteAssetUrls,
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

describe("normalizeLocalAssetPorts（261118：端口归一化 / 同步可移植性）", () => {
  it("裸 URL：把任何本地端口改成目标端口，query/hash 原样保留", () => {
    expect(normalizeLocalAssetPorts("http://127.0.0.1:19877/n1/a.png", CANONICAL_ASSET_PORT)).toBe("http://127.0.0.1:19876/n1/a.png");
    expect(normalizeLocalAssetPorts("http://127.0.0.1:19878/n1/a.png?token=x&w=128", 19877)).toBe("http://127.0.0.1:19877/n1/a.png?token=x&w=128");
  });

  it("quick-notes / staging 形态同样归一（小记与草稿图片）", () => {
    expect(normalizeLocalAssetPorts("http://127.0.0.1:19877/quick-notes/q1/b.png", 19876)).toBe("http://127.0.0.1:19876/quick-notes/q1/b.png");
    expect(normalizeLocalAssetPorts("http://127.0.0.1:19877/quick-notes/staging/d1/c.png", 19876)).toBe("http://127.0.0.1:19876/quick-notes/staging/d1/c.png");
  });

  it("卡片 JSON 的百分号编码形态也要归一（正文图片真实存储形态）", () => {
    const encoded = "http%3A%2F%2F127.0.0.1%3A19877%2Fn1%2Fa.png";
    expect(normalizeLocalAssetPorts(encoded, CANONICAL_ASSET_PORT)).toBe("http%3A%2F%2F127.0.0.1%3A19876%2Fn1%2Fa.png");
    // 大小写不敏感：%3a 形态也要改，且保留原大小写
    expect(normalizeLocalAssetPorts("http%3a%2f%2f127.0.0.1%3a19877%2fn1%2fa.png", CANONICAL_ASSET_PORT)).toBe("http%3a%2f%2f127.0.0.1%3a19876%2fn1%2fa.png");
  });

  it("非资产地址与外部地址一律不动（不能把 127.0.0.1 上的其它服务改坏）", () => {
    expect(normalizeLocalAssetPorts("http://127.0.0.1:19877/health", 19876)).toBe("http://127.0.0.1:19877/health");
    expect(normalizeLocalAssetPorts("http://127.0.0.1:19877/api/echo", 19876)).toBe("http://127.0.0.1:19877/api/echo");
    expect(normalizeLocalAssetPorts("https://example.com/n1/a.png", 19876)).toBe("https://example.com/n1/a.png");
    expect(normalizeLocalAssetPorts("lake-asset://n1/a.png", 19876)).toBe("lake-asset://n1/a.png");
  });

  it("形状收紧后仍覆盖真实资产：非 uuid noteId（如 welcome-note）+ 带扩展名文件名要归一", () => {
    expect(normalizeLocalAssetPorts("http://127.0.0.1:19877/welcome-note/a.png", 19876)).toBe("http://127.0.0.1:19876/welcome-note/a.png");
    // 纯数字文件名 + uuid noteId（内核把图重命名成数字）同样要归一
    expect(normalizeLocalAssetPorts("http://127.0.0.1:19877/152e3612-d942-4a58-8ff5-6df75bdd6bc1/1794", 19876)).toBe("http://127.0.0.1:19876/152e3612-d942-4a58-8ff5-6df75bdd6bc1/1794");
  });

  it("幂等 + 无副作用（空串/非法端口原样返回）", () => {
    const once = normalizeLocalAssetPorts("http://127.0.0.1:19877/n1/a.png", 19876);
    expect(normalizeLocalAssetPorts(once, 19876)).toBe(once);
    expect(normalizeLocalAssetPorts("", 19876)).toBe("");
    expect(normalizeLocalAssetPorts("http://127.0.0.1:19877/n1/a.png", 0)).toBe("http://127.0.0.1:19877/n1/a.png");
  });

  it("localAssetHttpUrl 默认使用规范端口（移动端/打包版一致）", () => {
    expect(localAssetHttpUrl("n1", "a.png")).toBe("http://127.0.0.1:19876/n1/a.png");
    expect(CANONICAL_ASSET_PORT).toBe(19876);
  });
});

describe("canonicalizeNoteAssetUrls（261118 保存收口）", () => {
  const NOTE = "0a424bbf-6a86-4884-a70d-43bfa4c4d294";
  const canonical = "127.0.0.1:" + CANONICAL_ASSET_PORT;

  it("裸 URL：任意实例端口/ token → 规范端口且去掉 token", () => {
    const body = '<img src="http://127.0.0.1:19888/' + NOTE + '/a.png?token=abc">';
    expect(canonicalizeNoteAssetUrls(body)).toContain(canonical + "/" + NOTE + "/a.png");
    expect(canonicalizeNoteAssetUrls(body)).not.toContain("19888");
    expect(canonicalizeNoteAssetUrls(body)).not.toContain("token=");
  });

  it("编码形态：只改端口，不破坏百分号编码", () => {
    const body = "http%3A%2F%2F127.0.0.1%3A19888%2F" + NOTE + "%2Fa.png";
    const out = canonicalizeNoteAssetUrls(body);
    expect(out).toContain("%3A" + CANONICAL_ASSET_PORT + "%2F");
    expect(out).not.toContain("%3A19888%2F");
  });

  it("幂等 + 非资产本机服务 URL 不动", () => {
    const body = '<a href="http://127.0.0.1:19888/api/echo?token=x">e</a>';
    expect(canonicalizeNoteAssetUrls(body)).toBe(body);
    const once = canonicalizeNoteAssetUrls('<img src="http://127.0.0.1:19888/' + NOTE + '/a.png?token=abc">');
    expect(canonicalizeNoteAssetUrls(once)).toBe(once);
  });
});
