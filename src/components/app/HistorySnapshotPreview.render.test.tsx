// @vitest-environment jsdom
/**
 * 历史快照预览的 ink 分支（261106）：解析成功 ⇒ 只读画布（InkPreview，懒加载）；
 * 解析失败 ⇒ 仍退回结构化统计（不白屏、不挂内核/画布）。
 * 这里把 InkPreview 模块整体 mock 掉（真实 InkPad 由 InkPreview.render.test.tsx 覆盖）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInkDoc, inkToBody } from "../../core/inkDoc";

vi.mock("../../features/ink/InkPreview", () => ({
  InkPreview: ({ content }: { content: string }) =>
    createElement("div", { "data-testid": "ink-preview", "data-len": String(content.length) }),
}));

import { HistorySnapshotPreview } from "./HistorySnapshotPreview";

async function render(props: Parameters<typeof HistorySnapshotPreview>[0]): Promise<{ container: HTMLElement; unmount: () => Promise<void> }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => { root.render(createElement(HistorySnapshotPreview, props)); });
  // 懒加载 chunk 的微任务：再 flush 两轮（Suspense 解析后重渲染）
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return {
    container,
    unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); },
  };
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("HistorySnapshotPreview：手写板（ink）分支", () => {
  it("ink 正文可解析 ⇒ 渲染只读画布（InkPreview），并保留结构化事实", async () => {
    const body = inkToBody(createInkDoc());
    const view = await render({ kind: "ink", noteId: "n1", body, snapshotId: 1 });
    expect(view.container.querySelector("[data-testid=\"ink-preview\"]")).not.toBeNull();
    expect(view.container.textContent).toContain("页面");
    expect(view.container.textContent).toContain("1 页");
    // 画布放在与其它只读编辑器同一块预览槽里（不另起容器）
    expect(view.container.querySelector(".history-editor-preview [data-testid=\"ink-preview\"]")).not.toBeNull();
    await view.unmount();
  });

  it("ink 正文解析失败 ⇒ 退回结构化统计，不挂画布", async () => {
    const view = await render({ kind: "ink", noteId: "n1", body: "不是 inkDoc", snapshotId: 2 });
    expect(view.container.querySelector("[data-testid=\"ink-preview\"]")).toBeNull();
    expect(view.container.textContent).toContain("无法解析这份手写板快照");
    await view.unmount();
  });
});
