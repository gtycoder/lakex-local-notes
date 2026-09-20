import { afterEach, describe, expect, it, vi } from "vitest";
import { openAssetEntry } from "./openAssetEntry.js";
import { closeAttachmentPreview, subscribeAttachmentPreview, type AttachmentPreviewState, type AttachmentPreviewItem } from "./attachmentPreviewController.js";
import { closeImagePreview, subscribeImagePreview, type ImagePreviewState } from "../editor/imagePreview.js";

let attachmentState: AttachmentPreviewState | null = null;
let imageState: ImagePreviewState | null = null;
subscribeAttachmentPreview((s) => { attachmentState = s; });
subscribeImagePreview((s) => { imageState = s; });

afterEach(() => { closeAttachmentPreview(); closeImagePreview(); });

const URL_PNG = "http://127.0.0.1:19876/n/1.png";
const URL_MP3 = "http://127.0.0.1:19876/n/1.mp3";
const URL_PDF = "http://127.0.0.1:19876/n/1.pdf";

describe("openAssetEntry 统一附件打开分流", () => {
  it("图片 → 应用内 Lightbox，不落系统", () => {
    const onOpen = vi.fn();
    openAssetEntry(URL_PNG, "1.png", 0, { openSystem: onOpen });
    expect(imageState).not.toBeNull();
    expect(attachmentState).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("音频 → 内嵌附件预览，不落系统", () => {
    const onOpen = vi.fn();
    openAssetEntry(URL_MP3, "1.mp3", 12, { openSystem: onOpen });
    expect(attachmentState?.item.kind).toBe("audio");
    expect(imageState).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("PDF → 默认系统应用打开", () => {
    const onOpen = vi.fn();
    openAssetEntry(URL_PDF, "1.pdf", 12, { openSystem: onOpen });
    expect(onOpen).toHaveBeenCalledTimes(1);
    const item = onOpen.mock.calls[0][0] as AttachmentPreviewItem;
    expect(item.kind).toBe("pdf");
    expect(imageState).toBeNull();
    expect(attachmentState).toBeNull();
  });

  it("directOpen:false → 非媒体打开信息预览层", () => {
    const onOpen = vi.fn();
    openAssetEntry(URL_PDF, "1.pdf", 12, { openSystem: onOpen, directOpen: false });
    expect(attachmentState?.item.kind).toBe("pdf");
    expect(onOpen).not.toHaveBeenCalled();
  });
});
