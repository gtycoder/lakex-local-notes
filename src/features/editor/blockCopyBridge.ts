/**
 * 块菜单「复制」→ 应用侧复制管线（与正文 ⌘C 完全同一套）。
 *
 * 背景（261106 用户报）：**块级多选**（跨多个顶层块拖选）后点块手柄菜单的「复制」，
 * 图文混排粘到微信会**图裂**；同样选区按 ⌘C 正常。
 *
 * 根因：两条链路不同。
 *   ① ⌘C = 浏览器的 copy 事件 ⇒ 被 EditorTab / LakeEditor 的捕获处理器接管，
 *      经 `buildClipboardPayload`（= normalizeClipboardHtml）把本地资产物化成 base64、
 *      清掉内核隐藏节点，再写剪贴板；
 *   ② 块菜单「复制」= vendor `copyDomBlock` → 内核 `renderer.execCommand("copy", range)`，
 *      内核直接写它自己的剪贴板（HTML 里图片仍是 `http://127.0.0.1:19876/…` 本地地址，
 *      也没有 base64）⇒ 外部应用（微信/Word）拿不到图 ⇒ 图裂。
 *
 * 修法（不改内核、不 patch vendor）：多块选区时**拦下**块菜单「复制」这一下点击，
 * 取当前 DOM 选区（与 ⌘C 同源；块菜单 mousedown 不会清掉它），拿不到时回退到多块高亮
 * （`.ne-brick-highlight`）重建与 vendor `selectBlocksInEditor` 相同的 Range；然后把该 Range
 * 设成浏览器选区执行一次 `document.execCommand("copy")` ⇒ 走回 ① 的 copy 事件处理器
 * ⇒ 剪贴板内容与 ⌘C 逐字节一致。
 * **单块**分两类处理（261106 A/B 实测后定稿）：
 *   · 单张图片块（菜单「复制」/「复制图片」）⇒ 改走 `native.copyAssetImage`（与 ⌘C 图片复制
 *     同一入口，剪贴板是 `image/png` 位图）：外部应用唯一可用形态，且回粘 Lake 正文只 +≈0.8KB；
 *   · 单块文本 ⇒ 不接管（没有非折叠 DOM 选区；保持 vendor 内核 `ne-clipboard` 原生格式，
 *     保证 Lake→Lake 回粘保真）。
 *
 * 多块选区（≥2 个高亮块）才走 HTML copy 事件链路；单图片块走位图。
 */
import { buildClipboardPayload } from "./clipboardHtml";
import { native } from "../../lib/native";
import { reportNativeActionError } from "../../lib/nativeErrors";
import { parseAssetRef } from "./selectionToolbar/selectionToolbarModel";

const MENU_ROOT = ".ne-block-context-menu";
const MENU_ITEM = ".ne-block-menu-item";
const MENU_LABEL = ".ne-block-menu-label";
const HIGHLIGHT_CLASS = "ne-brick-highlight";
const HIGHLIGHT_EXTEND_PROP = "--ln-brick-hl-extend";
const COPY_LABEL = "复制";
/** 图片卡块的菜单文案与普通块不同（见 vendor BlockContextMenu 的卡片菜单表）。 */
const COPY_IMAGE_LABEL = "复制图片";
const SINGLE_IMAGE_LABELS = new Set([COPY_LABEL, COPY_IMAGE_LABEL]);

/** 菜单项文字（「复制」vs「复制代码/复制图片/复制表格」靠它区分）。 */
function menuItemLabel(item: Element): string {
  return (item.querySelector(MENU_LABEL)?.textContent ?? "").trim();
}

/** 当前浏览器选区（要求非折叠且落在编辑器容器内）；无则 null。与 ⌘C 用同一份选区。 */
export function selectionRangeIn(container: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  return range;
}

/** 当前多块选区高亮的块（vendor 在多块选区成立时即打 class，文档顺序）。 */
export function highlightedBlocks(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("." + HIGHLIGHT_CLASS));
}

