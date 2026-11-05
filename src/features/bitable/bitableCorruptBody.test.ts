// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BitableEditor, type BitableEditorProps } from "./BitableEditor";

/**
 * 多维表「坏正文 = 只读」行为护栏（CORE-02）。
 *
 * 背景：桌面旧版自己写了判据 `parseBitableBody(content) === null`——它同时把**空正文**
 * （新建/清空）判成坏正文 ⇒ 空白文档一打开就只读 + 横幅；而移动端把 null 落成
 * 「这张多维表还没有数据表。」，用户根本看不到正文已损坏。判据已收口到 core 的
 * `checkDocBody("bitable", …)`（与 usheet / board / ink 同一套），本测试锁两端宿主行为。
 */
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("bt-grid-wrap") ? 600 : 36; });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(900);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(content: string, overrides: Partial<BitableEditorProps> = {}): BitableEditorProps {
  const props: BitableEditorProps = {
    noteId: "corrupt-1", content, visible: true, readOnly: false,
    onChange: vi.fn(), onDirty: vi.fn(),
    ...overrides,
  };
  act(() => root.render(createElement(BitableEditor, props)));
  return props;
}

describe("多维表坏正文（CORE-02 单一判据）", () => {
  it("坏 JSON = 只读 + 横幅，且从不写盘 / 标脏", () => {
    const props = mount("{ 不是 json");
    expect(host.querySelector("[data-bitable-parse-error]")).not.toBeNull();
    expect(host.textContent).toContain("已锁定为只读");
    // 编辑入口全部禁用（只读兜底，不是「空表」）
    expect(host.querySelector<HTMLButtonElement>(".bt-add-record")?.disabled).toBe(true);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onDirty).not.toHaveBeenCalled();
  });

  it("结构不对 / 异 kind 也按坏正文处理（不落成空表）", () => {
    for (const bad of [
      JSON.stringify({ kind: "bitable", version: 99, tables: [] }),
      JSON.stringify({ kind: "usheet", version: 1, workbook: {} }),
      "<p>这是一篇 Lake 文档</p>",
    ]) {
      act(() => root.unmount());
      root = createRoot(host);
      mount(bad);
      expect(host.querySelector("[data-bitable-parse-error]"), bad).not.toBeNull();
    }
  });

  it("空正文 = 可编辑的默认数据表（不再被误判成坏正文）", () => {
    const props = mount("");
    expect(host.querySelector("[data-bitable-parse-error]")).toBeNull();
    // 默认表 = 1 张数据表 + 表格视图，编辑入口可用
    expect(host.querySelector(".bt-grid")).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>(".bt-add-record")?.disabled).toBe(false);
    act(() => { vi.advanceTimersByTime(5000); });
    // 打开即只读：不因为「补默认表」就写盘
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("合法正文照常可编辑（判据不误伤正常文档）", () => {
    const good = JSON.stringify({
      kind: "bitable", version: 1, activeTableId: "t1",
      tables: [{
        id: "t1", name: "表一", activeViewId: "v1",
        views: [{ id: "v1", name: "表格视图", type: "grid" }],
        fields: [{ id: "f1", name: "文本", type: "text" }],
        records: [{ id: "r1", createdAt: "T0", updatedAt: "T0", values: { f1: "甲" } }],
      }],
    });
    mount(good);
    expect(host.querySelector("[data-bitable-parse-error]")).toBeNull();
    expect(host.querySelector(".bt-grid")).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>(".bt-add-record")?.disabled).toBe(false);
  });
});
