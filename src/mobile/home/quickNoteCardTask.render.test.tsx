// @vitest-environment jsdom
/**
 * 261106 用户反馈：移动端小记卡片预览里的待办勾选框点不动。
 * 根因：HomePage 渲染卡片时没给 QuickNotePreview 传 onToggleTask（组件在无回调时把复选框设成只读）。
 * 本用例锁三件事：
 *  ① 卡片把回调传下去（复选框不再只读）；
 *  ② 点第 N 个勾选框 ⇒ 按序号翻转正文里那一个 checkbox 卡值，用 saveQuickNoteContent 回写（text/images 原样）；
 *  ③ 失败给可见提示、不静默，且不回填/不刷新（不制造假的勾选态）。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readQuickNote: vi.fn(),
  saveQuickNoteContent: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../bridge", () => ({
  bridge: {
    readQuickNote: mocks.readQuickNote,
    saveQuickNoteContent: mocks.saveQuickNoteContent,
  },
}));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));
// 卡片数 < 阈值时走普通列表；这里仍给一个桩，避免真实 virtualizer 在 jsdom 里量尺寸。
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    measure: () => undefined,
    measureElement: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

import { parseQuickNotePreview } from "../../features/quickNotes/quickNotePreviewParser";
import { HomePage, type MobileQuickNote } from "./HomePage";

const checkbox = (state: "true" | "false") => `<card type="inline" name="checkbox" value="data:${state}"></card>`;
const bodyWith = (second: "true" | "false") =>
  `<ul class="lake-list"><li class="lake-list-node lake-list-task">${checkbox("false")}<span>写代码</span></li><li class="lake-list-node lake-list-task">${checkbox(second)}<span>跑测试</span></li></ul>`;

const NOTE: MobileQuickNote = {
  id: "q1",
  createdAt: "2026-11-06T09:00:00.000Z",
  updatedAt: "2026-11-06T09:00:00.000Z",
  previewText: "写代码 跑测试",
  imageCount: 0,
  firstImage: null,
  tags: [],
  tagIds: [],
};

/** 假的小记库：save 只改正文与 updatedAt，read 始终回当前状态（与真桥同构）。 */
let storedBody = bodyWith("false");
let storedAt = "2026-11-06T09:00:00.000Z";

class IntersectionObserverStub {
  constructor(private readonly callback?: IntersectionObserverCallback) {}
  observe(target?: Element): void {
    if (target && this.callback) {
      this.callback([{ target, isIntersecting: true, intersectionRatio: 1 } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
  }
  disconnect(): void {}
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

class ResizeObserverStub {
  constructor(private readonly callback?: ResizeObserverCallback) {}
  observe(target?: Element): void {
    if (target && this.callback) {
      const rect = { width: 390, height: 120, top: 0, left: 0, right: 390, bottom: 120, x: 0, y: 0, toJSON: () => ({}) } as DOMRectReadOnly;
      this.callback([{ target, contentRect: rect, borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
  }
  disconnect(): void {}
  unobserve(): void {}
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onQuickNotesChanged = vi.fn(async () => {});

const renderHome = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(HomePage, {
      tab: "quick",
      notebooks: [],
      notes: [],
      quickNotes: [NOTE],
      tagDirectory: [],
      docCounts: {},
      onTabChange: () => {},
      onOpenNotebook: () => {},
      onOpenNote: () => {},
      onOpenDrawer: () => {},
      onOpenSearch: () => {},
      onCreateNotebook: () => {},
      onCreateNote: () => {},
      onTreeChanged: async () => {},
      onQuickNotesChanged,
      onQuickNoteTagsChanged: async () => {},
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, value: 120 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 390, bottom: 800, width: 390, height: 800,
    toJSON: () => ({}),
  } as DOMRect);
  storedBody = bodyWith("false");
  storedAt = "2026-11-06T09:00:00.000Z";
  mocks.readQuickNote.mockReset();
  mocks.readQuickNote.mockImplementation(async () => ({
    id: NOTE.id,
    content: { text: "写代码\n跑测试", body: storedBody, images: [] },
    tagIds: [],
    tags: [],
    previewText: NOTE.previewText,
    updatedAt: storedAt,
  }));
  mocks.saveQuickNoteContent.mockReset();
  mocks.saveQuickNoteContent.mockImplementation(async (_id: string, payload: { body: string }) => {
    storedBody = payload.body;
    storedAt = "2026-11-06T10:00:00.000Z";
    return NOTE.id;
  });
  mocks.showToast.mockReset();
  onQuickNotesChanged.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const checkboxes = (): HTMLInputElement[] => [...host.querySelectorAll<HTMLInputElement>(".qn-card input[type=checkbox]")];

describe("小记卡片预览勾选待办", () => {
  it("卡片把 onToggleTask 传给预览：复选框可点（不再只读）", async () => {
    await renderHome();
    const boxes = checkboxes();
    expect(boxes.length).toBe(2);
    expect(boxes[0].readOnly).toBe(false);
    expect(boxes[1].readOnly).toBe(false);
  });

  it("点第 2 个勾选框：翻转正文里那一个 checkbox，再按原 text/images 回写并刷新列表", async () => {
    await renderHome();
    const before = mocks.readQuickNote.mock.calls.length; // 首屏按需读详情 = 1 次
    await act(async () => {
      checkboxes()[1].click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.saveQuickNoteContent).toHaveBeenCalledTimes(1);
    const [savedId, payload] = mocks.saveQuickNoteContent.mock.calls[0] as [string, { text: string; body: string; images: unknown[] }];
    expect(savedId).toBe(NOTE.id);
    // text / images 原样回写，只有正文那一个 checkbox 从 data:false 翻成 data:true
    expect(payload.text).toBe("写代码\n跑测试");
    expect(payload.images).toEqual([]);
    const items = parseQuickNotePreview(payload.body)[0];
    expect(items.kind).toBe("list");
    if (items.kind === "list") {
      expect(items.items.map((item) => item.checked)).toEqual([false, true]);
    }
    expect(onQuickNotesChanged).toHaveBeenCalledTimes(1);

    // 立即回填详情缓存：卡片仍是富文本预览（不闪回纯文本摘要），且第 2 条已是勾选态。
    const after = checkboxes();
    expect(after.length).toBe(2);
    expect(after.map((box) => box.checked)).toEqual([false, true]);
    // 点勾选框不得顺带进编辑态（预览内部已 stopPropagation ⇒ 不会再走 openEdit 的整篇读取）。
    expect(mocks.readQuickNote.mock.calls.length).toBe(before + 2);
  });

  it("保存失败：给可见提示、不刷新列表、不伪造勾选态", async () => {
    mocks.saveQuickNoteContent.mockRejectedValueOnce(new Error("磁盘已满"));
    await renderHome();
    await act(async () => {
      checkboxes()[0].click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.showToast).toHaveBeenCalledTimes(1);
    const [message, options] = mocks.showToast.mock.calls[0] as [string, { type?: string }];
    expect(message).toContain("更新待办失败");
    expect(message).toContain("磁盘已满");
    expect(options?.type).toBe("error");
    expect(onQuickNotesChanged).not.toHaveBeenCalled();
  });

  it("正文读不出来（缺正文）时点不动也不崩：不保存、不刷新", async () => {
    mocks.readQuickNote.mockResolvedValue(null);
    await renderHome();
    const boxes = checkboxes();
    expect(boxes.length).toBe(0); // 没有正文就只能显示纯文本摘要
    expect(mocks.saveQuickNoteContent).not.toHaveBeenCalled();
    expect(onQuickNotesChanged).not.toHaveBeenCalled();
  });
});
