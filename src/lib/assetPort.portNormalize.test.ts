/**
 * 【261118】端口归一化护栏：S3 配置后「同一条正文在不同端口/实例/设备打开」必须不坏图。
 *
 * 背景：正文里的图片是**绝对 URL**，历史上按「当次运行端口」落盘 ⇒ dev(19877)/packaged(19876)/
 * 回退端口(19878…) 之间互开就指向不存在的端口；上云后换设备（移动端固定 19876）同样坏图。
 * 契约（本文件钉死）：
 *   · 落盘/上云 = 规范端口 19876（stripAssetAccessToken）；
 *   · 渲染/内存文档 = 本实例实际端口（addAssetAccessToken / withAssetAccessToken / withLocalImageThumb）；
 *   · 两种形态都要覆盖：裸 URL 与内核卡片的百分号编码 JSON。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

function stubRuntime(assetPort: number, assetToken: string) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { lakeNative: { assetPort, assetToken } },
  });
  vi.resetModules();
}

afterEach(() => {
  vi.resetModules();
  if ("window" in globalThis) delete (globalThis as { window?: unknown }).window;
});

const ENCODED_CARD = "http%3A%2F%2F127.0.0.1%3A19876%2Fn1%2Fa.png";

describe("端口归一化：落盘规范端口 / 渲染实际端口", () => {
  it("dev 实例（19877）打开规范端口正文：裸 URL 与编码卡片都归一到 19877 并注入 token", async () => {
    stubRuntime(19877, "tok-19877");
    const mod = await import("./assetPort");
    const body = '<p><img src="http://127.0.0.1:19876/n1/a.png"></p><card value="data:%7B%22src%22%3A%22' + ENCODED_CARD + '%22%7D">';
    const rendered = mod.addAssetAccessToken(body);
    expect(rendered).toContain("http://127.0.0.1:19877/n1/a.png?token=tok-19877");
    expect(rendered).toContain("http%3A%2F%2F127.0.0.1%3A19877%2Fn1%2Fa.png");
    expect(rendered).not.toContain("127.0.0.1:19876");
  });

  it("保存时回到规范端口 19876 且 token 被剥离（这一条保证 S3 上的正文可移植）", async () => {
    stubRuntime(19877, "tok-19877");
    const mod = await import("./assetPort");
    const body = '<p><img src="http://127.0.0.1:19876/n1/a.png"></p><card value="data:%7B%22src%22%3A%22' + ENCODED_CARD + '%22%7D">';
    const rendered = mod.addAssetAccessToken(body);
    const saved = mod.stripAssetAccessToken(rendered);
    expect(saved).not.toContain("token=");
    expect(saved).not.toContain("127.0.0.1:19877");
    expect(saved).toContain("http://127.0.0.1:19876/n1/a.png");
    expect(saved).toContain(ENCODED_CARD);
    // 幂等：再走一轮不产生变化（否则每次保存都会改正文 ⇒ 同步反复上报内容变更）
    expect(mod.stripAssetAccessToken(saved)).toBe(saved);
  });

  it("回退端口实例（19878）同样把历史端口正文归一到自己（打开就正常显示）", async () => {
    stubRuntime(19878, "tok-fallback");
    const mod = await import("./assetPort");
    const body = '<img src="http://127.0.0.1:19877/n1/a.png">';
    expect(mod.addAssetAccessToken(body)).toContain("http://127.0.0.1:19878/n1/a.png?token=tok-fallback");
  });

  it("直接 URL 入口（小记缩略图/预览）也先归一端口再注入 token", async () => {
    stubRuntime(19877, "tok-19877");
    const mod = await import("./assetPort");
    expect(mod.withAssetAccessToken("http://127.0.0.1:19876/quick-notes/q1/b.png")).toBe("http://127.0.0.1:19877/quick-notes/q1/b.png?token=tok-19877");
    // 非资产地址不动（避免把其它本地服务改坏）
    expect(mod.withAssetAccessToken("http://127.0.0.1:19876/health")).toBe("http://127.0.0.1:19876/health");
  });

  it("缩略图档位：历史端口 URL 也能生成当前端口的 ?w=（否则缩略图直接不生效）", async () => {
    stubRuntime(19877, "tok-19877");
    const mod = await import("./assetPort");
    const thumb = mod.withLocalImageThumb("http://127.0.0.1:19876/n1/a.png", 128);
    expect(thumb.startsWith("http://127.0.0.1:19877/n1/a.png")).toBe(true);
    expect(thumb).toContain("w=128");
    // 非图片后缀不缩
    expect(mod.withLocalImageThumb("http://127.0.0.1:19876/n1/a.gif", 128)).toContain("a.gif");
  });

  it("移动端（固定 19876）打开桌面 dev 上传的正文：归一后仍指向 19876", async () => {
    stubRuntime(19876, "tok-mobile");
    const mod = await import("./assetPort");
    const body = '<img src="http://127.0.0.1:19877/n1/a.png">';
    expect(mod.addAssetAccessToken(body)).toBe('<img src="http://127.0.0.1:19876/n1/a.png?token=tok-mobile">');
  });
});