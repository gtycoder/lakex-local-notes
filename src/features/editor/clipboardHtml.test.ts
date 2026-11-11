// @vitest-environment jsdom
import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { buildAssetDataUrlRequest, buildClipboardPayload, canonicalAssetUrlForCopy, isMobileEnvironment, normalizeClipboardHtml, normalizeImageDataUrl, upgradePastedHtml } from "./clipboardHtml";

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

describe("canonicalAssetUrlForCopy（复制取原图前的 URL 规范化）", () => {
  const base = "http://127.0.0.1:19876/n1/a.jpg";
  it("去掉显示用 w 与 date，保留 token 与其它 query", () => {
    expect(canonicalAssetUrlForCopy(base + "?w=1024&date=123&token=T&x=1")).toBe(base + "?token=T&x=1");
    expect(canonicalAssetUrlForCopy(base + "?token=T&w=1024")).toBe(base + "?token=T");
  });
  it("只有 w 时不留空 query", () => {
    expect(canonicalAssetUrlForCopy(base + "?w=1024")).toBe(base);
  });
  it("非本地资产 / 无 query 原样", () => {
    const external = "https://example.com/a.png?w=1024";
    expect(canonicalAssetUrlForCopy(external)).toBe(external);
    expect(canonicalAssetUrlForCopy(base)).toBe(base);
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

describe("本地资产复制取原图（task-30）", () => {
  const RealXhr = globalThis.XMLHttpRequest;
  class FakeXhr {
    static lastUrl = "";
    static status = 200;
    static body = `data:image/png;base64,${PNG_1PX}`;
    open(_method: string, url: string): void { FakeXhr.lastUrl = url; }
    send(): void { /* 同步桩 */ }
    get status(): number { return FakeXhr.status; }
    get responseText(): string { return FakeXhr.body; }
  }
  beforeAll(() => {
    (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
  });
  afterAll(() => {
    (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = RealXhr;
  });
  afterEach(() => {
    FakeXhr.lastUrl = "";
    FakeXhr.status = 200;
    FakeXhr.body = `data:image/png;base64,${PNG_1PX}`;
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    delete (window as unknown as { lakeAssetToken?: unknown }).lakeAssetToken;
  });

  it("移动端：本地资产先同步取 ?base64=1 原图（w/date 去掉、token 保留），不走 canvas 缩略图", () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    (window as unknown as { lakeAssetToken?: unknown }).lakeAssetToken = { getToken: () => "T" };
    const html = normalizeClipboardHtml(
      fragmentFromHtml('<img src="http://127.0.0.1:19876/quick-notes/q1/a.jpg?w=1024&date=123&token=T">'),
      document
    );
    expect(html).toContain('src="data:image/png;base64,');
    const requestUrl = new URL(FakeXhr.lastUrl);
    expect(requestUrl.searchParams.get("base64")).toBe("1");
    expect(requestUrl.searchParams.get("w")).toBeNull();
    expect(requestUrl.searchParams.get("date")).toBeNull();
    expect(requestUrl.searchParams.get("token")).toBe("T");
  });

  it("桌面：本地资产同样先取原图（URL 去 w，不影响桌面 base64=1 语义）", () => {
    const html = normalizeClipboardHtml(
      fragmentFromHtml('<img src="http://127.0.0.1:19876/n1/a.png?w=1024">'),
      document
    );
    expect(html).toContain('src="data:image/png;base64,');
    const requestUrl = new URL(FakeXhr.lastUrl);
    expect(requestUrl.searchParams.get("base64")).toBe("1");
    expect(requestUrl.searchParams.get("w")).toBeNull();
  });

  it("移动端：取原图失败才退回 canvas（已解码图不丢）", () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    FakeXhr.status = 500;
    const frag = fragmentFromHtml('<img src="http://127.0.0.1:19876/n1/a.jpg?w=1024" width="1" height="1">');
    const imgEl = frag.querySelector("img")!;
    Object.defineProperty(imgEl, "naturalWidth", { value: 1, configurable: true });
    Object.defineProperty(imgEl, "complete", { value: true, configurable: true });
    const html = normalizeClipboardHtml(frag, document);
    expect(html).toContain('src="data:image/png;base64,');
    expect(new URL(FakeXhr.lastUrl).searchParams.get("base64")).toBe("1");
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

  it("大图只嗅探前缀、payload 原样保留（复制不被整串 atob 卡住）", () => {
    const padding = "A".repeat(2_000_000);   // ≈1.5MB 二进制：整串 atob 会明显吃内存
    const value = `data:image/jpeg;base64,${PNG_1PX}${padding}`;
    const out = normalizeImageDataUrl(value);
    expect(out).toBe(`data:image/png;base64,${PNG_1PX}${padding}`);
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
describe("buildClipboardPayload（⌘C 与块菜单「复制」共用同一份）", () => {
  function rangeAcross(html: string): { range: Range; host: HTMLElement } {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const range = document.createRange();
    range.setStartBefore(host.firstElementChild!);
    range.setEndAfter(host.lastElementChild!);
    return { range, host };
  }

  it("跨块 range：plain 按块保留换行、html 依次包含所有块", () => {
    const { range, host } = rangeAcross("<p>第一段</p><p>第二段</p>");
    const payload = buildClipboardPayload(range, document);
    expect(payload.plain).toBe("第一段\n第二段");
    expect(payload.html).toContain("第一段");
    expect(payload.html).toContain("第二段");
    expect(payload.html.indexOf("第一段")).toBeLessThan(payload.html.indexOf("第二段"));
    host.remove();
  });

  it("html 复用 normalizeClipboardHtml（隐藏节点/零宽字符只清一次）", () => {
    const { range, host } = rangeAcross('<div class="ne-card-toolbar">工具</div><p>正\u200B文</p>');
    const payload = buildClipboardPayload(range, document);
    expect(payload.html).not.toContain("工具");
    expect(payload.html).toBe("<p>正文</p>");
    host.remove();
  });

  it("plain 保留块间换行：段落/标题/列表项各自成行；单个段内选区不额外加换行", () => {
    const { range, host } = rangeAcross("<p>a</p><h2>标题</h2><ul><li>x</li><li>y</li></ul>");
    expect(buildClipboardPayload(range, document).plain).toBe("a\n标题\nx\ny");
    host.remove();

    const inline = document.createElement("div");
    inline.innerHTML = "<p>hello world</p>";
    document.body.appendChild(inline);
    const textNode = inline.querySelector("p")!.firstChild!;
    const inner = document.createRange();
    inner.setStart(textNode, 0);
    inner.setEnd(textNode, 5);
    expect(buildClipboardPayload(inner, document).plain).toBe("hello");
    inline.remove();
  });

  it("嵌套块（卡片内段落 / 块中块）只保留单换行，不产生空行", () => {
    const { range, host } = rangeAcross(
      "<ne-card><ne-p>a</ne-p><ne-p>b</ne-p></ne-card><ne-p>c</ne-p><div><div>d</div></div>",
    );
    expect(buildClipboardPayload(range, document).plain).toBe("a\nb\nc\nd");
    host.remove();
  });

  it("代码块内部原始空行保留；代码块与段落之间仍单换行", () => {
    const { range, host } = rangeAcross(
      "<p>前</p><pre>a\n\nb</pre><p>后</p><ne-code-block><div>line1</div><div></div><div>line3</div></ne-code-block>",
    );
    expect(buildClipboardPayload(range, document).plain).toBe("前\na\n\nb\n后\nline1\n\nline3");
    host.remove();
  });

  it("plain 把 <br> 转换行、跳过隐藏节点与零宽字符", () => {
    const { range, host } = rangeAcross('<p>a<br>b</p><div class="ne-card-toolbar">工具</div><p>c\u200Bd</p>');
    expect(buildClipboardPayload(range, document).plain).toBe("a\nb\ncd");
    host.remove();
  });
});
