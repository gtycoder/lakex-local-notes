// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Dialog } from "../components/ui/Overlay";
import { ImageLightbox } from "../features/editor/ImageLightbox";
import { AttachmentPreview } from "../features/attachment/AttachmentPreview";
import { openImagePreview, closeImagePreview, subscribeImagePreview } from "../features/editor/imagePreview";
import { openAttachmentPreview, closeAttachmentPreview, buildAttachmentPreviewItem, subscribeAttachmentPreview } from "../features/attachment/attachmentPreviewController";
import { usePadShortcuts } from "../mobile/pad/usePadShortcuts";
import { lockPageScroll } from "../lib/pageScrollLock";
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => { closeImagePreview(); closeAttachmentPreview(); root.unmount(); }); host.remove(); document.body.style.overflow = document.documentElement.style.overflow = ""; vi.unstubAllGlobals(); });
it("设置上打开图片/附件后，Esc只关最上层；父设置和滚动锁仍保留，Pad快捷键不越层", () => {
  const parentClose = vi.fn(), padClose = vi.fn();
  function App() { usePadShortcuts(true, { escape: padClose }); return createElement("div", null, createElement(Dialog, { label: "设置", onDismiss: parentClose, children: createElement("button", null, "设置字段") }), createElement(ImageLightbox), createElement(AttachmentPreview)); }
  let imageOpen = false, attachmentOpen = false;
  const unsubscribeImage = subscribeImagePreview(state => { imageOpen = !!state; });
  const unsubscribeAttachment = subscribeAttachmentPreview(state => { attachmentOpen = !!state; });
  act(() => root.render(createElement(App)));
  act(() => openImagePreview([{ src: "data:image/png;base64,AA==" }], 0));
  act(() => openAttachmentPreview(buildAttachmentPreviewItem("test.bin", "样本.bin", 0), null, null));
  const escape = () => act(() => { document.querySelector('[aria-label="设置"] button')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  escape(); expect(attachmentOpen).toBe(false); expect(imageOpen).toBe(true); expect(parentClose).not.toHaveBeenCalled(); expect(padClose).not.toHaveBeenCalled(); expect(document.body.style.overflow).toBe("hidden");
  escape(); expect(imageOpen).toBe(false); expect(attachmentOpen).toBe(false); expect(parentClose).not.toHaveBeenCalled(); expect(padClose).not.toHaveBeenCalled(); expect(document.body.style.overflow).toBe("hidden");
  unsubscribeImage(); unsubscribeAttachment();
});
it("页面锁可乱序和重复释放，最后一层释放才恢复原来的body/html值", () => {
  document.body.style.overflow = "scroll"; document.documentElement.style.overflow = "auto";
  const parent = lockPageScroll(), child = lockPageScroll(); parent(); parent(); expect(document.body.style.overflow).toBe("hidden"); child();
  expect(document.body.style.overflow).toBe("scroll"); expect(document.documentElement.style.overflow).toBe("auto");
});
