/**
 * 移动端画板查看/编辑器（kind=board）挂载护栏。
 *
 * jsdom + mock 掉 vendor 懒加载器：只验证「宿主这一层」的行为（真画布在设备上验收）：
 * - 未活动过的 tab 不建实例（隐藏态建画布会量成 0 尺寸）；
 * - 阅读态 readOnly + fitOnInit；编辑态 readOnly=false 且注册同步 capture；
 * - 喂给画布的是正文里的 elements（board 正文绝不交给 Lake 编辑器）；
 * - 视口是**本机记忆**（boardViewStore，L3）：有记忆时不 fit、按记忆喂 plaitViewport、缩放/滚动回写。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

const rendered: Array<Record<string, unknown>> = [];
const uploaded: Array<{ bytes: Uint8Array; filename: string; noteId?: string }> = [];
const readPreview = vi.fn(async () => ({ supported: false } as { supported: boolean; dataUrl?: string }));

vi.mock("../bridge", () => ({
  bridge: {
    uploadResource: async (input: { bytes: Uint8Array; filename: string }, noteId: string) => {
      uploaded.push({ ...input, noteId });
      return { url: "http://127.0.0.1:19876/" + noteId + "/1789000000000_deadbeef.png", filename: "1789000000000_deadbeef.png", mimeType: "image/png", size: input.bytes.length };
    },
  },
}));

vi.mock("../../lib/native", () => ({
  native: { readAssetPreview: (...args: unknown[]) => readPreview(...(args as [])) },
}));

vi.mock("@dlient/lakex-doc-react", () => ({
  loadDrawnixBoardCore: async () => ({
    default: (props: Record<string, unknown>) => {
      rendered.push(props);
      // 模拟画布容器：平移记忆盯的是 .viewport-container 的滚动量
      return createElement("div", { className: "viewport-container" });
    },
  }),
}));

import { MobileBoardViewer } from "./MobileBoardViewer";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const CANONICAL = "http://127.0.0.1:19876/board-5/1789000000000_deadbeef.png";
import { readBoardView, resetBoardViews, writeBoardView } from "../../features/board/boardViewStore";

const BODY = JSON.stringify({
  kind: "board",
  version: 1,
  engine: "drawnix",
  preset: "drawing",
  elements: [{ id: "n1", type: "geometry" }],
});

async function mount(
  active: boolean,
  editing = false,
  opts: { onChange?: (c: string) => void; onCapture?: (c: (() => string | null) | null) => void; noteId?: string } = {},
) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const { act } = await import("react");
  act(() => root.render(createElement(MobileBoardViewer, {
    noteId: opts.noteId ?? "board-1",
    content: BODY, active, editing,
    onChange: opts.onChange,
    onCapture: opts.onCapture,
  })));
  // 懒加载组件 + Suspense 需要几个 microtask/frame 才会落地
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    act(() => undefined);
  }
  return { root, host };
}

describe("移动端画板查看/编辑器", () => {
  it("未活动的 tab 不建画布实例（避免隐藏态量成 0 尺寸）", async () => {
    rendered.length = 0;
    const { root } = await mount(false);
    expect(rendered).toHaveLength(0);
    root.unmount();
  });

  it("阅读态：readOnly + 无记忆时 fitOnInit + 正文 elements，且容器占满文档层", async () => {
    resetBoardViews();
    rendered.length = 0;
    const { root, host } = await mount(true);
    expect(rendered.length).toBeGreaterThan(0);
    const props = rendered[rendered.length - 1];
    expect(props.readOnly).toBe(true);
    expect(props.fitOnInit).toBe(true);
    expect(props.locale).toBe("zh-CN");
    expect((props.value as { plaitValue: unknown[] }).plaitValue).toEqual([{ id: "n1", type: "geometry" }]);
    expect(host.querySelector(".mobile-board-viewer")).toBeTruthy();
    expect(host.querySelector(".mobile-board-viewer")?.hasAttribute("data-prevent-swipe")).toBe(true);
    expect(host.querySelector(".mobile-board-viewer")?.classList.contains("is-editing")).toBe(false);
    root.unmount();
  });

  it("编辑态：readOnly=false、显示工具条类名，并注册同步 capture", async () => {
    rendered.length = 0;
    let capture: (() => string | null) | null = null;
    const { root, host } = await mount(true, true, { onCapture: (c) => { capture = c; } });
    const props = rendered[rendered.length - 1];
    expect(props.readOnly).toBe(false);
    expect(typeof props.onChange).toBe("function");
    expect(host.querySelector(".mobile-board-viewer")?.classList.contains("is-editing")).toBe(true);
    expect(typeof capture).toBe("function");
    root.unmount();
  });

  it("编辑变更后 capture 返回最新 board body（不依赖 800ms 防抖）", async () => {
    rendered.length = 0;
    let capture: (() => string | null) | null = null;
    const changed: string[] = [];
    const { root } = await mount(true, true, {
      onChange: (c) => changed.push(c),
      onCapture: (c) => { capture = c; },
    });
    const props = rendered[rendered.length - 1];
    const onChange = props.onChange as (p: unknown) => void;
    const { act } = await import("react");
    act(() => onChange({ plaitValue: [{ id: "n2", type: "geometry" }] }));
    expect(typeof capture).toBe("function");
    const body = capture!();
    expect(body).toContain('"id":"n2"');
    expect(changed.some((c) => c.includes('"id":"n2"'))).toBe(true);
    root.unmount();
  });

  it("视口记忆（261020 P1）：有本机记忆时不再 fit，按记忆喂 plaitViewport", async () => {
    resetBoardViews();
    writeBoardView("board-2", { viewport: { x: 12, y: 34, zoom: 1.5 } });
    rendered.length = 0;
    const { root } = await mount(true, false, { noteId: "board-2" });
    const props = rendered[rendered.length - 1];
    expect(props.fitOnInit).toBe(false);
    expect((props.value as { plaitViewport?: unknown }).plaitViewport).toEqual({ x: 12, y: 34, zoom: 1.5 });
    root.unmount();
    resetBoardViews();
  });

  it("只记滚动量也算有记忆（不 fit），缩放回写进本机记忆", async () => {
    resetBoardViews();
    writeBoardView("board-3", { scroll: { left: 120, top: 240 } });
    rendered.length = 0;
    const { root } = await mount(true, true, { noteId: "board-3" });
    const props = rendered[rendered.length - 1];
    expect(props.fitOnInit).toBe(false);
    // 缩放：内核被动回调 → 写本机记忆（不进正文）
    const onViewportPersist = props.onViewportPersist as (v: { x: number; y: number; zoom: number }) => void;
    const { act } = await import("react");
    act(() => onViewportPersist({ x: 5, y: 6, zoom: 2 }));
    expect(readBoardView("board-3")?.viewport).toEqual({ x: 5, y: 6, zoom: 2 });
    expect(readBoardView("board-3")?.scroll).toEqual({ left: 120, top: 240 });
    root.unmount();
    resetBoardViews();
  });

  it("打开时把资产 URL 换回 data URL（内存口径），不重复上传", async () => {
    resetBoardViews();
    uploaded.length = 0;
    readPreview.mockImplementation(async () => ({ supported: true, dataUrl: PNG }));
    rendered.length = 0;
    const assetBody = JSON.stringify({
      kind: "board", version: 1, engine: "drawnix", preset: "drawing",
      elements: [{ id: "img", type: "image", url: CANONICAL, width: 10, height: 10 }],
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const { act } = await import("react");
    act(() => root.render(createElement(MobileBoardViewer, { noteId: "board-5", content: assetBody, active: true })));
    for (let i = 0; i < 8; i += 1) { await new Promise((r) => setTimeout(r, 0)); act(() => undefined); }
    const props = rendered[rendered.length - 1];
    const value = props.value as { plaitValue: Array<{ url?: string }> };
    expect(value.plaitValue[0].url).toBe(PNG);
    expect(uploaded.length).toBe(0);   // 已有资产不重复上传
    expect(readPreview).toHaveBeenCalled();
    root.unmount();
    resetBoardViews();
  });

  it("编辑态把内联图片提升为资产文件：写盘是 canonical 资产 URL（覆盖 data URL）", async () => {
    resetBoardViews();
    uploaded.length = 0;
    rendered.length = 0;
    let capture: (() => string | null) | null = null;
    const body = JSON.stringify({
      kind: "board", version: 1, engine: "drawnix", preset: "drawing",
      elements: [{ id: "img", type: "image", url: PNG }],
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const { act } = await import("react");
    act(() => root.render(createElement(MobileBoardViewer, {
      noteId: "board-6", content: body, active: true, editing: true, onCapture: (c) => { capture = c; },
    })));
    for (let i = 0; i < 10; i += 1) { await new Promise((r) => setTimeout(r, 0)); act(() => undefined); }
    expect(uploaded.length).toBe(1);
    expect(uploaded[0].filename).toMatch(/\.png$/);
    expect(uploaded[0].bytes.length).toBeGreaterThan(0);
    expect(typeof capture).toBe("function");
    const saved = capture!();
    expect(saved).toContain("http://127.0.0.1:19876/board-6/1789000000000_deadbeef.png"); // 磁盘口径 = 资产 URL
    expect(saved).not.toContain("data:image");       // 绝不把内联图片写进正文
    root.unmount();
    resetBoardViews();
  });

  it("画布容器上的滚动/松手会写回滚动记忆（写的是 localStorage 的 L3 档，不触发保存）", async () => {
    resetBoardViews();
    rendered.length = 0;
    const { root, host } = await mount(true, true, { noteId: "board-4" });
    const scroll = host.querySelector<HTMLElement>(".viewport-container");
    expect(scroll).toBeTruthy();
    const { act } = await import("react");
    act(() => { scroll!.dispatchEvent(new Event("scroll")); });
    await new Promise((r) => setTimeout(r, 260));
    expect(readBoardView("board-4")?.scroll).toEqual({ left: 0, top: 0 });
    root.unmount();
    resetBoardViews();
  });
});
