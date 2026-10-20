import { useEffect } from "react";
import InkPad, { type InkPadProps } from "../../features/ink/InkPad";
import { setStylusHandwritingEnabled } from "../native/stylusInput";
import "./inkPad.shared.css";
import "./inkPad.mobile.css";

export type MobileInkPadProps = Omit<InkPadProps, "variant">;

export function MobileInkPad({ active = false, readOnly = false, ...props }: MobileInkPadProps) {
  useEffect(() => {
    if (!active || readOnly) return;
    void setStylusHandwritingEnabled(false);
    return () => { void setStylusHandwritingEnabled(true); };
  }, [active, readOnly]);

  return <InkPad {...props} active={active} readOnly={readOnly} variant="mobile" />;
}

export default MobileInkPad;
