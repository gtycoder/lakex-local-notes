/**
 * 设备形态（平板 / 折叠屏展开）—— 261027。
 *
 * 原生侧（MainActivity 的 lakeDevice）按 smallestScreenWidthDp >= 600 判定，
 * 折叠展开/旋转时通过 window.__lakeSetTablet(bool) 再推一次；Web 只负责 body.lake-tablet
 * 的布局差异（内容限宽居中、设置页加宽），不改信息架构。
 * 非 Android 无桥 ⇒ 不添加类，手机布局零变化。
 */
type DeviceBridge = { isTablet?: () => boolean };

export function installDeviceProfile(): void {
  const apply = (tablet: boolean): void => {
    document.body.classList.toggle("lake-tablet", tablet === true);
  };
  (window as { __lakeSetTablet?: (tablet: boolean) => void }).__lakeSetTablet = apply;
  const bridge = (window as { lakeDevice?: DeviceBridge }).lakeDevice;
  if (!bridge) return;
  try {
    apply(bridge.isTablet?.() === true);
  } catch { /* 桥不可用时保持手机布局 */ }
}
