// @vitest-environment jsdom
/**
 * 移动小记卡片的 Lightbox 画廊**只收图片**（261112 R2）。
 *
 * 现场：小记资源清单（core/quickNoteModel StoredQuickNoteContent.images）是「图片 + 视频/音频/附件」混合数组；
 * 首页把它整份塞进 openImagePreview ⇒ 大图左右切会切到视频（黑屏/空白）。本用例锁：
 *  ① 画廊 = 仅 image mime（视频/音频/附件不进去）；
 *  ② 索引按「过滤后的图片序列」对齐（点第 2 张图 ⇒ index 1）；
 *  ③ 封面去重照旧：hiddenMediaNames 仍含首图，但首图仍在画廊里（封面也是画廊入口）；
 *  ④ QuickNotePreview 的 assets 仍是全量（媒体卡要 URL，不能顺手把视频卡弄丢）。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openImagePreview: vi.fn(),
  readQuickNote: vi.fn(async () => null),
  showToast: vi.fn(),
  previewProps: { current: null as null | Record<string, unknown> },
}));

vi.mock("../../features/editor/imagePreview", () => ({ openImagePreview: mocks.openImagePreview }));
vi.mock("../../features/quickNotes/QuickNotePreview", () => ({
  QuickNotePreview: (props: Record<string, unknown>) => {
    mocks.previewProps.current = props;
    const assets = props.assets as Array<{ filename: string; mimeType: string }>;
    const onImageClick = props.onImageClick as (image: { filename: string }) => void;
    return createElement("div", null, assets.map((asset) =>
      createElement("button", { key: asset.filename, "data-media": asset.mimeType, onClick: () => onImageClick(asset) }, asset.filename),
    ));
  },
}));
vi.mock("../bridge", () => ({
  bridge: {
    readQuickNote: mocks.readQuickNote,
    listNoteTagLinks: vi.fn(async () => ({})),
    setQuickNoteTags: vi.fn(),
    setNoteTags: vi.fn(),
    batchNotes: vi.fn(),
  },
}));
vi.mock("../ui/ConfirmDialog", () => ({ confirmMobile: vi.fn(async () => true) }));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    measure: () => undefined,
    measureElement: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

import { HomePage, type MobileQuickNote } from "./HomePage";

const T = "2026-11-12T10:00:00.000Z";
const asset = (id: string, filename: string, mimeType: string, size = 10) => ({
  id, filename, mimeType, size, hash: "a".repeat(64),
  width: mimeType.startsWith("image/") ? 100 : null,
  height: mimeType.startsWith("image/") ? 100 : null,
});

const NOTE: MobileQuickNote = {
  id: "q1", createdAt: T, updatedAt: T, previewText: "一张图 + 一段视频", imageCount: 2,
  firstImage: "a.png", body: "<p>正文</p>",
  images: [
    asset("i1", "a.png", "image/png"),
    asset("i2", "b.jpg", "image/jpeg"),
    asset("v1", "c.mp4", "video/mp4"),
    asset("a1", "d.m4a", "audio/mp4"),
  ],
  tags: [], tagIds: [],
};

class IntersectionObserverStub {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = IntersectionObserverStub;
  mocks.openImagePreview.mockReset();
  mocks.previewProps.current = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function renderHome(): Promise<void> {
  await act(async () => {
    root.render(createElement(HomePage, {
      tab: "quick",
      notebooks: [], notes: [], quickNotes: [NOTE],
      tagDirectory: [], docCounts: {},
      onTabChange: () => {}, onOpenNotebook: () => {}, onOpenNote: () => {}, onOpenQuickNote: () => {},
      onTagsChanged: async () => undefined, onOpenDrawer: () => {}, onOpenSearch: () => {},
      onCreateNotebook: () => {}, onCreateNote: () => {}, onTreeChanged: async () => {},
      onQuickNotesChanged: async () => {}, onQuickNoteTagsChanged: async () => undefined,
    }));
  });
}

describe("小记卡片 Lightbox 画廊只收图片（261112 R2）", () => {
  it("点第 2 张图：画廊 = 两张图（无视频/音频），index 对齐过滤后的序列", async () => {
    await renderHome();
    const second = host.querySelector('[data-media="image/jpeg"]');
    expect(second).toBeTruthy();
    await act(async () => { (second as HTMLButtonElement).click(); });
    // handleImageTap 有 300ms 单击/双击判定窗
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });

    expect(mocks.openImagePreview).toHaveBeenCalledTimes(1);
    const [images, index] = mocks.openImagePreview.mock.calls[0] as [Array<{ src: string }>, number];
    expect(images).toHaveLength(2);
    expect(index).toBe(1);
    const joined = images.map((image) => image.src).join("|");
    expect(joined).toContain("a.png");
    expect(joined).toContain("b.jpg");
    expect(joined).not.toContain("c.mp4");
    expect(joined).not.toContain("d.m4a");
  });

  it("封面去重照旧：hiddenMediaNames 含首图，且首图仍在画廊里（索引仍从 0 开始）", async () => {
    await renderHome();
    const first = host.querySelector('[data-media="image/png"]');
    await act(async () => { (first as HTMLButtonElement).click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });

    const props = mocks.previewProps.current as { hiddenMediaNames?: Set<string>; assets: unknown[] };
    expect(props.hiddenMediaNames).toBeInstanceOf(Set);
    expect(props.hiddenMediaNames?.has("a.png")).toBe(true);
    // QuickNotePreview 的 assets 仍是全量（视频/音频卡不能丢 URL）
    expect(props.assets).toHaveLength(4);
    const [images, index] = mocks.openImagePreview.mock.calls[0] as [unknown[], number];
    expect(images).toHaveLength(2);
    expect(index).toBe(0);
  });
});
