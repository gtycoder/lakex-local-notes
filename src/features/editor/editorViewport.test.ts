// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearScrollMemory, locateEditorSearchHit, readEditorScroll, rememberEditorScroll } from "./editorViewport";

/**
 * 编辑器视口域（261028 DT-14）：这些逻辑从 1114 行的 EditorTab.tsx 抽出来后，
 * 第一次可以脱离 Lake 内核、在 jsdom 里按**行为**验证（此前只有源码字符串断言）。
 */
describe("editorViewport — 滚动记忆", () => {
  it("按 noteId 记住 / 读取 / 清理，互不串台", () => {
    rememberEditorScroll("n1", 480);
    rememberEditorScroll("n2", 12);
    expect(readEditorScroll("n1")).toBe(480);
    expect(readEditorScroll("n2")).toBe(12);
    expect(readEditorScroll("n3")).toBeUndefined();
    clearScrollMemory("n1");
    expect(readEditorScroll("n1")).toBeUndefined();
    expect(readEditorScroll("n2")).toBe(12);
  });

  it("0 也是有效位置（不能被当成「没记过」）", () => {
    rememberEditorScroll("n0", 0);
    expect(readEditorScroll("n0")).toBe(0);
    clearScrollMemory("n0");
  });
});

describe("editorViewport — 模块边界（DT-14）", () => {
  it("不反向依赖 EditorTab 组件模块 / lakeRuntime（抽出来就是为了少拉依赖）", () => {
    // jsdom 环境下 import.meta.url 不是 file: 协议，按 vitest 根目录（仓库根）读源码。
    const src = readFileSync("src/features/editor/editorViewport.ts", "utf8");
    expect(src).not.toMatch(/^import .*["'].*\/EditorTab["']/m);
    expect(src).not.toMatch(/^import .*["'].*lakeRuntime["']/m);
    expect(src).not.toMatch(/from "react"/);
  });
});

describe("editorViewport — 全局搜索命中定位", () => {
  beforeEach(() => {
    // jsdom 不实现 scrollIntoView；这里只验证调用，不验证滚动几何（那由真机走查覆盖）。
    Object.defineProperty(Element.prototype, "scrollIntoView", { value: vi.fn(), writable: true, configurable: true });
    document.body.innerHTML = `<div class="lake-editor-tab" data-note-id="n1">
      <p data-node-id="a">Alpha 标题</p>
      <p data-node-id="b">无关内容</p>
    </div>`;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("命中即高亮命中块并滚动到第一个命中", () => {
    expect(locateEditorSearchHit("n1", "alpha")).toBe(true);
    expect(document.querySelector('[data-node-id="a"]')!.classList.contains("lake-search-hit-target")).toBe(true);
    expect(document.querySelector('[data-node-id="b"]')!.classList.contains("lake-search-hit-target")).toBe(false);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("高亮 1.8s 后自动清除", () => {
    expect(locateEditorSearchHit("n1", "alpha")).toBe(true);
    const hit = document.querySelector('[data-node-id="a"]')!;
    vi.advanceTimersByTime(1800);
    expect(hit.classList.contains("lake-search-hit-target")).toBe(false);
  });

  it("空查询 / 未知文档 / 无命中 → false（不抛错）", () => {
    expect(locateEditorSearchHit("n1", "   ")).toBe(false);
    expect(locateEditorSearchHit("missing", "alpha")).toBe(false);
    expect(locateEditorSearchHit("n1", "zzz")).toBe(false);
  });
});
