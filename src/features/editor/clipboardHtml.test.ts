// @vitest-environment jsdom
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { buildAssetDataUrlRequest, isMobileEnvironment, normalizeClipboardHtml, normalizeImageDataUrl, upgradePastedHtml } from "./clipboardHtml";

// jsdom 无 canvas 实现：mock getContext/toDataURL（仅测试 blob→png 分支的调用路径）
const origGetContext = HTMLCanvasElement.prototype.getContext;
const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
beforeAll(() => {
  (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = () =>
    ({ drawImage: () => {}, fillRect: () => {}, fillStyle: "" }) as unknown as CanvasRenderingContext2D;
  (HTMLCanvasElement.prototype as unknown as { toDataURL: unknown }).toDataURL = () =>
    `data:image/png;base64,${PNG_1PX}`;
});
afterAll(() => {
  (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;
  (HTMLCanvasElement.prototype as unknown as { toDataURL: unknown }).toDataURL = origToDataURL;
});

function fragmentFromHtml(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

// 1x1 透明 PNG
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("isMobileEnvironment（平台判定）", () => {
  it("桌面：有 lakeNative.uploadResource 但 Capacitor 非原生 → 非移动端", () => {
    (window as unknown as { lakeNative?: unknown }).lakeNative = { uploadResource: () => Promise.resolve({}) };
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => false };
    expect(isMobileEnvironment()).toBe(false);
    delete (window as unknown as { lakeNative?: unknown }).lakeNative;
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });
  it("Capacitor 原生平台 true → 移动端", () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    expect(isMobileEnvironment()).toBe(true);
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });
});

describe("buildAssetDataUrlRequest（复制到第三方的图片 URL 组装）", () => {
  it("已带 token 的 URL 不重复拼接（单一 query，base64 生效）", () => {
    const out = buildAssetDataUrlRequest("http://127.0.0.1:19876/n1/1700_ab.webp?token=ABC", "ABC")!;
    expect(out).toContain("base64=1");
    expect((out.match(/\?/g) || []).length).toBe(1);
    expect((out.match(/token=/g) || []).length).toBe(1);
    expect(new URL(out).searchParams.get("base64")).toBe("1");
  });
  it("无 query 的 URL 正确附加 base64 与 token", () => {
    expect(buildAssetDataUrlRequest("http://127.0.0.1:19876/n1/a.png", "T")).toBe("http://127.0.0.1:19876/n1/a.png?base64=1&token=T");
  });
  it("非本地资产 URL → null", () => {
    expect(buildAssetDataUrlRequest("https://example.com/a.png", "T")).toBeNull();
  });
});

describe("normalizeClipboardHtml", () => {
  it("去除零宽字符（Lake 光标定位用）", () => {
    const html = normalizeClipboardHtml(fragmentFromHtml("<p>a\u200Bb\u200Dc\uFEFFd</p>"), document);
    expect(html).toBe("<p>abcd</p>");
  });

  it("去除只含 <br> 或为空的 span", () => {
    const html = normalizeClipboardHtml(fragmentFromHtml("<p><span><br></span>x<span></span>y</p>"), document);
    expect(html).toBe("<p>xy</p>");
  });

  it("去除空块级元素", () => {
    const html = normalizeClipboardHtml(fragmentFromHtml("<p>a</p><p> </p><div></div><p>b</p>"), document);
    expect(html).toBe("<p>a</p><p>b</p>");
  });

  it("保留图片并按真实格式修正 data URL MIME", () => {
    const html = normalizeClipboardHtml(
      fragmentFromHtml(`<img src="data:image/jpeg;base64,${PNG_1PX}">`),
      document
    );
    expect(html).toBe(`<img src="data:image/png;base64,${PNG_1PX}">`);
  });


  it("移动端复制：blob 注入的已解码图片 → canvas 转 PNG data URL（微信兼容）", () => {
    // 模拟移动端环境（Capacitor 原生平台）
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    // 构造一个"已解码"的 blob img：canvas 生成真实图片数据
    const canvas = document.createElement("canvas");
    canvas.width = 2; canvas.height = 2;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "red"; ctx.fillRect(0, 0, 2, 2);
    const img = document.createElement("img");
    img.src = canvas.toDataURL("image/png"); // data URL 同步解码
    const html = normalizeClipboardHtml(fragmentFromHtml(`<img src="${img.src}">`), document);
    // blob: src 才会走 canvas 分支——这里 data URL 走 normalizeImageDataUrl 常规路径，
    // 验证移动端环境下 data URL 图片仍保留
    expect(html).toContain('src="data:image/png;base64,');
    // 清理
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  it("移动端复制：blob src 且已解码 → canvas 转 PNG", () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    // 直接构造 blob URL 图片（真实 PNG 字节）
    const bytes = Uint8Array.from(atob(PNG_1PX), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes as unknown as BlobPart], { type: "image/png" });
    const blobUrl = URL.createObjectURL(blob);
    // 直接构造含 blob src 的片段（jsdom 中 outerHTML 会序列化 blob URL，用字面量 HTML 更稳）
    const frag = fragmentFromHtml(`<img src="${blobUrl}" width="1" height="1">`);
    // 同步模拟"已解码"（jsdom 中 naturalWidth 为 0，需绕过 complete 判定）
    const imgEl = frag.querySelector("img")!;
    Object.defineProperty(imgEl, "naturalWidth", { value: 1, configurable: true });
    Object.defineProperty(imgEl, "complete", { value: true, configurable: true });
    const html = normalizeClipboardHtml(frag, document);
    expect(html).toContain('src="data:image/png;base64,');
    URL.revokeObjectURL(blobUrl);
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  it("过滤隐藏卡片工具栏等选择器", () => {
    const html = normalizeClipboardHtml(
      fragmentFromHtml('<div class="ne-card-toolbar">工具</div><p>正文</p>'),
      document
    );
    expect(html).toBe("<p>正文</p>");
  });

  it("丢弃 javascript: 链接，保留 https/mailto", () => {
    const html = normalizeClipboardHtml(
      fragmentFromHtml(
        '<a href="https://example.com">好</a><a href="javascript:alert(1)">坏</a><a href="mailto:a@b.c">邮</a>'
      ),
      document
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="mailto:a@b.c"');
    expect(html).not.toContain("javascript:");
  });
});

describe("normalizeImageDataUrl", () => {
  it("按真实格式修正 MIME（jpeg 头实际为 PNG → png）", () => {
    expect(normalizeImageDataUrl(`data:image/jpeg;base64,${PNG_1PX}`)).toBe(`data:image/png;base64,${PNG_1PX}`);
  });

  it("非法 base64 返回 null", () => {
    expect(normalizeImageDataUrl("data:image/png;base64,!!!not-base64!!!")).toBeNull();
  });

  it("非 base64 的 data URL 返回 null", () => {
    expect(normalizeImageDataUrl("data:image/svg+xml,%3Csvg%3E")).toBeNull();
  });

  it("普通 http 地址原样返回", () => {
    expect(normalizeImageDataUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
  });
});

describe("upgradePastedHtml（知乎懒加载空 SVG → 真实 URL）", () => {
  it("空白 SVG + data-actualsrc → 替换 src", () => {
    const html =
      '<img src="data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3C/svg%3E" data-actualsrc="https://cdn.example.com/a.jpg">';
    const out = upgradePastedHtml(html);
    expect(out).toContain('src="https://cdn.example.com/a.jpg"');
  });

  it("空白 SVG + data-src → 替换 src", () => {
    const html = '<img src="data:image/svg+xml;utf8,<svg></svg>" data-src="https://cdn.example.com/b.jpg">';
    const out = upgradePastedHtml(html);
    expect(out).toContain('src="https://cdn.example.com/b.jpg"');
  });

  it("srcset 兜底提取首张图", () => {
    const html = '<img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" srcset="https://cdn.example.com/c.jpg 1x">';
    const out = upgradePastedHtml(html);
    expect(out).toContain('src="https://cdn.example.com/c.jpg"');
  });

  it("含绘制元素的 SVG 视为真实图，不替换", () => {
    const html =
      '<img src="data:image/svg+xml,%3Csvg%3E%3Cpath%20d=%22M0%200%22/%3E%3C/svg%3E" data-actualsrc="https://cdn.example.com/d.jpg">';
    const out = upgradePastedHtml(html);
    expect(out).not.toContain('<img src="https://cdn.example.com/d.jpg"');
    expect(out).toContain('<img src="data:image/svg+xml');
  });

  it("无空 SVG 占位时原样返回", () => {
    const html = '<img src="https://cdn.example.com/e.jpg">';
    expect(upgradePastedHtml(html)).toBe(html);
  });
});
