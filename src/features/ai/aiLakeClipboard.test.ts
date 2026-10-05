import { describe, expect, it, vi } from "vitest";
import { buildLakeClipboard, wrapNeClipboard } from "./aiLakeClipboard";

const HTML = '<div class="lake-content"><p class="ne-p">x</p></div>';
function fakeKernel(over: Record<string, unknown> = {}) {
  const writeData = vi.fn((format: string) => {
    if (format === "text/ne-inode") return '{"type":"fragment"}';
    if (format === "text/html") return HTML;
    if (format === "text/plain") return "x";
    return "";
  });
  return {
    readData: vi.fn((format: string, data: string) => (format === "text/markdown" && data ? { fragment: true } : null)),
    writeData,
    ...over,
  };
}

/** 「复制为 Lake」（261005）：外壳格式是内核内部约定（lakex.js eSz），这里锁住以防内核升级漂移。 */
describe("buildLakeClipboard", () => {
  it("外壳 = <ne-clipboard data=URL编码(ne-inode) source=URL编码(href)> + 内核 html", () => {
    const href = "lake://app/";
    const p = buildLakeClipboard(fakeKernel(), "**x**", href);
    expect(p).not.toBeNull();
    expect(p!.html).toBe('<ne-clipboard data="' + encodeURIComponent('{"type":"fragment"}') + '" source="' + encodeURIComponent(href) + '"></ne-clipboard>' + HTML);
    expect(p!.plain).toBe("x");
  });

  it("三种格式都由内核 writeData 产出（不自己拼正文）", () => {
    const k = fakeKernel();
    buildLakeClipboard(k, "**x**", "about:blank");
    expect(k.readData).toHaveBeenCalledWith("text/markdown", "**x**");
    const formats = k.writeData.mock.calls.map((c) => c[0]);
    expect(formats).toContain("text/ne-inode");
    expect(formats).toContain("text/html");
    expect(formats).toContain("text/plain");
  });

  it("解析失败 / 无 ne-inode ⇒ 返回 null（调用方回退）", () => {
    expect(buildLakeClipboard(fakeKernel({ readData: () => null }), "x", "about:blank")).toBeNull();
    expect(buildLakeClipboard(fakeKernel({ writeData: () => "" }), "x", "about:blank")).toBeNull();
  });

  it("wrapNeClipboard 与内核 eSz 逐字符一致", () => {
    expect(wrapNeClipboard("A B", "<p>h</p>", "x/y")).toBe('<ne-clipboard data="A%20B" source="x%2Fy"></ne-clipboard><p>h</p>');
  });
});
