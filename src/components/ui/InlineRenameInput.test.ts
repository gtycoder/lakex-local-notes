// @vitest-environment jsdom
/**
 * InlineRenameInput 行为护栏（261028 DT-12）：三处行内重命名收敛成原语后的语义锁。
 *
 * 三处**空名口径本来就不同**，迁移只收敛实现、不合并语义：
 * · 目录（Sidebar）= fallback：空名不提交、保持原名（弹窗「确定」同时置灰）；
 * · 标签（QuickNoteTagManager）= reject：空名退出编辑、不改名；
 * · allow：允许提交空串。
 * 另外锁住：Enter 一定 trim、Esc 取消、失焦默认不提交（三处现状），以及 DOM 仍是**单个 input**
 * （不新增 wrapper，类名/aria 原样透传 ⇒ 视觉与几何不变）。
 */
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InlineRenameInput, resolveRenameCommit, type RenameEmptyPolicy } from "./InlineRenameInput";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const calls: { commits: string[]; cancels: number } = { commits: [], cancels: 0 };

interface HarnessProps {
  initial: string;
  policy: RenameEmptyPolicy;
  commitOnBlur?: boolean;
  selectOnFocus?: boolean;
}

function Harness({ initial, policy, commitOnBlur, selectOnFocus }: HarnessProps) {
  const [value, setValue] = useState(initial);
  return createElement(InlineRenameInput, {
    value,
    onChange: setValue,
    onCommit: (next: string) => { calls.commits.push(next); },
    onCancel: () => { calls.cancels += 1; },
    emptyPolicy: policy,
    commitOnBlur,
    selectOnFocus,
    // 与标签行内重命名同一组类名/aria：迁移不得改 DOM 与视觉
    className: "ln-input__field quick-note-tag-manager__rename",
    ariaLabel: "重命名标签 原名字",
  });
}

const render = (props: HarnessProps) => act(() => root.render(createElement(Harness, props)));
const input = () => host.querySelector<HTMLInputElement>("input")!;
const press = (key: string) => act(() => {
  input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
});
const blur = () => act(() => {
  input().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  calls.commits = [];
  calls.cancels = 0;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("resolveRenameCommit：空名策略（纯判定）", () => {
  it("非空一律提交 trimmed 值（三种策略一致）", () => {
    for (const policy of ["fallback", "reject", "allow"] as const) {
      expect(resolveRenameCommit("  标题  ", policy)).toEqual({ action: "commit", value: "标题" });
    }
  });

  it("空名按策略分流：fallback=不动作 / reject=取消 / allow=提交空串", () => {
    expect(resolveRenameCommit("   ", "fallback").action).toBe("none");
    expect(resolveRenameCommit("   ", "reject").action).toBe("cancel");
    expect(resolveRenameCommit("   ", "allow")).toEqual({ action: "commit", value: "" });
  });
});

describe("InlineRenameInput：交互", () => {
  it("只渲染一个 input，类名与 aria 原样透传（不加 wrapper、不改视觉）", () => {
    render({ initial: "原名字", policy: "fallback" });
    expect(host.querySelectorAll("input").length).toBe(1);
    expect(input().className).toBe("ln-input__field quick-note-tag-manager__rename");
    expect(input().getAttribute("aria-label")).toBe("重命名标签 原名字");
  });

  it("Enter 提交 trim 后的值（目录/标签两处同一条路）", () => {
    render({ initial: "  原名字  ", policy: "fallback" });
    press("Enter");
    expect(calls.commits).toEqual(["原名字"]);
    expect(calls.cancels).toBe(0);
  });

  it("Esc 取消，不提交", () => {
    render({ initial: "原名字", policy: "fallback" });
    press("Escape");
    expect(calls.commits).toEqual([]);
    expect(calls.cancels).toBe(1);
  });

  it("fallback（目录）：空名回车不提交、不取消（保持编辑态，原名不变）", () => {
    render({ initial: "   ", policy: "fallback" });
    press("Enter");
    expect(calls.commits).toEqual([]);
    expect(calls.cancels).toBe(0);
  });

  it("reject（标签）：空名回车 = 退出编辑、不改名", () => {
    render({ initial: "  ", policy: "reject" });
    press("Enter");
    expect(calls.commits).toEqual([]);
    expect(calls.cancels).toBe(1);
  });

  it("allow：空名回车提交空串", () => {
    render({ initial: "", policy: "allow" });
    press("Enter");
    expect(calls.commits).toEqual([""]);
  });

  it("失焦默认不提交（三处现状：只在 Enter 提交）", () => {
    render({ initial: "  原名字  ", policy: "fallback" });
    blur();
    expect(calls.commits).toEqual([]);
    expect(calls.cancels).toBe(0);
  });

  it("commitOnBlur：失焦按同一套空名策略提交", () => {
    render({ initial: "  原名字  ", policy: "fallback", commitOnBlur: true });
    blur();
    expect(calls.commits).toEqual(["原名字"]);
  });

  it("Esc 收尾后的失焦不再提交（不会把已取消的名字写回去）", () => {
    render({ initial: "原名字", policy: "fallback", commitOnBlur: true });
    press("Escape");
    blur();
    expect(calls.commits).toEqual([]);
    expect(calls.cancels).toBe(1);
  });

  it("selectOnFocus 才全选（目录弹窗现状；标签行内输入不受影响）", () => {
    let selected = 0;
    render({ initial: "原名字", policy: "fallback", selectOnFocus: true });
    input().select = () => { selected += 1; };
    act(() => { input().dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    expect(selected).toBe(1);
  });
});
