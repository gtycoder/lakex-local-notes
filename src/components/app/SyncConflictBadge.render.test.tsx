// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncConflictBadge } from "./SyncConflictBadge";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false); });

const render = (count: number) => act(() => root.render(createElement(SyncConflictBadge, { count })));

describe("同步记录角标（P1）", () => {
  it("0 / 非法数值不渲染（不占位、不进无障碍树）", () => {
    render(0);
    expect(document.body.querySelector("[data-sync-conflict-badge]")).toBeNull();
    render(Number.NaN);
    expect(document.body.querySelector("[data-sync-conflict-badge]")).toBeNull();
  });

  it("有未读时渲染数字，超过 99 显示 99+，并标记 aria-hidden（文字由按钮的隐藏文案承担）", () => {
    render(3);
    const badge = document.body.querySelector("[data-sync-conflict-badge]")!;
    expect(badge.textContent).toBe("3");
    expect(badge.getAttribute("aria-hidden")).toBe("true");
    render(120);
    expect(document.body.querySelector("[data-sync-conflict-badge]")!.textContent).toBe("99+");
  });
});
