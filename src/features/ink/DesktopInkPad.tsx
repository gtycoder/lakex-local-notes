import InkPad from "./InkPad";
import type { EditorHostProps } from "../editor/editorHost";
import "./inkPad.shared.css";
import "./inkPad.desktop.css";

/**
 * DT-06：桌面手写板宿主 = 「契约词表（visible/focused/pane/readOnly/onChange/onDirty/onCapture）
 * → InkPad 内部词表（active/paneVisible/onEditorCapture）」的**唯一适配层**。
 * InkPad 由桌面/移动端共用（MobileInkPad 也包它），所以内核侧不改名，只在这一层翻译。
 */
export type DesktopInkPadProps = EditorHostProps;

export function DesktopInkPad({ visible, focused, pane, onCapture, ...props }: DesktopInkPadProps) {
  return <InkPad {...props} variant="desktop" active={focused ?? visible} paneVisible={visible} pane={pane} onEditorCapture={onCapture} />;
}

export default DesktopInkPad;
