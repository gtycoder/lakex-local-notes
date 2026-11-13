// @vitest-environment jsdom
/** 默认笔记本选择器（261106 task-86）：打开时默认选中当前值；选择即回调。
 *  261113 用户点单重做：必须走选择器原语（.mb-list-item + role=option + 右侧打勾），
 *  不再把设置行（button.mb-set-item）塞进 Sheet —— 那会吃到浏览器默认按钮外观（粗边框灰盒子）。 */
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

const options = () => [...host.querySelectorAll('[role="option"]')] as HTMLButtonElement[];

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
  it("行原语 = .mb-list-item / role=option：不再用设置行（button.mb-set-item）", async () => {
    await render("nb2");
    const [first] = options();
    expect(first).toBeTruthy();
    expect(first.classList.contains("mb-list-item")).toBe(true);
    expect(first.classList.contains("mb-set-item")).toBe(false);
    expect(host.querySelector("button.mb-set-item")).toBeNull();
  });

  it("打开时默认选中当前值（aria-selected + 打勾格）", async () => {
    await render("nb2");
    const [first, second] = options();
    expect(first.getAttribute("aria-selected")).toBe("false");
    expect(second.getAttribute("aria-selected")).toBe("true");
    expect(second.classList.contains("is-selected")).toBe(true);
    expect(second.querySelector(".mb-list-item__check svg")).not.toBeNull();
    expect(first.querySelector(".mb-list-item__check svg")).toBeNull();
  });

  it("未设置时都不选中；点一行即回调 id", async () => {
    await render(null);
    expect(options().every((option) => option.getAttribute("aria-selected") === "false")).toBe(true);
    await act(async () => { options()[0].click(); });
    expect(onPick).toHaveBeenCalledWith("nb1");
  });

  it("没有笔记本 ⇒ 空态提示", async () => {
    await render(null, []);
    expect(host.textContent).toContain("还没有笔记本");
  });
});
