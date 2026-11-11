/**
 * 选区复制 / 剪切 → 我们自己的剪贴板内容（桌面与移动端、文档与写作卡共用**一套**语义）。
 *
 * 为什么要接管：内核默认把本地资产写成 `http://127.0.0.1:<port>/…` 或 ne-clipboard 片段，
 * 外部应用（微信 / Word / 浏览器）取不到图；这里统一走 clipboardHtml.buildClipboardPayload
 * —— 图片物化成 data URL（取**原图字节**，见 clipboardHtml.normalizeImage 的 ?base64=1 路径），
 * 纯文本按块级换行归一化。
 *
 * 只在**选区落在该宿主内**、非折叠、**且选区里真的有图片**时接管；其余（纯文字/表格/画板卡选区）
 * 交回内核 —— 内核写私有 `ne-clipboard` 片段，站内粘贴才能还原卡片语义；我们把整段 HTML 归一化后
 * 会丢掉这个片段（表格/画板/思维导图粘回来会降级），所以不能无条件接管。
 * 单一来源：LakeEditor（文档 + 移动端文档编辑器）与 QuickNoteEditor（小记写作卡）都挂这一份，
 * 不要再各写一遍 copy/cut 处理器。
 */
import { buildClipboardPayload } from "./clipboardHtml";

/** 选区里是否有 <img>（只有这时才需要我们把 127.0.0.1 资产物化成 data URL）。 */
function selectionHasImage(range: Range): boolean {
  const fragment = range.cloneContents();
  return Boolean(fragment.querySelector?.("img")) || Array.from(fragment.childNodes).some(
    (node) => node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "IMG",
  );
}

function selectionRangeIn(host: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return host.contains(range.commonAncestorContainer) ? range : null;
}

/** 给编辑宿主挂 copy/cut 接管；返回清理函数（随实例卸载调用）。 */
export function attachSelectionClipboard(host: HTMLElement): () => void {
  const onCopy = (event: ClipboardEvent): void => {
    const range = selectionRangeIn(host);
    if (!event.clipboardData || !range || !selectionHasImage(range)) return;
    try {
      const { html, plain } = buildClipboardPayload(range, document);
      event.clipboardData.setData("text/html", html);
      event.clipboardData.setData("text/plain", plain);
    } catch {
      // 物化失败（同步取图被拒/选区异常）⇒ 不拦，交回内核/浏览器默认复制（宁可拿原始内容，不写空）。
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onCut = (event: ClipboardEvent): void => {
    const range = selectionRangeIn(host);
    if (!event.clipboardData || !range || !selectionHasImage(range)) return;
    try {
      const { html, plain } = buildClipboardPayload(range, document);
      event.clipboardData.setData("text/html", html);
      event.clipboardData.setData("text/plain", plain);
    } catch {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    try { document.execCommand("delete"); } catch { /* 内核可能自行处理 */ }
  };
  host.addEventListener("copy", onCopy, true);
  host.addEventListener("cut", onCut, true);
  return () => {
    host.removeEventListener("copy", onCopy, true);
    host.removeEventListener("cut", onCut, true);
  };
}
