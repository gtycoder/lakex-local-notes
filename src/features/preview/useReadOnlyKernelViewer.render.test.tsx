// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 内核只读 viewer 宿主 hook 的行为护栏（261112 R1 预览基础层）。
 *
 * 收口前是 3 份实现（历史快照 / 小记卡片兜底 / AI 答案），各自抄了
 * createLakeDocument("viewer") + addAssetAccessToken + setDocument + destroy 一整段。
 * 这里把三处共同的不变量钉死，并覆盖两个「漏一次就复发」的坑：
 *  - 忘 addAssetAccessToken ⇒ 预览里的图 401 / 不显示；
 *  - 忘 disableVirtualRendering ⇒ 正文只画一屏（由调用方 prefs 决定，本测试钉 prefs 原样透传）。
 *
 * 另：源码级断言「三处包装都只经本 hook」——防止以后又有人手抄第 4 份。
 */
const h = vi.hoisted(() => ({ createLakeDocument: vi.fn(), destroyLakeEditor: vi.fn() }));
vi.mock("../editor/lakeRuntime", () => ({
  createLakeDocument: h.createLakeDocument,
  destroyLakeEditor: h.destroyLakeEditor,
}));
// token 注入用可断言的替换：真实现按运行期 token 改写正文 URL（无 token 时原样）。
vi.mock("../../lib/assetPort", () => ({ addAssetAccessToken: (content: string) => "TOKEN:" + content }));

import { useReadOnlyKernelViewer } from "./useReadOnlyKernelViewer";
import type { LakeEditorInstance, LakeEditorPrefs } from "../editor/lakeRuntime";

