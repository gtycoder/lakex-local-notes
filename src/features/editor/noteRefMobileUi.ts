/**
 * 移动端「文档引用」的 UI 注入面（261120 用户点单）。
 *
 * 为什么需要注册表：卡片由**内核自己的 React 树**渲染（拿不到应用 context），而移动端的弹层必须是
 * 底部 Sheet（可拖动调整高度）—— 桌面那套 `.ln-*` 锚定 Popover 在手机上就是「老旧小浮层 + 焦点抢键盘」。
 * 做法与 `setNoteRefHost` 同一姿势：移动端入口把组件注册进来，`noteRefCard` 只按「有没有注册」分流，
 * **不 import 任何 src/mobile 模块**（否则桌面包会把移动端 UI 拖进依赖图，check:arch 也会拦）。
 */
import type { ComponentType } from "react";
import type { NoteSummary } from "../../lib/types";
import type { NoteRefValue } from "./noteRef";

export interface NoteRefPickerProps {
  open: boolean;
  /** 选中一篇：只回填、不落库（与桌面同一语义，由调用方决定什么时候写卡片）。 */
  onPick: (note: NoteSummary) => void;
  onClose: () => void;
}

export interface NoteRefEditorProps {
  open: boolean;
  value: NoteRefValue;
  onSave: (next: NoteRefValue) => void;
  onClose: () => void;
}

export interface NoteRefMobileUi {
  /** 选文档：**打开即列出全部文档**、不聚焦任何输入框（用户 261120：不许默认拉起键盘）。 */
  Picker: ComponentType<NoteRefPickerProps>;
  /** 编辑「文本 / 链接」（桌面是锚定 `.ne-link-editor` 浮层；移动端走底部 Sheet）。 */
  Editor: ComponentType<NoteRefEditorProps>;
}

let current: NoteRefMobileUi | null = null;

export function setNoteRefMobileUi(ui: NoteRefMobileUi | null): void { current = ui; }
export function noteRefMobileUi(): NoteRefMobileUi | null { return current; }
