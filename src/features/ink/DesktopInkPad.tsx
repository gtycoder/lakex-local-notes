import InkPad, { type InkPadProps } from "./InkPad";
import "./inkPad.shared.css";
import "./inkPad.desktop.css";

export type DesktopInkPadProps = Omit<InkPadProps, "variant" | "active" | "paneVisible" | "pane"> & {
  visible?: boolean;
  focused?: boolean;
  pane?: "left" | "right" | null;
};

export function DesktopInkPad({ visible, focused, pane, ...props }: DesktopInkPadProps) {
  return <InkPad {...props} variant="desktop" active={focused ?? visible} paneVisible={visible} pane={pane} />;
}

export default DesktopInkPad;
