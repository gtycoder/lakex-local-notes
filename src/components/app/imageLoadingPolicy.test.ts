import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 图片加载口径护栏（261116 用户点单）：
 * 正文/Lake 内核/图片 Lightbox = 原图；属性/资源页/回收站孤儿/小图列表 = 缩略档。
 * 这是源码断言，防止以后把正文也加 ?w 或把小图退回原图。
 */
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("图片加载口径（正文=原图，其余=缩略图）", () => {
  it("正文 viewer / Lightbox 不接缩略档位", () => {
    expect(read("./NoteDocPreview.tsx")).not.toContain("withAssetWidth");
    expect(read("../../features/editor/ImageLightbox.tsx")).not.toContain("withAssetWidth");
  });

  it("属性、资源页、回收站孤儿预览走缩略档 + token", () => {
    const noteInfo = read("./NoteInfoDialog.tsx");
    expect(noteInfo).toContain("assetThumbWidthForCss");
    expect(noteInfo).toContain("withAssetWidth");
    expect(noteInfo).toContain("withAssetAccessToken");
    expect(noteInfo).toContain("const [assetsOpen, setAssetsOpen] = useState(false)");
    const history = read("./HistoryPanel.tsx");
    expect(history).toContain("withAssetWidth(base, width1024)");
    expect(history).toContain("imageSrc");
    const assets = read("./AssetsBrowser.tsx");
    expect(assets).toContain("preview === \"image\" ? 1024 : null");
  });

  it("AI 选图器/小记/标签详情仍是既有缩略档位，不回退原图", () => {
    expect(read("../../features/aiWriting/AiImagePicker.tsx")).toContain("aiWritingAttachmentUrl(ref)");
    expect(read("../../features/quickNotes/QuickNotePreview.tsx")).toContain("loading=\"lazy\"");
    expect(read("../../mobile/tags/TagQuickNotePreview.tsx")).toContain("quickNotePreviewAssetUrl");
  });
});
