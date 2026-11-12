// @vitest-environment jsdom
/**
 * 标签详情小记富预览的 Lightbox 画廊**只收图片**（261112 R2，与首页卡片同一判据）。
 *
 * 资源清单是「图片 + 视频/音频/附件」混合数组；全塞进 openImagePreview 会让大图左右切切到视频。
 * 本用例锁：① 画廊仅 image mime；② 点第 2 张图 index=1；③ assets 仍传全量（媒体卡要 URL）。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openImagePreview: vi.fn(),
  readQuickNote: vi.fn(),
  previewProps: { current: null as null | Record<string, unknown> },
  /** mock 工厂被提升到文件顶部 ⇒ 夹具必须一起 hoist（不能引用下面的顶层函数）。 */
  images: [
    { id: "i1", filename: "a.png", mimeType: "image/png", size: 10, hash: "b".repeat(64), width: 100, height: 100 },
    { id: "i2", filename: "b.jpg", mimeType: "image/jpeg", size: 10, hash: "b".repeat(64), width: 100, height: 100 },
    { id: "v1", filename: "c.mp4", mimeType: "video/mp4", size: 10, hash: "b".repeat(64), width: null, height: null },
    { id: "a1", filename: "d.m4a", mimeType: "audio/mp4", size: 10, hash: "b".repeat(64), width: null, height: null },
  ],
}));

vi.mock("../bridge", () => ({
  bridge: {
    readQuickNote: mocks.readQuickNote.mockResolvedValue({
      content: { text: "一张图", body: "<p>正文</p>", images: mocks.images },
      tagIds: [],
    }),
  },
}));
vi.mock("../../features/editor/imagePreview", () => ({ openImagePreview: mocks.openImagePreview }));
vi.mock("../../features/quickNotes/QuickNotePreview", () => ({
  QuickNotePreview: (props: Record<string, unknown>) => {
    mocks.previewProps.current = props;
    const assets = props.assets as Array<{ filename: string; mimeType: string }>;
    const onImageClick = props.onImageClick as (image: { filename: string }) => void;
    return createElement("div", null, assets.map((item) =>
      createElement("button", { key: item.filename, "data-media": item.mimeType, onClick: () => onImageClick(item) }, item.filename),
    ));
  },
}));

import { TagQuickNotePreview } from "./TagQuickNotePreview";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
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

async function renderPreview(): Promise<void> {
  await act(async () => { root.render(createElement(TagQuickNotePreview, { noteId: "q1", fallbackText: "摘要" })); });
  await act(async () => { await Promise.resolve(); }); // 等 readQuickNote resolve
}

describe("标签详情小记预览画廊只收图片（261112 R2）", () => {
  it("点第 2 张图：画廊 2 张（无视频/音频）、index=1；assets 仍全量", async () => {
    await renderPreview();
    const second = host.querySelector('[data-media="image/jpeg"]');
    expect(second).toBeTruthy();
    await act(async () => { (second as HTMLButtonElement).click(); });

    expect(mocks.openImagePreview).toHaveBeenCalledTimes(1);
    const [images, index] = mocks.openImagePreview.mock.calls[0] as [Array<{ src: string }>, number];
    expect(images).toHaveLength(2);
    expect(index).toBe(1);
    const joined = images.map((image) => image.src).join("|");
    expect(joined).toContain("a.png");
    expect(joined).toContain("b.jpg");
    expect(joined).not.toContain("c.mp4");
    expect(joined).not.toContain("d.m4a");

    const props = mocks.previewProps.current as { assets: unknown[] };
    expect(props.assets).toHaveLength(4);
  });

  it("点第 1 张图：index=0（索引在过滤后的图片序列上对齐）", async () => {
    await renderPreview();
    const first = host.querySelector('[data-media="image/png"]');
    await act(async () => { (first as HTMLButtonElement).click(); });
    const [, index] = mocks.openImagePreview.mock.calls[0] as [unknown[], number];
    expect(index).toBe(0);
  });
});