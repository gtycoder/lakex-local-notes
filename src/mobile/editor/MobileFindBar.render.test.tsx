// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileFindBar, type MobileFindBarProps } from "./MobileFindBar";
import type { KernelFindService } from "./kernelFind";

/**
 * MOB-04：查找条 UI 自建，但命中计数/定位来自内核 search 服务（onSearch → count/jumpTo）。
 * 这里用真实挂载 + 假内核服务验：输入即搜索、n/m 显示、下一个走内核 jumpTo、卸载 destroy。
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const fakeService = (count: number) => {
  const jumpTo = vi.fn(() => true);
  const destroy = vi.fn();
  const service: KernelFindService = {
    onSearch: vi.fn(() => ({ count, jumpTo, destroy })),
  } as unknown as KernelFindService;
  return { service, jumpTo, destroy };
};

const fakeEditor = (service: KernelFindService) => ({ _$commandUnderlay: { _renderer: { getService: () => service } } });

const render = (props: Partial<MobileFindBarProps> & { service?: KernelFindService }) => {
  const { service, ...rest } = props;
  const element: ReactElement = createElement(MobileFindBar, {
    root: null,
    revision: "r1",
    editor: service ? fakeEditor(service) : null,
    onClose: () => undefined,
    ...rest,
  } as MobileFindBarProps);
  act(() => { root.render(element); });
  return element;
};

/** React 18 受控 input：用原生 setter + input 事件驱动 onChange。 */
const typeQuery = (value: string) => {
  const input = host.querySelector<HTMLInputElement>("input[type=search]");
  if (!input) throw new Error("no find input");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const countText = () => host.querySelector(".mb-find__count")?.textContent ?? "";

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("MobileFindBar（MOB-04：内核查找）", () => {
  it("输入即调内核搜索；显示 n/m 并跳到首个命中", () => {
    const { service, jumpTo } = fakeService(3);
    render({ service });
    typeQuery("查找");
    expect(service.onSearch).toHaveBeenCalledWith("查找");
    expect(countText()).toBe("1/3");
    expect(jumpTo).toHaveBeenCalledWith(0);
  });

  it("「下一个」走内核 jumpTo 环形步进", () => {
    const { service, jumpTo } = fakeService(3);
    render({ service });
    typeQuery("查找");
    const next = host.querySelector<HTMLButtonElement>("button[aria-label=\"下一个\"]");
    act(() => { next?.click(); });
    expect(jumpTo).toHaveBeenLastCalledWith(1);
    act(() => { next?.click(); });
    expect(jumpTo).toHaveBeenLastCalledWith(2);
    act(() => { next?.click(); });
    expect(jumpTo).toHaveBeenLastCalledWith(0);
  });

  it("无命中不显示计数；空查询不发起搜索", () => {
    const { service } = fakeService(0);
    render({ service });
    typeQuery("找不到");
    expect(service.onSearch).toHaveBeenCalledWith("找不到");
    expect(countText()).toBe("");
    typeQuery("");
    expect(service.onSearch).toHaveBeenCalledTimes(1);
  });

  it("卸载时 release 内核 context（destroy）", () => {
    const { service, destroy } = fakeService(2);
    render({ service });
    typeQuery("查找");
    act(() => root.unmount());
    expect(destroy).toHaveBeenCalled();
    root = createRoot(host); // afterEach 还会 unmount 一次，保持合法
  });

  it("没有编辑器/服务时降级：不崩、按钮禁用、不显示计数", () => {
    render({ editor: null });
    typeQuery("查找");
    expect(countText()).toBe("");
    const next = host.querySelector<HTMLButtonElement>("button[aria-label=\"下一个\"]");
    expect(next?.disabled).toBe(true);
  });
});
