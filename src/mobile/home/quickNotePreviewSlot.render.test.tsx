// @vitest-environment jsdom
/**
 * F-B / F-C / F-H（261119 平滑度审计）：小记列表卡预览「恒定槽位」护栏。
 *
 * 三条都是「异步内容到达改高 / 瞬切」家族，收口在 QuickNotePreview 的 slotFrame 模式：
 *  · F-B：占位（previewText 纯文本）与富预览**同一槽位、同一夹持** ⇒ 正文到达前后外框几何声明不变；
 *  · F-C：内核兜底的 Suspense fallback 保留占位文本（不再换 unsupported 标签片），外框只在正文
 *    到达时上一阶（折叠上限），内核落地不改外框（高度曲线「单阶」）；
 *  · F-H：展开/收起 = 结构展开位移过渡（is-animating + 行内高度从实测起点过渡到目标），reduced-motion 瞬切。
 * 另钉 HomePage 的接线（slotFrame/fallbackText）与「首屏正文必须预热」（core/quickNoteDetailPrewarm 判据）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 内核只读兜底（懒加载模块）：测试里永远不真挂内核 —— 用「可释放的 suspense」模拟内核 chunk 0.3–0.9s 晚到。 */
const kernelMock = vi.hoisted(() => ({
  ready: false,
  pending: null as null | Promise<void>,
  release: null as null | (() => void),
}));
vi.mock("../../features/quickNotes/QuickNoteKernelPreview", () => ({
  QuickNoteKernelPreview: () => {
    if (!kernelMock.ready) {
      kernelMock.pending ??= new Promise<void>((resolve) => {
        kernelMock.release = () => { kernelMock.ready = true; resolve(); };
      });
      throw kernelMock.pending;
    }
    return <div data-kernel-view="true" />;
  },
}));

const bridgeMocks = vi.hoisted(() => ({ readQuickNote: vi.fn(async (_id: string) => null) }));
vi.mock("../bridge", () => ({ bridge: { readQuickNote: bridgeMocks.readQuickNote } }));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    measure: () => undefined,
    measureElement: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

import { QuickNotePreview } from "../../features/quickNotes/QuickNotePreview";
import { HomePage, type MobileQuickNote } from "./HomePage";

/** 内核真实产出的日期卡（快路径还原不了 ⇒ 内核兜底）。 */
const DATE_CARD = '<card type="inline" name="dateCard" value="data:%7B%22date%22%3A%221789123456000%22%7D"></card>';
const PLAIN_BODY = '<p><span>摘要文本</span></p>';
const IMAGE_BODY = '<p><span>看这张</span></p><p><card type="inline" name="image" value="data:' + encodeURIComponent(JSON.stringify({ src: "http://127.0.0.1:19876/quick-notes/q1/1794_a.png", name: "1794_a.png", originWidth: 1080, originHeight: 2400 })) + '"></card></p>';
const IMAGE_ASSETS = [{ id: "i1", filename: "1794_a.png", mimeType: "image/png", width: 1080, height: 2400, size: 278755, hash: "h", url: "http://127.0.0.1:19876/quick-notes/q1/1794_a.png?token=t&w=1024" }];
const LONG_BODY = "<p>" + "<span>长文</span>".repeat(200) + "</p>";

/** 可控布局读数（jsdom 无布局）：测试按需改写 scrollHeight / clientHeight。 */
const heights = { scrollHeight: 0, clientHeight: 0 };
/** 手动 rAF 队列：断言位移过渡的「起点 → 终点」两步。 */
let frames: FrameRequestCallback[] = [];
const flushFrames = (): void => {
  const pending = frames;
  frames = [];
  for (const cb of pending) cb(0);
};
let reducedMotion = false;

let host: HTMLDivElement;
let root: Root;

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}
class IntersectionObserverStub {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
  takeRecords(): [] { return []; }
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  heights.scrollHeight = 0;
  heights.clientHeight = 0;
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => heights.scrollHeight });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => heights.clientHeight });
  reducedMotion = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reducedMotion : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
  kernelMock.ready = false;
  kernelMock.pending = null;
  kernelMock.release = null;
  bridgeMocks.readQuickNote.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

type PreviewProps = React.ComponentProps<typeof QuickNotePreview>;
const renderPreview = async (props: Partial<PreviewProps>): Promise<void> => {
  await act(async () => {
    root.render(createElement(QuickNotePreview, { body: "", assets: [], onImageClick: () => undefined, ...props } as PreviewProps));
    await Promise.resolve();
  });
};
const slot = (): HTMLElement => {
  const el = host.querySelector<HTMLElement>(".qn-preview-slot");
  expect(el).toBeTruthy();
  return el as HTMLElement;
};

