export const LAKE_UI_TOKENS = {
  light: {
    shell: "#F0F2F7",
    panel: "#FFFFFF",
    canvas: "#FFFFFF",
    border: "#DDE2EC",
    text: "#232838",
    textSecondary: "#667181",
    textTertiary: "#8993A1",
    accent: "#3B5BDB",
    accentSoft: "#EDF0FD",
    syncPending: "#B7771E",
    syncSuccess: "#368A61",
    error: "#C94A43",
  },
  dark: {
    shell: "#17191E",
    panel: "#202329",
    canvas: "#272A31",
    border: "#383E49",
    text: "#F3F5F8",
    textSecondary: "#B1BAC8",
    textTertiary: "#838D9C",
    accent: "#7A90EA",
    accentSoft: "rgba(122,144,234,.18)",
    syncPending: "#E4AF5E",
    syncSuccess: "#63C47B",
    error: "#F08078",
  },
} as const;

export const LAKE_MOTION = {
  fast: "120ms",
  standard: "180ms",
  panel: "260ms",
  ease: "cubic-bezier(.22, 1, .36, 1)",
} as const;
