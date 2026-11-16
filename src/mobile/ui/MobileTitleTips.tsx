import { useEffect } from "react";
import { installNativeTitleTips } from "../../lib/nativeTitleTip";

/**
 * 移动壳：原生 `title` → 自绘 `.mb-tip`（261115 A04）。
 *
 * 移动端没有 hover：共享逻辑走长按 450ms（pointermove > 8px / pointerup / 点击 / 滚动收起），
 * `focusin` 仍可显示。视觉由 `src/mobile/kit.css` 的 `.mb-tip` / `.mb-tip--wide` 负责；
 * 本文件不 import 任何桌面 UI 组件与桌面样式（mobileIndependence 红线）。
 */
export const MOBILE_TIP_ID = "lake-mobile-title-tip";

/** 安装原生 title → .mb-tip 的拦截器；返回卸载函数。
 *  261116：外壳改为**空闲后再动态加载**本模块（entry 预算 50KB 吃紧，长按提示不是首屏能力）。 */
export function installMobileTitleTips(): () => void {
  return installNativeTitleTips({
    id: MOBILE_TIP_ID,
    tipClassName: "mb-tip",
    wideClassName: "mb-tip--wide",
  });
}

/** 兼容旧挂法（测试/其它宿主）：挂一次等于 install，卸载时清理。 */
export function MobileTitleTips() {
  useEffect(() => installMobileTitleTips(), []);
  return null;
}
