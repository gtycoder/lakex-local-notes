/**
 * 桌面工作空间的「顶栏槽位」上下文（DT-09 收口）。
 *
 * 背景：四个空间（资料库 / 小记 / 回收站 / 资源）是 keep-alive 的，每个空间各有一份顶栏左侧
 * （`DesktopTopBarLeading`）⇒ DOM 里同时存在 4 份**完全相同**的按钮组，只有「活动空间那一份」不同：
 * ① 只有它能展开同步浮窗（其余副本藏在 `workspace-view--hidden` 里，浮窗必须收起）；
 * ② 只有它接管 App 的共享 ref（`wsMenuWrapRef` / `syncBtnRef` —— 工作空间菜单定位、外点判定、
 *    同步 toast 锚点都读这两个 ref；挂到隐藏副本上会量到 0 尺寸、锚点全错）。
 *
 * 改造前是 App 里 4 份 JSX、每份手写 `visible=` + 三元 ref（只有这两个参数有差别）。现在 App 只构造
 * **一个**顶栏元素、四处复用；每个渲染点用 `DesktopWorkspaceSlotProvider` 声明自己属于哪个空间，
 * 组件据此推导可见性与 ref 归属（纯函数 `topBarLeadingSlotView`，逐态可测）。
 *
 * 注意：provider 不产生 DOM —— 外壳结构与几何完全不变，四份副本照旧渲染（只是 3 份是隐藏的）。
 */
import { createContext, useContext, type ReactNode } from "react";
import type { DesktopWorkspace } from "./desktopTypes";

const DesktopWorkspaceSlotContext = createContext<DesktopWorkspace | null>(null);

/** 声明「子树里渲染的顶栏属于哪个空间」。由四个工作空间视图在顶栏槽位处各自包一层。 */
export function DesktopWorkspaceSlotProvider(props: { workspace: DesktopWorkspace; children: ReactNode }) {
  return <DesktopWorkspaceSlotContext.Provider value={props.workspace}>{props.children}</DesktopWorkspaceSlotContext.Provider>;
}

export interface TopBarLeadingSlotView {
  /** 同步浮窗是否可展开：非活动副本必须收起（它只是 keep-alive 下的隐藏重复 DOM）。 */
  visible: boolean;
  /** 是否接管 App 的共享 ref：只能挂到活动副本，否则定位 / 外点 / 同步 toast 锚到隐藏元素。 */
  sharedRefs: boolean;
}

/**
 * 顶栏左侧在某个槽位上的视图状态（纯函数，便于按四态逐项测试）。
 *
 * `slot === null` = 没有槽位上下文（独立渲染 / 单测）⇒ 视为唯一副本，可见并接管 ref。
 */
export function topBarLeadingSlotView(activeWorkspace: DesktopWorkspace, slot: DesktopWorkspace | null): TopBarLeadingSlotView {
  const visible = slot === null || slot === activeWorkspace;
  return { visible, sharedRefs: visible };
}

/** 当前渲染点所在的槽位；不在 provider 内返回 null。 */
export function useDesktopWorkspaceSlot(): DesktopWorkspace | null {
  return useContext(DesktopWorkspaceSlotContext);
}
