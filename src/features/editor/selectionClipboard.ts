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
 * 不要再各写一遍 copy/cut 处理器。唯一例外 = 桌面 `EditorTab` 的独立 copy 管线（**显式契约例外**，
 * 全量接管待裁决点 C；但 cut 删除两套管线同走 deleteSelectionKernelFirst，见下）。
 */
import { buildClipboardPayload } from "./clipboardHtml";
import { matrixFromTableElement, payloadFromMatrix, tableIndexInHost, tableMatrixFromBody } from "./tableClipboardModel";

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

/**
 * 剪贴板里的**位图**（261121 用户现场：复制 GIF 到微信没问题，但 DSH / Codex 不能用；
 * 在访达里复制同一个文件它们就能用 —— 说明它们读的是系统剪贴板的**图片**，不是 text/html）。
 *
 * 做法：从即将写入的 HTML 里取第一张 data URL 图 → 原字节 Blob；非 PNG（GIF/WebP/JPEG）用 canvas
 * 转成 PNG（位图消费者只需要一帧；text/html 里的原图 data URL 保持不变，微信仍拿动图）。
 * 转不出来（无 canvas / 无图）返回 null ⇒ 调用方退回原来的「只有文本」行为。
 */
export async function clipboardImageBlob(html: string): Promise<Blob | null> {
  const match = /src="(data:image\/[a-z0-9.+-]+;base64,[^"]+)"/i.exec(html);
  if (!match) return null;
  let buffer: ArrayBuffer;
  let mime: string;
  try {
    const [, meta, base64] = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(match[1]) ?? [];
    if (!meta || !base64) return null;
    mime = meta.toLowerCase();
    const binary = atob(base64);
    buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  } catch {
    return null;
  }
  if (mime === "image/png") return new Blob([buffer], { type: "image/png" });
  // Chromium 的系统剪贴板只接受 image/png ⇒ 非 PNG 用 canvas 转一帧。
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  try {
    const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
    const image = await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      let settled = false;
      const done = (value: HTMLImageElement | null) => { if (settled) return; settled = true; resolve(value); };
      // 解码卡住（坏图/无解码器）也必须收口：复制是交互动作，不能挂在这里。
      const timer = setTimeout(() => done(null), 1200);
      img.onload = () => { clearTimeout(timer); done(img); };
      img.onerror = () => { clearTimeout(timer); done(null); };
      img.src = url;
    });
    if (!image || image.naturalWidth <= 0 || image.naturalHeight <= 0) { URL.revokeObjectURL(url); return null; }
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) { URL.revokeObjectURL(url); return null; }
    context.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), "image/png"));
    return blob ?? null;
  } catch {
    return null;
  }
}

/** 把文本 + 位图一起写进系统剪贴板（异步 API；不可用/失败时静默保留事件里已写的文本）。 */
async function writeRichClipboard(html: string, plain: string): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") return;
    const items: Record<string, Blob> = {
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plain], { type: "text/plain" }),
    };
    const image = await clipboardImageBlob(html);
    if (image) items["image/png"] = image;
    await navigator.clipboard.write([new ClipboardItem(items)]);
  } catch {
    /* 异步剪贴板不可用：事件里已写的 text/html + text/plain 仍在，行为与改动前一致 */
  }
}

/**
 * 判断选区是否落在「整张表格」上（261122 现场：内核复制文档表格卡只写第一个单元格的一段文字，
 * 表格数据根本没进剪贴板）。只有整表/多格选择才接管；单元格里选文字不接管。
 */
export function selectedTableForClipboard(host: HTMLElement): HTMLTableElement | null {
  const selection = typeof window !== "undefined" ? window.getSelection() : null;
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    try {
      const fragment = selection.getRangeAt(0).cloneContents();
      const cloned = fragment.querySelector?.("table.ne-table, table.lake-table");
      if (cloned) return cloned as HTMLTableElement;
    } catch { /* 跨节点选区异常：走伪选择判据 */ }
  }
  const fakeTable = host.querySelector<HTMLTableElement>('table.ne-table[ne-fake-table-selection="true"], table.lake-table[ne-fake-table-selection="true"]');
  if (fakeTable) return fakeTable;
  const fakeCell = host.querySelector<HTMLElement>('td.ne-td[ne-fake-cell-selection="true"]');
  return (fakeCell?.closest("table.ne-table, table.lake-table") as HTMLTableElement | null) ?? null;
}

/** 写表格载荷到系统剪贴板（keydown 路径用；内核不走 DOM copy 事件）。失败静默。 */
async function writeTableClipboard(payload: { html: string; plain: string }): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([payload.html], { type: "text/html" }),
        "text/plain": new Blob([payload.plain], { type: "text/plain" }),
      })]);
      return;
    }
  } catch { /* 落到下面的 execCommand 回退 */ }
  try {
    const area = document.createElement("textarea");
    area.value = payload.plain;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  } catch { /* 两条路都失败：本次复制不生效（内核可能已写了自己的内容） */ }
}

