// @vitest-environment jsdom
/**
 * 批量「移动到…」目录树弹窗（261106 task-89）：层级渲染、展开/收起、当前位置高亮、
 * 默认展开当前路径、自身/后代禁用、选择后确认、取消无调用、返回键关闭。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { consumeBack } from "./backStack";
import { MoveTargetTreeSheet, type MoveTargetNode } from "./MoveTargetTreeSheet";

const NODES: MoveTargetNode[] = [
  { id: "nb1", title: "笔记本一", parentId: null, nodeType: "notebook" },
  { id: "g1", title: "分组一", parentId: "nb1", nodeType: "group" },
  { id: "g2", title: "子分组", parentId: "g1", nodeType: "group" },
  { id: "nb2", title: "笔记本二", parentId: null, nodeType: "notebook" },
];

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onConfirm = vi.fn();
const onClose = vi.fn();

const render = async (props: Partial<{ currentParentId: string | null; excludedIds: string[]; busy: boolean; nodes: MoveTargetNode[] }> = {}): Promise<void> => {
  await act(async () => {
    root.render(createElement(MoveTargetTreeSheet, {
      open: true,
      nodes: props.nodes ?? NODES,
      currentParentId: props.currentParentId ?? null,
      excludedIds: props.excludedIds ?? [],
      busy: props.busy ?? false,
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
const rowTitles = (): string[] => [...host.querySelectorAll(".mb-set-name")].map((el) => el.textContent ?? "");
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

describe("MoveTargetTreeSheet（思源式目录树选择）", () => {
  it("层级渲染：默认只展开根；点箭头展开/收起", async () => {
    await render();
    expect(rowTitles()).toEqual(["笔记本一", "笔记本二"]); // 笔记本下未展开
    await click(byAria("展开 笔记本一"));
    expect(rowTitles()).toEqual(["笔记本一", "分组一", "笔记本二"]);
    await click(byAria("收起 笔记本一"));
    expect(rowTitles()).toEqual(["笔记本一", "笔记本二"]);
  });

  it("默认展开当前路径：当前位置在「分组一」⇒ 笔记本一 + 分组一都展开并标注当前位置", async () => {
    await render({ currentParentId: "g1" });
    expect(rowTitles()).toEqual(["笔记本一", "分组一", "子分组", "笔记本二"]);
    expect(host.textContent).toContain("当前位置");
    // 当前位置在「分组一」的 desc 上，不是别处
    const row = byAria("移动到 分组一")!.closest(".mb-set-item")!;
    expect(row.textContent).toContain("当前位置");
  });

  it("排除自身/后代：禁用 + 写明原因，且不能确认", async () => {
    await render({ currentParentId: "g1", excludedIds: ["g2"] });
    const excluded = byAria("移动到 子分组") as HTMLButtonElement;
    expect(excluded.disabled).toBe(true);
    expect(excluded.closest(".mb-set-item")!.textContent).toContain("不能移动到自身内部");
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

  it("没有容器节点时给空态（不崩）", async () => {
    await render({ nodes: [] });
    expect(host.textContent).toContain("还没有笔记本");
  });
});
