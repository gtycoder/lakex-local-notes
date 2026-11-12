// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 桌面只读文档预览的图片放大（用户裁决 Q06）：回收站 / 历史面板 / 文档属性共用 NoteDocPreview，
 * 双击正文图片打开共享 Lightbox —— **不新造浮层、也不挂编辑器交互**。
 *
 * 锁三件事：
 * 1. 画廊列表来自**正文**（内核 viewer 的 DOM 可能只渲染了一部分；实测 DOM 收集会数少）；
 * 2. 双击的是哪一张由 DOM 序列对齐决定（attachImagePreviewClick 既有能力）；
 * 3. 传给 Lightbox 的 originalSrc 是「去显示档 w/date、保留 token」的原图（Q02 的放大意图），
 *    而不是把档位图直接放大。
 */
const h = vi.hoisted(() => ({ createLakeDocument: vi.fn(), destroyLakeEditor: vi.fn() }));
vi.mock("../../features/editor/lakeRuntime", () => ({
  createLakeDocument: h.createLakeDocument,
  destroyLakeEditor: h.destroyLakeEditor,
}));
// token 注入/剥离在单测里保持 identity：本文件只关心档位语义，不关心运行期令牌值。
vi.mock("../../lib/assetPort", () => ({
  addAssetAccessToken: (content: string) => content,
  withAssetAccessToken: (url: string) => url,
}));
vi.mock("../../features/editor/clipboardHtml", () => ({ isMobileEnvironment: () => false }));

import { NoteDocPreview } from "./NoteDocPreview";
import {
  closeImagePreview,
  subscribeImagePreview,
  type ImagePreviewState,
} from "../../features/editor/imagePreview";

const A_URL = "http://127.0.0.1:19876/n1/a.png?w=1024&date=1";
const B_URL = "http://127.0.0.1:19876/n1/b.png";
const imageCard = (src: string) =>
  '<card type="block" name="image" value="data:' + encodeURIComponent(JSON.stringify({ src })) + '"></card>';
const BODY = imageCard(A_URL) + imageCard(B_URL);

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let states: Array<ImagePreviewState | null>;
let unsubscribe: (() => void) | null = null;

const lastState = () => states[states.length - 1] ?? null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  states = [];
  h.destroyLakeEditor.mockReset();
  // 模拟内核 viewer：把正文图片渲染进宿主（只渲染第一张 = 虚拟渲染/懒加载下 DOM 不全的现场）。
  h.createLakeDocument.mockReset().mockImplementation((element: HTMLElement) => {
    const img = document.createElement("img");
    img.className = "ne-image";
    img.setAttribute("src", A_URL);
    element.append(img);
    return { setDocument: vi.fn(), requestCardHydration: vi.fn() };
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  unsubscribe = subscribeImagePreview((state) => states.push(state));
});

afterEach(() => {
  act(() => closeImagePreview());
  unsubscribe?.();
  unsubscribe = null;
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const render = () => act(() => {
  root.render(createElement(NoteDocPreview, { noteId: "n1", body: BODY }));
});

describe("NoteDocPreview：双击图片放大（Q06）", () => {
  it("双击正文图片 ⇒ 打开共享 Lightbox，画廊取正文全量（不是 DOM 已渲染的那几张）", () => {
    render();
    const img = host.querySelector<HTMLImageElement>(".note-doc-preview__host img.ne-image");
    expect(img).toBeTruthy();

    act(() => { img!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });

    const state = lastState();
    expect(state).not.toBeNull();
    expect(state!.images).toHaveLength(2);
    expect(state!.index).toBe(0);
  });

  it("放大意图 = 原图：originalSrc 去掉显示档 w/date；src 保持调用方给的显示 URL", () => {
    render();
    const img = host.querySelector<HTMLImageElement>(".note-doc-preview__host img.ne-image")!;
    act(() => { img.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });

    const state = lastState()!;
    expect(state.images[0].src).toBe(A_URL);
    expect(state.images[0].originalSrc).toBe("http://127.0.0.1:19876/n1/a.png");
    // 第二张没有显示档参数 ⇒ 原图与显示相同（不会凭空加 query）
    expect(state.images[1].originalSrc).toBe(B_URL);
  });

  it("正文里没有图片时双击不产生预览（不误开空 Lightbox）", () => {
    // 该用例模拟「正文纯文字」的宿主：内核不渲染任何 img.ne-image。
    h.createLakeDocument.mockImplementationOnce(() => ({ setDocument: vi.fn(), requestCardHydration: vi.fn() }));
    act(() => { root.render(createElement(NoteDocPreview, { noteId: "n1", body: "<p>纯文字</p>" })); });
    const surface = host.querySelector<HTMLElement>(".note-doc-preview__host")!;
    act(() => { surface.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(lastState()).toBeNull();
  });
});
