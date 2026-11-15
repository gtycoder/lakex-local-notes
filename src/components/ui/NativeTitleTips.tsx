import { useEffect } from "react";
import { installNativeTitleTips } from "../../lib/nativeTitleTip";

/**
 * 桌面壳：原生 `title` → 自绘 `.ln-tip`（261006 Phase 2.2；261115 A04）。
 *
 * 行为全在两端共享的 `lib/nativeTitleTip`（悬停/焦点 350ms、触屏长按 450ms、可访问名判断、
 * `aria-describedby` 增删与复原、事件清理）；这里只决定桌面气泡的 id 与 class，
 * 视觉仍由 `kit.css` 的 `.ln-tip` / `.ln-tip--wide` 负责（不改时序、不改宽版规则）。
 */
export const TIP_ID = "lake-native-title-tip";

export function NativeTitleTips() {
  useEffect(
    () => installNativeTitleTips({
      id: TIP_ID,
      tipClassName: "ln-tip",
      extraClassName: "native-title-tip",
      wideClassName: "ln-tip--wide",
    }),
    [],
  );
  return null;
}
