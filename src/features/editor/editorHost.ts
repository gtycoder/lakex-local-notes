/**
 * DT-06：五种编辑器宿主（doc / usheet / bitable / board / ink）的**单一 prop 词表**。
 *
 * 背景（审计 03-desktop DT-06）：五个宿主各自声明 props，出现两套词表
 * （`visible/focused/pane/readOnly` vs `active/paneVisible`）、两套 capture 入口，
 * 加第 6 种 kind 时要改 6 处类型。这里把「同一个交互」收敛成一份类型来源：
 *   - 可见性/分屏：`visible / focused / pane`
 *   - 读态：`readOnly`
 *   - 变更通知：`onChange / onDirty`
 *   - 按需取正文：`onCapture`（类型见 `core/editorCapture`）
 *
 * 边界（保守版 DT-06）：**只有类型，不含行为**。各宿主仍按自己的生命周期接线
 * （懒挂载、隐藏 flush、capture 注册时机都不在这里统一，避免改变时序）。
 *
 * 本文件放在 features/editor 而不是 core/editorHost：
 * core/editorHost.ts 是 DT-10 认定为「零引用死模块」并删除的诱饵文件，
 * 宿主契约的消费方全在 features/editor 及其宿主组件里。
 */
import type { EditorCaptureHandler } from "../../core/editorCapture";

/** 分屏栏位：null / 缺省 = 未分屏。 */
export type EditorHostPane = "left" | "right" | null;

/**
 * 五种宿主共用 props（单一词表）。
 *
 * 各宿主按需 `extends` 本契约再补专有 prop；doc 宿主（EditorTab）没有 capture 注册入口
 * （正文由内核实例 `getDocument` 现取，见 useSavePipelineGlue 的 editorsRef 兜底），
 * 因此它以 `Omit<EditorHostProps, "onCapture">` 接入，避免多一个永远不会被调用的回调。
 */
export interface EditorHostProps {
  noteId: string;
  content: string;
  /** 当前标签/工作区是否可见（keep-alive 下仍挂载）。 */
  visible: boolean;
  /** 分屏里的焦点栏（决定 data-active；全局唯一）。缺省 = visible（旧行为）。 */
  focused?: boolean;
  /** 分屏里所在栏位；未分屏不传。仅用于布局（data-pane）。 */
  pane?: EditorHostPane;
  /** 只读（锁定 / 回收站 / 被他端 purge / 坏正文兜底）。 */
  readOnly: boolean;
  /** 正文变更通知；无参调用 = 只报「变了」，带 content = 交出最新正文。 */
  onChange: (content: string) => void;
  /** 用户一改动立即通知（早于宿主内部防抖）。 */
  onDirty?: () => void;
  /** 注册/注销按需同步序列化（卸载时传 null）。 */
  onCapture?: EditorCaptureHandler;
}
