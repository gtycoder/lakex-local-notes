/**
 * dock「二级面板」开合阶段（261104）。
 *
 * 为什么要有这个 store：工作区胶囊的显隐判据里含「键盘弹起就隐藏」，而**面板开合本身会改变视口/输入法状态**
 * （开：收 IME；关：放回 IME），于是键盘判据在面板过渡期间抖一次 ⇒ 胶囊在面板边缘闪入闪出。
 * 定稿口径（AGENTS §4）：面板展开时应由**层序**盖住胶囊（dock z=4 > 胶囊 z=2），不需要隐藏；
 * 因此把面板阶段暴露成单一来源，胶囊判据（capsuleVisibility）与 dock 共用。
 *
 * 阶段：closed（无面板）→ open（面板展示中，含收起动画之前的稳定态）→ closing（收起过渡中）→ closed。
 */
import { useSyncExternalStore } from "react";

export type DockPanelPhase = "closed" | "open" | "closing";

let phase: DockPanelPhase = "closed";
const listeners = new Set<() => void>();

export function setDockPanelPhase(next: DockPanelPhase): void {
  if (phase === next) return;
  phase = next;
  for (const listener of listeners) listener();
}

export function getDockPanelPhase(): DockPanelPhase {
  return phase;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useDockPanelPhase(): DockPanelPhase {
  return useSyncExternalStore(subscribe, getDockPanelPhase, () => "closed" as const);
}

/** 仅测试用：复位单例（vitest 同一进程里多文件共享模块）。 */
export function resetDockPanelPhaseForTest(): void {
  phase = "closed";
}
