// @vitest-environment jsdom
/**
 * 搜索 Sheet 渲染护栏（261105 搜索增强）。
 *
 * 覆盖：范围筛选（切档按新 scope 重搜 + 标签命中摘要）、最近搜索（空查询展示、点一条直接执行、
 * Enter 记录、清空）、空态引导（非「全部」无结果给放宽动作）、点击结果打开并关闭、失败重试。
 * MobileSheet 外壳用**真的**：返回键/右滑/遮罩/焦点必须由原语负责（换成桩就验不到回归）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const mocks = vi.hoisted(() => ({
  searchNotes: vi.fn(async (_query: string, _scope: string): Promise<Array<Record<string, unknown>>> => []),
  reportMobileActionError: vi.fn(async () => {}),
}));

vi.mock("../bridge", () => ({ bridge: { searchNotes: mocks.searchNotes } }));
vi.mock("../lib/reportMobileActionError", () => ({ reportMobileActionError: mocks.reportMobileActionError }));

import { SearchSheet } from "./SearchSheet";
import { RECENT_SEARCHES_KEY } from "../search/recentSearches";

const T = "2026-11-05T00:00:00.000Z";

function noteResult(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "n1", title: "项目计划", snippet: "正文里有<mark>项目</mark>", matchType: "body", updatedAt: T, parentTitle: "笔记本", ...patch };
}

let host: HTMLDivElement;
let root: Root;
let onClose: Mock<() => void>;
let onOpenNote: Mock<(id: string) => void>;
let onOpenQuickNote: Mock<(id: string) => void>;

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  localStorage.clear();
  mocks.searchNotes.mockReset();
  mocks.searchNotes.mockResolvedValue([]);
  mocks.reportMobileActionError.mockClear();
  onClose = vi.fn<() => void>();
  onOpenNote = vi.fn<(id: string) => void>();
  onOpenQuickNote = vi.fn<(id: string) => void>();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const render = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(SearchSheet, { open: true, onClose, onOpenNote, onOpenQuickNote }));
  });
};
const input = (): HTMLInputElement => host.querySelector<HTMLInputElement>(".mobile-search-input") as HTMLInputElement;
const setQuery = async (value: string): Promise<void> => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
};
/** 输入路径有 200ms 防抖：等一拍再断言。 */
const settle = async (ms = 240): Promise<void> => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
};
const button = (text: string): HTMLButtonElement | undefined =>
  ([...host.querySelectorAll("button")] as HTMLButtonElement[]).find((el) => (el.textContent ?? "").trim() === text);
const click = async (el: HTMLElement | undefined | null): Promise<void> => {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
};
const keydown = async (key: string): Promise<void> => {
  await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });
};

describe("搜索 Sheet：范围筛选 / 最近搜索 / 空态（261105）", () => {
  it("空查询展示最近搜索；点一条直接执行，点结果打开笔记并关闭", async () => {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(["旧查询", "项目"]));
    mocks.searchNotes.mockResolvedValue([noteResult()]);
    await render();

    expect(host.textContent).toContain("最近搜索");
    await click(button("旧查询"));
    await settle();
    expect(input().value).toBe("旧查询");
    expect(mocks.searchNotes).toHaveBeenCalledWith("旧查询", "all");
    expect(host.textContent).toContain("项目计划");

    const row = host.querySelector<HTMLButtonElement>("button.mobile-doc-row") as HTMLButtonElement;
    await click(row);
    expect(onOpenNote).toHaveBeenCalledWith("n1");
    expect(onClose).toHaveBeenCalled();
    // 「真正执行过」的查询回到最前（去重）
    expect(JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) as string)[0]).toBe("旧查询");
  });

  it("范围筛选：切到「标签」按新范围重搜，标签命中在行尾显示标签名", async () => {
    mocks.searchNotes.mockResolvedValue([noteResult({ matchedTags: ["灵感"] })]);
    await render();
    await setQuery("灵感");
    await settle();
    expect(mocks.searchNotes).toHaveBeenLastCalledWith("灵感", "all");

    await click(button("标签"));
    await settle();
    expect(mocks.searchNotes).toHaveBeenLastCalledWith("灵感", "tags");
    expect(host.textContent).toContain("标签：灵感");
    // 范围说明随档切换
    expect(host.textContent).toContain("只搜文档与小记的标签名");
  });

  it("非「全部」范围无结果 ⇒ 给放宽动作（标签范围文案 = 清空标签筛选），点了按「全部」重搜", async () => {
    await render();
    await setQuery("项目");
    await settle();

    await click(button("正文"));
    await settle();
    expect(host.textContent).toContain("当前范围（正文）没有匹配");
    await click(button("在全部范围搜索"));
    await settle();
    expect(mocks.searchNotes).toHaveBeenLastCalledWith("项目", "all");

    await click(button("标签"));
    await settle();
    expect(host.textContent).toContain("当前范围（标签）没有匹配");
    expect(button("清空标签筛选")).toBeTruthy();
  });

  it("Enter 立即搜索并记入最近搜索；输入框内 Esc 也能关闭", async () => {
    await render();
    await setQuery("移动 搜索");
    await keydown("Enter");
    await settle();
    expect(mocks.searchNotes).toHaveBeenCalledWith("移动 搜索", "all");
    expect(JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) as string)).toContain("移动 搜索");

    await keydown("Escape");
    expect(onClose).toHaveBeenCalled();
  });

  it("没有最近搜索时只给范围说明（不出现空历史区）", async () => {
    await render();
    expect(host.textContent).not.toContain("最近搜索");
    expect(host.textContent).toContain("搜文档标题、正文、标签与小记");
    await click(button("标题"));
    expect(host.textContent).toContain("只搜文档标题");
  });

  it("搜索失败给出错误与重试（不静默）", async () => {
    mocks.searchNotes.mockRejectedValueOnce(new Error("boom"));
    await render();
    await setQuery("项目");
    await settle();
    expect(host.textContent).toContain("搜索失败");
    expect(mocks.reportMobileActionError).toHaveBeenCalled();
    await click(button("重试搜索"));
    await settle();
    expect(mocks.searchNotes).toHaveBeenCalledTimes(2);
  });

  it("清空最近搜索只清本机这一项", async () => {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(["项目"]));
    await render();
    expect(host.textContent).toContain("项目");
    await click(button("清空"));
    expect(host.textContent).not.toContain("最近搜索");
    expect(localStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
  });
});

describe("搜索 Sheet 接线（原语负责返回/Esc/右滑）", () => {
  // jsdom 环境的 import.meta.url 不是 file: 协议，按仓库根取源码（同其它 jsdom 静态护栏）。
  const SOURCE = readFileSync(path.join(process.cwd(), "src/mobile/settings/SearchSheet.tsx"), "utf8");

  it("复用 MobileSheet，不手写浮层（返回栈/右滑/遮罩/焦点只有一套）", () => {
    expect(SOURCE).toContain("<MobileSheet");
    expect(SOURCE).toContain("onClose={onClose}");
    expect(SOURCE).not.toContain("createPortal");
    // 不自己渲染遮罩（只允许在注释里提到原语的类名）
    expect(SOURCE).not.toContain('className="mb-scrim"');
  });

  it("范围/最近搜索/空态都走纯逻辑模块（可单测，不在组件里藏判据）", () => {
    expect(SOURCE).toContain("bridge.searchNotes(trimmed, nextScope)");
    expect(SOURCE).toContain("searchEmptyState");
    expect(SOURCE).toContain("searchScopeHint");
    expect(SOURCE).toContain("recordRecentSearch");
    expect(SOURCE).toContain("clearRecentSearches");
  });
});
