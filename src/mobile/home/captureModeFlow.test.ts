/**
 * 快捷入口取数流护栏（261119 拍照小记 / 剪切板小记）：
 *  · camera：写作卡就绪（同一 loader）→ 相机 → 成功交回 File / 取消与过期会话不回调（空卡、不自动再弹）；
 *  · clipboard：文本交回预填 / 空结果 500ms 复读一次再定论（Android 10+ 焦点时序）→ 空则 onEmpty。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  loadQuickNoteComposer: vi.fn(),
  takeCameraPhoto: vi.fn(),
  readClipboardText: vi.fn(),
}));

vi.mock("../native/cameraCapture", () => ({ takeCameraPhoto: h.takeCameraPhoto }));
vi.mock("../native/clipboardText", () => ({ readClipboardText: h.readClipboardText }));

import { runCameraCapture, runClipboardPrefill } from "./captureModeFlow";

const always = () => true;

beforeEach(() => {
  vi.useFakeTimers();
  h.loadQuickNoteComposer.mockReset().mockResolvedValue(undefined);
  h.takeCameraPhoto.mockReset();
  h.readClipboardText.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("runCameraCapture", () => {
  it("写作卡就绪后调相机；成功交回 File（入卡由调用方走 insertFiles）", async () => {
    const file = new File([new Uint8Array([1])], "camera_1.jpg", { type: "image/jpeg" });
    h.takeCameraPhoto.mockResolvedValue(file);
    const onPhoto = vi.fn();
    await runCameraCapture({ whenReady: h.loadQuickNoteComposer, isCurrent: always, onPhoto });
    expect(h.loadQuickNoteComposer).toHaveBeenCalled();
    expect(h.takeCameraPhoto).toHaveBeenCalledTimes(1);
    expect(onPhoto).toHaveBeenCalledWith(file);
  });

  it("用户取消/失败（null）⇒ 不回调（保留空白写作卡，不再自动弹）", async () => {
    h.takeCameraPhoto.mockResolvedValue(null);
    const onPhoto = vi.fn();
    await runCameraCapture({ whenReady: h.loadQuickNoteComposer, isCurrent: always, onPhoto });
    expect(onPhoto).not.toHaveBeenCalled();
  });

  it("会话已换代（新的快捷入口触发）⇒ 迟到结果不注入", async () => {
    const file = new File([new Uint8Array([1])], "camera_1.jpg", { type: "image/jpeg" });
    h.takeCameraPhoto.mockResolvedValue(file);
    const onPhoto = vi.fn();
    await runCameraCapture({ whenReady: h.loadQuickNoteComposer, isCurrent: () => false, onPhoto });
    expect(onPhoto).not.toHaveBeenCalled();
  });
});

describe("runClipboardPrefill", () => {
  it("剪贴板有文本 ⇒ onText（去掉首尾空白）", async () => {
    h.readClipboardText.mockResolvedValue("  一段文本\n");
    const onText = vi.fn();
    const onEmpty = vi.fn();
    await runClipboardPrefill({ isCurrent: always, onText, onEmpty });
    expect(onText).toHaveBeenCalledWith("一段文本");
    expect(onEmpty).not.toHaveBeenCalled();
  });

  it("空结果 500ms 后复读一次（焦点时序兜底）；仍空 ⇒ onEmpty", async () => {
    h.readClipboardText.mockResolvedValue("");
    const onText = vi.fn();
    const onEmpty = vi.fn();
    const pending = runClipboardPrefill({ isCurrent: always, onText, onEmpty });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.readClipboardText).toHaveBeenCalledTimes(1);
    expect(onEmpty).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(h.readClipboardText).toHaveBeenCalledTimes(2);
    expect(onText).not.toHaveBeenCalled();
    expect(onEmpty).toHaveBeenCalledTimes(1);
  });

  it("第一次空、复读拿到文本 ⇒ 仍按有文本预填", async () => {
    h.readClipboardText.mockResolvedValueOnce("").mockResolvedValueOnce("晚到的文本");
    const onText = vi.fn();
    const onEmpty = vi.fn();
    const pending = runClipboardPrefill({ isCurrent: always, onText, onEmpty });
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(onText).toHaveBeenCalledWith("晚到的文本");
    expect(onEmpty).not.toHaveBeenCalled();
  });
});
