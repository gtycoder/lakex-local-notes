// @vitest-environment jsdom
/**
 * 小记列表多选模式（261106 task-82）：长按卡片进入、顶部栏（取消/已选 N/全选）、
 * 行复选框、底部操作条（打标签 / **移入回收站**；不做批量彻底删除）、返回键先退出多选。
 * 桥接（bridge.batchNotes）等 task-80 落地后接，本阶段动作按钮只给占位提示。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readQuickNote: vi.fn(async () => null),
  showToast: vi.fn(),
  listNoteTagLinks: vi.fn(async () => ({})),
  setQuickNoteTags: vi.fn(),
  setNoteTags: vi.fn(),
  batchNotes: vi.fn(),
  confirmMobile: vi.fn(async (_options?: { title?: string; body?: string; confirmText?: string }) => true),
}));
vi.mock("../bridge", () => ({
  bridge: {
    readQuickNote: mocks.readQuickNote,
    listNoteTagLinks: mocks.listNoteTagLinks,
    setQuickNoteTags: mocks.setQuickNoteTags,
    setNoteTags: mocks.setNoteTags,
    batchNotes: mocks.batchNotes,
  },
}));
vi.mock("../ui/ConfirmDialog", () => ({ confirmMobile: mocks.confirmMobile }));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    measure: () => undefined,
    measureElement: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

import { consumeBack } from "../ui/backStack";
import { HomePage, type MobileQuickNote } from "./HomePage";

const T = "2026-11-01T00:00:00.000Z";
const note = (id: string, text: string, updatedAt: string): MobileQuickNote => ({
  id, createdAt: T, updatedAt, previewText: text, imageCount: 0, firstImage: null, tags: [], tagIds: [],
});
const NOTES = [note("q1", "想法一", "2026-11-06T09:00:00.000Z"), note("q2", "想法二", "2026-11-05T09:00:00.000Z")];

class IntersectionObserverStub {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onTabChange = vi.fn();

const renderHome = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(HomePage, {
      tab: "quick",
      notebooks: [],
      notes: [],
      quickNotes: NOTES,
      tagDirectory: [{ id: "t_work", name: "工作", createdAt: T, updatedAt: T }],
      docCounts: {},
      onTabChange,
      onOpenNotebook: () => {},
      onOpenNote: () => {},
      onOpenQuickNote: () => {},
      onTagsChanged: async () => undefined,
      onOpenDrawer: () => {},
      onOpenSearch: () => {},
      onCreateNotebook: () => {},
      onCreateNote: () => {},
      onTreeChanged: async () => {},
      onQuickNotesChanged: async () => {},
      onQuickNoteTagsChanged: async () => {},
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const cards = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".qn-card")];
const longPress = async (card: HTMLElement): Promise<void> => {
  await act(async () => {
    const start = new Event("touchstart", { bubbles: true });
    Object.defineProperty(start, "touches", { value: [{ clientX: 10, clientY: 10 }] });
    card.dispatchEvent(start);
    await new Promise((resolve) => setTimeout(resolve, 400));
    card.dispatchEvent(new Event("touchend", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const click = async (el: Element | null | undefined): Promise<void> => {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
};
const topBar = (): HTMLElement | null => host.querySelector('[role="toolbar"][aria-label="多选操作"]');
const topButtons = (): HTMLButtonElement[] => [...(topBar()?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];
const actionBar = (): HTMLElement | null => host.querySelector('[role="group"][aria-label="批量操作"]');

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} unobserve(): void {} });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, value: 120 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.readQuickNote.mockClear();
  mocks.showToast.mockReset();
  mocks.batchNotes.mockReset();
  mocks.batchNotes.mockResolvedValue({ ok: true, results: [{ id: "q1", ok: true }], summary: { total: 1, done: 1, failed: 0 } });
  mocks.confirmMobile.mockReset();
  mocks.confirmMobile.mockResolvedValue(true);
  onTabChange.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("小记列表多选（task-82）", () => {
  it("常规态：三个 tab、胶囊栏在、没有复选框；长按卡片 → 选择条 + 复选框 + 胶囊让位", async () => {
    await renderHome();
    expect(host.querySelectorAll(".mobile-htab").length).toBe(3);
    expect(host.querySelector(".mobile-bottom-bar--home")).not.toBeNull();
    expect(host.querySelectorAll("[data-selection-checkbox]").length).toBe(0);

    await longPress(cards()[0]);
    expect(topBar()).not.toBeNull();
    expect(topBar()!.textContent).toContain("已选 1");
    expect(host.querySelectorAll("[data-selection-checkbox]").length).toBe(2);
    expect(host.querySelector(".mobile-bottom-bar--home")).toBeNull();   // 胶囊让位
    expect(host.querySelectorAll(".mobile-htab").length).toBe(0);        // 顶部换成选择条
  });

  it("长按抬手补发的 click 被吞掉（不打开编辑器）；选择态点卡片 = 切换勾选", async () => {
    await renderHome();
    const first = cards()[0];
    await longPress(first);
    await click(first); // 补发 click
    expect(host.textContent).toContain("已选 1");
    expect(mocks.readQuickNote).not.toHaveBeenCalled(); // 没有进编辑器（openEdit 会读全文）

    await click(cards()[1]);
    expect(topBar()!.textContent).toContain("已选 2");
    expect(cards()[1].getAttribute("aria-pressed")).toBe("true");
    await click(cards()[1]);
    expect(topBar()!.textContent).toContain("已选 1");
  });

  it("全选 / 全不选 / 取消恢复常规页头", async () => {
    await renderHome();
    await longPress(cards()[0]);
    expect(topButtons().map((b) => b.textContent?.trim())).toEqual(["取消", "全选"]);
    await click(topButtons()[1]);
    expect(topBar()!.textContent).toContain("已选 2");
    expect(topButtons()[1].textContent?.trim()).toBe("全不选");
    await click(topButtons()[1]);
    expect(topBar()!.textContent).toContain("已选 0");

    await click(topButtons()[0]);
    expect(topBar()).toBeNull();
    expect(host.querySelectorAll(".mobile-htab").length).toBe(3);
    expect(host.querySelector(".mobile-bottom-bar--home")).not.toBeNull();
  });

  const actionButton = (label: string): HTMLButtonElement =>
    [...actionBar()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === label)!;

  it("底部操作条：打标签 / 移入回收站（无批量删除、无「彻底」）", async () => {
    await renderHome();
    await longPress(cards()[0]);
    const labels = [...actionBar()!.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
    expect(labels).toEqual(["打标签", "移入回收站"]);
    expect(labels.join("")).not.toContain("删除");
    expect(labels.join("")).not.toContain("彻底");
  });

  it("移入回收站：二次确认（软删文案）→ bridge.batchNotes(trash quickNotes) → 刷新并退出选择", async () => {
    await renderHome();
    await longPress(cards()[0]);
    await click(actionButton("移入回收站"));
    const options = mocks.confirmMobile.mock.calls[0]?.[0] as { title?: string; body?: string; confirmText?: string };
    expect(options.title).toBe("移入回收站？");
    expect(options.body).toContain("小记回收站");
    expect(options.confirmText).toBe("移入回收站");
    expect(mocks.batchNotes).toHaveBeenCalledWith({ action: "trash", ids: ["q1"], space: "quickNotes" });
    expect(mocks.showToast).toHaveBeenCalledWith("已移入回收站 1 项");
    expect(topBar()).toBeNull(); // 成功后退出选择
  });

  it("打标签：选择器（搜索/多选）→ 确认按钮显示影响条数 → batchNotes(tag-add)", async () => {
    await renderHome();
    await longPress(cards()[0]);
    await click(actionButton("打标签"));
    expect(host.querySelector('input[aria-label="搜索标签"]')).toBeTruthy();
    const tagRow = [...host.querySelectorAll<HTMLButtonElement>(".qn-tag-sheet__item")]
      .find((el) => (el.textContent ?? "").includes("工作"))!;
    await click(tagRow);
    const confirm = [...host.querySelectorAll<HTMLButtonElement>(".mb-sheet__foot button")]
      .find((el) => (el.textContent ?? "").includes("确认"))!;
    expect(confirm.textContent).toContain("确认（1 条）");
    await click(confirm);
    expect(mocks.batchNotes).toHaveBeenCalledWith({ action: "tag-add", ids: ["q1"], space: "quickNotes", tagIds: ["t_work"] });
  });

  it("部分失败：错误提示汇总 + 保留选择（不退出）", async () => {
    mocks.batchNotes.mockResolvedValueOnce({
      ok: false,
      results: [{ id: "q1", ok: false, reason: "already-trashed" }],
      summary: { total: 1, done: 0, failed: 1 },
      reason: "invalid-input",
    });
    await renderHome();
    await longPress(cards()[0]);
    await click(actionButton("移入回收站"));
    expect(mocks.showToast).toHaveBeenCalledWith("成功 0，失败 1（已在回收站）", { type: "error" });
    expect(topBar()!.textContent).toContain("已选 1"); // 失败保留选择
  });

  it("返回键：选择态先退出多选（不退出 App）", async () => {
    await renderHome();
    await longPress(cards()[0]);
    await act(async () => { expect(consumeBack()).toBe(true); });
    expect(topBar()).toBeNull();
  });
});
