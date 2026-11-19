/**
 * takeCameraPhoto 语义护栏（261118「拍照变相册」修复）：
 *  · web 预览（mobile-preview）⇒ 回退既有 file input（保持现状）；
 *  · 原生成功 ⇒ 落盘字节组装成与相册选图同形的 File（后续走同一条 insertFiles/上传链路），读成功即删临时文件；
 *  · 用户取消 ⇒ null 且**不回退任何选择器**（绝不把取消变成「打开相册」）；
 *  · 原生失败/读失败 ⇒ 显式 toast + null（拍照绝不静默打开相册）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  native: { value: false },
  takePhoto: vi.fn(),
  readFile: vi.fn(),
  deleteFile: vi.fn(),
  pickLocalFile: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => h.native.value },
  registerPlugin: () => ({ takePhoto: h.takePhoto }),
}));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: { readFile: h.readFile, deleteFile: h.deleteFile },
}));
vi.mock("../ui/pickFile", () => ({ pickLocalFile: h.pickLocalFile }));
vi.mock("../ui/toastBus", () => ({ showToast: h.showToast }));

import { takeCameraPhoto } from "./cameraCapture";

const PHOTO = { cancelled: false, path: "camera/camera_1_ab12.jpg", name: "camera_1_ab12.jpg", mimeType: "image/jpeg", size: 3 };

beforeEach(() => {
  h.native.value = false;
  h.takePhoto.mockReset();
  h.readFile.mockReset();
  h.deleteFile.mockReset();
  h.pickLocalFile.mockReset();
  h.showToast.mockReset();
  h.deleteFile.mockResolvedValue(undefined);
});

describe("takeCameraPhoto", () => {
  it("web 预览无原生桥：回退既有 file input 方案（行为保持现状）", async () => {
    const fallback = new File([new Uint8Array([1])], "fallback.jpg", { type: "image/jpeg" });
    h.pickLocalFile.mockResolvedValue(fallback);
    const out = await takeCameraPhoto();
    expect(out).toBe(fallback);
    expect(h.pickLocalFile).toHaveBeenCalledWith("image/*", "environment");
    expect(h.takePhoto).not.toHaveBeenCalled();
  });

  it("原生成功：落盘字节组装 File（名/类型/字节），读成功即删临时文件", async () => {
    h.native.value = true;
    h.takePhoto.mockResolvedValue(PHOTO);
    h.readFile.mockResolvedValue({ data: btoa("abc") });
    const out = await takeCameraPhoto();
    expect(out).toBeInstanceOf(File);
    expect(out?.name).toBe("camera_1_ab12.jpg");
    expect(out?.type).toBe("image/jpeg");
    expect(out?.size).toBe(3);
    expect(new Uint8Array(await out!.arrayBuffer())).toEqual(new Uint8Array([97, 98, 99]));
    expect(h.readFile).toHaveBeenCalledWith({ path: "camera/camera_1_ab12.jpg", directory: "DATA" });
    expect(h.deleteFile).toHaveBeenCalledWith({ path: "camera/camera_1_ab12.jpg", directory: "DATA" });
    expect(h.pickLocalFile).not.toHaveBeenCalled();
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it("用户取消：返回 null 且不回退选择器（取消绝不变成打开相册）", async () => {
    h.native.value = true;
    h.takePhoto.mockResolvedValue({ cancelled: true });
    const out = await takeCameraPhoto();
    expect(out).toBeNull();
    expect(h.readFile).not.toHaveBeenCalled();
    expect(h.pickLocalFile).not.toHaveBeenCalled();
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it("原生调用失败（无相机应用/插件缺失）：显式提示，不静默开相册", async () => {
    h.native.value = true;
    h.takePhoto.mockRejectedValue(new Error("camera unavailable"));
    const out = await takeCameraPhoto();
    expect(out).toBeNull();
    expect(h.showToast).toHaveBeenCalledWith(expect.stringContaining("无法调起相机"), { type: "error" });
    expect(h.pickLocalFile).not.toHaveBeenCalled();
  });

  it("读字节失败/空照片：显式提示且保留临时文件（不回插空图）", async () => {
    h.native.value = true;
    h.takePhoto.mockResolvedValue(PHOTO);
    h.readFile.mockResolvedValue({ data: "" });
    const out = await takeCameraPhoto();
    expect(out).toBeNull();
    expect(h.showToast).toHaveBeenCalledWith(expect.stringContaining("照片读取失败"), { type: "error" });
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it("回传缺 path/name 视同取消", async () => {
    h.native.value = true;
    h.takePhoto.mockResolvedValue({ cancelled: false, name: "camera_1_ab12.jpg" });
    expect(await takeCameraPhoto()).toBeNull();
    expect(h.showToast).not.toHaveBeenCalled();
  });
});
