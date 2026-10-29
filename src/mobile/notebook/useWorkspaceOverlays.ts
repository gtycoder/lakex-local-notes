/**
 * 工作区浮层的**唯一 owner**（MOB-02）。
 *
 * 以前是 10 个独立 useState（目录抽屉 / 大纲 / 查找条 / 标签全屏 / 切换笔记本 / 新建 / 行菜单 /
 * 属性 / 图标 / 历史版本）各自为政：互斥只在 openSidebar/openOutline 两处手写，其余都能叠开；
 * 返回键、顶底栏复位又各自散在三四个 effect 里。新增一个面板要改四处（state / 互斥 / 复位 / 返回栈），
 * 漏一处就是 MOB-01 那类洞（返回键跳过浮层直接退工作区）。
 *
 * 现在只有一份状态 `overlay`（null = 无浮层）+ 三个入口：open / close / toggle。
 * 三条不变量：
 *  ① **互斥**：open 永远替换当前值 ⇒ 任意时刻最多一个浮层（互斥只有这一处实现）。
 *  ② **载荷随值**：「这个浮层针对谁」就是 overlay 的字段（create.parentId / menu|info|icon|history.node），
 *     不再另设第二份 state（否则又会分叉成"面板开着、目标却是旧的"）。
 *  ③ **返回栈单点**：自带返回栈的种类登记在 SELF_REGISTERED_OVERLAY_KINDS，工作区不再重复登记，
 *     否则返回键会跳过子菜单下钻（MOB-01 已踩过）。
 */
import { useCallback, useState } from "react";
import type { NotebookTreeItem } from "../data/notebookTreeRepository";

export type WorkspaceOverlay =
  /** 左目录抽屉（.side-panel--left） */
  | { kind: "sidebar" }
  /** 右大纲抽屉（.side-panel--right） */
  | { kind: "outline" }
  /** 文档内查找条（只对 Lake 文档开放） */
  | { kind: "find" }
  /** 全屏标签列表（.mobile-model） */
  | { kind: "tabs" }
  | { kind: "notebookSwitch" }
  /** 目录「新建」：parentId = 建到哪个节点下（抽屉工具栏 = 笔记本根；行内 ＋ = 该行节点） */
  | { kind: "create"; parentId: string }
  /** 目录行 ⋮ 菜单 */
  | { kind: "menu"; node: NotebookTreeItem }
  /** 文档属性 */
  | { kind: "info"; node: NotebookTreeItem }
  /** 节点图标选择器 */
  | { kind: "icon"; node: NotebookTreeItem }
  /** 历史版本 */
  | { kind: "history"; node: NotebookTreeItem };

export type WorkspaceOverlayKind = WorkspaceOverlay["kind"];

/** 无载荷、可以「再点同一入口 = 收起」的浮层（带载荷的种类一律走 open 覆盖，不当开关用）。 */
const SIMPLE_OVERLAYS = {
  sidebar: { kind: "sidebar" },
  outline: { kind: "outline" },
  find: { kind: "find" },
} as const;

export type ToggleableOverlayKind = keyof typeof SIMPLE_OVERLAYS;

/**
 * 自带返回栈的种类 —— 由浮层原语自己 pushBackHandler：
 *   · create / menu / notebookSwitch → MobileSheetMenu（含子菜单下钻：返回先退子层）
 *   · info / icon / history → MobileSheet（ui/MobileSheet.tsx）
 * 工作区**不得**再登记一遍，否则栈顶变成工作区的"直接关面板"。
 */
export const SELF_REGISTERED_OVERLAY_KINDS: ReadonlySet<WorkspaceOverlayKind> = new Set([
  "create", "menu", "notebookSwitch", "info", "icon", "history",
]);

export interface WorkspaceOverlays {
  overlay: WorkspaceOverlay | null;
  /** 打开浮层（先收掉当前浮层 ⇒ 互斥）；同一带载荷种类再打开 = 覆盖载荷。 */
  open: (next: WorkspaceOverlay) => void;
  /** 关闭；传 kind 时只在「当前正是它」时才关（切文档收起查找条这类条件关闭）。 */
  close: (kind?: WorkspaceOverlayKind) => void;
  /** 再点同一入口 = 收起（只给抽屉/查找条这类无载荷浮层用）。 */
  toggle: (kind: ToggleableOverlayKind) => void;
}

export function useWorkspaceOverlays(): WorkspaceOverlays {
  const [overlay, setOverlay] = useState<WorkspaceOverlay | null>(null);

  const open = useCallback((next: WorkspaceOverlay) => { setOverlay(next); }, []);

  const close = useCallback((kind?: WorkspaceOverlayKind) => {
    setOverlay((current) => (current && (!kind || current.kind === kind) ? null : current));
  }, []);

  const toggle = useCallback((kind: ToggleableOverlayKind) => {
    setOverlay((current) => (current?.kind === kind ? null : SIMPLE_OVERLAYS[kind]));
  }, []);

  return { overlay, open, close, toggle };
}
