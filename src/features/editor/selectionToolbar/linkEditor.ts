/**
 * 链接编辑的共享实现 —— 桌面选区浮栏与移动端 dock 的**唯一来源**
 * （AGENTS §3#14「同一个交互语义全仓只能有一套」）。
 *
 * 为什么单独抽出来（261010 定的口径，261012 落地）：桌面原来把「捕获选区 → 还原 → 选 link/insertLink → 执行」
 * 写在 `SelectionToolbar.tsx` 里；移动端 dock 要加链接时必须复用同一套判定，**不允许**再写第二套链接 UI，
 * 也**不允许**直接 `execCommand("link", …)` 静默 no-op（选区不合法时内核只回 false、正文毫无变化）。
 *
 * 内核实测口径（261012 设备实测，见 LAKEX-CONTRACT §5.32）：
 *   - `link(url, true, true)` 包住当前选区；`insertLink(text, url, true, true)` 用于折叠光标；
 *   - 是否可用由 `queryCommandEnabled` 决定（选区整段已在链接里时 link=false、unlink=true）；
 *   - **确认前必须先把选区与焦点还给编辑器** —— 我们自己的输入框拿到焦点会让内核选区丢失、命令静默失败
 *     （桌面 260930 踩过，261012 在移动端复现）。
 */

/** 命令执行器：桌面 = `editor.execCommand`；移动端 dock = `renderer.execCommand`。 */
export type LinkCommandRunner = (name: string, ...args: unknown[]) => unknown;

/** 打开链接编辑器时捕获的选区（`cloneRange` 在失焦后仍可用于还原）。 */
export interface LinkEditorTarget {
  range: Range | null;
  /** 捕获时的选中文字（用于判断用户有没有改过文本）。 */
  selected: string;
}

export interface LinkEditorLike {
  execCommand?(name: string, ...args: unknown[]): unknown;
  queryCommandEnabled?(name: string): unknown;
}

/** 链接合法性（对齐内核固定栏「请输入正确的链接」）：有 scheme（http/https/mailto/tel）、以 / 或 # 开头，或形如域名。 */
export function isValidLink(value: string): boolean {
  return /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(value) || /^[^\s]+\.[^\s]+/.test(value);
}

/** 捕获当前选区（打开链接编辑器时调用）。 */
export function captureLinkTarget(selection?: Selection | null): LinkEditorTarget {
  const sel = selection ?? (typeof window !== "undefined" ? window.getSelection() : null);
  const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
  return { range, selected: range ? range.toString().trim() : "" };
}

/** 还原选区 + 把焦点还给编辑器（内核命令生效的前置条件）。 */
export function restoreLinkTarget(editor: LinkEditorLike, target: LinkEditorTarget): void {
  try {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (sel && target.range) { sel.removeAllRanges(); sel.addRange(target.range); }
    editor.execCommand?.("focus");
  } catch { /* 还原失败则按当前选区尽力执行 */ }
}

/**
 * 应用链接。
 *
 * 判定：有选区且文本未改 → 先试 `link`；文本改过或光标折叠 → 先试 `insertLink`；
 * 第一条被内核拒绝（返回 false）就换另一条，两条都被拒 ⇒ 返回 false（调用方**保持编辑器打开**，
 * 绝不假装成功，也绝不静默 no-op）。
 *
 * ⚠️ **为什么不拿 `queryCommandEnabled` 当门（261012 设备实测修正）**：移动端 WebView 里，
 * 「我们自己输入框拿了焦点 → 还原选区 → 立刻问 enabled」这条同步路径上 `queryCommandEnabled('link')`
 * **会返回 false，而紧接着执行 `link` 却完全成功**（同一时刻直接执行能写出 `<a href>`）。
 * 即描述符状态在内核选区尚未就绪时会误报。桌面浮栏历史上用 enabled 当门，在移动端会把**可用功能整个挡掉**
 * ⇒ 改为「按选区形态决定先后顺序 + 用命令自身的返回值判定成败」。
 *
 * 调用方的 `run` 必须**回传内核返回值**（true / false；`link` 回的是卡 id）——否则两条都会当成成功，
 * 退化成"静默 no-op"。
 */
export function applyTextLink(params: {
  editor: LinkEditorLike;
  /** 命令执行器（两端通道不同，必须由调用方给；**必须回传内核返回值**）。 */
  run: LinkCommandRunner;
  target: LinkEditorTarget;
  text: string;
  src: string;
}): boolean {
  const { editor, run, target } = params;
  const url = (params.src ?? "").trim();
  if (!url || !isValidLink(url)) return false;
  const selected = target.selected;
  const label = (params.text ?? "").trim();
  restoreLinkTarget(editor, target);
  /** 文本被改过 或 光标折叠（没有选中文字）⇒ 先试 insertLink。 */
  const preferInsert = !selected || (!!label && label !== selected);
  const linkArgs: [string, string, boolean, boolean] = ["link", url, true, true];
  const insertArgs: [string, string, string, boolean, boolean] = ["insertLink", label || selected || "链接", url, true, true];
  const attempts = preferInsert ? [insertArgs, linkArgs] : [linkArgs, insertArgs];
  for (const [name, ...args] of attempts) {
    const result = run(name, ...args);
    if (result === false) continue;   // 内核明确拒绝这条 ⇒ 换另一条
    return true;                      // true / 卡 id 都算内核接受了这次调用
  }
  return false;
}
