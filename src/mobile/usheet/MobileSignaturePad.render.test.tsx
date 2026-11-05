// @vitest-environment jsdom
/**
 * 移动端表格「手写签名」浮层（261104）渲染护栏。
 *
 * 只验宿主层：浮层内容/动作可用态/取消与返回键；canvas 实际绘制与 PNG 导出在真机验证。
 * 导出裁剪的几何判据是纯函数（signatureInkBounds），直接在 node/jsdom 下单测。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MobileSignaturePad, signatureInkBounds } from "./MobileSignaturePad";

interface Mounted {
  container: HTMLElement;
  unmount: () => Promise<void>;
}

async function mount(props: Partial<{ open: boolean; busy: boolean; onCancel: () => void; onConfirm: (png: Uint8Array) => void }> = {}): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const merged = {
    open: true,
    busy: false,
    onCancel: () => undefined,
    onConfirm: () => undefined,
    ...props,
  };
  await act(async () => { root.render(<MobileSignaturePad {...merged} />); });
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

const findButton = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === text) as HTMLButtonElement | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => { callback(0); return 0; }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => undefined) as typeof window.cancelAnimationFrame;
  // jsdom 无 canvas 2d：显式给 null，避免每个用例刷 "getContext not implemented"。
  window.HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof window.HTMLCanvasElement.prototype.getContext;
});

describe("移动端表格手写签名浮层", () => {
  it("未打开不渲染任何浮层", async () => {
    const view = await mount({ open: false });
    expect(view.container.querySelector(".mb-sheet")).toBeNull();
    await view.unmount();
  });

  it("打开：标题/画布/提示 + 撤销/清空/确认（无笔迹时三个动作都禁用）", async () => {
    const view = await mount();
    const sheet = view.container.querySelector(".mb-usheet-sign-sheet");
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain("手写签名");
    expect(sheet!.querySelector(".mb-usheet-sign__canvas")).not.toBeNull();
    expect(sheet!.textContent).toContain("在此处手写签名");
    expect(findButton(view.container, "确认")!.disabled).toBe(true);
    expect(findButton(view.container, "撤销")!.disabled).toBe(true);
    expect(findButton(view.container, "清空")!.disabled).toBe(true);
    expect(findButton(view.container, "取消")!.disabled).toBe(false);
    await view.unmount();
  });

  it("落笔后动作可用；撤销一次回到空态", async () => {
    const view = await mount();
    const canvas = view.container.querySelector(".mb-usheet-sign__canvas") as HTMLCanvasElement;
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 12, clientY: 16 }));
      canvas.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX: 12, clientY: 16 }));
    });
    expect(findButton(view.container, "确认")!.disabled).toBe(false);
    await act(async () => { findButton(view.container, "撤销")!.click(); });
    expect(findButton(view.container, "确认")!.disabled).toBe(true);
    await view.unmount();
  });

  it("busy：取消与确认都禁用（上传/写格期间不可二次提交）", async () => {
    const view = await mount({ busy: true });
    expect(findButton(view.container, "取消")!.disabled).toBe(true);
    // busy 时确认按钮文案改为「插入中…」，同样不可点。
    expect(findButton(view.container, "插入中…")!.disabled).toBe(true);
    await view.unmount();
  });

  it("取消走 onCancel（不触发 onConfirm）", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const view = await mount({ onCancel, onConfirm });
    await act(async () => { findButton(view.container, "取消")!.click(); });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("导出裁剪判据：笔迹 bbox + padding，夹在画布内；无笔迹返回 null", () => {
    expect(signatureInkBounds([], 300, 200)).toBeNull();
    expect(signatureInkBounds([{ x: 50, y: 60 }, { x: 150, y: 120 }], 300, 200, 10)).toEqual({ left: 40, top: 50, width: 120, height: 80 });
    // 贴边笔迹不能裁出画布外。
    expect(signatureInkBounds([{ x: 2, y: 3 }, { x: 298, y: 199 }], 300, 200, 12)).toEqual({ left: 0, top: 0, width: 300, height: 200 });
    // 单点（点按留下的圆点）同样保留 padding。
    expect(signatureInkBounds([{ x: 100, y: 100 }], 300, 200, 12)).toEqual({ left: 88, top: 88, width: 24, height: 24 });
  });
});
