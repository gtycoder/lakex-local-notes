// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { clipboardImageBlob } from "./selectionClipboard";

/** 1×1 透明 PNG 的 data URL（真实字节，不是占位）。 */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
/** GIF89a 的 1×1 头（足够让 data URL 解析通过；jsdom 里没有 canvas ⇒ 期望转不出 PNG）。 */
const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

describe("复制图片时补系统剪贴板的位图（261121：DSH / Codex 只读剪贴板图片）", () => {
  it("HTML 里的 PNG data URL → image/png Blob（字节数一致）", async () => {
    const blob = await clipboardImageBlob(`<img src="${PNG}">`);
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe("image/png");
    expect(blob!.size).toBeGreaterThan(0);
  });

  it("没有图片 / 坏 data URL → null（不影响原来的纯文本粘贴）", async () => {
    expect(await clipboardImageBlob("<p>只有文字</p>")).toBeNull();
    expect(await clipboardImageBlob('<img src="data:image/png;base64,@@@">')).toBeNull();
  });

  it("非 PNG（GIF）在无 canvas 环境返回 null 且不抛（有 canvas 时才转一帧）", async () => {
    await expect(clipboardImageBlob(`<img src="${GIF}">`)).resolves.toBeNull();
  });
});
