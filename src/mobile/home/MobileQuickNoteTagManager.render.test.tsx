// @vitest-environment jsdom
/**
 * 移动端标签管理（261105）：重命名 / 删除 / 合并 / 拖拽排序（无置顶、无上下移按钮）。
 * 261106：补「新建」→ 设置「标签」页同一入口；删除/合并文案对齐桌面（会同时移除文档与小记上的该标签）。
 * 拖拽本身依赖真实 touch 与 elementFromPoint（设备验收），这里覆盖渲染与写操作接线。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createQuickNoteTag: vi.fn(async () => ({ id: "t_new", name: "新", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" })),
  updateQuickNoteTag: vi.fn(async () => undefined),
  deleteQuickNoteTag: vi.fn(async () => undefined),
  mergeQuickNoteTags: vi.fn(async () => undefined),
  reorderQuickNoteTags: vi.fn(async () => undefined),
  confirmMobile: vi.fn(async (_options?: { title?: string; body?: string; confirmText?: string }) => true),
}));
vi.mock("../bridge", () => ({ bridge: {
  createQuickNoteTag: mocks.createQuickNoteTag,
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
  id, name, createdAt: T1, updatedAt: T1, count: 1, ...over,
});

interface Mounted { container: HTMLElement; unmount: () => Promise<void>; onChanged: () => Promise<void> }

async function mount(
  tags = [tag("t_a", "工作"), tag("t_b", "灵感")],
  docCounts?: Record<string, number>,
): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const onChanged = vi.fn(async () => undefined);
  await act(async () => {
    root.render(<MobileQuickNoteTagManager open tags={tags} docCounts={docCounts} onClose={() => undefined} onChanged={onChanged} />);
  });
  return { container, onChanged, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}

const byAria = (root: ParentNode, label: string) => root.querySelector('[aria-label="' + label + '"]') as HTMLElement | null;
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => (el as HTMLElement).click()); };
const byText = (root: ParentNode, text: string) => [...root.querySelectorAll("button")].find((el) => (el.textContent || "").trim() === text) as HTMLButtonElement | undefined;

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const typeInto = async (input: HTMLInputElement, value: string): Promise<void> => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("MobileQuickNoteTagManager", () => {
  it("渲染：长按拖拽提示在；没有置顶/上下移入口（261105 定稿）", async () => {
    const m = await mount();
    try {
      expect(m.container.textContent).toContain("长按拖动可排序");
      expect(byAria(m.container, "置顶 工作")).toBeNull();
      expect(byText(m.container, "上移")).toBeUndefined();
      expect(byText(m.container, "下移")).toBeUndefined();
      expect(m.container.querySelectorAll("[data-tag-id]").length).toBe(2);
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

  it("新建：输入名称 → 新建走 createQuickNoteTag，并刷新目录", async () => {
    mocks.createQuickNoteTag.mockClear();
    const m = await mount();
    try {
      const input = m.container.querySelector('input[aria-label="新标签名称"]') as HTMLInputElement;
      expect(input).toBeTruthy();
      await typeInto(input, "  工作区  ");
      await click(byText(m.container, "新建"));
      expect(mocks.createQuickNoteTag).toHaveBeenCalledWith("工作区");
      expect(m.onChanged).toHaveBeenCalled();
    } finally { await m.unmount(); }
  });

  it("新建：与已有标签同名时不调桥，就地报错", async () => {
    mocks.createQuickNoteTag.mockClear();
    const m = await mount();
    try {
      await typeInto(m.container.querySelector('input[aria-label="新标签名称"]') as HTMLInputElement, "工作");
      await click(byText(m.container, "新建"));
      expect(mocks.createQuickNoteTag).not.toHaveBeenCalled();
      expect(m.container.textContent).toContain("已有同名标签");
    } finally { await m.unmount(); }
  });

  it("删除确认文案与桌面一致：说明会同时移除文档与小记上的该标签（带引用计数）", async () => {
    mocks.confirmMobile.mockClear();
    const m = await mount(undefined, { t_a: 3 });
    try {
      expect(m.container.textContent).toContain("3 篇、1 条"); // 行计数：文档数 + 小记数
      await click(byAria(m.container, "更多操作 工作"));
      await click(byText(m.container, "删除"));
      const options = mocks.confirmMobile.mock.calls[0]?.[0] as { title?: string; body?: string };
      expect(options.title).toBe("删除标签「工作」？");
      expect(options.body).toBe("会同时移除文档与小记上的该标签（引用 3 篇文档、1 条小记）；文档与小记本身不会被删除。");
    } finally { await m.unmount(); }
  });

  it("合并确认文案与桌面合并弹窗一致（源标签消失、内容保留、引用改到目标标签）", async () => {
    mocks.confirmMobile.mockClear();
    const m = await mount();
    try {
      await click(byAria(m.container, "更多操作 工作"));
      await click(byText(m.container, "合并到…"));
      expect(m.container.textContent).toContain("合并后源标签消失；文档与小记会保留，引用改到目标标签。");
      await click([...m.container.querySelectorAll(".qn-tag-sheet__item")].find((el) => (el.textContent || "").startsWith("灵感")) ?? null);
      const options = mocks.confirmMobile.mock.calls[0]?.[0] as { body?: string };
      expect(options.body).toBe("合并后源标签消失；文档与小记会保留，引用改到目标标签。");
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
});
