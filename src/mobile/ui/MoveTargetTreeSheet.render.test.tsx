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
  it("层级渲染：默认展开所有根笔记本一层（用户能直接看到全部笔记本与其下一级分组）", async () => {
    await render();
    expect(rowTitles()).toEqual(["笔记本一", "分组一", "笔记本二"]); // 根笔记本展开一层；更深层（子分组）收起
    await click(byAria("展开 分组一"));
    expect(rowTitles()).toEqual(["笔记本一", "分组一", "子分组", "笔记本二"]);
    await click(byAria("收起 分组一"));
    expect(rowTitles()).toEqual(["笔记本一", "分组一", "笔记本二"]);
    await click(byAria("收起 笔记本一"));
    expect(rowTitles()).toEqual(["笔记本一", "笔记本二"]);
  });

  it("多个根笔记本全部可见 + 列表自身可滚动（矮屏/键盘时不被外层裁掉）", async () => {
    const many: MoveTargetNode[] = [
      ...Array.from({ length: 6 }, (_, i) => ({
        id: "nb" + i, title: "笔记本" + (i + 1), parentId: null, nodeType: "notebook",
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        id: "g" + i, title: "分组" + (i + 1), parentId: "nb" + i, nodeType: "group",
      })),
    ];
    await render({ nodes: many });
    // 6 个根笔记本 + 各自展开一层的 6 个分组全部渲染（不是"只看到一行"）
    expect(rowTitles()).toEqual(["笔记本1", "分组1", "笔记本2", "分组2", "笔记本3", "分组3", "笔记本4", "分组4", "笔记本5", "分组5", "笔记本6", "分组6"]);
    expect(host.querySelector(".mb-tree-list")).not.toBeNull(); // 内部滚动容器（max-height 在 CSS）
  });

  it("搜索：按名称过滤，命中项祖先自动展开；无命中给空态", async () => {
    await render();
    const search = host.querySelector('input[aria-label="搜索笔记本"]') as HTMLInputElement;
    expect(search).toBeTruthy();
    const type = async (value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        setter?.call(search, value);
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await type("子分组"); // 深层命中：其祖先（笔记本一 > 分组一）保留并自动展开
    expect(rowTitles()).toEqual(["笔记本一", "分组一", "子分组"]);
    await type("笔记本二");
    expect(rowTitles()).toEqual(["笔记本二"]);
    await type("不存在");
    expect(rowTitles()).toEqual([]);
    expect(host.textContent).toContain("没有匹配的笔记本");
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
