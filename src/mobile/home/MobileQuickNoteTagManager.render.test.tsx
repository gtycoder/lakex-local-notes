// @vitest-environment jsdom
/**
 * 移动端标签管理（261105）：重命名 / 删除 / 合并 / 置顶 / 上移下移。
 * 断言全部走 bridge 公开 API（标签表是唯一来源；删除只移除关联，不删小记）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateQuickNoteTag: vi.fn(async () => undefined),
  deleteQuickNoteTag: vi.fn(async () => undefined),
  mergeQuickNoteTags: vi.fn(async () => undefined),
  reorderQuickNoteTags: vi.fn(async () => undefined),
  confirmMobile: vi.fn(async () => true),
}));
vi.mock("../bridge", () => ({ bridge: {
  updateQuickNoteTag: mocks.updateQuickNoteTag,
  deleteQuickNoteTag: mocks.deleteQuickNoteTag,
  mergeQuickNoteTags: mocks.mergeQuickNoteTags,
  reorderQuickNoteTags: mocks.reorderQuickNoteTags,
} }));
vi.mock("../ui/ConfirmDialog", () => ({ confirmMobile: mocks.confirmMobile }));
vi.mock("../ui/toastBus", () => ({ showToast: vi.fn() }));

import { MobileQuickNoteTagManager } from "./MobileQuickNoteTagManager";

const T1 = "2026-11-01T00:00:00.000Z";
const tag = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, sortOrder: 0, pinned: false, createdAt: T1, updatedAt: T1, deletedAt: null, count: 1, ...over,
});

interface Mounted { container: HTMLElement; unmount: () => Promise<void> }

async function mount(tags = [tag("t_a", "工作"), tag("t_b", "灵感", { pinned: true })]): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const onChanged = vi.fn(async () => undefined);
  await act(async () => {
    root.render(<MobileQuickNoteTagManager open tags={tags} onClose={() => undefined} onChanged={onChanged} />);
  });
  return {
    container,
    unmount: async () => { await act(async () => root.unmount()); container.remove(); },
  };
}

const byAria = (root: ParentNode, label: string) => root.querySelector('[aria-label="' + label + '"]') as HTMLElement | null;
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => (el as HTMLElement).click()); };
const byText = (root: ParentNode, text: string) => [...root.querySelectorAll("button")].find((el) => (el.textContent || "").trim() === text) as HTMLButtonElement | undefined;

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("MobileQuickNoteTagManager", () => {
  it("置顶开关走 updateQuickNoteTag，并按当前 pin 状态给相反值", async () => {
    const m = await mount();
    try {
      await click(byAria(m.container, "置顶 工作"));
      expect(mocks.updateQuickNoteTag).toHaveBeenCalledWith("t_a", { pinned: true });
      await click(byAria(m.container, "取消置顶 灵感"));
      expect(mocks.updateQuickNoteTag).toHaveBeenLastCalledWith("t_b", { pinned: false });
    } finally { await m.unmount(); }
  });

  it("重命名：展开 → 输入 → 保存走 updateQuickNoteTag", async () => {
    const m = await mount();
    try {
      await click(byAria(m.container, "更多操作 工作"));
      await click(byText(m.container, "重命名"));
      const input = m.container.querySelector('input[aria-label="标签名"]') as HTMLInputElement;
      expect(input).toBeTruthy();
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "  工作区  ");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await click(byText(m.container, "保存"));
      expect(mocks.updateQuickNoteTag).toHaveBeenCalledWith("t_a", { name: "工作区" });
    } finally { await m.unmount(); }
  });

  it("删除：二次确认后走 deleteQuickNoteTag（不删小记）", async () => {
    const m = await mount();
    try {
      await click(byAria(m.container, "更多操作 工作"));
      await click(byText(m.container, "删除"));
      expect(mocks.confirmMobile).toHaveBeenCalled();
      expect(mocks.deleteQuickNoteTag).toHaveBeenCalledWith("t_a");
    } finally { await m.unmount(); }
  });

  it("合并：选择目标后走 mergeQuickNoteTags(source, target)", async () => {
    const m = await mount();
    try {
      await click(byAria(m.container, "更多操作 工作"));
      await click(byText(m.container, "合并到…"));
      expect(m.container.textContent).toContain("把「工作」合并到：");
      const target = [...m.container.querySelectorAll(".qn-tag-sheet__item")].find((el) => (el.textContent || "").startsWith("灵感"));
      await click(target ?? null);
      expect(mocks.mergeQuickNoteTags).toHaveBeenCalledWith("t_a", "t_b");
    } finally { await m.unmount(); }
  });

  it("排序：上移会按新顺序整表 reorder（置顶优先级由目录排序承担）", async () => {
    const m = await mount();
    try {
      await click(byAria(m.container, "更多操作 灵感"));
      await click(byText(m.container, "上移"));
      expect(mocks.reorderQuickNoteTags).toHaveBeenCalledWith(["t_b", "t_a"]);
    } finally { await m.unmount(); }
  });
});
