/**
 * AI 助手浮层几何常量（K13，261112 审计 R0）。
 *
 * 为什么单独成文件：`AI_DIALOG_GAP` 原先定义在 `AiAssistantDialog.tsx`（520 行组件）里，而
 * `features/editor/selectionToolbar/SelectionToolbar.tsx` 只用到这一个常量 ⇒ editor 的编译图被接到
 * ai 的**组件模块**上（06 报告 F-09）。常量下沉到这里后：
 * - `SelectionToolbar` 只 import 本文件（共享"数字"，不共享组件）；
 * - `AiAssistantDialog` 也从本文件取值（261112 R0 已迁，改值只改这里）。
 *
 * 口径：与 `usePopoverPosition` 的 gap 同值 —— 夹取与补空间必须用同一口径（见 AiAssistantDialog 注释）。
 */
export const AI_DIALOG_GAP = 8;