/** Lake 顶层块元素（用于判断选区是否跨块；不依赖 vendor 高亮是否还在）。 */
const BLOCK_SELECTOR = "ne-p, ne-h1, ne-h2, ne-h3, ne-h4, ne-h5, ne-h6, ne-ul, ne-ol, ne-li, ne-blockquote, ne-code-block, ne-table, ne-card, ne-l";

function blockAncestor(node: Node | null): Element | null {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element ? element.closest(BLOCK_SELECTOR) : null;
}

/**
 * 选区是否**跨多个顶层块**（不依赖 vendor 高亮是否还在）。
 *
 * 为什么需要它：单块内选中文字后点块菜单「复制」时，vendor 会走它自己的单块复制；
 * 只有跨块选区才应被本桥接管（复用 ⌘C 管线）。最初实现只要"有非折叠选区"就接管，
 * 导致**单块文字复制**被误接管：菜单项此时是 activeElement，execCommand("copy") 的 copy 事件
 * 不经过编辑器宿主 ⇒ 剪贴板没写进去（用户 261107 报「单块文字复制失效」）。
 */
export function selectionSpansBlocks(container: HTMLElement, range: Range): boolean {
  const pick = (node: Node, offset: number, isEnd: boolean): Element | null => {
    if (node === container) {
      const children = container.childNodes;
      const index = isEnd ? Math.max(0, Math.min(offset - 1, children.length - 1)) : Math.min(offset, children.length - 1);
      let child: ChildNode | null = children[index] ?? null;
      while (child && child.nodeType !== Node.ELEMENT_NODE) child = child.nextSibling;
      return blockAncestor(child);
    }
    return blockAncestor(node);
  };
  const start = pick(range.startContainer, range.startOffset, false);
  const end = pick(range.endContainer, range.endOffset, true);
  if (!start || !end) return false;
  if (start === end) return false;
  return container.contains(start) && container.contains(end);
}

/**
 * 单张图片块（恰好 1 个高亮块、块内含一张**本地资产图**）→ 资产引用；否则 null。
 * 用于把「单图片块菜单复制」接到与 ⌘C 图片复制同一个入口（位图），
 * 避免内核路径往剪贴板写 `127.0.0.1` 本地 URL / `ne-clipboard`（外部应用取不到图）。
 */
export function singleImageAsset(container: HTMLElement): { noteId: string; filename: string } | null {
  const blocks = highlightedBlocks(container).filter((block) => block.isConnected);
  if (blocks.length !== 1) return null;
  const img = blocks[0].querySelector("img");
  if (!img) return null;
  return parseAssetRef(img.getAttribute("src") ?? "");
}

/** 与 vendor `selectBlocksInEditor` 同口径：首块之前 → 末块之后。 */
export function blocksRange(blocks: HTMLElement[]): Range {
  const range = document.createRange();
  range.setStartBefore(blocks[0]);
  range.setEndAfter(blocks[blocks.length - 1]);
  return range;
}

/** 临时把浏览器选区设成 range 后执行 copy 命令（触发既有 copy 捕获处理器），最后恢复原选区。 */
function copyRangeThroughCopyEvent(range: Range, selection: Selection): boolean {
  const previous: Range[] = [];
  for (let i = 0; i < selection.rangeCount; i += 1) previous.push(selection.getRangeAt(i).cloneRange());
  selection.removeAllRanges();
  selection.addRange(range);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  selection.removeAllRanges();
  for (const saved of previous) {
    try { selection.addRange(saved); } catch { /* 忽略：原选区可能已失效 */ }
  }
  return copied;
}

/** 兜底：copy 命令不可用（非用户手势/环境限制）时直接写 Clipboard API，内容仍取同一份 payload。 */
function writeClipboardPayloadApi(range: Range): void {
  try {
    const { html, plain } = buildClipboardPayload(range.cloneRange(), document);
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return;
    void navigator.clipboard
      .write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([plain], { type: "text/plain" }) })])
      .catch(() => undefined);
  } catch {
    /* 忽略：复制失败不应打断交互 */
  }
}

