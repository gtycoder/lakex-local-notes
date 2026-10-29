// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeBack } from "./backStack";
import { MobileSheet, type MobileSheetProps } from "./MobileSheet";

/**
 * MOB-11（261027 审计）：底部 Sheet 原语把「scrim + data-prevent-swipe + 右滑关闭 + 返回栈
 * + 焦点/滚动锁」收成一份实现。以前每个面板各写一套，漏一件就是 MOB-01 那类洞：
 * 面板开着按返回键，直接退出 App / 退出工作区。
 * 这里用**真实挂载**验行为（返回栈登记/注销、滚动锁嵌套、焦点归还），不重复验视觉。
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const sheet = (open: boolean, props: Partial<MobileSheetProps> = {}): ReactElement => createElement(MobileSheet, {
  open,
  title: "标题",
  onClose: () => undefined,
  children: "内容",
  ...props,
} as MobileSheetProps);

const render = (element: ReactElement) => act(() => { root.render(element); });

/** 叠层用例：两个 Sheet 同时挂载，用来验滚动锁的嵌套计数。 */
function Nested({ first, second }: { first: boolean; second: boolean }): ReactElement {
  return createElement("div", null,
    createElement(MobileSheet, { key: "a", open: first, title: "A", onClose: () => undefined, children: "A" }),
    createElement(MobileSheet, { key: "b", open: second, title: "B", onClose: () => undefined, children: "B" }),
  );
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

describe("MobileSheet 原语（MOB-11）", () => {
  it("打开时登记返回栈（返回键只关面板），关闭后注销", () => {
    const onClose = vi.fn();
    render(sheet(true, { onClose }));
    let consumed = false;
    act(() => { consumed = consumeBack(); });
    expect(consumed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);

    render(sheet(false, { onClose }));
    let after = true;
    act(() => { after = consumeBack(); });
    expect(after).toBe(false);
  });

  it("dismissible=false：不登记返回栈、遮罩点了不关、也不画关闭按钮（只能由流程自己关）", () => {
    const onClose = vi.fn();
    render(sheet(true, { dismissible: false, onClose }));
    let consumed = true;
    act(() => { consumed = consumeBack(); });
    expect(consumed).toBe(false);
    act(() => { host.querySelector(".mb-scrim")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('button[aria-label="关闭"]')).toBeNull();
  });

  it("关闭入口统一：遮罩点击与右上 × 都走同一个 onClose", () => {
    const onClose = vi.fn();
    render(sheet(true, { onClose }));
    act(() => { host.querySelector(".mb-scrim")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => { (host.querySelector('button[aria-label="关闭"]') as HTMLElement | null)?.click(); });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("滚动锁：打开期间锁住页面滚动，叠层按打开数嵌套，全关才还原", () => {
    render(createElement(Nested, { first: true, second: false }));
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");

    render(createElement(Nested, { first: true, second: true }));
    expect(document.body.style.overflow).toBe("hidden");

    // 先关一个：另一个还开着 ⇒ 不能提前解锁
    render(createElement(Nested, { first: false, second: true }));
    expect(document.body.style.overflow).toBe("hidden");

    render(createElement(Nested, { first: false, second: false }));
    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("焦点：打开时收进面板，关闭后还给原元素（不留焦点在 body）", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    render(sheet(true));
    const el = host.querySelector(".mb-sheet") as HTMLElement;
    expect(el.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(el);

    render(sheet(false));
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("子内容 autoFocus 时不被面板抢焦点（搜索框 / 知识库名称输入）", () => {
    render(sheet(true, { children: createElement("input", { autoFocus: true }) }));
    expect(document.activeElement).toBe(host.querySelector("input"));
  });

  it("表面类名沿用 .mb-sheet 系列（迁移时 DOM/类名不变 ⇒ 视觉与快照不变）", () => {
    render(sheet(true, {
      className: "qn-tag-sheet",
      bodyClassName: "qn-tag-sheet__body",
      titleClassName: "mb-ellipsis",
      footer: createElement("div", { className: "mb-btn" }, "脚注"),
    }));
    const el = host.querySelector(".mb-sheet") as HTMLElement;
    expect(el.className).toBe("mb-sheet qn-tag-sheet");
    expect(el.getAttribute("data-prevent-swipe")).not.toBeNull();
    expect(el.getAttribute("role")).toBe("dialog");
    expect(el.querySelector(".mb-sheet__grab")).not.toBeNull();
    expect((el.querySelector(".mb-sheet__title") as HTMLElement).className).toBe("mb-sheet__title mb-ellipsis");
    expect((el.querySelector(".mb-sheet__body") as HTMLElement).className).toBe("mb-sheet__body qn-tag-sheet__body");
    expect(el.lastElementChild?.textContent).toBe("脚注");
    expect(host.querySelector(".mb-scrim")?.getAttribute("data-prevent-swipe")).not.toBeNull();
  });
});