describe("F-B 恒定槽位：正文到达不改卡高", () => {
  it("文本卡：占位（纯文本）与富预览同槽同夹持 ⇒ 换内容不换几何", async () => {
    await renderPreview({ slotFrame: "text", fallbackText: "摘要文本" });
    const before = slot();
    expect(before.className).toContain("quick-note-preview");
    expect(before.className).toContain("qn-preview-slot--text");
    // 占位与富预览同一容器、同一段落类（同构同高前提）
    expect(before.querySelector(".quick-note-preview-paragraph")?.textContent).toBe("摘要文本");
    const frameClass = before.className;
    const frameStyle = before.getAttribute("style");
    expect(frameStyle).toContain("7.5em"); // 5 行摘要槽

    await renderPreview({ slotFrame: "text", fallbackText: "摘要文本", body: PLAIN_BODY });
    const after = slot();
    expect(after.className).toBe(frameClass);          // 几何声明零变化
    expect(after.getAttribute("style")).toBe(frameStyle);
    expect(after.querySelector(".quick-note-preview-paragraph")?.textContent).toBe("摘要文本");
  });

  it("多图卡：折叠上限槽恒定 220px ⇒ 图文到达只填内容不改框", async () => {
    await renderPreview({ slotFrame: "media", fallbackText: "看这张" });
    const before = slot();
    expect(before.className).toContain("qn-preview-slot--media");
    expect(before.style.height).toBe("220px");         // 恒定槽（不只是 max-height）
    expect(before.className).toContain("is-collapsed"); // 加载中画渐隐（几何无关）
    const frameStyle = before.getAttribute("style");

    await renderPreview({ slotFrame: "media", fallbackText: "看这张", body: IMAGE_BODY, assets: IMAGE_ASSETS });
    const after = slot();
    // 几何声明（槽类 + 夹持）零变化；is-collapsed 只是「被裁/加载中」的渐隐态（几何无关），内容到达可独立翻转。
    expect(after.className).toContain("qn-preview-slot--media");
    expect(after.getAttribute("style")).toBe(frameStyle);
    expect(after.querySelectorAll(".quick-note-preview-image").length).toBe(1);
  });

  it("经典模式（不传 slotFrame）行为不变：无槽位类、折叠仍是 maxHeight 夹持", async () => {
    await renderPreview({ body: PLAIN_BODY });
    expect(host.querySelector(".qn-preview-slot")).toBeNull();
    expect(host.querySelector(".quick-note-preview")).not.toBeNull();
  });
});

