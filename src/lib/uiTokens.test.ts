import { describe, expect, it } from "vitest";
import { LAKE_MOTION, LAKE_UI_TOKENS } from "./uiTokens";

describe("Lake UI semantic tokens", () => {
  it("defines the approved light and dark reading surfaces", () => {
    expect(LAKE_UI_TOKENS.light).toMatchObject({ shell: "#F0F2F7", panel: "#FFFFFF", accent: "#3B5BDB" });
    expect(LAKE_UI_TOKENS.dark).toMatchObject({ shell: "#17191E", panel: "#202329", canvas: "#272A31", text: "#F3F5F8", accent: "#7A90EA" });
  });

  it("keeps shell motion on the approved timings", () => {
    expect(LAKE_MOTION).toEqual({ fast: "120ms", standard: "180ms", panel: "260ms", ease: "cubic-bezier(.22, 1, .36, 1)" });
  });
});
