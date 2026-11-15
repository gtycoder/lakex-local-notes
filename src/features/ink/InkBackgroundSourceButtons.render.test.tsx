// @vitest-environment jsdom
/** 底栏「背景来源」按钮（261104 二十二批）：文字说明是背景、排在纸张之后、禁用态跟随导入状态。 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { InkBackgroundSourceButtons } from "./InkBackgroundSourceButtons";

async function render(props: Parameters<typeof InkBackgroundSourceButtons>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<InkBackgroundSourceButtons {...props} />); });
  return { container, close: async () => { await act(async () => root.unmount()); container.remove(); } };
}

describe("背景来源按钮", () => {
  it("两个入口都是文字按钮，文案说明是背景；点击转到导入动作", async () => {
    const onImportImages = vi.fn();
    const onImportPdf = vi.fn();
    const view = await render({ disabled: false, onImportImages, onImportPdf });
    const group = view.container.querySelector('[aria-label="背景来源"]')!;
    expect(group).not.toBeNull();
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent)).toEqual(["背景图片", "背景 PDF"]);
    expect(buttons[0].getAttribute("title")).toContain("背景页");
    await act(async () => { buttons[0].click(); });
    await act(async () => { buttons[1].click(); });
    expect(onImportImages).toHaveBeenCalledTimes(1);
    expect(onImportPdf).toHaveBeenCalledTimes(1);
    await view.close();
  });

  it("导入中禁用；没接任何导入能力时整组不渲染", async () => {
    const view = await render({ disabled: true, onImportImages: () => undefined });
    const button = view.container.querySelector('button[aria-label="背景图片"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await view.close();
    const empty = await render({ disabled: false });
    expect(empty.container.querySelector('[aria-label="背景来源"]')).toBeNull();
    await empty.close();
  });
});