describe("F-C 内核兜底：fallback 与内核视图同框（高度曲线单阶）", () => {
  it("Suspense 期间保留占位文本、外框已上到折叠上限；内核落地不改外框", async () => {
    await renderPreview({ slotFrame: "text", noteId: "q1", fallbackText: "今天", body: "<p><span>今天</span>" + DATE_CARD + "</p>" });
    const pending = slot();
    // fallback = 占位文本（不再换成 unsupported 标签片）⇒ 内核落地是同框换内容
    expect(pending.textContent).toContain("今天");
    expect(pending.querySelectorAll(".quick-note-preview-unsupported").length).toBe(0);
    // 外框在正文到达（判为内核兜底）时已上到折叠上限 = 220px（「单阶」的那一阶）
    expect(pending.style.maxHeight).toBe("220px");
    const frameClass = pending.className;
    const frameStyle = pending.getAttribute("style");

    await act(async () => {
      kernelMock.release?.();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const settled = slot();
    expect(settled.querySelector("[data-kernel-view]")).toBeTruthy();   // 内核只读视图已落地
    expect(settled.className).toBe(frameClass);                          // 外框零变化
    expect(settled.getAttribute("style")).toBe(frameStyle);
  });
});

describe("F-H 展开/收起 = 位移过渡（不是瞬切）", () => {
  it("展开：从实测折叠高过渡到内容高，收尾清掉行内高交回夹持", async () => {
    heights.scrollHeight = 1000;
    heights.clientHeight = 120;
    await renderPreview({ slotFrame: "text", fallbackText: "长文", body: LONG_BODY });
    const toggle = host.querySelector<HTMLButtonElement>(".quick-note-preview-toggle");
    expect(toggle).toBeTruthy();
    expect(slot().className).toContain("is-collapsed");

    await act(async () => { toggle?.click(); await Promise.resolve(); });
    const expanding = slot();
    expect(expanding.className).toContain("is-expanded");
    expect(expanding.className).toContain("is-animating");
    expect(expanding.style.maxHeight).toBe("none");
    expect(expanding.style.height).toBe("120px");       // 起点 = 展开前的折叠高
    await act(async () => { flushFrames(); await Promise.resolve(); });
    expect(expanding.style.height).toBe("1000px");       // 终点 = 内容高（height 过渡）
    await act(async () => { expanding.dispatchEvent(new Event("transitionend")); await Promise.resolve(); });
    expect(expanding.className).not.toContain("is-animating");
    expect(expanding.style.height).toBe("");
    expect(expanding.style.maxHeight).toBe("");
  });

  it("收起：回到展开前的折叠高（不瞬切），并恢复夹持", async () => {
    heights.scrollHeight = 1000;
    heights.clientHeight = 120;
    await renderPreview({ slotFrame: "text", fallbackText: "长文", body: LONG_BODY });
    const toggle = () => host.querySelector<HTMLButtonElement>(".quick-note-preview-toggle") as HTMLButtonElement;
    await act(async () => { toggle().click(); await Promise.resolve(); });
    await act(async () => { flushFrames(); host.querySelector<HTMLElement>(".qn-preview-slot")?.dispatchEvent(new Event("transitionend")); await Promise.resolve(); });

    await act(async () => { toggle().click(); await Promise.resolve(); });
    const collapsing = slot();
    expect(collapsing.className).toContain("is-animating");
    expect(collapsing.className).not.toContain("is-expanded");
    await act(async () => { flushFrames(); await Promise.resolve(); });
    expect(collapsing.style.height).toBe("120px");        // 回落目标 = 折叠槽高
    await act(async () => { collapsing.dispatchEvent(new Event("transitionend")); await Promise.resolve(); });
    expect(collapsing.style.maxHeight).toBe("7.5em");      // 夹持交回
  });

  it("prefers-reduced-motion：瞬切（无过渡类、无行内高）", async () => {
    heights.scrollHeight = 1000;
    heights.clientHeight = 120;
    reducedMotion = true;
    await renderPreview({ slotFrame: "text", fallbackText: "长文", body: LONG_BODY });
    const toggle = host.querySelector<HTMLButtonElement>(".quick-note-preview-toggle");
    await act(async () => { toggle?.click(); await Promise.resolve(); });
    const expanded = slot();
    expect(expanded.className).toContain("is-expanded");
    expect(expanded.className).not.toContain("is-animating");
    expect(expanded.style.cssText).toBe("");              // 瞬切：不碰行内高
  });
});

describe("HomePage 接线与首屏预热", () => {
  const note = (id: string, imageCount: number, updatedAt: string): MobileQuickNote => ({
    id,
    createdAt: updatedAt,
    updatedAt,
    previewText: "摘要 " + id,
    imageCount,
    firstImage: imageCount > 0 ? "1794_a.png" : null,
    tags: [],
    tagIds: [],
  });

  it("卡片按内容分槽（纯文本 = 摘要槽 / 多图 = 恒定折叠槽），并预热首屏 8 条正文", async () => {
    // 最近更新降序 ⇒ 展示顺序 = q0..q11；前 8 条（无正文）必须在挂载后被读回（首屏预热，IO 从未触发）。
    const notes = Array.from({ length: 12 }, (_, i) =>
      note("q" + i, i === 1 ? 2 : 0, "2026-11-" + String(12 - i).padStart(2, "0") + "T00:00:00.000Z"));
    await act(async () => {
      root.render(createElement(HomePage, {
        tab: "quick",
        notebooks: [],
        notes: [],
        quickNotes: notes,
        tagDirectory: [],
        docCounts: {},
        onTabChange: () => {},
        onOpenNotebook: () => {},
        onOpenNote: () => {},
        onOpenDrawer: () => {},
        onOpenSearch: () => {},
        onCreateNotebook: () => {},
        onCreateNote: () => {},
        onTreeChanged: async () => {},
        onQuickNotesChanged: async () => {},
        onQuickNoteTagsChanged: async () => {},
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(host.querySelectorAll(".qn-preview-slot--text").length).toBe(11);
    expect(host.querySelectorAll(".qn-preview-slot--media").length).toBe(1);
    // 槽里是占位摘要（fallbackText 接线），不是旧的 .qn-card__text 纯文本块
    expect(host.querySelector(".qn-card__text")).toBeNull();
    expect(host.querySelector(".qn-preview-slot--text .quick-note-preview-paragraph")?.textContent).toContain("摘要");

    // 首屏正文预热 = 一屏 8 条（core/quickNoteDetailPrewarm 判据；IntersectionObserver 全程没触发）
    const loaded = bridgeMocks.readQuickNote.mock.calls.map((call) => String(call[0])).sort();
    expect(loaded).toEqual(["q0", "q1", "q2", "q3", "q4", "q5", "q6", "q7"]);
  });
});
