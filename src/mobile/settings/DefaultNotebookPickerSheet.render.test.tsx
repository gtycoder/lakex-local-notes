// @vitest-environment jsdom
/** 默认笔记本选择器（261106 task-86）：打开时默认选中当前值；选择即回调。 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DefaultNotebookPickerSheet } from "./DefaultNotebookPickerSheet";

const NOTEBOOKS = [{ id: "nb1", title: "笔记本一" }, { id: "nb2", title: "笔记本二" }];

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onPick = vi.fn();
const onClose = vi.fn();

const render = async (currentId: string | null, notebooks = NOTEBOOKS): Promise<void> => {
  await act(async () => {
    root.render(createElement(DefaultNotebookPickerSheet, {
      open: true, notebooks, currentId, onPick, onClose,
    }));
  });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onPick.mockReset();
  onClose.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("DefaultNotebookPickerSheet", () => {
  it("打开时默认选中当前值（aria-pressed + 「当前默认」）", async () => {
    await render("nb2");
    const picked = host.querySelector('[aria-label="选择笔记本 笔记本二"]') as HTMLButtonElement;
    expect(picked.getAttribute("aria-pressed")).toBe("true");
    expect(picked.textContent).toContain("当前默认");
    expect((host.querySelector('[aria-label="选择笔记本 笔记本一"]') as HTMLButtonElement).getAttribute("aria-pressed")).toBe("false");
  });

  it("未设置时都不选中；点一行即回调 id", async () => {
    await render(null);
    expect(host.textContent).not.toContain("当前默认");
    await act(async () => { (host.querySelector('[aria-label="选择笔记本 笔记本一"]') as HTMLButtonElement).click(); });
    expect(onPick).toHaveBeenCalledWith("nb1");
  });

  it("没有笔记本 ⇒ 空态提示", async () => {
    await render(null, []);
    expect(host.textContent).toContain("还没有笔记本");
  });
});
