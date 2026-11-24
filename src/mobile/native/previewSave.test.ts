import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveFileToUserVisible: vi.fn(async () => ({ ok: true, name: "a.png", dir: "Gallery" })),
  showToast: vi.fn(),
}));
vi.mock("./openFileSave", () => ({ saveFileToUserVisible: mocks.saveFileToUserVisible }));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));

import { assetLocalKeyOf, installImagePreviewSave } from "./previewSave";
import { getPreviewActions, setPreviewActions, closeImagePreview } from "../../features/editor/imagePreview";

describe("图片预览长按保存到手机（261124）", () => {
  it("URL → 资产 localKey：文档图 / 小记图 / staging / 外链", () => {
    expect(assetLocalKeyOf("http://127.0.0.1:19876/n1/a.png?w=1024")).toBe("note-assets/n1/a.png");
    expect(assetLocalKeyOf("http://127.0.0.1:19876/quick-notes/q1/b.jpg")).toBe("quick-notes/assets/q1/b.jpg"); // 规范 quick URL = /quick-notes/{id}/{file}
    expect(assetLocalKeyOf("http://127.0.0.1:19876/quick-notes/staging/d1/c.png")).toBeNull(); // 草稿暂存不外送
    expect(assetLocalKeyOf("https://example.com/x.png")).toBeNull(); // 非本机资产
  });

  it("注册动作：保存走 localKey + 相册（toDownloads=false）；失败给错误 toast", async () => {
    installImagePreviewSave();
    const actions = getPreviewActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].label).toBe("保存到手机");
    await actions[0].run({ src: "http://127.0.0.1:19876/n1/a.png?w=1024", originalSrc: "http://127.0.0.1:19876/n1/a.png" });
    expect(mocks.saveFileToUserVisible).toHaveBeenCalledWith({ localKey: "note-assets/n1/a.png", name: "a.png", mime: "image/png", toDownloads: false });
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining("已保存到相册"), expect.anything());
    // 外链：不调原生、给可读错误
    mocks.saveFileToUserVisible.mockClear();
    await actions[0].run({ src: "https://example.com/x.png" });
    expect(mocks.saveFileToUserVisible).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenLastCalledWith(expect.stringContaining("暂不支持保存"), expect.objectContaining({ type: "error" }));
    setPreviewActions(null);
    closeImagePreview();
  });
});
