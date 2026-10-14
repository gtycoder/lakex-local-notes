/**
 * 移动端「外壳高度」的单一来源（261014）。
 *
 * **为什么需要它**：Android adjustResize 下**输入法会把 WebView 压矮**（实测 842 → 530），而**我们自己画的面板不会**
 * （面板是浮层，视口不变）。于是「面板 ⇄ 输入法」来回切时，任何以视口高为基准的盒子都会跟着变高变矮 ——
 * 用户看到的就是**编辑区跳动**（261014 实测：小记写作卡 320 → 428px、文档侧同理）。
 * 语雀的口径是**内容视口恒定**：键盘与面板占同一块区域，正文区域一动不动。我们的做法：
 *   .mobile-app 高度 = **这个稳定值 − 当前底部被占高度**（--mb-app-h，由 EditorDock 写）。
 *
 * **为什么单调取最大值**：只有「键盘收起时的视口高」才是稳定值；取历史最大值可以避开
 * 「实例挂载时键盘正好开着」（拿到 530）以及 keep-alive 隐藏实例的时序问题。方向变化时重置
 * （横竖屏的外壳高不同，竖屏的值带到横屏会把页面撑高）。
 */
let shell = 0;

/** 记一次视口高，返回当前的稳定外壳高（只增不减；方向变化时由 resetShellHeight 重置）。 */
export function noteViewport(innerHeight: number): number {
  if (innerHeight > shell) shell = innerHeight;
  return shell;
}

/** 稳定外壳高（键盘收起时的高度）；尚未测量到返回 0。 */
export function shellHeight(): number {
  return shell;
}

/** 方向变化时重置（横竖屏切换后重新学习；否则竖屏的 842 会把横屏页面撑高）。 */
export function resetShellHeight(): void {
  shell = 0;
}
