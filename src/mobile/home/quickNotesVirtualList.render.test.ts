// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => Array.from({ length: 6 }, (_, index) => ({ index, key: `q${index}`, start: index * 140 - 20, size: 140 })),
    getTotalSize: () => 5600,
    measure: () => undefined,
    measureElement: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

import { HomePage, type MobileQuickNote } from "./HomePage";

class ResizeObserverStub {
  constructor(private readonly callback?: ResizeObserverCallback) {}
  observe(target?: Element): void {
    if (target && this.callback) {
      const rect = { width: 390, height: 800, top: 0, left: 0, right: 390, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRectReadOnly;
      this.callback([{ target, contentRect: rect, borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
  }
  disconnect(): void {}
  unobserve(): void {}
}

class IntersectionObserverStub {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
  takeRecords(): [] { return []; }
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, value: 8000 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 390, bottom: 800, width: 390, height: 800,
    toJSON: () => ({}),
  } as DOMRect);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("小记虚拟列表渲染", () => {
  it("40 条小记只挂载视口附近的卡片，而不是全部 40 张", async () => {
    const notes: MobileQuickNote[] = Array.from({ length: 40 }, (_, index) => ({
      id: `q${index}`,
      createdAt: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      updatedAt: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      previewText: `小记 ${index}`,
      imageCount: 0,
      firstImage: null,
      tags: [],
      tagIds: [],
    }));
    await act(async () => {
      root.render(createElement(HomePage, {
        tab: "quick",
        notebooks: [],
        notes: [],
        quickNotes: notes,
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
        onQuickNotesChanged: async () => {},
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const mounted = host.querySelectorAll("[data-quick-note-id]").length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(40);
  });
});
