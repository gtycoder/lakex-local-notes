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

/** 弹窗正文改走内核只读视图（lazy）：测试里换掉它，避免在 jsdom 里拉起真内核；MarkdownView 兜底仍可见。 */
vi.mock("./AiAnswerViewer", () => ({ default: () => null }));
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

  it("保存到小记：默认 860×620、正文用渲染视图（不再是源码 textarea）、关闭钮可点（用户 261110）", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<SaveQuickNoteDialog open content={"# 标题\n\n这是一条小记正文"} busy={false} error={null} onConfirm={onConfirm} onClose={onClose} />);
    const el = section();
    expect(el.className).toContain("aiw-quicknote");
    expect(el.style.width).toBe("860px");
    expect(el.style.height).toBe("620px");
    expect(el.querySelectorAll(".floating-dialog-resize").length).toBe(8);
    // 内核只读视图（lazy）+ MarkdownView 兜底：不再暴露源码 textarea，正文以渲染态出现
    expect(el.querySelector("textarea")).toBeNull();
    const preview = el.querySelector(".aiw-quicknote__preview")!;
    expect(preview.getAttribute("role")).toBe("document");
    expect(preview.textContent).toContain("这是一条小记正文");
    // 保存的仍是原始 Markdown（渲染只是展示层，不改入库内容）
    const save = [...el.querySelectorAll("button")].find((b) => (b.textContent || "").includes("小记一下"))!;
    act(() => { save.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(onConfirm).toHaveBeenCalledWith("# 标题\n\n这是一条小记正文");
    const close = el.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!;
    act(() => { close.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("生成文档：标题可编辑，确认时把用户改过的标题带给 onConfirm（用户 261110 点单）", () => {
    const onConfirm = vi.fn();
    render(<PublishDocDialog open title="AI 生成文档" notebooks={[notebook]} busy={false} error={null} onConfirm={onConfirm} onClose={() => {}} />);
    const el = section();
    const input = el.querySelector<HTMLInputElement>('[aria-label="文档标题"]')!;
    expect(input).toBeTruthy();
    expect(input.value).toBe("AI 生成文档");
    // React 受控输入：走原生 setter + input 事件
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "我改过的标题");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirm = [...el.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "确认")!;
    act(() => { confirm.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(onConfirm).toHaveBeenCalledWith("nb1", "我改过的标题");
  });
});
