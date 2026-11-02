import { useEffect } from "react";

/**
 * 平板外接键盘快捷键（261102，仅 `expanded` 生效）——最小集：
 *   - ⌘/Ctrl+K 全局搜索
 *   - ⌘/Ctrl+F 文档内查找
 *   - N        新建文档（**只在非输入态**；有焦点在编辑器/输入框时不抢键）
 *   - Esc      关闭当前浮层（不改变编辑态；编辑态收起由各面板自己处理）
 *
 * 判据做成纯函数便于单测：`matchPadShortcut` 不碰 DOM，`isTypingTarget` 只做 closest 判断。
 * 手机（compact）不挂这个 hook —— 软键盘场景没有外接键盘语义。
 */
export type PadShortcutAction = "search" | "find" | "new-note" | "escape";

export interface PadShortcutEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  /** 焦点是否在可输入区域（编辑器/输入框/表格网格）。 */
  typing?: boolean;
}

export function matchPadShortcut(event: PadShortcutEventLike): PadShortcutAction | null {
  if (event.key === "Escape") return "escape";
  const mod = event.metaKey === true || event.ctrlKey === true;
  const key = event.key.toLowerCase();
  if (mod && key === "k") return "search";
  if (mod && key === "f") return "find";
  if (mod && key === "n") return "new-note";
  // 裸 N 只给"非输入态"：编辑正文时打 n 必须照常输入字母。
  if (!mod && !event.typing && key === "n") return "new-note";
  return null;
}

/** 焦点是否落在可输入区域（含内核 contenteditable 与表格 canvas 宿主）。 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as (HTMLElement | null);
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], .ne-engine, .ne-editor, .lake-editor-mount, .mobile-usheet-root');
}

/** 返回值约定：只有 Esc 关心 —— 返回 false = 「我这一层没东西可关」，不抢键（见下）。 */
export type PadShortcutHandler = () => void | boolean;

export interface PadShortcutHandlers {
  search?: PadShortcutHandler;
  find?: PadShortcutHandler;
  newNote?: PadShortcutHandler;
  escape?: PadShortcutHandler;
}

export function usePadShortcuts(enabled: boolean, handlers: PadShortcutHandlers): void {
  const { search, find, newNote, escape } = handlers;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const action = matchPadShortcut({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        typing: isTypingTarget(event.target),
      });
      if (!action) return;
      const handler = action === "search" ? search : action === "find" ? find : action === "new-note" ? newNote : escape;
      if (!handler) return;
      if (action === "escape") {
        // Esc 是「逐层收」：handler 返回 false = 这一层没东西可关 ⇒ **不 preventDefault**，
        // 让后注册的监听者继续收下一层（此前 MobileApp 无条件 preventDefault，把工作区的
        // 「Esc 收悬浮树/大纲」整条吃掉了 —— 261102 十三批实测：Esc 收得掉浮层、收不掉树）。
        if (handler() !== false) event.preventDefault();
        return;
      }
      event.preventDefault();
      handler();
    };
    // **捕获阶段**：内核在 window/document 冒泡阶段会对 Escape 调 preventDefault（实测：合成 keydown
    // defaultPrevented=true ⇒ 下面的守卫直接 return，平板 Esc 永远收不掉悬浮树/大纲）。捕获先跑，
    // 真键盘事件的目标是页面里的元素，所以这里总能先于内核看到尚未被 preventDefault 的事件。
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, search, find, newNote, escape]);
}
