// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileBitableRecordPage } from "./MobileBitableRecordPage";
import { MobileBitableViewer } from "./MobileBitableViewer";
import { orderedTableFields, createBitableField, createBitableRecord, createBitableView, createDefaultBitableTable } from "../../core/bitableDoc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ts = "2026-09-01T00:00:00.000Z";

function fixture() {
  const table = createDefaultBitableTable("收集表");
  table.fields = [
    createBitableField("text", "标题", "f-title"),
    createBitableField("text", "内容", "f-content"),
  ];
  const view = createBitableView("grid", "内容", "v1");
  table.views = [view];
  table.activeViewId = view.id;
  const record = { ...createBitableRecord("r1"), createdAt: ts, updatedAt: ts, values: { "f-title": "记录一", "f-content": "正文" } };
  table.records = [record];
  return { table, view, record };
}

describe("MobileBitableRecordPage（只读详情）", () => {
  it("整页展示：标题 = 主字段值、只读徽标、字段逐行、1/N 翻页", () => {
    const { table, view, record } = fixture();
    const html = renderToStaticMarkup(createElement(MobileBitableRecordPage, {
      noteId: "n1", table, fields: orderedTableFields(table, view), record, ctx: { tables: [table] },
      index: 0, total: 3, onPrev: () => {}, onNext: () => {}, onClose: () => {},
    }));
    expect(html).toContain("mbt-page");
    expect(html).toContain("记录详情");
    expect(html).toContain(">只读<");
    expect(html).toContain("mbt-page-title");
    expect(html).toContain("记录一");
    expect(html).toContain("mbt-detail-row");
    expect(html).toContain("1/3");
    expect(html).toContain('aria-label="下一条"');
  });

  it("顶栏 = topChrome overlay 表面（顶部安全区消费一次，不再压状态栏）；正文内距并入共享 --mb-page-pad", () => {
    const { table, view, record } = fixture();
    const html = renderToStaticMarkup(createElement(MobileBitableRecordPage, {
      noteId: "n1", table, fields: orderedTableFields(table, view), record, ctx: { tables: [table] },
      index: 0, total: 3, onPrev: () => {}, onNext: () => {}, onClose: () => {},
    }));
    // 261119 task-5：整页从屏幕顶展开 ⇒ 顶栏声明 data-mb-topbar + data-edge="overlay"（契约登记见 topChromeContract.test.ts）
    expect(html).toMatch(/class="mbt-page-bar"[^>]*data-mb-topbar[^>]*data-edge="overlay"/);
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "mobileBitable.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // 安全区在本表面消费一次（--mb-chrome-inset-top，走契约派生；此前不消费 ⇒ 「编辑/只读」压在系统时钟上）
    expect(css).toMatch(/\.mbt-page-bar\s*\{[^}]*padding:\s*calc\(var\(--lake-space-xs\) \+ var\(--mb-chrome-inset-top\)\)/);
    // 正文与多维表列表/表单同一内距来源（打开详情不再换缩进）
    expect(css).toMatch(/\.mbt-page-body\s*\{[^}]*var\(--mb-page-pad\)/);
    expect(css).not.toMatch(/\.mbt-page-body[^}]*--mb-reader-pad/);
  });
});

describe("记录详情打开/关闭（261119 R-1：与 chrome 隐藏/恢复同批通知，防两级提交跳变）", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it("打开行详情：onFullscreenChange 与页面挂载同一批通知（通知时页面尚未挂载）；返回同批通知 false、各一次", () => {
    const { table } = fixture();
    const body = JSON.stringify({ kind: "bitable", version: 1, activeTableId: table.id, tables: [table] });
    const calls: Array<{ open: boolean; pageMounted: boolean }> = [];
    const onFullscreenChange = (open: boolean) => {
      calls.push({ open, pageMounted: !!host.querySelector(".mbt-page") });
    };
    act(() => root.render(createElement(MobileBitableViewer, { noteId: "n-detail", content: body, onFullscreenChange })));
    const row = host.querySelector<HTMLElement>('tr[role="row"]');
    expect(row).toBeTruthy();
    act(() => row!.click());
    // 通知发生在同一更新批里（此刻页面还没挂载）⇒ 打开与父级 chrome 隐藏一次提交到位。
    // 若退回「挂载后再通知」的 useEffect 实现（两级提交 = 打开/返回各跳一次），这里 pageMounted 会是 true。
    expect(calls).toEqual([{ open: true, pageMounted: false }]);
    expect(host.querySelector(".mbt-page")).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="返回"]')!.click());
    expect(calls).toEqual([{ open: true, pageMounted: false }, { open: false, pageMounted: true }]);
    expect(host.querySelector(".mbt-page")).toBeNull();
  });

  it("翻页（onPrev/onNext）不重复通知全屏状态（开/合只在真正变化时各一次）", () => {
    const { table } = fixture();
    table.records = [
      ...table.records,
      { ...createBitableRecord("r2"), createdAt: ts, updatedAt: ts, values: { "f-title": "记录二" } },
    ];
    const body = JSON.stringify({ kind: "bitable", version: 1, activeTableId: table.id, tables: [table] });
    const onFullscreenChange = vi.fn();
    act(() => root.render(createElement(MobileBitableViewer, { noteId: "n-detail2", content: body, onFullscreenChange })));
    act(() => host.querySelector<HTMLElement>('tr[role="row"]')!.click());
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="下一条"]')!.click());
    expect(host.querySelector(".mbt-page-title")!.textContent).toContain("记录");
    expect(onFullscreenChange.mock.calls).toEqual([[true]]);
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="返回"]')!.click());
    expect(onFullscreenChange.mock.calls).toEqual([[true], [false]]);
  });
});
