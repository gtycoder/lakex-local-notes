// @vitest-environment jsdom
/**
 * 「移动到…」目标选择（v2 261107 简化）：**只列笔记本**、平铺 + 搜索、当前位置、自身禁用、确认/取消/返回。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { consumeBack } from "./backStack";
import { MoveTargetTreeSheet, type MoveTargetNode } from "./MoveTargetTreeSheet";

const NODES: MoveTargetNode[] = [
  { id: "nb1", title: "笔记本一", parentId: null, nodeType: "notebook" },
  { id: "g1", title: "分组一", parentId: "nb1", nodeType: "group" },
  { id: "nb2", title: "笔记本二", parentId: null, nodeType: "notebook" },
  { id: "g2", title: "子分组", parentId: "g1", nodeType: "group" },
];

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onConfirm = vi.fn();
const onClose = vi.fn();

const render = async (props: Partial<{ currentParentId: string | null; excludedIds: string[]; busy: boolean; nodes: MoveTargetNode[]; title: string; confirmLabel: string; description: string }> = {}): Promise<void> => {
  await act(async () => {
    root.render(createElement(MoveTargetTreeSheet, {
      open: true,
      nodes: props.nodes ?? NODES,
      currentParentId: props.currentParentId ?? null,
      excludedIds: props.excludedIds ?? [],
      busy: props.busy ?? false,
      title: props.title,
      confirmLabel: props.confirmLabel,
      description: props.description,
      onConfirm,
      onClose,
    }));
  });
};
const click = async (el: Element | null | undefined): Promise<void> => {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); await Promise.resolve(); });
};
const byAria = (label: string): HTMLElement | null => host.querySelector('[aria-label="' + label + '"]');
const rowTitles = (): string[] => [...host.querySelectorAll(".mb-row__title")].map((el) => el.textContent ?? "");
const confirmButton = (): HTMLButtonElement =>
  [...host.querySelectorAll<HTMLButtonElement>(".mb-sheet__foot button")].find((b) => (b.textContent ?? "").includes("移动到此处"))!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onConfirm.mockReset();
  onClose.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("MoveTargetTreeSheet（简化：只选笔记本）", () => {
  it("只列笔记本：分组不展示、也不可被选中", async () => {
    await render();
    expect(rowTitles()).toEqual(["笔记本一", "笔记本二"]);
    expect(byAria("移动到 分组一")).toBeNull();
    expect(byAria("移动到 子分组")).toBeNull();
  });

  it("当前位置：对应笔记本行标注「当前位置」", async () => {
    await render({ currentParentId: "nb1" });
    const row = byAria("移动到 笔记本一")!;
    expect(row.textContent).toContain("当前位置");
    expect(byAria("移动到 笔记本二")!.textContent).not.toContain("当前位置");
  });

  it("排除自身/后代：禁用 + 写明原因，且不能确认", async () => {
    await render({ excludedIds: ["nb2"] });
    const excluded = byAria("移动到 笔记本二") as HTMLButtonElement;
    expect(excluded.disabled).toBe(true);
    expect(excluded.textContent).toContain("不能移动到自身内部");
    await click(excluded);
    expect(confirmButton().disabled).toBe(true);
  });

  it("选择目标后「移动到此处」可用并回调 parentId；未选时禁用", async () => {
    await render();
    expect(confirmButton().disabled).toBe(true);
    await click(byAria("移动到 笔记本二"));
    expect(confirmButton().disabled).toBe(false);
    expect(byAria("移动到 笔记本二")!.getAttribute("aria-pressed")).toBe("true");
    await click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith("nb2");
  });

  it("搜索：按名称过滤笔记本；无命中给空态；分组名不会命中", async () => {
    await render();
    const search = host.querySelector('input[aria-label="搜索笔记本"]') as HTMLInputElement;
    const type = async (value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        setter?.call(search, value);
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await type("二");
    expect(rowTitles()).toEqual(["笔记本二"]);
    await type("分组一");
    expect(rowTitles()).toEqual([]);
    expect(host.textContent).toContain("没有匹配的笔记本");
  });

  it("取消：只关弹窗，不调用确认；返回键同样先关弹窗", async () => {
    await render();
    const cancel = [...host.querySelectorAll<HTMLButtonElement>(".mb-sheet__foot button")].find((b) => (b.textContent ?? "").trim() === "取消")!;
    await click(cancel);
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();

    onClose.mockClear();
    await act(async () => { expect(consumeBack()).toBe(true); });
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("没有笔记本时给空态（不崩）", async () => {
    await render({ nodes: [{ id: "g1", title: "分组", parentId: null, nodeType: "group" }] });
    expect(host.textContent).toContain("还没有笔记本");
  });

  it("文案参数：默认仍是「移动到…/移动到此处」；调用方可覆盖（转文档不再显示「移动到…」）", async () => {
    await render();
    expect(host.querySelector(".mb-sheet__title")?.textContent).toBe("移动到…");
    expect(confirmButton().textContent).toContain("移动到此处");
    expect(host.textContent).not.toContain("选择目标笔记本");

    await render({ title: "转为文档", confirmLabel: "转为文档", description: "选择目标笔记本" });
    expect(host.querySelector(".mb-sheet__title")?.textContent).toBe("转为文档");
    const confirm = [...host.querySelectorAll<HTMLButtonElement>(".mb-sheet__foot button")].find((b) => (b.textContent ?? "").trim() === "转为文档");
    expect(confirm, "主按钮应显示调用方给的 confirmLabel").toBeTruthy();
    expect(host.textContent).toContain("选择目标笔记本");
  });
});
