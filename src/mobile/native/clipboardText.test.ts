/**
 * readClipboardText 壳层护栏（261119「剪切板小记」）：
 *  · 原生 = 自有 ClipboardText 插件（只取文本）；
 *  · web 预览 = navigator.clipboard.readText，不可用/被拒 = 空串；
 *  · 任何失败都不抛错 —— 读不到只是拿不到预填内容（调用方给 toast + 空白写作卡）。
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  native: { value: false },
  readText: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => h.native.value },
  registerPlugin: () => ({ readText: h.readText }),
}));

import { readClipboardText } from "./clipboardText";

const setWebClipboard = (clipboard: unknown) => {
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
};

beforeEach(() => {
  h.native.value = false;
  h.readText.mockReset();
  setWebClipboard(undefined);
});

describe("readClipboardText", () => {
  it("原生：插件回文本 ⇒ 原样返回", async () => {
    h.native.value = true;
    h.readText.mockResolvedValue({ text: "最新一条文本" });
    await expect(readClipboardText()).resolves.toBe("最新一条文本");
  });

  it("原生：空剪贴板/非文本（text 空串或缺失）⇒ 空串", async () => {
    h.native.value = true;
    h.readText.mockResolvedValue({ text: "" });
    await expect(readClipboardText()).resolves.toBe("");
    h.readText.mockResolvedValue({});
    await expect(readClipboardText()).resolves.toBe("");
    h.readText.mockResolvedValue(null);
    await expect(readClipboardText()).resolves.toBe("");
  });

  it("原生：插件异常（旧 APK/被拒）⇒ 空串，不抛错", async () => {
    h.native.value = true;
    h.readText.mockRejectedValue(new Error("not implemented"));
    await expect(readClipboardText()).resolves.toBe("");
  });

  it("web 预览：navigator.clipboard.readText 可用 ⇒ 文本", async () => {
    setWebClipboard({ readText: vi.fn().mockResolvedValue("web text") });
    await expect(readClipboardText()).resolves.toBe("web text");
    expect(h.readText).not.toHaveBeenCalled();
  });

  it("web 预览：readText 被拒 / 不可用 ⇒ 空串", async () => {
    setWebClipboard({ readText: vi.fn().mockRejectedValue(new Error("denied")) });
    await expect(readClipboardText()).resolves.toBe("");
    setWebClipboard({});
    await expect(readClipboardText()).resolves.toBe("");
    setWebClipboard(undefined);
    await expect(readClipboardText()).resolves.toBe("");
  });
});
