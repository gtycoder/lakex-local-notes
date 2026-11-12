// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoticeToast } from "./NoticeToast";
import { DesktopStatusBar } from "./DesktopStatusBar";
import type { DocumentStatusModel } from "../model/documentStatusModel";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 操作提示 toast（261112 task-93）：`showNotice` 在**任何空间**都要看得见。
 *
 * 机制：App 只把 `notice` 传给 DesktopStatusBar，而状态栏只在知识库空间有内容
 * （`showDocumentStats={desktopWorkspace === "library"}`）⇒ 之前其它空间整段 return null，提示丢失。
 * 现在状态栏在该分支渲染共享的 NoticeToast（无提示时返回 null，DOM 与以前一致）。
 */
const synced: DocumentStatusModel = { kind: "synced", label: "已同步" } as DocumentStatusModel;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const renderToast = (notice: Parameters<typeof NoticeToast>[0]["notice"]) => {
  act(() => root.render(createElement(NoticeToast, { notice })));
};

describe("NoticeToast（唯一提示实现）", () => {
  it("无提示 ⇒ 不渲染任何 DOM（其余空间/快照态零成本）", () => {
    renderToast(null);
    expect(host.childElementCount).toBe(0);
  });

  it("有提示 ⇒ 文本 + role=status（不是 alert：错误横幅另有其宿主）；可带一个动作按钮", () => {
    const onClick = vi.fn();
    renderToast({ text: "已转为文档：去年总结", action: { label: "打开", onClick } });
    const toast = host.querySelector<HTMLElement>(".document-notice-toast")!;
    expect(toast.textContent).toContain("已转为文档：去年总结");
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.getAttribute("aria-live")).toBe("polite");
    const action = toast.querySelector<HTMLButtonElement>("button")!;
    expect(action.className).toContain("ln-btn--link");
    act(() => action.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("非知识库空间的提示可见性（task-93）", () => {
  const renderBar = (overrides: Partial<Parameters<typeof DesktopStatusBar>[0]> = {}) => {
    act(() => root.render(createElement(DesktopStatusBar, {
      showDocumentStats: false, wordCount: 0, imageCount: 0, notice: null,
      documentStatus: synced, locked: false, ...overrides,
    })));
  };

  it("日记/小记/AI/标签/回收站/资源空间（showDocumentStats=false）：不渲染底栏，但提示 toast 可见", () => {
    renderBar({ notice: { text: "已转为小记；日记已移入回收站，可恢复" } });
    expect(host.querySelector(".statusbar")).toBeNull();
    const toast = host.querySelector<HTMLElement>(".document-notice-toast")!;
    expect(toast).toBeTruthy();
    expect(toast.textContent).toContain("已转为小记");
  });

  it("非知识库空间无提示 ⇒ 什么都不渲染（42 态快照里的这些态 DOM 与以前一致）", () => {
    renderBar({ notice: null });
    expect(host.childElementCount).toBe(0);
  });

  it("知识库空间行为不变：底栏仍在，提示按原位置/原类名渲染", () => {
    act(() => root.render(createElement(DesktopStatusBar, {
      showDocumentStats: true, wordCount: 10, imageCount: 2,
      notice: { text: "已复制 Markdown（12 字符）" }, documentStatus: synced, locked: false,
    })));
    expect(host.querySelector(".statusbar")).toBeTruthy();
    expect(host.querySelector(".document-notice-toast")?.textContent).toContain("已复制 Markdown");
  });

  it("接线护栏：App 始终渲染 DesktopStatusBar（只是统计内容按空间收敛），提示标记只有一份", () => {
    const APP = readFileSync(path.resolve("src/App.tsx"), "utf8");
    const BAR = readFileSync(path.resolve("src/components/app/DesktopStatusBar.tsx"), "utf8");
    // 状态栏在每个空间都挂载 ⇒ 提示宿主在所有空间可达（不是每个空间各写一份 toast）
    expect(APP).toContain("<DesktopStatusBar");
    expect(APP).toContain('showDocumentStats={desktopWorkspace === "library"}');
    expect(BAR).toContain("if (!showDocumentStats) return <NoticeToast notice={notice} />;");
    expect(BAR).toContain("<NoticeToast notice={notice} />");
    // 提示只有 NoticeToast 一份标记（状态栏不许再内联一份）
    expect(BAR).not.toContain('className="document-notice-toast"');
    const TOAST = readFileSync(path.resolve("src/components/app/NoticeToast.tsx"), "utf8");
    expect(TOAST).toContain('className="document-notice-toast"');
    expect(TOAST).toContain('role="status"');
  });
});
