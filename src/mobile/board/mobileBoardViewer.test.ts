/**
 * 移动端画板查看器（kind=board，只读）挂载护栏。
 *
 * jsdom + mock 掉 vendor 懒加载器：只验证「宿主这一层」的行为（真画布在桌面已实测，见
 * docs/STORAGE-LAYERS.md §四）：
 * - 未活动过的 tab 不建实例（隐藏态建画布会量成 0 尺寸）；
 * - 实例以 readOnly + fitOnInit 挂载（移动端只读、打开即自适应到内容）；
 * - 喂给画布的是正文里的 elements（board 正文绝不交给 Lake 编辑器）。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

const rendered: Array<Record<string, unknown>> = [];

vi.mock("@dlient/lakex-doc-react", () => ({
  loadDrawnixBoardCore: async () => ({
    default: (props: Record<string, unknown>) => {
      rendered.push(props);
      return null;
    },
  }),
}));

import { MobileBoardViewer } from "./MobileBoardViewer";

const BODY = JSON.stringify({
  kind: "board",
  version: 1,
  engine: "drawnix",
  preset: "drawing",
  elements: [{ id: "n1", type: "geometry" }],
});

async function mount(active: boolean) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const { act } = await import("react");
  act(() => root.render(createElement(MobileBoardViewer, { content: BODY, active })));
  // 懒加载组件 + Suspense 需要几个 microtask/frame 才会落地
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    act(() => undefined);
  }
  return { root, host, render: () => act(() => root.render(createElement(MobileBoardViewer, { content: BODY, active }))) };
}

describe("移动端画板查看器（只读）", () => {
  it("未活动的 tab 不建画布实例（避免隐藏态量成 0 尺寸）", async () => {
    rendered.length = 0;
    const { root } = await mount(false);
    expect(rendered).toHaveLength(0);
    root.unmount();
  });

  it("活动 tab：readOnly + fitOnInit + 正文 elements，且容器占满文档层", async () => {
    rendered.length = 0;
    const { root, host } = await mount(true);
    expect(rendered.length).toBeGreaterThan(0);
    const props = rendered[rendered.length - 1];
    expect(props.readOnly).toBe(true);
    expect(props.fitOnInit).toBe(true);
    expect(props.locale).toBe("zh-CN");
    expect((props.value as { plaitValue: unknown[] }).plaitValue).toEqual([{ id: "n1", type: "geometry" }]);
    expect(host.querySelector(".mobile-board-viewer")).toBeTruthy();
    root.unmount();
  });
});
