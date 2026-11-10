// @vitest-environment jsdom
/**
 * AI 写作两个弹窗（261110 用户定稿）：原弹窗太窄 ⇒ 升级为**浮动窗**（useFloatingDialog）：
 * 默认尺寸更大、标题栏可拖动、8 向可缩放、尺寸/位置设备本地记忆；内容走 ln-* 原语。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublishDocDialog } from "./PublishDocDialog";
import { SaveQuickNoteDialog } from "./SaveQuickNoteDialog";
import type { TreeNode } from "../../lib/types";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

function render(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => { root!.render(node); });
}

const section = (): HTMLElement => document.querySelector(".floating-dialog") as HTMLElement;

const notebook: TreeNode = {
  id: "nb1", workspaceId: "desktop", parentId: null, nodeType: "notebook", title: "个人笔记",
  noteFileId: null, sortOrder: 0, createdAt: "", updatedAt: "", isConflict: false, icon: null, space: null,
} as TreeNode;

afterEach(() => { act(() => { root?.unmount(); }); host?.remove(); root = null; });

describe("AI 写作弹窗（浮动窗 + 原语 + 可缩放）", () => {
  it("生成文档：默认 780×460、浮动窗类、标题栏可拖、8 向缩放手柄齐全", () => {
    render(<PublishDocDialog open title="AI 生成文档" notebooks={[notebook]} busy={false} error={null} onConfirm={() => {}} onClose={() => {}} />);
    const el = section();
    expect(el.className).toContain("aiw-publish");
    expect(el.style.width).toBe("780px");
    expect(el.style.height).toBe("460px");
    expect(el.querySelector(".floating-dialog-header")).toBeTruthy();
    expect(el.querySelectorAll(".floating-dialog-resize").length).toBe(8);
    expect(el.querySelector(".ln-dialog__body")).toBeTruthy();
    expect(el.querySelector(".ln-form__row")).toBeTruthy();
    expect(el.querySelector(".ln-btn--primary")).toBeTruthy();
  });

  it("保存到小记：默认 860×620、正文 textarea 吃满、关闭钮可点", () => {
    const onClose = vi.fn();
    render(<SaveQuickNoteDialog open content="这是一条小记正文" busy={false} error={null} onConfirm={() => {}} onClose={onClose} />);
    const el = section();
    expect(el.className).toContain("aiw-quicknote");
    expect(el.style.width).toBe("860px");
    expect(el.style.height).toBe("620px");
    expect(el.querySelectorAll(".floating-dialog-resize").length).toBe(8);
    expect((el.querySelector("textarea") as HTMLTextAreaElement).value).toBe("这是一条小记正文");
    const close = el.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!;
    act(() => { close.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