/**
 * 直接把 payload 写进剪贴板（261107 单块文字修复）。
 *
 * 为什么不能走 `execCommand("copy")`：块菜单项是 activeElement，copy 事件不经过编辑器宿主，
 * 编辑器里的 copy 捕获处理器收不到 ⇒ 剪贴板没内容。这里用 Clipboard API 直写 html+plain
 * （异步，不依赖焦点），失败再退 writeText / 经典 textarea+execCommand（两者都不依赖焦点路径）。
 */
function writePayloadDirect(range: Range): void {
  let payload: { html: string; plain: string };
  try {
    payload = buildClipboardPayload(range.cloneRange(), document);
  } catch {
    return;
  }
  const writeViaTextarea = (): boolean => {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = payload.plain;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      textarea.remove();
      return ok;
    } catch {
      return false;
    }
  };
  void (async () => {
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([payload.html], { type: "text/html" }),
            "text/plain": new Blob([payload.plain], { type: "text/plain" }),
          }),
        ]);
        return;
      }
    } catch { /* 回退 */ }
    try {
      if (navigator.clipboard?.writeText && payload.plain) {
        await navigator.clipboard.writeText(payload.plain);
        return;
      }
    } catch { /* 回退 */ }
    writeViaTextarea();
  })();
}

/** 清掉我们借用的多块高亮（与 vendor `setBlockHighlight(false)` 同一份清理，避免残留背景）。 */
function clearHighlight(blocks: HTMLElement[]): void {
  for (const block of blocks) {
    block.classList.remove(HIGHLIGHT_CLASS);
    block.style.removeProperty(HIGHLIGHT_EXTEND_PROP);
  }
}

/** 关掉块菜单（vendor 在 document 上监听 Escape）。 */
function closeBlockMenu(): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

/**
 * 在编辑器容器上挂「块菜单复制」桥。
 * @param container 编辑器实例挂载点（`.lake-editor-mount`）：高亮块只在这个范围内找。
 * @returns 卸载函数（随编辑器销毁）。
 */
