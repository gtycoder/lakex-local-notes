// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AttachmentCell } from "./bitableCells";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it("只读附件不接收剪贴板文件，正常可写附件仍上传", () => {
  const onUpload = vi.fn();
  const props = { noteId: "audit", value: [], readOnly: true, onUpload, onRemove: vi.fn(), onOpen: vi.fn(), onReorder: vi.fn(), onRename: vi.fn() };
  const file = new File(["a"], "photo.png", { type: "image/png" });
  const paste = () => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { items: [{ kind: "file", getAsFile: () => file }] } });
    act(() => host.querySelector(".bt-attachment-cell")!.dispatchEvent(event));
  };
  act(() => root.render(createElement(AttachmentCell, props))); paste();
  expect(onUpload).not.toHaveBeenCalled();
  act(() => root.render(createElement(AttachmentCell, { ...props, readOnly: false }))); paste();
  expect(onUpload).toHaveBeenCalledExactlyOnceWith([file]);
});
