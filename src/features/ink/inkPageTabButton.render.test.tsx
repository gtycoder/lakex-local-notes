// @vitest-environment jsdom
/**
 * 底栏「页签」按钮（261104 二十六批二轮）：页签编辑的独立入口。
 * 三态：无页签 ⇒「打标记」（空串保存）；有文字改了 ⇒「保存」；「清除页签」= 删字段。只读禁用整层。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { InkPageTabButton, type InkPageTabButtonProps } from "./InkPageTabButton";

interface Mounted { container: HTMLElement; unmount: () => Promise<void> }

async function mount(props: Partial<InkPageTabButtonProps> = {}): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const full: InkPageTabButtonProps = {
    page: { note: undefined },
    pageNumber: 3,
    readOnly: false,
    onSave: () => undefined,
    onClear: () => undefined,
    ...props,
  };
  await act(async () => { root.render(<InkPageTabButton {...full} />); });
  return { container, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}

const byLabel = (root: ParentNode, label: string) => root.querySelector('[aria-label="' + label + '"]') as HTMLElement | null;
const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); };
const setInput = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("底栏「页签」按钮", () => {
  it("默认收起；点开显示「第 N 页页签」+ 输入框 + 打标记/清除页签", async () => {
    const view = await mount();
    expect(view.container.querySelector("[data-ink-page-tab]")).toBeNull();
    await click(byLabel(view.container, "页签"));
    const pop = view.container.querySelector("[data-ink-page-tab]")!;
    expect(pop).not.toBeNull();
    expect(pop.textContent).toContain("第 3 页页签");
    // 自适应展开方向：靠左时向右展开（is-align-left），避免被面板/窗口裁掉
    expect(pop.className).toMatch(/is-align-(left|right)/);
    const input = pop.querySelector(".ink-page-tab__input") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(pop.querySelector(".ink-page-tab__save")!.textContent).toBe("打标记");
    expect((pop.querySelector(".ink-page-tab__clear") as HTMLButtonElement).disabled).toBe(true);
    await view.unmount();
  });

  it("空输入「打标记」⇒ onSave(\"\")（纯标记）；有文字「保存」⇒ onSave(文字)", async () => {
    const onSave = vi.fn();
    const view = await mount({ onSave });
    await click(byLabel(view.container, "页签"));
    await click(view.container.querySelector(".ink-page-tab__save"));
    expect(onSave).toHaveBeenCalledWith("");
    // 打开状态被关掉，重新打开并输入文字
    await click(byLabel(view.container, "页签"));
    const input = view.container.querySelector(".ink-page-tab__input") as HTMLInputElement;
    await setInput(input, "  第三章要点  ");
    expect(view.container.querySelector(".ink-page-tab__save")!.textContent).toBe("保存");
    await click(view.container.querySelector(".ink-page-tab__save"));
    expect(onSave).toHaveBeenLastCalledWith("第三章要点");
    await view.unmount();
  });

  it("已有页签：回显文字、清除可用；清除走 onClear", async () => {
    const onClear = vi.fn();
    const view = await mount({ page: { note: "已有的一句话" }, onClear });
    await click(byLabel(view.container, "页签"));
    const input = view.container.querySelector(".ink-page-tab__input") as HTMLInputElement;
    expect(input.value).toBe("已有的一句话");
    const save = view.container.querySelector(".ink-page-tab__save") as HTMLButtonElement;
    expect(save.disabled).toBe(true); // 没改动
    const clear = view.container.querySelector(".ink-page-tab__clear") as HTMLButtonElement;
    expect(clear.disabled).toBe(false);
    await click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("只读：输入框与两个动作都禁用（按钮本身可见）", async () => {
    const view = await mount({ readOnly: true, page: { note: "" } });
    expect((byLabel(view.container, "页签") as HTMLButtonElement).disabled).toBe(false);
    await click(byLabel(view.container, "页签"));
    expect((view.container.querySelector(".ink-page-tab__input") as HTMLInputElement).disabled).toBe(true);
    expect((view.container.querySelector(".ink-page-tab__save") as HTMLButtonElement).disabled).toBe(true);
    expect((view.container.querySelector(".ink-page-tab__clear") as HTMLButtonElement).disabled).toBe(true);
    await view.unmount();
  });

  it("Esc 关闭弹层（输入框内 Esc 也一样，且不冒泡给面板）", async () => {
    const view = await mount();
    await click(byLabel(view.container, "页签"));
    expect(view.container.querySelector("[data-ink-page-tab]")).not.toBeNull();
    await act(async () => {
      (view.container.querySelector(".ink-page-tab__input") as HTMLInputElement)
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(view.container.querySelector("[data-ink-page-tab]")).toBeNull();
    await view.unmount();
  });
});
