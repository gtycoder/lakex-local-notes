// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageLightbox } from "./ImageLightbox";
import { closeImagePreview, openImagePreview, setPreviewActions } from "./imagePreview";

// 261124：预览内长按出动作菜单（移动端注册「保存到手机」）；无动作的端不渲染菜单。
describe("ImageLightbox 长按动作菜单", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    setPreviewActions(null);
    closeImagePreview();
    document.querySelectorAll(".image-lightbox").forEach((el) => el.remove());
  });

  const open = async () => {
    // 先渲染（订阅效果挂上）再打开——挤在同一个 act 里 emit 会早于订阅，state 为空。
    await act(async () => { root.render(createElement(ImageLightbox, null)); });
    await act(async () => { openImagePreview([{ src: "http://127.0.0.1:19876/n1/a.png" }], 0); });
  };
  const press = async (ms = 500) => {
    const stage = document.querySelector(".image-lightbox__stage")!;
    const t = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(t, "touches", { value: [{ clientX: 100, clientY: 100 }] });
    await act(async () => { stage.dispatchEvent(t); });
    await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  };

  it("无注册动作：长按不出菜单（桌面行为不变）", async () => {
    await open();
    await press();
    expect(document.querySelector(".image-lightbox__menu")).toBeNull();
  });

  it("有动作：长按出菜单，点动作执行、点取消关菜单", async () => {
    const run = vi.fn();
    setPreviewActions([{ id: "save", label: "保存到手机", run }]);
    await open();
    await press();
    const menu = document.querySelector(".image-lightbox__menu");
    expect(menu).not.toBeNull();
    expect(menu!.textContent).toContain("保存到手机");
    await act(async () => {
      (Array.from(menu!.querySelectorAll("button")).find((b) => b.textContent === "保存到手机") as HTMLButtonElement).click();
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".image-lightbox__menu")).toBeNull();
    // 再次长按 → 取消只关菜单
    await press();
    const menu2 = document.querySelector(".image-lightbox__menu");
    expect(menu2).not.toBeNull();
    await act(async () => {
      (Array.from(menu2!.querySelectorAll("button")).find((b) => b.textContent === "取消") as HTMLButtonElement).click();
    });
    expect(document.querySelector(".image-lightbox__menu")).toBeNull();
    expect(document.querySelector(".image-lightbox")).not.toBeNull(); // 预览不关
  });
});
