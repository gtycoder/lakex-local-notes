import { useCallback } from "react";
import { native } from "../../lib/native";
import InkPad from "./InkPad";
import type { EditorHostProps } from "../editor/editorHost";
import { importInkImagePages, pickInkImageFiles } from "./inkImageImport";
import "./inkPad.shared.css";
import "./inkPad.desktop.css";

/**
 * DT-06：桌面手写板宿主 = 「契约词表（visible/focused/pane/readOnly/onChange/onDirty/onCapture）
 * → InkPad 内部词表（active/paneVisible/onEditorCapture）」的**唯一适配层**。
 * InkPad 由桌面/移动端共用（MobileInkPad 也包它），所以内核侧不改名，只在这一层翻译。
 *
 * v2 图片页：桌面入口 = 工具条「导入图片」（编辑态）。上传走既有 IPC 资产通道
 * （native.uploadResource），与画板/文档图片同一条落盘/声明/同步/GC 管线。
 */
export type DesktopInkPadProps = EditorHostProps;

export function DesktopInkPad({ visible, focused, pane, onCapture, noteId, ...props }: DesktopInkPadProps) {
  const onImportImages = useCallback(async () => {
    const files = await pickInkImageFiles();
    if (files.length === 0) return null; // 用户取消
    return importInkImagePages(files, {
      upload: (input) => native.uploadResource(input, noteId),
    });
  }, [noteId]);
  return (
    <InkPad
      {...props}
      variant="desktop"
      active={focused ?? visible}
      paneVisible={visible}
      pane={pane}
      onEditorCapture={onCapture}
      onImportImages={onImportImages}
    />
  );
}

export default DesktopInkPad;
