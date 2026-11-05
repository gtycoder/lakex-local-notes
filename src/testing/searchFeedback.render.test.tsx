// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ desktop: vi.fn(), mobile: vi.fn(), report: vi.fn() }));
vi.mock("../lib/native", () => ({ native: { searchNotes: mocks.desktop } }));
vi.mock("../mobile/bridge", () => ({ bridge: { searchNotes: mocks.mobile } }));
vi.mock("../mobile/lib/reportMobileActionError", () => ({ reportMobileActionError: mocks.report }));
// 本测试只验证搜索请求与反馈；真实 Sheet 的关闭/返回/焦点契约由移动浮层测试覆盖。
vi.mock("../mobile/ui/MobileSheet", () => ({
  MobileSheet: ({ open, children }: { open: boolean; children: ReactNode }) => open ? createElement("section", null, children) : null,
}));
import { SearchPanel } from "../components/app/SearchPanel";
import { SearchSheet } from "../mobile/settings/SearchSheet";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.desktop.mockReset(); mocks.mobile.mockReset(); mocks.report.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});
function setQuery(value: string) {
  const input = document.querySelector<HTMLInputElement>("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(220); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

for (const platform of ["desktop", "mobile"] as const) {
  const request = () => platform === "desktop" ? mocks.desktop : mocks.mobile;
  function render(open = true) {
    act(() => root.render(platform === "desktop"
      ? createElement(SearchPanel, { open, initialQuery: "旧关键词", onOpenNote: vi.fn(), onOpenQuickNote: vi.fn(), onClose: vi.fn() })
      : createElement(SearchSheet, { open, onOpenNote: vi.fn(), onOpenQuickNote: vi.fn(), onClose: vi.fn() })));
    if (platform === "mobile" && open) setQuery("旧关键词");
  }
  describe(platform + " 搜索反馈", () => {
    it("失败显示原因与重试，不冒充正常空结果；原地重试成功后清除错误", async () => {
      request().mockRejectedValueOnce(new Error("索引暂不可用")).mockResolvedValueOnce([]);
      render(); await flush();
      expect(document.querySelector('[role="alert"]')?.textContent).toContain("索引暂不可用");
      expect(document.body.textContent).not.toMatch(/没有匹配结果|无匹配结果/);
      const retry = [...document.querySelectorAll<HTMLButtonElement>("button")].find(e => e.textContent === "重试搜索")!;
      act(() => retry.click()); await flush();
      expect(request()).toHaveBeenCalledTimes(2);
      expect(document.querySelector('[role="alert"]')).toBeNull();
      expect(document.body.textContent).toMatch(/没有匹配结果|无匹配结果/);
    });
    it("新关键词成功后，旧请求晚到的错误不能覆盖新结果", async () => {
      const old = deferred<[]>();
      request().mockReturnValueOnce(old.promise).mockResolvedValueOnce([
        { id: "new", kind: "note", title: "新结果", snippet: "", matchType: "title", updatedAt: "2026-11-05" },
      ]);
      render(); await flush(); setQuery("新关键词"); await flush();
      await act(async () => old.reject(new Error("过期失败")));
      expect(document.body.textContent).toContain("新结果");
      expect(document.querySelector('[role="alert"]')).toBeNull();
    });
    it("清空关键词终止加载反馈，旧响应不重新填入结果", async () => {
      const old = deferred<[]>(); request().mockReturnValueOnce(old.promise);
      render(); await flush();
      expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
      setQuery(""); await flush();
      await act(async () => old.reject(new Error("旧请求失败")));
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
      expect(document.querySelector('[role="alert"]')).toBeNull();
    });
    it("关闭后到达的失败不会污染重新打开的搜索", async () => {
      const old = deferred<[]>(); request().mockReturnValueOnce(old.promise).mockResolvedValueOnce([]);
      render(); await flush(); render(false);
      await act(async () => old.reject(new Error("关闭前请求失败")));
      render(); await flush();
      expect(document.querySelector('[role="alert"]')).toBeNull();
      expect(document.body.textContent).toMatch(/没有匹配结果|无匹配结果/);
    });
  });
}
