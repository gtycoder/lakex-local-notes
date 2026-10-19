import InkPad, { type InkPadProps } from "./InkPad";
import "./inkPad.shared.css";
import "./inkPad.desktop.css";

export type DesktopInkPadProps = Omit<InkPadProps, "variant">;

export function DesktopInkPad(props: DesktopInkPadProps) {
  return <InkPad {...props} variant="desktop" />;
}

export default DesktopInkPad;