/**
 * 只接管「整表/多格选择」的复制（261122）：**独立可挂**，因为文档编辑器 `EditorTab` 有自己的 copy 管线
 * （不走 attachSelectionClipboard）——这是**显式契约例外**（全量接管是外发微信/Word 的历史口径，
 * 语义是否合并 = 裁决点 C，未裁决前不合并、也不算漂移）。两个宿主都挂这一份，避免再写第二套。
 * 数据源 = **内核正文**（`getBody`）：表格是虚拟渲染的，DOM 里只有视口附近的行。
 */
export function attachTableCopy(host: HTMLElement, getBody?: () => string | null): () => void {
  const payloadOf = (table: HTMLTableElement): { html: string; plain: string } | null => {
    try {
      const index = tableIndexInHost(host, table);
      const fromBody = getBody ? tableMatrixFromBody(getBody(), index) : null;
      const matrix = fromBody ?? matrixFromTableElement(table);
      return matrix ? payloadFromMatrix(matrix) : null;
    } catch { return null; }
  };
  const onCopy = (event: ClipboardEvent): void => {
    if (!event.clipboardData) return;
    const table = selectedTableForClipboard(host);
    if (!table || !table.rows?.length) return;
    const payload = payloadOf(table);
    if (!payload) return;
    event.clipboardData.setData("text/html", payload.html);
    event.clipboardData.setData("text/plain", payload.plain);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() !== "c") return;
    // 内核整表选择时焦点可能落在 body（实测）⇒ 只按 event.target/activeElement 过滤会漏掉真实场景。
    const table = selectedTableForClipboard(host);
    if (!table || !table.rows?.length || !host.contains(table)) return;
    const payload = payloadOf(table);
    if (!payload) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void writeTableClipboard(payload);
  };
  host.addEventListener("copy", onCopy, true);
  window.addEventListener("keydown", onKeyDown, true);
  return () => {
    host.removeEventListener("copy", onCopy, true);
    window.removeEventListener("keydown", onKeyDown, true);
  };
}

/**
 * cut 后删除选区的**统一删除实现**（260917 实测：`document.execCommand("delete")` 只删 DOM、
 * 内核模型不变，点块即被重绘回来）——必须先走内核命令让模型同步，DOM 删除仅作兜底。
 * 桌面 EditorTab 的 cutHandler 与共享桥的 deleteSelection 回调同走这一份，别再内联第二份判据。
 * 入参 = 编辑器命令面（kernel/execCommand 子集，见 lakeRuntime.LakeEditorInstance）。
 */
export function deleteSelectionKernelFirst(
  editor: { kernel?: { execCommand?(name: string, ...args: unknown[]): unknown }; execCommand?(name: string, ...args: unknown[]): unknown } | null | undefined,
): void {
  try {
    // 删除必须走内核命令（与 style/insertCard 同一入口），内核模型才会同步
    if (editor?.kernel?.execCommand) editor.kernel.execCommand("delete");
    else if (editor?.execCommand) editor.execCommand("delete");
    else document.execCommand("delete");
  } catch {
    try { document.execCommand("delete"); } catch { /* 内核可能自行处理 */ }
  }
}

export interface SelectionClipboardOptions {
  /**
   * cut 写完剪贴板后的删除回调：宿主传 deleteSelectionKernelFirst 的「内核优先」实现
   * （`() => deleteSelectionKernelFirst(editorRef.current)`）；缺省 = 仅 DOM 兜底（等价旧行为）。
   */
  deleteSelection?: () => void;
}

/** 给编辑宿主挂 copy/cut 接管；返回清理函数（随实例卸载调用）。 */
export function attachSelectionClipboard(host: HTMLElement, options: SelectionClipboardOptions = {}): () => void {
  // 表格复制 = 与 EditorTab 共用的同一份接管（这里组合进来，避免两处各写一份）。
  const detachTableCopy = attachTableCopy(host);
  const onCopy = (event: ClipboardEvent): void => {
    if (!event.clipboardData) return;
    const range = selectionRangeIn(host);
    if (!event.clipboardData || !range || !selectionHasImage(range)) return;
    let payload: { html: string; plain: string };
    try {
      payload = buildClipboardPayload(range, document);
      event.clipboardData.setData("text/html", payload.html);
      event.clipboardData.setData("text/plain", payload.plain);
    } catch {
      // 物化失败（同步取图被拒/选区异常）⇒ 不拦，交回内核/浏览器默认复制（宁可拿原始内容，不写空）。
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    // 再把**位图**补进系统剪贴板（DSH/Codex 这类程序读图片，不读 HTML）。失败不影响上面的文本。
    void writeRichClipboard(payload.html, payload.plain);
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
    // 删除走「内核命令优先、DOM 兜底」的统一实现（deleteSelectionKernelFirst）：
    // 只删 DOM 时内核模型不变，点块即被重绘回来（260917 实测，editorCut.test.ts 钉住）。
    try { (options.deleteSelection ?? ((): void => deleteSelectionKernelFirst(null)))(); } catch { /* 内核可能自行处理 */ }
  };
  host.addEventListener("copy", onCopy, true);
  host.addEventListener("cut", onCut, true);
  return () => {
    detachTableCopy();
    host.removeEventListener("copy", onCopy, true);
    host.removeEventListener("cut", onCut, true);
  };
}