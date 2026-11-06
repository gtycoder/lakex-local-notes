// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 文档正文只读预览（261106 统一）：NoteDocPreview 是 doc 预览的**唯一**实现——
 * 回收站 / 历史面板 / 文档属性 / 标签空间都经它挂只读 Lake viewer。
 * 这里锁四件事：① 挂载参数（阅读档字号 + 只读 viewer）；② 切正文只 setDocument（同实例复用）；
 * ③ 卸载/换文档销毁；④ 失败回调/兜底提示（不把异常抛给宿主页面）。
 */
const h = vi.hoisted(() => ({
  createLakeDocument: vi.fn(),
  destroyLakeEditor: vi.fn(),
  mobile: { value: false },
}));

vi.mock("../../features/editor/lakeRuntime", () => ({
  createLakeDocument: h.createLakeDocument,
  destroyLakeEditor: h.destroyLakeEditor,
}));
vi.mock("../../lib/assetPort", () => ({ addAssetAccessToken: (content: string) => content }));
vi.mock("../../features/editor/clipboardHtml", () => ({ isMobileEnvironment: () => h.mobile.value }));

import { NoteDocPreview, NOTE_DOC_PREVIEW_FONT_SIZE } from "./NoteDocPreview";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let viewer: { setDocument: ReturnType<typeof vi.fn>; requestCardHydration: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  viewer = { setDocument: vi.fn(), requestCardHydration: vi.fn() };
  h.createLakeDocument.mockReset().mockReturnValue(viewer);
  h.destroyLakeEditor.mockReset();
  h.mobile.value = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = (node: ReturnType<typeof createElement>) => act(() => { root.render(node); });

describe("NoteDocPreview（doc 只读预览共用实现）", () => {
  it("挂只读 Lake viewer：阅读档字号 16 + 禁原生大纲 + 正文走 setDocument", () => {
    render(createElement(NoteDocPreview, { noteId: "n1", body: "<p>正文</p>", className: "trash-preview-viewer" }));

    expect(h.createLakeDocument).toHaveBeenCalledTimes(1);
    const [element, mode, , tocEnabled, noteId, scrollNode, prefs] = h.createLakeDocument.mock.calls[0];
    expect(mode).toBe("viewer");
    expect(tocEnabled).toBe(false);
    expect(noteId).toBe("n1");
    expect(scrollNode).toBe(element);
    expect(prefs).toMatchObject({ fontSize: NOTE_DOC_PREVIEW_FONT_SIZE, disableNativeToc: true });
    expect(NOTE_DOC_PREVIEW_FONT_SIZE).toBe(16);
    expect(viewer.setDocument).toHaveBeenCalledWith("text/lake", "<p>正文</p>");
    expect(viewer.requestCardHydration).toHaveBeenCalled();
    // 调用方容器类保留（滚动/边框仍由各处既有 CSS 负责），作用域类始终在
    const surface = host.querySelector<HTMLElement>(".note-doc-preview")!;
    expect(surface.className).toBe("note-doc-preview trash-preview-viewer");
    expect(host.querySelector(".note-doc-preview__host")).toBeTruthy();
  });

  it("切正文只 setDocument（不重建 viewer）；换文档才重建", () => {
    render(createElement(NoteDocPreview, { noteId: "n1", body: "<p>一</p>" }));
    render(createElement(NoteDocPreview, { noteId: "n1", body: "<p>二</p>" }));
    expect(h.createLakeDocument).toHaveBeenCalledTimes(1);
    expect(viewer.setDocument).toHaveBeenLastCalledWith("text/lake", "<p>二</p>");

    render(createElement(NoteDocPreview, { noteId: "n2", body: "<p>三</p>" }));
    expect(h.destroyLakeEditor).toHaveBeenCalledTimes(1);
    expect(h.createLakeDocument).toHaveBeenCalledTimes(2);
  });

  it("卸载销毁 viewer", () => {
    render(createElement(NoteDocPreview, { noteId: "n1", body: "<p>x</p>" }));
    act(() => root.render(createElement("div")));
    expect(h.destroyLakeEditor).toHaveBeenCalledWith(viewer);
  });

  it("挂载失败：先回调 onError，不抛给宿主；没人接时才在容器里兜一行", () => {
    h.createLakeDocument.mockImplementation(() => { throw new Error("内核炸了"); });
    const onError = vi.fn();
    render(createElement(NoteDocPreview, { noteId: "n1", body: "<p>x</p>", onError }));
    expect(onError).toHaveBeenCalledWith("内核炸了");
    expect(host.querySelector(".note-doc-preview__error")).toBeNull();

    h.createLakeDocument.mockImplementation(() => { throw new Error("内核炸了"); });
    render(createElement(NoteDocPreview, { noteId: "n2", body: "<p>x</p>" }));
    expect(host.querySelector(".note-doc-preview__error")?.textContent).toContain("内核炸了");
  });

  it("移动端：禁虚拟渲染（正文渲染不全的老坑），桌面不传", () => {
    h.mobile.value = true;
    render(createElement(NoteDocPreview, { noteId: "n1", body: "<p>x</p>" }));
    expect(h.createLakeDocument.mock.calls[0][6]).toMatchObject({
      fontSize: 16, disableNativeToc: true, disableVirtualRendering: true, showToolbar: false,
    });
    act(() => root.unmount());
    h.mobile.value = false;
    root = createRoot(host);
    render(createElement(NoteDocPreview, { noteId: "n1", body: "<p>x</p>" }));
    expect(h.createLakeDocument.mock.calls[1][6].disableVirtualRendering).toBeUndefined();
  });

  it("空 noteId 不挂内核（目录/正文缺失的行没有预览）", () => {
    render(createElement(NoteDocPreview, { noteId: "", body: "<p>x</p>" }));
    expect(h.createLakeDocument).not.toHaveBeenCalled();
  });
});
/**
 * 排版护栏（261106 用户验收「预览正文很大」）：预览固定阅读档，且回收站/标签空间/历史/属性共用同一作用域。
 * 细节值来自对内核 dist/style.css 与运行时 computed 的实测（见 noteDocPreview.css 头注释）。
 */
describe("noteDocPreview.css：统一阅读档排版", () => {
  // 去掉注释再断言（文件头解释里会提到 !important，那是说明不是声明）
  const CSS = readFileSync(path.resolve("src/components/app/noteDocPreview.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("正文基准走字号令牌（14px）+ 行高 1.7；标题按 em 缩放（内核是 28/24/20/16 px 定值）", () => {
    expect(CSS).toMatch(/\.note-doc-preview \.ne-viewer-body \{[^}]*font-size: var\(--lake-font-size-preview\)/s);
    expect(CSS).toMatch(/line-height: 1\.7;/);
    for (const [tag, size] of [["h1", "1.5em"], ["h2", "1.3em"], ["h3", "1.15em"], ["h4", "1em"]] as const) {
      expect(CSS, tag).toMatch(new RegExp(`\\.note-doc-preview ne-${tag} \\{ font-size: ${size.replace(".", "\\.")}`));
    }
  });

  it("内容列宽 760px + 左右内距（内核 viewer 不限宽）；不引入 !important", () => {
    expect(CSS).toContain("max-width: 760px;");
    expect(CSS).toContain("padding-inline: var(--lake-space-xl);");
    expect(CSS).not.toContain("!important");
    // 不允许出现字号字面量（ui-metrics 同口径：字号一律 --lake-font-size-*）
    expect(CSS).not.toMatch(/font-size:\s*[0-9.]+px/);
  });
});
