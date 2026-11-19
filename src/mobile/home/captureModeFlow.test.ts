/**
 * 快捷入口取数流护栏（261119 拍照小记 / 剪切板小记；用户裁决「都做成替换」）：
 *  · camera：写作卡分包就绪（同一 loader）→ 相机 → 成功产出 **captureSeed 图片项**（text 空 + images=[拍照图]），
 *    与 clipboard **同一条** captureSeed 草稿通道（落草稿即整份替换未提交旧草稿），不再 insertFiles 并入；
 *    取消/失败 = **不落任何种子**（旧草稿一动不动，卡走草稿恢复态，不自动再弹）；过期会话结果一律不注入。
 *  · clipboard：文本交回预填（text=文本 + images 空，同通道）/ 空结果 500ms 复读一次再定论（Android 10+ 焦点时序）→ 空则 onEmpty。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  loadQuickNoteComposer: vi.fn(),
  takeCameraPhoto: vi.fn(),
  readClipboardText: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../native/cameraCapture", () => ({ takeCameraPhoto: h.takeCameraPhoto }));
vi.mock("../native/clipboardText", () => ({ readClipboardText: h.readClipboardText }));
vi.mock("../ui/toastBus", () => ({ showToast: h.showToast }));

import { runCameraCapture, runCaptureFlow, runClipboardPrefill } from "./captureModeFlow";

const always = () => true;
const photoFile = () => new File([new Uint8Array([1, 2, 3])], "camera_1.jpg", { type: "image/jpeg" });
const seedImage = { filename: "camera_1.jpg", mimeType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) };

beforeEach(() => {
  vi.useFakeTimers();
  h.loadQuickNoteComposer.mockReset().mockResolvedValue(undefined);
  h.takeCameraPhoto.mockReset();
  h.readClipboardText.mockReset();
  h.showToast.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("runCameraCapture", () => {
  it("写作卡分包就绪后调相机；成功交回 captureSeed 图片项（filename/mimeType/bytes）", async () => {
    h.takeCameraPhoto.mockResolvedValue(photoFile());
    const onPhoto = vi.fn();
    const onCancel = vi.fn();
    await runCameraCapture({ whenReady: h.loadQuickNoteComposer, isCurrent: always, onPhoto, onCancel });
    expect(h.loadQuickNoteComposer).toHaveBeenCalled();
    expect(h.takeCameraPhoto).toHaveBeenCalledTimes(1);
    expect(onPhoto).toHaveBeenCalledWith(seedImage);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("用户取消/失败（null）⇒ 只 onCancel（不落任何种子 ⇒ 旧草稿不动），不再自动弹", async () => {
    h.takeCameraPhoto.mockResolvedValue(null);
    const onPhoto = vi.fn();
    const onCancel = vi.fn();
    await runCameraCapture({ whenReady: h.loadQuickNoteComposer, isCurrent: always, onPhoto, onCancel });
    expect(onPhoto).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("会话已换代（新的快捷入口触发）⇒ 迟到结果不注入（photo / cancel 都不回调）", async () => {
    h.takeCameraPhoto.mockResolvedValue(photoFile());
    const onPhoto = vi.fn();
    const onCancel = vi.fn();
    await runCameraCapture({ whenReady: h.loadQuickNoteComposer, isCurrent: () => false, onPhoto, onCancel });
    expect(onPhoto).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("照片字节读取失败（arrayBuffer 抛错）⇒ 语义等价失败回传：onCancel 收尾 + 可见提示，不向调用方抛", async () => {
    const bad = {
      name: "camera_1.jpg",
      type: "image/jpeg",
      arrayBuffer: () => Promise.reject(new Error("read fail")),
    } as unknown as File;
    h.takeCameraPhoto.mockResolvedValue(bad);
    const onPhoto = vi.fn();
    const onCancel = vi.fn();
    await expect(runCameraCapture({ whenReady: h.loadQuickNoteComposer, isCurrent: always, onPhoto, onCancel })).resolves.toBeUndefined();
    expect(onPhoto).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(h.showToast).toHaveBeenCalledWith("速记内容准备失败", { type: "error" });
  });

  it("字节读取失败但会话已换代 ⇒ 迟到失败不回传（不回调、不提示）", async () => {
    const bad = {
      name: "camera_1.jpg",
      type: "image/jpeg",
      arrayBuffer: () => Promise.reject(new Error("read fail")),
    } as unknown as File;
    h.takeCameraPhoto.mockResolvedValue(bad);
    // 前两次 isCurrent（whenReady 后 / takeCameraPhoto 后）为真、失败回传那次已换代。
    let calls = 0;
    const isCurrent = () => { calls += 1; return calls <= 2; };
    const onPhoto = vi.fn();
    const onCancel = vi.fn();
    await runCameraCapture({ whenReady: h.loadQuickNoteComposer, isCurrent, onPhoto, onCancel });
    expect(onPhoto).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(h.showToast).not.toHaveBeenCalled();
  });
});

describe("runCaptureFlow（camera 与 clipboard 同走 captureSeed 草稿通道 —— 「都做成替换」）", () => {
  const flowInput = () => ({
    whenReady: h.loadQuickNoteComposer,
    isCurrent: always,
    setCaptureSeed: vi.fn(),
    setSeedReady: vi.fn(),
    prefill: { current: true },
  });

  it("camera 成功 = text 空 + images=[拍照图] 的种子（落草稿替换旧草稿；不走 insertFiles 并入）", async () => {
    h.takeCameraPhoto.mockResolvedValue(photoFile());
    const input = flowInput();
    await runCaptureFlow({ mode: "camera", ...input });
    expect(input.setCaptureSeed).toHaveBeenCalledWith({ text: "", images: [seedImage] });
    // 落定前不挂写作卡（种子落成草稿后由 MobileApp 的 seed effect 放开）
    expect(input.setSeedReady).toHaveBeenCalledWith(false);
    expect(input.setSeedReady).not.toHaveBeenCalledWith(true);
    expect(input.prefill.current).toBe(false);
  });

  it("camera 取消 = 不落任何种子（旧草稿一动不动）：setCaptureSeed 不被调用，只放开挂载走草稿恢复态", async () => {
    h.takeCameraPhoto.mockResolvedValue(null);
    const input = flowInput();
    await runCaptureFlow({ mode: "camera", ...input });
    expect(input.setCaptureSeed).not.toHaveBeenCalled();
    expect(input.setSeedReady).toHaveBeenCalledTimes(1);
    expect(input.setSeedReady).toHaveBeenCalledWith(true);
    expect(input.prefill.current).toBe(false);
  });

  it("camera 取数失败（字节读取抛错）= 与取消同口径收尾：不落种子、放行挂载、清 pending + 可见提示（不静默留空壳）", async () => {
    const bad = {
      name: "camera_1.jpg",
      type: "image/jpeg",
      arrayBuffer: () => Promise.reject(new Error("read fail")),
    } as unknown as File;
    h.takeCameraPhoto.mockResolvedValue(bad);
    const input = flowInput();
    await runCaptureFlow({ mode: "camera", ...input });
    expect(input.setCaptureSeed).not.toHaveBeenCalled();
    expect(input.setSeedReady).toHaveBeenCalledWith(true);
    expect(input.prefill.current).toBe(false);
    expect(h.showToast).toHaveBeenCalledWith("速记内容准备失败", { type: "error" });
  });

  it("clipboard 成功 = text=剪贴板文本 + images 空 的种子（与 camera 同一条 captureSeed 通道）", async () => {
    h.readClipboardText.mockResolvedValue("一段文本");
    const input = flowInput();
    await runCaptureFlow({ mode: "clipboard", ...input });
    expect(input.setCaptureSeed).toHaveBeenCalledWith({ text: "一段文本", images: [] });
    expect(input.setSeedReady).toHaveBeenCalledWith(false);
    expect(input.prefill.current).toBe(false);
  });

  it("clipboard 空 = 不落种子（旧草稿不动）+ 可见提示，放开挂载", async () => {
    h.readClipboardText.mockResolvedValue("");
    const input = flowInput();
    const pending = runCaptureFlow({ mode: "clipboard", ...input });
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(input.setCaptureSeed).not.toHaveBeenCalled();
    expect(h.showToast).toHaveBeenCalledWith("剪贴板没有可用的文本");
    expect(input.setSeedReady).toHaveBeenCalledWith(true);
    expect(input.prefill.current).toBe(false);
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
