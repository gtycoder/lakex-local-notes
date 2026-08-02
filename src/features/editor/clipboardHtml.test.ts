// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { normalizeClipboardHtml, normalizeImageDataUrl, upgradePastedHtml } from "./clipboardHtml";

function fragmentFromHtml(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

// 1x1 透明 PNG
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

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
