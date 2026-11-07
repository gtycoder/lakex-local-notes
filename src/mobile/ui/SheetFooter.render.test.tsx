// @vitest-environment jsdom
/** SheetFooter 原语：标准两键/单键的 DOM 与禁用/忙态语义。 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetFooter } from "./SheetFooter";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const buttons = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>(".mb-sheet__foot button")];

describe("SheetFooter", () => {
  it("标准两键：顺序 = 取消 → 主操作；类名沿用 mb-btn 原语", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    await act(async () => root.render(createElement(SheetFooter, {
      cancel: { label: "取消", onClick: onCancel },
      confirm: { label: "确定", onClick: onConfirm },
    })));
    const [cancel, confirm] = buttons();
    expect(cancel.textContent).toBe("取消");
    expect(cancel.className).toContain("mb-btn--secondary");
    expect(confirm.textContent).toBe("确定");
    expect(confirm.className).toContain("mb-btn--primary");
    await act(async () => { cancel.click(); confirm.click(); });
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalled();
  });

  it("单键（只有取消/只有确认）与 busy：busy 时禁用并显示处理文案", async () => {
    await act(async () => root.render(createElement(SheetFooter, { cancel: { label: "关闭" } })));
    expect(buttons()).toHaveLength(1);
    await act(async () => root.render(createElement(SheetFooter, {
      confirm: { label: "保存", busy: true, busyLabel: "保存中…", onClick: vi.fn() },
    })));
    const [confirm] = buttons();
    expect(confirm.textContent).toBe("保存中…");
    expect(confirm.disabled).toBe(true);
  });

  it("danger / grow / compact 与自定义 children", async () => {
    await act(async () => root.render(createElement(SheetFooter, {
      cancel: { label: "取消", grow: true },
      confirm: { label: "删除", variant: "danger", grow: true },
      children: createElement("button", { type: "button", className: "mb-btn mb-btn--secondary mb-btn--sm" }, "清除"),
    })));
    const all = buttons();
    expect(all).toHaveLength(3);
    expect(all[0].className).toContain("mb-flex1");
    expect(all[1].textContent).toBe("清除");
    expect(all[2].className).toContain("mb-btn--danger");
    expect(all[2].className).toContain("mb-flex1");
  });
});
