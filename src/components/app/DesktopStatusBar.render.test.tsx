// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopStatusBar } from "./DesktopStatusBar";
import type { DocumentStatusModel } from "../model/documentStatusModel";

/**
 * 桌面状态栏（261110 第二批）：可点锁胶囊 = ln-btn--ghost + compact；提示条的动作用 ln-btn--link。
 */
const synced: DocumentStatusModel = { kind: "synced", label: "已同步" } as DocumentStatusModel;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const classesOf = (el: Element): string[] => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
/** 类名只含 ln-*（状态类 is-* + 已登记的布局钩子除外）。 */
const HOOKS = new Set(["document-statusbar-lock"]);
const onlyPrimitive = (el: Element): boolean => classesOf(el).every((name) => name.startsWith("ln-") || name.startsWith("is-") || HOOKS.has(name));

function render(overrides: Partial<Parameters<typeof DesktopStatusBar>[0]> = {}) {
  const props = {
    showDocumentStats: true, wordCount: 10, imageCount: 2, notice: null,
    documentStatus: synced, locked: false,
    ...overrides,
  };
  act(() => root.render(createElement(DesktopStatusBar, props)));
}

describe("DesktopStatusBar（261110 第二批）", () => {
  it("锁胶囊 = ln-btn--ghost + compact（类名只含 ln-*），点开浮层里的解锁 = ln-btn--primary", () => {
    const onUnlock = vi.fn();
    render({ locked: true, onUnlock });
    const lock = document.body.querySelector<HTMLButtonElement>(".document-statusbar-lock")!;
    expect(onlyPrimitive(lock)).toBe(true);
    expect(lock.className).toContain("ln-btn--ghost");
    expect(lock.className).toContain("ln-btn--compact");
    act(() => lock.click());
    const unlock = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "") === "解锁")!;
    expect(unlock.className).toContain("ln-btn--primary");
    act(() => unlock.click());
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it("提示条动作 = ln-btn--link + compact；点击回调", () => {
    const onClick = vi.fn();
    render({ notice: { text: "磁盘正文已被外部修改", action: { label: "查看", onClick } } });
    const action = [...document.body.querySelectorAll<HTMLButtonElement>(".document-notice-toast button")][0]!;
    expect(onlyPrimitive(action)).toBe(true);
    expect(action.className).toContain("ln-btn--link");
    act(() => action.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
