// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeBack } from "../ui/backStack";
import { MobileQuickNoteTagSheet, type MobileQuickNoteTagSheetProps } from "./MobileQuickNoteTagSheet";

/**
 * MOB-01（261027 审计）：首页「添加标签」面板打开时按返回键，必须只关面板。
 * 之前组件从不登记返回栈 ⇒ useBackHandler 落到首页分支 onAppExit()，用户体感是「闪退」。
 * 这里用真实挂载验证「打开时登记 / 关闭后注销」。
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderSheet(open: boolean): { onClose: ReturnType<typeof vi.fn>; rerender: (next: boolean) => void } {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const onClose = vi.fn();
  const element = (isOpen: boolean): ReactElement => createElement(MobileQuickNoteTagSheet, {
    open: isOpen,
    options: [],
    selected: [],
    onAdd: () => undefined,
    onCreate: async () => "tag-created",
    onClose,
  } satisfies MobileQuickNoteTagSheetProps);
  act(() => { root!.render(element(open)); });
  return { onClose, rerender: (next) => act(() => { root!.render(element(next)); }) };
}

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
});

describe("小记标签面板返回键（MOB-01）", () => {
  it("打开时返回键由面板消费：只关面板（不再落到 onAppExit）", () => {
    const { onClose } = renderSheet(true);
    let consumed = false;
    act(() => { consumed = consumeBack(); });
    expect(consumed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("关闭后注销处理器：返回栈不在关面板后残留", () => {
    const { rerender } = renderSheet(true);
    rerender(false);
    let consumed = true;
    act(() => { consumed = consumeBack(); });
    expect(consumed).toBe(false);
  });
});
