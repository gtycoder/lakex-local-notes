// @vitest-environment jsdom
/** 移动端命名弹窗（v2 261107）：新建 / 重命名统一走它。 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NameSheet } from "./NameSheet";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onClose = vi.fn();
const onSubmit = vi.fn();

const render = async (props: Partial<{ open: boolean; initialValue: string; busy: boolean }> = {}): Promise<void> => {
  await act(async () => {
    root.render(createElement(NameSheet, {
      open: props.open ?? true,
      title: "重命名",
      initialValue: props.initialValue ?? "",
      busy: props.busy ?? false,
      onClose,
      onSubmit,
    }));
  });
};
const input = (): HTMLInputElement => host.querySelector("#mb-name-sheet-input") as HTMLInputElement;
const btn = (label: string): HTMLButtonElement =>
  [...host.querySelectorAll<HTMLButtonElement>(".mb-sheet__foot button")].find((b) => (b.textContent ?? "").trim() === label)!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onClose.mockReset();
  onSubmit.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("NameSheet", () => {
  it("预填初始值；输入后点确定回传 trim 值", async () => {
    await render({ initialValue: "旧名字" });
    expect(input().value).toBe("旧名字");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(input(), "  新名字  ");
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { btn("确定").click(); });
    expect(onSubmit).toHaveBeenCalledWith("新名字");
  });

  it("空值不提交，给行内错误", async () => {
    await render();
    await act(async () => { btn("确定").click(); });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(host.textContent).toContain("名称不能为空");
  });

  it("取消只回调 onClose；busy 时按钮禁用", async () => {
    await render();
    await act(async () => { btn("取消").click(); });
    expect(onClose).toHaveBeenCalled();
    await render({ busy: true });
    // busy 时主按钮文案变「处理中…」且禁用。
    const primary = [...host.querySelectorAll<HTMLButtonElement>(".mb-sheet__foot button")][1];
    expect(primary.disabled).toBe(true);
    expect(primary.textContent).toContain("处理中");
  });
});
