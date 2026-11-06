// @vitest-environment jsdom
/**
 * 手写板只读预览（261106）：历史快照 / 标签空间共用 InkPreview。
 * 锁四件事：① 只读（工具按钮禁用、不落笔）；② 多页可翻页且**不写设备本地导航键**（预览不能串台文档视图）；
 * ③ 坏正文退化成 InkPad 的只读保护横幅（不白屏、不抛错）；④ 空页不崩。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { createInkDoc, inkToBody, type InkDoc } from "../../core/inkDoc";
import { InkPreview } from "./InkPreview";

interface Mounted { container: HTMLElement; unmount: () => Promise<void> }

async function mount(content: string): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => { root.render(<InkPreview content={content} />); });
  return {
    container,
    unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); },
  };
}

function twoPageBody(): string {
  const doc: InkDoc = createInkDoc("page-1");
  doc.pages.push({ ...doc.pages[0], id: "page-2" });
  return inkToBody(doc);
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  class ResizeObserverStub { observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ } }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
});

describe("手写板只读预览 InkPreview", () => {
  it("只读渲染：readOnly + 工具按钮全部禁用（落笔/擦除不可能触发）", async () => {
    const view = await mount(twoPageBody());
    const pad = view.container.querySelector(".ink-pad")!;
    expect(pad).not.toBeNull();
    expect(pad.getAttribute("data-readonly")).toBe("true");
    for (const label of ["画笔", "高亮笔", "整笔橡皮", "撤销", "重做", "新建页"]) {
      const btn = view.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      expect(btn, label).not.toBeNull();
      expect(btn!.disabled, label).toBe(true);
    }
    await view.unmount();
  });

  it("多页：底栏显示页码、可翻页，但**不写**设备本地 ink-nav（不带 noteId）", async () => {
    localStorage.clear();
    const view = await mount(twoPageBody());
    const counter = view.container.querySelector(".ink-pages span")!;
    expect(counter.textContent).toContain("第 1 / 2 页");
    const next = view.container.querySelector<HTMLButtonElement>('button[aria-label="下一页"]')!;
    await act(async () => { next.click(); });
    expect(view.container.querySelector(".ink-pages span")!.textContent).toContain("第 2 / 2 页");
    const navKeys = Object.keys(localStorage).filter((key) => key.startsWith("lakex-local-notes-v3.ink-nav."));
    expect(navKeys).toEqual([]);
    await view.unmount();
  });

  it("坏正文：退化成 InkPad 的只读保护横幅（不抛错）", async () => {
    const view = await mount("这不是 inkDoc 正文");
    const pad = view.container.querySelector(".ink-pad")!;
    expect(pad.className).toContain("ink-pad--invalid");
    expect(pad.textContent).toContain("手写板正文无法解析");
    await view.unmount();
  });

  it("外层只提供槽位类，不自己写滚动容器（滚动交给调用方预览槽）", async () => {
    const view = await mount(inkToBody(createInkDoc()));
    const root = view.container.querySelector(".ink-preview")!;
    expect(root).not.toBeNull();
    expect(root.getAttribute("aria-label")).toBe("手写板只读预览");
    expect(view.container.querySelectorAll(".history-editor-preview, .note-doc-preview")).toHaveLength(0);
    await view.unmount();
  });
});
