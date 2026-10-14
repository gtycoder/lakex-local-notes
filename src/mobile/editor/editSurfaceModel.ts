/**
 * 移动端「编辑面」的**几何与状态算术**（纯函数，261014 抽取；无 React、无 DOM）。
 *
 * 为什么单独一层：这几条算术原来散在 EditorDock 的 hooks/effects 里，而**它们覆盖的迁移正是过去反复出 bug 的地方**
 * （键盘⇄面板切换导致正文跳动、面板塌陷、工具栏掉底）。抽成纯函数后：迁移在 **CI 里可测**（不再只能靠设备上人眼看 GIF）；
 * 「编辑面」的口径只有一处（viewportShell.ts 给稳定外壳高，这里给占用与偏移）。
 *
 * 三个量的关系（设备实测口径见 docs/LAKEX-CONTRACT.md §5.36–§5.38）：
 *   occupation = 输入法 / 面板**占住底部**的高度（两者互斥：面板开时输入法必须收）
 *   surfaceH   = 稳定外壳高 − occupation  ⇒ 键盘态与面板态**相等**（内容视口恒定 = 不跳）
 *   kbOffset   = 工具栏的 --kb-offset：面板期负责把工具栏抬到「键盘让出的区域」上方；
 *                过渡期必须**跟着视口一起长**，否则工具栏会先掉到屏幕底部再弹回来（实测 474 → 786 → 474）
 */

/** 底部被占高度：面板（含收起过渡）优先于输入法；两者都无 = 0。 */
export function bottomOccupation(input: {
  panelOpen: boolean;
  closing: boolean;
  panelHeight: number;
  keyboardOpen: boolean;
  keyboardHeight: number;
}): number {
  const panel = input.panelOpen || input.closing ? Math.max(0, input.panelHeight) : 0;
  const ime = input.keyboardOpen ? Math.max(0, input.keyboardHeight) : 0;
  return Math.max(panel, ime);
}

/** 外壳高度 = 稳定外壳高 − 底部占用（不小于 0；未测到外壳高时返回 0，由调用方决定要不要写）。 */
export function shellSurfaceHeight(shellHeight: number, occupation: number): number {
  if (!shellHeight || shellHeight <= 0) return 0;
  return Math.max(0, Math.round(shellHeight - Math.max(0, occupation)));
}

/**
 * 工具栏底距（--kb-offset）。
 * · 面板开/收起过渡：innerHeight − shellHeight + panelHeight —— 键盘收起过程中 innerHeight 从 530 长到 842，
 *   这个值同步从 0 长到 panelHeight，**工具栏屏幕 Y 恒定**（这是「面板接管键盘让出的区域」的机制）；
 * · 无面板：用 edge-to-edge 的上移量（adjustResize 下恒 0）。
 */
export function dockKbOffset(input: {
  panelOpen: boolean;
  closing: boolean;
  innerHeight: number;
  shellHeight: number;
  panelHeight: number;
  edgeToEdgeOffset: number;
}): number {
  if (!(input.panelOpen || input.closing)) return Math.max(0, Math.round(input.edgeToEdgeOffset));
  const growing = Math.round(input.innerHeight - input.shellHeight + input.panelHeight);
  return Math.max(0, growing, Math.round(input.edgeToEdgeOffset));
}

/** 打开面板时捕获的「键盘区高度」（下限兜底：拿不到键盘高时也要占够一块区域）。 */
export function capturePanelHeight(keyboardHeight: number, floor = 280): number {
  return Math.max(Math.round(keyboardHeight), floor);
}
