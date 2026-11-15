// @vitest-environment jsdom
import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { NativeSelect, baseSelectSupported } from "./NativeSelect";

/**
 * A13 试点护栏：原生下拉只在支持 base-select 的运行时启用，失败必须能退回自研 Select。
 * jsdom 没有 base-select ⇒ 这里同时钉住「检测返回 false」这条降级判据。
 */
function mount(node: React.ReactNode): HTMLDivElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return host;
}

describe("NativeSelect（A13 试点）", () => {
  it("检测：CSS.supports 缺失或返回 false 时降级（老内核判据）", () => {
    const globalWithCss = globalThis as unknown as { CSS?: unknown };
    const original = globalWithCss.CSS;
    try {
      globalWithCss.CSS = undefined;
      expect(baseSelectSupported()).toBe(false);
      globalWithCss.CSS = { supports: () => false };
      expect(baseSelectSupported()).toBe(false);
      globalWithCss.CSS = { supports: () => true };
      expect(baseSelectSupported()).toBe(true);
      globalWithCss.CSS = { supports: () => { throw new Error("boom"); } };
      expect(baseSelectSupported()).toBe(false);
    } finally {
      globalWithCss.CSS = original;
    }
  });

  it("渲染选项、当前值与 disabled 选项", () => {
    const host = mount(
      <NativeSelect
        label="备份间隔"
        value="7"
        onChange={() => {}}
        options={[{ value: "1", label: "每天" }, { value: "7", label: "每周" }, { value: "30", label: "每月", disabled: true }]}
      />,
    );
    const select = host.querySelector("select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe("7");
    expect([...select.options].map((o) => o.label)).toEqual(["每天", "每周", "每月"]);
    expect(select.options[2].disabled).toBe(true);
    expect(select.getAttribute("aria-label")).toBe("备份间隔");
    expect(select.className).toContain("ln-select--native");
  });

  it("change 回调传出字符串值", () => {
    const onChange = vi.fn();
    const host = mount(<NativeSelect label="备份间隔" value="1" onChange={onChange} options={[{ value: "1", label: "每天" }, { value: "7", label: "每周" }]} />);
    const select = host.querySelector("select") as HTMLSelectElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, "7");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("7");
  });

  it("disabled 透传", () => {
    const host = mount(<NativeSelect label="备份间隔" value="1" onChange={() => {}} disabled options={[{ value: "1", label: "每天" }]} />);
    expect((host.querySelector("select") as HTMLSelectElement).disabled).toBe(true);
  });
});
