// @vitest-environment jsdom
/**
 * 移动端「页签」入口（261104 二十六批四轮）：顶部导航按钮 → 底部 Sheet 里编辑。
 * 按钮在导航里、Sheet 是宿主兄弟节点（不放胶囊滚动容器里，也不用 createPortal）。
 * 表单逻辑与桌面共用 InkPageTabForm（打标记/保存/清除三态；只读禁用）。
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MobilePageTabButton, MobilePageTabSheet, type MobilePageTabState } from "./MobilePageTab";

interface HostProps {
  pageNumber?: number;
  readOnly?: boolean;
  note?: string;
  onSave?: (text: string) => void;
  onClear?: () => void;
}

/** 与 MobileInkPad 同构的最小宿主：按钮 + 兄弟 Sheet。 */
function Host({ pageNumber = 3, readOnly = false, note, onSave = () => undefined, onClear = () => undefined }: HostProps) {
  const [open, setOpen] = useState<MobilePageTabState | null>(null);
  const state: MobilePageTabState = { pageNumber, readOnly, note, onSave, onClear };
  return (
    <>
      <MobilePageTabButton state={state} onOpen={setOpen} />
      <MobilePageTabSheet state={open} open={open !== null} onClose={() => setOpen(null)} />
    </>
  );
}

interface Mounted { container: HTMLElement; unmount: () => Promise<void> }

async function mount(props: HostProps = {}): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => { root.render(<Host {...props} />); });
  return { container, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}

const byLabel = (root: ParentNode, label: string) => root.querySelector('[aria-label="' + label + '"]') as HTMLElement | null;
const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); };

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("移动端页签入口", () => {
  it("入口是导航里的 44 按钮；点开是底部 Sheet，表单含「第 N 页页签」", async () => {
    const view = await mount();
    const trigger = byLabel(view.container, "页签") as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    expect(trigger.className).toContain("ink-tool");
    expect(view.container.querySelector(".mb-sheet")).toBeNull();
    await click(trigger);
    const sheet = view.container.querySelector(".mb-sheet")!;
    expect(sheet).not.toBeNull();
    expect(sheet.textContent).toContain("第 3 页页签");
    expect(sheet.querySelector(".ink-page-tab__input")).not.toBeNull();
    await view.unmount();
  });

  it("空输入「打标记」⇒ onSave(\"\") 并关 Sheet", async () => {
    const onSave = vi.fn();
    const view = await mount({ onSave });
    await click(byLabel(view.container, "页签"));
    const save = view.container.querySelector(".ink-page-tab__save") as HTMLButtonElement;
    expect(save.textContent).toBe("打标记");
    await click(save);
    expect(onSave).toHaveBeenCalledWith("");
    expect(view.container.querySelector(".mb-sheet")).toBeNull();
    await view.unmount();
  });

  it("已有页签：回显文字、清除可用；清除走 onClear", async () => {
    const onClear = vi.fn();
    const view = await mount({ note: "第三章要点", onClear });
    await click(byLabel(view.container, "页签"));
    expect((view.container.querySelector(".ink-page-tab__input") as HTMLInputElement).value).toBe("第三章要点");
    const clear = view.container.querySelector(".ink-page-tab__clear") as HTMLButtonElement;
    expect(clear.disabled).toBe(false);
    await click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("只读：入口可见，Sheet 里输入与两个动作禁用", async () => {
    const view = await mount({ readOnly: true, note: "" });
    const trigger = byLabel(view.container, "页签") as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    await click(trigger);
    expect((view.container.querySelector(".ink-page-tab__input") as HTMLInputElement).disabled).toBe(true);
    expect((view.container.querySelector(".ink-page-tab__save") as HTMLButtonElement).disabled).toBe(true);
    expect((view.container.querySelector(".ink-page-tab__clear") as HTMLButtonElement).disabled).toBe(true);
    await view.unmount();
  });
});