type FakeInstance = {
  setDocument: ReturnType<typeof vi.fn>;
  requestCardHydration?: ReturnType<typeof vi.fn>;
  kernel?: unknown;
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let editors: FakeInstance[];

const makeEditor = (): FakeInstance => ({ setDocument: vi.fn(), requestCardHydration: vi.fn() });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  editors = [];
  h.createLakeDocument.mockReset().mockImplementation(() => {
    const editor = makeEditor();
    editors.push(editor);
    return editor;
  });
  h.destroyLakeEditor.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

interface HarnessProps {
  keyValue: string | null;
  body: string | null;
  noteId?: string | null;
  mount?: "keep-alive" | "reveal-latch";
  revealRootMarginPx?: number;
  docType?: "text/lake" | "text/markdown";
  prefs?: Partial<LakeEditorPrefs>;
  scrollNode?: HTMLElement | (() => HTMLElement | null) | null;
  onInstance?: (instance: LakeEditorInstance | null) => void;
  onError?: (message: string) => void;
}

function Harness(props: HarnessProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { keyValue, body, noteId = "n1", ...rest } = props;
  useReadOnlyKernelViewer({ hostRef, key: keyValue, body, noteId, ...rest });
  return createElement("div", { ref: hostRef, className: "hook-host" });
}

const render = (props: HarnessProps) => act(() => { root.render(createElement(Harness, props)); });

describe("useReadOnlyKernelViewer：生命周期契约", () => {
  it("同 key 只 setDocument（不重建）；正文一律经 addAssetAccessToken", () => {
    render({ keyValue: "n1", body: "<p>一</p>" });
    expect(h.createLakeDocument).toHaveBeenCalledTimes(1);
    expect(editors[0].setDocument).toHaveBeenCalledWith("text/lake", "TOKEN:<p>一</p>");

    render({ keyValue: "n1", body: "<p>二</p>" });
    expect(h.createLakeDocument).toHaveBeenCalledTimes(1);
    expect(h.destroyLakeEditor).not.toHaveBeenCalled();
    expect(editors[0].setDocument).toHaveBeenLastCalledWith("text/lake", "TOKEN:<p>二</p>");
  });

  it("换 key / 换文档 ⇒ 销毁旧实例并重建", () => {
    render({ keyValue: "n1", body: "<p>一</p>" });
    render({ keyValue: "n2", body: "<p>二</p>" });
    expect(h.destroyLakeEditor).toHaveBeenCalledTimes(1);
    expect(h.destroyLakeEditor).toHaveBeenCalledWith(editors[0]);
    expect(h.createLakeDocument).toHaveBeenCalledTimes(2);
    expect(editors[1].setDocument).toHaveBeenCalledWith("text/lake", "TOKEN:<p>二</p>");
  });

  it("卸载销毁实例；onInstance 先给实例再给 null", () => {
    const onInstance = vi.fn();
    render({ keyValue: "n1", body: "<p>一</p>", onInstance });
    expect(onInstance).toHaveBeenCalledWith(editors[0]);
    act(() => root.render(createElement("div")));
    expect(h.destroyLakeEditor).toHaveBeenCalledWith(editors[0]);
    expect(onInstance).toHaveBeenLastCalledWith(null);
  });

  it("noteId 为空 / 正文为 null ⇒ 不创建；正文从有到无 ⇒ 销毁", () => {
    render({ keyValue: "n1", body: "<p>一</p>", noteId: null });
    expect(h.createLakeDocument).not.toHaveBeenCalled();

    render({ keyValue: "n1", body: null, noteId: "n1" });
    expect(h.createLakeDocument).not.toHaveBeenCalled();

    render({ keyValue: "n1", body: "<p>一</p>", noteId: "n1" });
    expect(h.createLakeDocument).toHaveBeenCalledTimes(1);
    render({ keyValue: "n1", body: null, noteId: "n1" });
    expect(h.destroyLakeEditor).toHaveBeenCalledWith(editors[0]);
  });

  it("创建参数与收口前一致：viewer / 空 onChange / toc=false / prefs 原样 / scrollNode getter 求值为宿主元素", () => {
    const prefs = { fontSize: 16, disableNativeToc: true };
    render({ keyValue: "n1", body: "<p>x</p>", prefs, scrollNode: () => host.querySelector<HTMLElement>(".hook-host") });
    const [element, mode, onChange, tocEnabled, noteId, scrollNode, passedPrefs] = h.createLakeDocument.mock.calls[0];
    expect(mode).toBe("viewer");
    expect(typeof onChange).toBe("function");
    expect(tocEnabled).toBe(false);
    expect(noteId).toBe("n1");
    expect(element).toBe(host.querySelector(".hook-host"));
    expect(scrollNode).toBe(element);
    expect(passedPrefs).toBe(prefs);
  });

  it("docType=text/markdown 原样交给内核（AI 答案路径）", () => {
    render({ keyValue: "ai", body: "## 标题", noteId: "ai", docType: "text/markdown", prefs: { disableVirtualRendering: true } });
    expect(editors[0].setDocument).toHaveBeenCalledWith("text/markdown", "TOKEN:## 标题");
  });
});

describe("useReadOnlyKernelViewer：失败面", () => {
  it("create 抛错 ⇒ 只回调 onError，不抛给宿主", () => {
    h.createLakeDocument.mockImplementation(() => { throw new Error("内核炸了"); });
    const onError = vi.fn();
    expect(() => render({ keyValue: "n1", body: "<p>x</p>", onError })).not.toThrow();
    expect(onError).toHaveBeenCalledWith("内核炸了");
  });

  it("setDocument 抛错 ⇒ 回调 onError（不让预览页炸掉）", () => {
    h.createLakeDocument.mockImplementation(() => {
      const editor = makeEditor();
      editor.setDocument.mockImplementation(() => { throw new Error("set 炸了"); });
      editors.push(editor);
      return editor;
    });
    const onError = vi.fn();
    render({ keyValue: "n1", body: "<p>x</p>", onError });
    expect(onError).toHaveBeenCalledWith("set 炸了");
  });

  it("实例没有 requestCardHydration 时安全（历史快照/AI 答案的测试替身就是这种形状）", () => {
    h.createLakeDocument.mockImplementation(() => {
      const editor: FakeInstance = { setDocument: vi.fn() };
      editors.push(editor);
      return editor;
    });
    expect(() => render({ keyValue: "n1", body: "<p>x</p>" })).not.toThrow();
    expect(editors[0].setDocument).toHaveBeenCalled();
  });
});

describe("useReadOnlyKernelViewer：reveal-latch 视口闩锁（小记卡片兜底）", () => {
  class FakeIntersectionObserver {
    static instances: FakeIntersectionObserver[] = [];
    root = null;
    rootMargin = "";
    thresholds: number[] = [];
    constructor(private readonly callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.rootMargin = options?.rootMargin ?? "";
      FakeIntersectionObserver.instances.push(this);
    }
    observe(): void { /* 由测试手动触发 */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
    takeRecords(): IntersectionObserverEntry[] { return []; }
    trigger(isIntersecting: boolean): void {
      this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
  }

  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver as unknown as typeof IntersectionObserver);
  });

  it("进入视口前不建实例；进入一次后常驻（滚出视口不销毁）；同小记正文变化只 setDocument", () => {
    render({ keyValue: "q1", body: "<p>一</p>", noteId: "q1", mount: "reveal-latch", revealRootMarginPx: 400 });
    expect(h.createLakeDocument).not.toHaveBeenCalled();
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    expect(FakeIntersectionObserver.instances[0].rootMargin).toBe("400px 0px");

    act(() => FakeIntersectionObserver.instances[0].trigger(true));
    expect(h.createLakeDocument).toHaveBeenCalledTimes(1);

    render({ keyValue: "q1", body: "<p>二</p>", noteId: "q1", mount: "reveal-latch", revealRootMarginPx: 400 });
    expect(h.createLakeDocument).toHaveBeenCalledTimes(1);
    expect(editors[0].setDocument).toHaveBeenLastCalledWith("text/lake", "TOKEN:<p>二</p>");

    act(() => FakeIntersectionObserver.instances[0].trigger(false));
    expect(h.destroyLakeEditor).not.toHaveBeenCalled();
  });

  it("没有 IntersectionObserver 的环境直接放行（老 WebView / 测试替身不丢功能）", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render({ keyValue: "q1", body: "<p>一</p>", noteId: "q1", mount: "reveal-latch" });
    expect(h.createLakeDocument).toHaveBeenCalledTimes(1);
  });
});

describe("单一来源：三处包装都经本 hook", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  /** 去掉注释再断言：注释里会说明「原实现 = createLakeDocument(...)」，不算调用。 */
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("useHistorySnapshotViewer / QuickNoteKernelPreview / AiAnswerViewer 不再各自调 createLakeDocument", () => {
    for (const rel of ["../../components/hooks/useHistorySnapshotViewer.ts", "../quickNotes/QuickNoteKernelPreview.tsx", "../aiWriting/AiAnswerViewer.tsx"]) {
      const src = code(read(rel));
      expect(src, rel).toContain("useReadOnlyKernelViewer(");
      expect(src, rel).not.toMatch(/createLakeDocument\(/);
      expect(src, rel).not.toMatch(/destroyLakeEditor\(/);
    }
  });
});
