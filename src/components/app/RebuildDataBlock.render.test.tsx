// @vitest-environment jsdom
/**
 * 261105 Batch4-D：「重建数据」Block 渲染/交互（列表 / 勾选 / 二次确认 / 取消 / 结果 / 失败）。
 * 依赖全部 props 注入（scan/rebuild/confirm），不依赖 IPC。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RebuildDataBlock, type RebuildDataBlockProps } from "./RebuildDataBlock";
import type { RebuildResultShape, RebuildScanResultShape } from "../../lib/types";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const scanned: RebuildScanResultShape = {
  generatedAt: "2026-11-05T00:00:00.000Z",
  scannedFiles: 2,
  truncated: false,
  candidates: [
    { noteId: "orphan-a", kind: "doc", relativePath: "notes/orphan-a.lake", sizeBytes: 120, mtimeMs: 1_800_000_000_000, title: "找回的笔记 A", titleSource: "body", rebuildable: true },
    { noteId: "orphan-b", kind: "doc", relativePath: "notes/orphan-b.lake", sizeBytes: 3, mtimeMs: 1_800_000_000_100, title: "恢复的笔记 orphan-b", titleSource: "fallback", rebuildable: false, reason: "正文不是合法 UTF-8（可能已损坏）" },
  ],
};

function render(props: Partial<RebuildDataBlockProps> = {}) {
  return act(async () => {
    root.render(createElement(RebuildDataBlock, {
      scan: vi.fn(async () => scanned),
      rebuild: vi.fn(async (): Promise<RebuildResultShape> => ({ generatedAt: "t", notebookId: "notebook-recovered", results: [{ noteId: "orphan-a", status: "created", title: "找回的笔记 A" }] })),
      confirm: vi.fn(async () => true),
      ...props,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const button = (text: string): HTMLButtonElement => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").includes(text))!;
const click = async (element: HTMLElement) => { await act(async () => { element.click(); await new Promise((resolve) => setTimeout(resolve, 0)); }); };

describe("重建数据 Block", () => {
  it("扫描：列出候选（标题/路径/size）；不可重建项禁用勾选并给原因", async () => {
    const scan = vi.fn(async () => scanned);
    await render({ scan });
    await click(button("扫描"));
    expect(scan).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("找回的笔记 A");
    expect(host.textContent).toContain("notes/orphan-a.lake");
    expect(host.textContent).toContain("不可重建");
    expect(host.textContent).toContain("正文不是合法 UTF-8");
    const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes).toHaveLength(2);
    expect(boxes[0].disabled).toBe(false);
    expect(boxes[1].disabled).toBe(true);
    expect(button("重建所选").disabled).toBe(true); // 未勾选
  });

  it("勾选 + 重建：二次确认（danger）→ 只提交所选 id → 展示结果", async () => {
    const confirm = vi.fn(async () => true);
    const rebuild = vi.fn(async (): Promise<RebuildResultShape> => ({ generatedAt: "t", notebookId: "notebook-recovered", results: [{ noteId: "orphan-a", status: "created", title: "找回的笔记 A" }] }));
    await render({ confirm, rebuild });
    await click(button("扫描"));
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => { box.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    await click(button("重建所选"));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }));
    expect(rebuild).toHaveBeenCalledWith(["orphan-a"]);
    expect(host.textContent).toContain("已重建");
    expect(host.textContent).toContain("notebook-recovered");
  });

  it("取消确认 ⇒ 不调用 rebuild（列表保留）", async () => {
    const confirm = vi.fn(async () => false);
    const rebuild = vi.fn(async (): Promise<RebuildResultShape> => ({ generatedAt: "t", notebookId: "notebook-recovered", results: [] }));
    await render({ confirm, rebuild });
    await click(button("扫描"));
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => { box.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    await click(button("重建所选"));
    expect(rebuild).not.toHaveBeenCalled();
    expect(host.textContent).toContain("找回的笔记 A");
  });

  it("扫描失败/重建失败都明确报错（不静默）", async () => {
    await render({ scan: vi.fn(async () => { throw new Error("扫描炸了"); }) });
    await click(button("扫描"));
    expect(host.textContent).toContain("扫描失败：扫描炸了");

    await render({
      scan: vi.fn(async () => scanned),
      rebuild: vi.fn(async () => { throw new Error("库不可写"); }),
    });
    await click(button("扫描"));
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => { box.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    await click(button("重建所选"));
    expect(host.textContent).toContain("重建失败：库不可写");
  });
});
