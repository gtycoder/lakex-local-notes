/**
 * 非正文文本输入面（自研卡内 textarea / 各类 input）的「光标处插入」（261123）。
 *
 * 背景（用户 261123 现场）：在「加密文本」卡的 textarea 里打字 → dock「＋ → 表情」→ 选表情 ⇒
 * 内核 `insertAtSelection` 把**整卡**顶掉。官方语义（docs/lakexEditor-developer-docs 08 命令列表）：
 * 「如果选区非折叠，被选中的内容将会被替换为插入内容」——卡内输入面不是内核 contenteditable，
 * 光标在卡里时内核选区仍指着卡片 ⇒ 插入变成「替换整卡」。所以小文本（表情等）落在输入面时
 * 必须**直接插进输入面光标处**，完全不经过内核命令面。
 *
 * React 受控输入的接线口径：`setRangeText` 改 DOM 值后**必须**派发冒泡 `input` 事件——
 * React 18 的 onChange 由原生 input 事件驱动（值跟踪器只拦「直接赋 .value」的路径，
 * setRangeText 不经 setter ⇒ 事件里的 target.value 已是新值，onChange 照常触发）。
 */

/** 该元素是不是「文本输入面」（textarea / 文本类 input）；内核 contenteditable 宿主不算。 */
export function isTextEntryField(el: Element | null | undefined): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el || el.nodeType !== 1) return false;   // 1 = ELEMENT_NODE（写字面量：node 单测环境没有 Node 全局）
  const tag = (el as Element).tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    return type === "text" || type === "search" || type === "password" || type === "url" || type === "tel" || type === "email";
  }
  return false;
}

/** 当前聚焦的文本输入面（没有则 null）；用于「插入到正在输入的地方」这类分流。无 document（node 单测）恒 null。 */
export function activeTextEntryField(doc?: Document): HTMLInputElement | HTMLTextAreaElement | null {
  const d = doc ?? (typeof document !== "undefined" ? document : null);
  if (!d) return null;
  return isTextEntryField(d.activeElement) ? d.activeElement : null;
}

/** 在输入面**当前光标/选区处**插入文本（替换选区），光标落在插入内容之后；返回新光标位置。 */
export function insertTextIntoField(field: HTMLInputElement | HTMLTextAreaElement, text: string): number {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  field.setRangeText(text, start, end, "end");
  field.dispatchEvent(new Event("input", { bubbles: true }));
  return field.selectionStart ?? start + text.length;
}
