/**
 * bitable 内部「点非文本控件先让文本框真失焦」小工具（261119 用户点单 + lead 裁定收口）。
 *
 * 同型问题（表单录屏 form_005/011 证实、mobileBitablePointerFocus.render.test.tsx 钉住）：
 * 共享 ui/dismissKeyboard.dismissKeyboardOnPointerDown 对**任何** input 落点都早退放行 ⇒
 * 滑杆（input[type=range]，触屏不接焦点）不会让文本框真失焦，文本框保留 DOM 焦点（录屏里光标一直在），
 * Android 随后的交互把软键盘重新拉回文本框 —— 「文本框失焦后不能反复触发键盘」被破坏。
 *
 * 本工具把口径收紧为：落点是**文本**输入控件才放行（点文本框照常聚焦编辑），其它控件/空白
 * 一律先把当前文本焦点 blur 掉。只在 src/mobile/bitable/** 内使用（表单视图 / 记录编辑面板），
 * **不动**共享 util 的全局语义。
 */
import { dismissKeyboard } from "../ui/dismissKeyboard";

/** 非文本类 input（触屏可能不接焦点，落点在它们上面也要让文本框真失焦）。 */
const NON_TEXT_INPUT_TYPES = new Set(["range", "checkbox", "radio", "file", "color", "button", "submit", "reset", "image"]);

/** 落点是否在**文本输入**控件上（这类落点放行，交给浏览器正常聚焦/编辑）。 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  if (el.closest("textarea, [contenteditable='true']")) return true;
  const input = el.closest("input") as HTMLInputElement | null;
  return !!input && !NON_TEXT_INPUT_TYPES.has(input.type);
}

/** pointerdown 处理器：文本输入落点放行，其它落点先收当前文本焦点。 */
export function onBitablePointerDown(event: { target: EventTarget | null }): void {
  if (isTextEntryTarget(event.target)) return;
  dismissKeyboard();
}
