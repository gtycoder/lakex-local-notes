/**
 * 工作区胶囊（底部 .mobile-bottom-bar）的显隐判据 —— 纯函数、无 DOM（261104 抽出加护栏）。
 *
 * 定稿口径（AGENTS §4「移动端入口分工」）：
 *   文档编辑态胶囊**常显**（编辑态也可能没光标、键盘/面板都没展开，此时要能切目录/看大纲/换标签/切笔记本），
 *   两条允许被覆盖的路径：
 *     ① 键盘弹起 ⇒ 隐藏（fixed 胶囊会跟着视口上浮，露着只会挡输入区）；
 *     ② dock 二级面板展开/收起 ⇒ **不隐藏**，由层序（dock z=4 > 胶囊 z=2）从上面盖住。
 *
 * 261104 修 bug：面板开合会顺带切换 IME（开：收；关：放回），键盘判据因此会在过渡里变一次 ⇒
 * 旧实现（250ms transform/opacity 过渡）表现为胶囊在面板边上「滑入/滑出」闪一下。现在：
 *   · 面板阶段**冻结**胶囊的可见性（打开前是什么就保持什么，见 capsuleHiddenFor 的 frozenHidden）；
 *   · 编辑态胶囊的 CSS 过渡改成 none（见 mobile.css 的 .mobile-bottom-bar--above-dock）⇒ 残余键盘路径也是瞬时。
 */
import type { DockPanelPhase } from "../editor/dockPanelPhase";

export interface CapsuleVisibilityInput {
  /** 阅读态顶/底栏自动收起（滚动隐藏）或子页全屏。 */
  chromeHidden: boolean;
  /** 当前是否有编辑器处于编辑态。 */
  editing: boolean;
  /** 当前编辑的是 Lake 文档（只有它有「无光标仍需导航」的场景）。 */
  capsuleInEdit: boolean;
  keyboardOpen: boolean;
}

/** 不考虑面板阶段的基础判据（面板未打开时直接用它）。 */
export function baseCapsuleHidden(input: CapsuleVisibilityInput): boolean {
  if (input.chromeHidden) return true;
  if (!input.editing) return false;
  if (!input.capsuleInEdit) return true;
  return input.keyboardOpen;
}

export interface CapsuleVisibilityWithPanel extends CapsuleVisibilityInput {
  dockPanelPhase: DockPanelPhase;
  /** 进入面板阶段那一刻冻结的可见性（closed 时忽略）。 */
  frozenHidden: boolean;
}

/** 面板开/关阶段：保持打开前的可见性（不隐藏、也不“复现”），等面板关完再按键盘判据。 */
export function capsuleHiddenFor(input: CapsuleVisibilityWithPanel): boolean {
  if (input.dockPanelPhase !== "closed") return input.frozenHidden;
  return baseCapsuleHidden(input);
}