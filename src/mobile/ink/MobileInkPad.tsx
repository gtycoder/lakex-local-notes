import InkPad, { type InkPadProps } from "../../features/ink/InkPad";
import "./inkPad.shared.css";
import "./inkPad.mobile.css";

export type MobileInkPadProps = Omit<InkPadProps, "variant">;

export function MobileInkPad(props: MobileInkPadProps) {
  return <InkPad {...props} variant="mobile" />;
}

export default MobileInkPad;
