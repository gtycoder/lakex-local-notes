// @vitest-environment jsdom
/**
 * AI 写作左栏（261110）：左侧 14px / 搜索过滤 / 置顶段（不做对话分组）/ 行内 ⋯ 置顶。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiWritingSidebar } from "./AiWritingSidebar";
import type { AiWritingConversation } from "../../core/aiWriting";

class ResizeObserverStub {
  observe() { /* noop */ }
  unobserve() { /* noop */ }
  disconnect() { /* noop */ }
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

const conversation = (id: string, title: string, updatedAt: string): AiWritingConversation => ({
  id, mode: "chat", title, promptText: null, docRefs: [],
  createdAt: updatedAt, updatedAt,
});

// 时间**相对 now** 生造：写死日期会让这条用例过一天就红（261111 实测：隔天跑「今天」桶空了）。
const now = new Date();
const yesterdayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).toISOString();
const list = [
  conversation("a", "周报整理", now.toISOString()),
  conversation("b", "产品标语", new Date(now.getTime() - 3600_000).toISOString()),
  conversation("c", "翻译练习", yesterdayNoon),
];

function render(props: Partial<Parameters<typeof AiWritingSidebar>[0]> = {}) {
  const handlers = {
    onNew: vi.fn(), onSelect: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onTogglePin: vi.fn(),
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <AiWritingSidebar
        conversations={list}
        activeId={null}
        pinnedIds={[]}
        {...handlers}
        {...props}
      />,
    );
  });
  return handlers;
}

const rowTitles = (): string[] => [...document.querySelectorAll(".aiw-hist .ln-row .ln-ellipsis")].map((el) => (el.textContent ?? "").trim());

afterEach(() => { act(() => { root?.unmount(); }); host?.remove(); root = null; });

describe("AiWritingSidebar（搜索 + 置顶）", () => {
  beforeEach(() => { localStorage.clear(); });

  it("默认按日期分组（今天/昨天/更早），没有「置顶」段", () => {
    render();
    const labels = [...document.querySelectorAll(".aiw-hist__label")].map((el) => (el.textContent ?? "").trim());
    expect(labels).toContain("今天");
    expect(labels).toContain("昨天");
    expect(labels).not.toContain("置顶");
    expect(rowTitles()).toEqual(["周报整理", "产品标语", "翻译练习"]);
  });

  it("置顶会话排在最前（独立「置顶」段，不并进日期分组）", () => {
    render({ pinnedIds: ["c"] });
    const labels = [...document.querySelectorAll(".aiw-hist__label")].map((el) => (el.textContent ?? "").trim());
    expect(labels[0]).toBe("置顶");
    expect(rowTitles()[0]).toBe("翻译练习");
    // 其余仍按日期分组
    expect(rowTitles().slice(1)).toEqual(["周报整理", "产品标语"]);
  });

  it("搜索框按标题过滤；无结果给提示", () => {
    render();
    const input = document.querySelector<HTMLInputElement>(".aiw-search input")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "标语");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(rowTitles()).toEqual(["产品标语"]);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "不存在");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(rowTitles()).toEqual([]);
    expect(document.querySelector(".aiw-hist__empty")?.textContent).toContain("没有匹配的对话");
  });

  it("新对话 = 重点按钮（ln-btn--primary，261110 用户点单）", () => {
    render();
    const button = document.querySelector(".aiw-new")!;
    expect(button.className).toContain("ln-btn");
    expect(button.className).toContain("ln-btn--primary");
  });

  it("行内 ⋯ → 置顶：回调带上会话 id", () => {
    const handlers = render();
    const more = document.querySelector<HTMLButtonElement>('[aria-label="对话操作"]')!;
    act(() => { more.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    const pinItem = [...document.querySelectorAll('[role="menuitem"]')].find((el) => (el.textContent ?? "").includes("置顶"))!;
    act(() => { pinItem.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(handlers.onTogglePin).toHaveBeenCalledWith("a");
  });

  it("右键行 = 打开同一个菜单（与知识库目录右键同一入口/同一形式，用户 261111）", () => {
    render();
    const row = document.querySelector<HTMLElement>(".aiw-hist .ln-row[role=listitem]")!;
    act(() => {
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 200 }));
    });
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((el) => (el.textContent ?? "").trim())).toEqual(["置顶", "重命名", "删除"]);
    // 与目录右键同一套表面/分隔线/危险项（surfaceClassName 覆盖默认 .ln-menu ⇒ 表面类就是 .context-menu）
    const surface = document.querySelector(".context-menu")!;
    expect(surface).toBeTruthy();
    expect(surface.querySelector(".context-menu-sep")).toBeTruthy();
    const danger = [...surface.querySelectorAll('button[role="menuitem"]')].find((el) => (el.textContent ?? "").includes("删除"))!;
    expect(danger.className).toBe("danger");
  });

  it("行内 ⋯ 菜单：三项都带图标、且挂到 body（不受左栏 overflow 裁剪，用户 261111）", () => {
    render();
    const more = document.querySelector<HTMLButtonElement>('[aria-label="对话操作"]')!;
    act(() => { more.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((el) => (el.textContent ?? "").trim())).toEqual(["置顶", "重命名", "删除"]);
    // 每一项都有 lead 图标（与知识库右键菜单同一身份：lucide 14 / aria-hidden）
    for (const item of items) {
      const icon = item.querySelector("svg");
      expect(icon, "菜单项缺图标：" + (item.textContent ?? "")).toBeTruthy();
      expect(icon!.getAttribute("aria-hidden")).toBe("true");
    }
    // 菜单是 portal 到 body 的浮层 ⇒ 左栏 .aiw-side 的 overflow:hidden 裁不到它
    const surface = document.querySelector(".context-menu")!;
    expect(surface).toBeTruthy();
    expect(surface.closest(".aiw-side")).toBeNull();
  });
});
