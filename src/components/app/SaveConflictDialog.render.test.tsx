// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveConflictDialog } from "./SaveConflictDialog";
import { SAVE_CONFLICT_MESSAGE } from "../../lib/types";

/**
 * 保存版本守卫的三选项确认（Batch4-D）：只有「另存为副本（推荐）/ 覆盖磁盘 / 放弃并载入磁盘版」三个出口，
 * 默认安全项是另存副本；Esc/点遮罩不静默关闭（冲突未处理前自动保存一直暂停）。
 */
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function render(props: Partial<Parameters<typeof SaveConflictDialog>[0]> = {}): { copy: ReturnType<typeof vi.fn>; overwrite: ReturnType<typeof vi.fn>; discard: ReturnType<typeof vi.fn> } {
  const copy = vi.fn();
  const overwrite = vi.fn();
  const discard = vi.fn();
  act(() => root.render(createElement(SaveConflictDialog, {
    open: true, fileName: "项目计划", busy: false,
    onSaveAsCopy: copy, onOverwrite: overwrite, onDiscardAndReload: discard,
    ...props,
  })));
  return { copy, overwrite, discard };
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((btn) => (btn.textContent ?? "").includes(text));
  if (!found) throw new Error("找不到按钮：" + text);
  return found;
}

describe("SaveConflictDialog（保存版本守卫）", () => {
  it("展示冲突说明 + 文档名；三个出口齐全，另存副本是默认（autoFocus）且文案标推荐", () => {
    render();
    const text = document.body.textContent ?? "";
    expect(text).toContain("这篇文档在别处被改过");
    expect(text).toContain(SAVE_CONFLICT_MESSAGE);
    expect(text).toContain("项目计划");
    const copy = buttonByText("另存为副本");
    expect(copy.textContent).toContain("推荐");
    expect(copy.autofocus || document.activeElement === copy || copy.hasAttribute("autofocus")).toBeTruthy();
    expect(buttonByText("覆盖磁盘")).toBeTruthy();
    expect(buttonByText("放弃本次修改并载入磁盘版")).toBeTruthy();
  });

  it("三个按钮分别回调对应动作（不互相串）", () => {
    const handlers = render();
    act(() => buttonByText("另存为副本").click());
    act(() => buttonByText("覆盖磁盘").click());
    act(() => buttonByText("放弃本次修改并载入磁盘版").click());
    expect(handlers.copy).toHaveBeenCalledTimes(1);
    expect(handlers.overwrite).toHaveBeenCalledTimes(1);
    expect(handlers.discard).toHaveBeenCalledTimes(1);
  });

  it("处理中（busy）三个按钮全禁用；open=false 不渲染任何内容", () => {
    render({ busy: true });
    for (const text of ["另存为副本", "覆盖磁盘", "放弃本次修改并载入磁盘版"]) {
      expect(buttonByText(text).disabled).toBe(true);
    }
    act(() => root.render(createElement(SaveConflictDialog, {
      open: false, fileName: "x", onSaveAsCopy: () => {}, onOverwrite: () => {}, onDiscardAndReload: () => {},
    })));
    expect(document.body.textContent ?? "").not.toContain("这篇文档在别处被改过");
  });
});
