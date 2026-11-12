// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublishDocDialog, type PublishDocDialogProps } from "./PublishDocDialog";

/**
 * 桌面共享「保存为文档」弹窗（261112 task-91）：AI 写作「生成文档」与日记「转为文档」同一实现。
 * 这里只锁**共享契约**（业务过滤在调用方）：
 *  · 候选只到笔记本这一层（弹窗直接消费调用方给的列表，不再二次过滤/不出现目录树）；
 *  · 标题默认值来自 props、可改，确认真回传 (notebookId, title)；
 *  · heading / description / confirmLabel 可换口径（AI「生成文档」/ 日记「转为文档」）；
 *  · 空候选、空标题不可确认；busy 禁用并显示 busyLabel；error 走 role=alert。
 */
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const dialogEl = () => document.querySelector<HTMLElement>(".floating-dialog.publish-doc")!;
const buttonByText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((el) => (el.textContent ?? "").trim() === text);

function render(overrides: Partial<PublishDocDialogProps> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  act(() => root.render(createElement(PublishDocDialog, {
    open: true, title: "AI 生成文档", notebooks: [{ id: "nb1", title: "个人笔记" }],
    busy: false, error: null, onConfirm, onClose, ...overrides,
  })));
  return { onConfirm, onClose };
}

describe("PublishDocDialog（桌面共享：AI 生成文档 / 日记转为文档）", () => {
  it("浮动窗 780×460 + 8 向缩放手柄；正文就是「知识库 + 标题」两行（没有目录树弹窗）", () => {
    render();
    const el = dialogEl();
    expect(el).toBeTruthy();
    expect(el.style.width).toBe("780px");
    expect(el.style.height).toBe("460px");
    expect(el.querySelectorAll(".floating-dialog-resize").length).toBe(8);
    expect(el.querySelector(".ln-dialog__body")).toBeTruthy();
    // 只有两行表单：知识库（下拉）+ 标题（输入）；不挂目录树/分组
    const labels = [...el.querySelectorAll(".ln-form__label")].map((n) => (n.textContent ?? "").trim());
    expect(labels).toEqual(["知识库", "标题"]);
    expect(el.querySelector('[role="tree"]')).toBeNull();
    expect(el.querySelector('[aria-label="选择知识库"]')?.textContent).toContain("个人笔记");
  });

  it("候选只到笔记本这一层：下拉选项 = 调用方列表（顺序一致）", () => {
    render({ notebooks: [{ id: "nb1", title: "个人笔记" }, { id: "nb2", title: "工作" }] });
    act(() => { dialogEl().querySelector<HTMLButtonElement>('[aria-label="选择知识库"]')!.click(); });
    const options = [...document.querySelectorAll('[role="listbox"] [role="option"]')].map((el) => (el.textContent ?? "").trim());
    expect(options).toEqual(["个人笔记", "工作"]);
  });

  it("标题可改：确认时把用户改过的标题（已 trim）与目标笔记本一起回传", () => {
    const { onConfirm } = render();
    const input = dialogEl().querySelector<HTMLInputElement>('[aria-label="文档标题"]')!;
    expect(input.value).toBe("AI 生成文档");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "  我改过的标题  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { buttonByText("确认")!.click(); });
    expect(onConfirm).toHaveBeenCalledWith("nb1", "我改过的标题");
  });

  it("日记口径：heading / description / confirmLabel 走 props（不出现「生成文档」的默认文案）", () => {
    const onClose = vi.fn();
    render({
      heading: "转为文档", title: "2025-12-31",
      description: "把这篇日记移出日记本、存成知识库里的普通文档。",
      confirmLabel: "转为文档", onClose,
    });
    expect(document.querySelector(".ln-dialog__title")?.textContent).toBe("转为文档");
    expect(document.body.textContent).toContain("把这篇日记移出日记本");
    expect(buttonByText("转为文档")).toBeTruthy();
    expect(document.body.textContent).not.toContain("把这条回答保存为一篇文档");
    act(() => { dialogEl().querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("边界：空候选给提示且不可确认；空标题不可确认；busy 禁用并显示 busyLabel；error 可见", () => {
    render({ notebooks: [] });
    expect(document.body.textContent).toContain("还没有可用的知识库");
    expect(buttonByText("确认")!.disabled).toBe(true);
    act(() => root.unmount());

    // 空标题（只有空格）⇒ 不可确认
    root = createRoot(host);
    render();
    const input = dialogEl().querySelector<HTMLInputElement>('[aria-label="文档标题"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(input, "   "); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(buttonByText("确认")!.disabled).toBe(true);

    // busy ⇒ 禁用 + busyLabel；error ⇒ role=alert
    act(() => root.unmount());
    root = createRoot(host);
    render({ busy: true, busyLabel: "生成中…", error: "生成文档失败" });
    const busy = buttonByText("生成中…")!;
    expect(busy.disabled).toBe(true);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("生成文档失败");
  });
});