export function attachBlockCopyBridge(container: HTMLElement): () => void {
  /** 菜单项按下瞬间的选区快照：menu mousedown 可能触发 vendor 的清选区/清高亮逻辑，click 时再取可能已丢。 */
  let pressedRange: Range | null = null;
  /** 最近悬停/按下的顶层块：单块菜单复制时即使选区被 vendor 清掉，也能确定"复制哪一块"。 */
  let activeBlock: HTMLElement | null = null;
  /**
   * 最近悬停/按下的图片元素（与 `imageCopyBridge` 同一思路）。
   * 为什么必须独立跟踪：块菜单 mousedown 会触发 vendor 的 document 捕获清理
   * （清 `.ne-brick-highlight`/收起手柄），到 click 时高亮可能已经没了 —— 只靠高亮会漏掉单图路径。
   */
  let activeImage: HTMLImageElement | null = null;

  const trackImage = (target: Element | null): void => {
    if (!target || typeof target.closest !== "function") return;
    const img = target instanceof HTMLImageElement ? target : target.closest("img");
    if (img instanceof HTMLImageElement && container.contains(img) && parseAssetRef(img.getAttribute("src") ?? "")) {
      activeImage = img;
    }
  };

  const onMouseOver = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    trackImage(target);
    const block = target && typeof target.closest === "function" ? target.closest<HTMLElement>(BLOCK_SELECTOR) : null;
    if (block && container.contains(block)) activeBlock = block;
  };

  const onMouseDown = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== "function") return;
    trackImage(target);
    // 任意 mousedown 都先快照选区：块手柄点击/menu mousedown 之后 vendor 会清选区或高亮，
    // click 时再取就没了（单块文字复制失效的直接原因）。
    const live = selectionRangeIn(container);
    if (live) pressedRange = live.cloneRange();
    const block = target.closest<HTMLElement>(BLOCK_SELECTOR);
    if (block && container.contains(block)) activeBlock = block;
  };

  const onClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== "function") return;
    const item = target.closest(MENU_ITEM);
    if (!item || !item.closest(MENU_ROOT)) return;
    const label = menuItemLabel(item);
    if (!SINGLE_IMAGE_LABELS.has(label)) return;
    const blocks = highlightedBlocks(container).filter((block) => block.isConnected);
    // ---- 多块（图文混排）优先：只有「复制」这个文案存在多块语义 ----
    if (label === COPY_LABEL) {
      // 选区来源与 ⌘C 完全一致：优先取当前 DOM 选区；拿不到时回退到按下瞬间的快照，再退化为多块高亮重建。
      const snapshot = pressedRange && pressedRange.commonAncestorContainer.isConnected ? pressedRange.cloneRange() : null;
      let range: Range | null = selectionRangeIn(container) ?? snapshot;
      if (!range && blocks.length >= 2) {
        try { range = blocksRange(blocks); } catch { range = null; }
      }
      const multiBlock = !!range && (blocks.length >= 2 || selectionSpansBlocks(container, range));
      if (range && multiBlock && container.contains(range.commonAncestorContainer)) {
        const selection = window.getSelection();
        if (selection) {
          pressedRange = null;
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          const copied = copyRangeThroughCopyEvent(range, selection);
          if (!copied) writeClipboardPayloadApi(range);
          clearHighlight(blocks);
          closeBlockMenu();
          return;
        }
      }
    }
    // ---- 单块文字（放在图片分支之前：有选区/快照能确定文字块时优先复制文字）----
    const live = selectionRangeIn(container);
    const snapshotRange = pressedRange && pressedRange.commonAncestorContainer.isConnected ? pressedRange.cloneRange() : null;
    const usableRange = live ?? snapshotRange;
    const liveBlock = usableRange && !selectionSpansBlocks(container, usableRange)
      ? blockAncestor(usableRange.startContainer)
      : null;
    const singleBlock = blocks[0] ?? (liveBlock && container.contains(liveBlock) ? liveBlock : null)
      ?? (activeBlock && activeBlock.isConnected && container.contains(activeBlock) ? activeBlock : null);
    const singleBlockHasLocalImage = (() => {
      const img = singleBlock?.querySelector("img");
      return !!img && !!parseAssetRef(img.getAttribute("src") ?? "");
    })();
    if (singleBlock && !singleBlockHasLocalImage) {
      const range = usableRange && blockAncestor(usableRange.startContainer) === singleBlock
        ? usableRange.cloneRange()
        : (() => { try { return blocksRange([singleBlock]); } catch { return null; } })();
      if (range && container.contains(range.commonAncestorContainer)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        pressedRange = null;
        activeImage = null;
        writePayloadDirect(range);
        clearHighlight(blocks);
        closeBlockMenu();
        return;
      }
    }
    // ---- 单张图片块：与 ⌘C 图片复制同一个入口（native.copyAssetImage → 位图）----
    const tracked = activeImage && activeImage.isConnected && container.contains(activeImage)
      && (!activeBlock || activeBlock.contains(activeImage))
      ? activeImage : null;
    const trackedRef = tracked ? parseAssetRef(tracked.getAttribute("src") ?? "") : null;
    const imageRef = trackedRef ?? singleImageAsset(container);
    if (imageRef && typeof native.copyAssetImage === "function") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      pressedRange = null;
      activeImage = null;
      void native.copyAssetImage(imageRef.noteId, imageRef.filename).catch((error) => reportNativeActionError("复制图片", error));
      clearHighlight(blocks);
      closeBlockMenu();
      return;
    }
    // 其他单块（缺块信息等）：不接管，保持 vendor 原生行为。
    pressedRange = null;
  };
  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("click", onClick, true);
  return () => {
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("click", onClick, true);
  };
}
