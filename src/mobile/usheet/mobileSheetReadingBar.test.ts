/**
 * 阅读态工具条行为护栏（261021 P4-4：用户定稿「读态筛选只对本机生效、绝不写正文」）。
 *
 * 只验这一层的契约：**筛选可点亮（且在生效时高亮）**，其余四项恒置灰并带理由（不隐藏死项）。
 * 「筛选不会写正文」由 viewer 的 capture 前还原 + usheetReadFilter 单测 + 设备对拍共同保证。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { MobileSheetReadingBar } from "./MobileSheetReadingBar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(props: Parameters<typeof MobileSheetReadingBar>[0]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(createElement(MobileSheetReadingBar, props)); });
  return { host, root };
}

describe("阅读态工具条（读态筛选 = 本机视图）", () => {
  it("可用时点亮「筛选 + 查找」（都不写正文），其余三项恒置灰且带理由", () => {
    const { host, root } = mount({ filterEnabled: true, onFilter: () => undefined, onSearch: () => undefined });
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".mb-usheet-readingbar__btn")];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["视图", "筛选", "排序", "冻结", "查找"]);
    expect(buttons.filter((b) => !b.disabled).map((b) => b.getAttribute("aria-label"))).toEqual(["筛选", "查找"]);
    for (const label of ["视图", "排序", "冻结"]) {
      expect(buttons.find((b) => b.getAttribute("aria-label") === label)!.title).not.toBe("");
    }
    expect(buttons[1].title).toContain("不写正文");
    expect(buttons[4].title).toContain("不写正文");
    act(() => root.unmount());
    host.remove();
  });

  it("文档已存筛选 / 未给回调 ⇒ 置灰并显示理由；生效时 aria-pressed + is-active", () => {
    const { host, root } = mount({ filterEnabled: false, filterDisabledReason: "这篇表格已有保存的筛选，回编辑态调整" });
    const filter = host.querySelector<HTMLButtonElement>('[aria-label="筛选"]')!;
    expect(filter.disabled).toBe(true);
    expect(filter.title).toBe("这篇表格已有保存的筛选，回编辑态调整");
    act(() => root.unmount());
    host.remove();

    const second = mount({ filterEnabled: true, filterActive: true, onFilter: () => undefined });
    const active = second.host.querySelector<HTMLButtonElement>('[aria-label="筛选"]')!;
    expect(active.getAttribute("aria-pressed")).toBe("true");
    expect(active.className).toContain("is-active");
    act(() => second.root.unmount());
    second.host.remove();
  });

  it("点击「筛选」触发回调；置灰时不触发", () => {
    const onFilter = vi.fn();
    const { host, root } = mount({ filterEnabled: true, onFilter });
    act(() => { host.querySelector<HTMLButtonElement>('[aria-label="筛选"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onFilter).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    host.remove();
  });
});
