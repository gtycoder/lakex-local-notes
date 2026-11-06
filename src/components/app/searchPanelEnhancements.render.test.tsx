// @vitest-environment jsdom
/**
 * 桌面搜索增强（261106）：范围筛选 / 最近搜索 / 空态与无结果引导 / 键盘与 Esc 不回归。
 * 纯逻辑在 features/search/*.test.ts 已覆盖；这里只验面板接线与可访问性行为。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  listQuickNoteTags: vi.fn(),
  listNoteTagLinks: vi.fn(),
  listNoteSummaries: vi.fn(),
  listQuickNotes: vi.fn(),
}));
vi.mock("../../lib/native", () => ({ native: mocks }));

import { SearchPanel } from "./SearchPanel";
import { RECENT_SEARCH_STORAGE_KEY } from "../../features/search/recentSearches";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.searchNotes.mockResolvedValue([]);
  mocks.listQuickNoteTags.mockResolvedValue([]);
  mocks.listNoteTagLinks.mockResolvedValue({});
  mocks.listNoteSummaries.mockResolvedValue([]);
  mocks.listQuickNotes.mockResolvedValue([]);
  localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(240); });
const input = () => document.querySelector<HTMLInputElement>(".search-panel-input-row input")!;
const optionRows = () => [...document.querySelectorAll<HTMLElement>('.search-panel-results [role="option"]')];
const tab = (label: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((el) => (el.textContent ?? "").trim() === label);
  if (!found) throw new Error("找不到范围页签：" + label);
  return found;
};
const click = (el: HTMLElement) => act(() => { el.click(); });
function render(overrides: Partial<Parameters<typeof SearchPanel>[0]> = {}) {
  const props = {
    open: true,
    initialQuery: "",
    onOpenNote: vi.fn(),
    onOpenQuickNote: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  act(() => root.render(createElement(SearchPanel, props)));
  return props;
}
const typeInto = (value: string) => act(() => {
  const el = input();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
const press = (key: string) => act(() => {
  input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
});

describe("搜索面板：范围筛选", () => {
  it("全部/标题/正文页签按 matchType 过滤；切回全部恢复", async () => {
    mocks.searchNotes.mockResolvedValue([
      { id: "t1", kind: "note", title: "标题命中", snippet: "", matchType: "title" },
      { id: "b1", kind: "note", title: "正文命中", snippet: "", matchType: "body" },
    ]);
    render({ initialQuery: "命中" });
    await flush();
    expect(optionRows().map((row) => row.textContent)).toEqual([expect.stringContaining("标题命中"), expect.stringContaining("正文命中")]);
    expect(tab("全部").getAttribute("aria-selected")).toBe("true");
    click(tab("标题"));
    await flush();
    expect(optionRows()).toHaveLength(1);
    expect(optionRows()[0].textContent).toContain("标题命中");
    click(tab("正文"));
    await flush();
    expect(optionRows()).toHaveLength(1);
    expect(optionRows()[0].textContent).toContain("正文命中");
    click(tab("全部"));
    await flush();
    expect(optionRows()).toHaveLength(2);
  });

  it("标签范围：用既有标签数据拼出命中（文档 + 小记，徽标「标签」）", async () => {
    mocks.listQuickNoteTags.mockResolvedValue([{ id: "t1", name: "灵感" }]);
    mocks.listNoteTagLinks.mockResolvedValue({ n1: ["t1"] });
    mocks.listNoteSummaries.mockResolvedValue([{ id: "n1", title: "灵感文档", kind: "doc", updatedAt: "2026-11-01T00:00:00.000Z", isConflict: false, parentId: null, sortOrder: 0 }]);
    mocks.listQuickNotes.mockResolvedValue([{ id: "q1", previewText: "灵感小记", updatedAt: "2026-11-02T00:00:00.000Z", tagIds: ["t1"] }]);
    render({ initialQuery: "灵感" });
    await flush();
    // 标签命中按更新时间倒序（小记 11-02 在前，文档 11-01 在后）
    expect(optionRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("灵感小记"),
      expect.stringContaining("灵感文档"),
    ]);
    expect(optionRows()[0].textContent).toContain("标签");
    click(tab("标签"));
    await flush();
    expect(optionRows()).toHaveLength(2);
    click(tab("标题"));
    await flush();
    expect(optionRows()).toHaveLength(0);
    expect(document.body.textContent).toContain("没有匹配结果");
  });
});

describe("搜索面板：最近搜索", () => {
  it("空查询展示最近搜索；点一下即执行；清空后不再出现", async () => {
    localStorage.setItem(RECENT_SEARCH_STORAGE_KEY, JSON.stringify(["标签", "Lake"]));
    render();
    await flush();
    expect(document.body.textContent).toContain("最近搜索");
    expect(document.body.textContent).toContain("Lake");
    const item = optionRows().find((row) => (row.textContent ?? "").includes("Lake"))!;
    click(item);
    await flush();
    expect(input().value).toBe("Lake");
    expect(mocks.searchNotes).toHaveBeenCalledWith("Lake", 50);

    typeInto("");
    await flush();
    const clear = [...document.querySelectorAll<HTMLButtonElement>("button")].find((btn) => (btn.textContent ?? "").trim() === "清空")!;
    click(clear);
    await flush();
    expect(document.body.textContent).not.toContain("最近搜索");
    expect(localStorage.getItem(RECENT_SEARCH_STORAGE_KEY)).toBeNull();
  });

  it("打开结果时把当前查询记进最近搜索（去重置顶）", async () => {
    localStorage.setItem(RECENT_SEARCH_STORAGE_KEY, JSON.stringify(["旧词", "客户"]));
    mocks.searchNotes.mockResolvedValue([{ id: "n1", kind: "note", title: "客户方案", snippet: "", matchType: "title" }]);
    const props = render({ initialQuery: "客户" });
    await flush();
    click(optionRows()[0]);
    await flush();
    expect(props.onOpenNote).toHaveBeenCalledWith("n1", "");
    expect(JSON.parse(localStorage.getItem(RECENT_SEARCH_STORAGE_KEY) ?? "[]")).toEqual(["客户", "旧词"]);
  });

  it("键盘：↑↓ 在最近搜索间移动，Enter 执行（空查询不再只显示提示）", async () => {
    localStorage.setItem(RECENT_SEARCH_STORAGE_KEY, JSON.stringify(["一", "二"]));
    render();
    await flush();
    press("ArrowDown");
    press("ArrowDown");
    expect(optionRows()[1].getAttribute("aria-selected")).toBe("true");
    press("Enter");
    await flush();
    expect(input().value).toBe("二");
  });
});

describe("搜索面板：空态 / 无结果引导 / 键盘不回归", () => {
  it("无关键词：引导搜标题/正文/标签 + ⌘K 唤起", async () => {
    render();
    await flush();
    expect(document.body.textContent).toContain("搜索标题、正文、标签");
    expect(document.body.textContent).toContain("⌘K");
  });

  it("无结果：范围不是全部时给「搜索全部范围」，点击后回到全部", async () => {
    render({ initialQuery: "无" });
    await flush();
    expect(document.body.textContent).toContain("没有匹配结果");
    expect([...document.querySelectorAll("button")].some((btn) => (btn.textContent ?? "").trim() === "搜索全部范围")).toBe(false);
    click(tab("标题"));
    await flush();
    const broaden = [...document.querySelectorAll<HTMLButtonElement>("button")].find((btn) => (btn.textContent ?? "").trim() === "搜索全部范围")!;
    expect(broaden).toBeTruthy();
    click(broaden);
    await flush();
    expect(tab("全部").getAttribute("aria-selected")).toBe("true");
  });

  it("键盘 ↑↓ 选择 + Enter 打开（原有搜索面板行为不回归）；Esc 关闭", async () => {
    mocks.searchNotes.mockResolvedValue([
      { id: "a", kind: "note", title: "结果一", snippet: "", matchType: "title" },
      { id: "b", kind: "note", title: "结果二", snippet: "", matchType: "body" },
    ]);
    const props = render({ initialQuery: "结果" });
    await flush();
    // 搜索返回后默认选中第一条；↓ 走到第二条。
    expect(optionRows()[0].getAttribute("aria-selected")).toBe("true");
    press("ArrowDown");
    expect(optionRows()[1].getAttribute("aria-selected")).toBe("true");
    // 再↓ 环形回到第一条（原有环绕步进不变）
    press("ArrowDown");
    expect(optionRows()[0].getAttribute("aria-selected")).toBe("true");
    press("ArrowDown");
    press("Enter");
    await flush();
    expect(props.onOpenNote).toHaveBeenCalledWith("b", "结果");
    expect(props.onClose).toHaveBeenCalled();

    const second = render({ initialQuery: "结果" });
    await flush();
    press("Escape");
    expect(second.onClose).toHaveBeenCalled();
  });
});
