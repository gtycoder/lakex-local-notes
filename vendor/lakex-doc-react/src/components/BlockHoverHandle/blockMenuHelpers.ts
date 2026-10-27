// src/components/BlockHoverHandle/blockMenuHelpers.ts
//
// 块操作菜单用到的 DOM / 编辑器辅助函数。
// 原定义于 LakexEditor.tsx，为把菜单逻辑整体收敛到 BlockHoverHandle 文件夹而迁移至此。

/** 在编辑器中选中某个块节点（全选其内容） */
export function selectBlockInEditor(editor: any, blockElement: HTMLElement): boolean {
  try {
    const domRange = document.createRange();
    domRange.selectNodeContents(blockElement);
    const modelRange = editor?.engine?.transformDOMRange?.(domRange);
    if (!modelRange) return false;
    editor.kernel.execCommand("selection", {
      focus: "end",
      anchor: "start",
      ranges: [modelRange],
    });
    return true;
  } catch {
    return false;
  }
}

/** 列表项标签：无序/有序/任务项在 DOM 里分别是 NE-ULI / NE-OLI / NE-TLI。 */
const LIST_ITEM_TAG_RE = /^NE-(ULI|OLI|TLI)$/;

/** 列表项缩进层级：内核渲染在 `ne-level` 上（缺省 = 0）。 */
function listItemLevel(el: HTMLElement): number {
  const level = Number(el.getAttribute("ne-level") || 0);
  return Number.isFinite(level) ? level : 0;
}

/** 列表族（无序/有序/任务），用于判断连续项是否属于同一列表。 */
function listItemFamily(el: HTMLElement): string {
  const content = el.querySelector("ne-uli-c, ne-oli-c, ne-tli-c");
  return (content ? content.tagName : el.tagName).toLowerCase();
}

/**
 * LOCAL-CHANGE(260917)：把一个块**作为一个整体**覆盖的顶层元素列出来。
 *
 * 云端语义「父项手柄代表整个条目（含子项）」：列表父项 = 自身 + 紧随其后、层级更深的同族项。
 * DOM 里内核把所有列表项都渲染成 `.ne-engine` 的**平级子节点**，嵌套只体现在 `ne-level`
 * （子项 level 更大），所以这里无需读整篇 JSON，纯 DOM 即可算出「父项 + 子项」区间。
 * 非列表块返回自身单元素。
 */
export function blockSpanElements(blockElement: HTMLElement | null): HTMLElement[] {
  if (!blockElement) return [];
  if (!LIST_ITEM_TAG_RE.test(blockElement.tagName)) return [blockElement];
  const baseLevel = listItemLevel(blockElement);
  const family = listItemFamily(blockElement);
  const span = [blockElement];
  let sibling = blockElement.nextElementSibling as HTMLElement | null;
  while (
    sibling
    && LIST_ITEM_TAG_RE.test(sibling.tagName)
    && listItemFamily(sibling) === family
    && listItemLevel(sibling) > baseLevel
  ) {
    span.push(sibling);
    sibling = sibling.nextElementSibling as HTMLElement | null;
  }
  return span;
}

/** 整块（含列表子项）的 DOM range：首元素之前 → 末元素之后（非折叠）。 */
function spanDomRange(span: HTMLElement[]): Range {
  const range = document.createRange();
  range.setStartBefore(span[0]);
  range.setEndAfter(span[span.length - 1]);
  return range;
}

/**
 * 选中整块（含列表子项）作为内核选区。
 * 单元素沿用 `selectBlockInEditor`（选中内容）；多元素（列表父项+子项）用跨元素 outer range，
 * 内核把它当「块选区」，`getSelectionContent` / `deleteByRange` / `insertAtSelection` 均按整段处理。
 */
export function selectBlockSpanInEditor(editor: any, blockElement: HTMLElement): boolean {
  const span = blockSpanElements(blockElement);
  if (!span.length) return false;
  if (span.length === 1) return selectBlockInEditor(editor, blockElement);
  try {
    const modelRange = editor?.engine?.transformDOMRange?.(spanDomRange(span));
    if (!modelRange) return false;
    editor.kernel.execCommand("selection", { focus: "end", anchor: "start", ranges: [modelRange] });
    return true;
  } catch {
    return false;
  }
}

/**
 * 编辑（替换/改样式）前的选中口径：多元素 span（列表父项+子项）用整段 outer range，
 * 单元素沿用「选中块内容」。否则转化只会作用到父项那一行、子项被落下。
 */
function selectWholeBlockForEdit(editor: any, blockElement: HTMLElement): boolean {
  if (blockSpanElements(blockElement).length > 1) return selectBlockSpanInEditor(editor, blockElement);
  return selectBlockInEditor(editor, blockElement);
}

/** 顶层块标签（手柄 BLOCK_TAGS 里可作 .ne-engine 直接子级的块）。 */
const TOP_BLOCK_TAGS = new Set([
  "NE-P", "NE-H1", "NE-H2", "NE-H3", "NE-H4", "NE-H5", "NE-H6",
  "NE-QUOTE", "NE-TLI", "NE-OLI", "NE-ULI",
  "NE-CARD", "NE-HOLE", "NE-ALERT-HOLE", "NE-CONTAINER-HOLE",
  "NE-CODEBLOCK", "NE-HR", "NE-TABLE-HOLE",
  "NE-IMAGE", "NE-VIDEO", "NE-AUDIO", "NE-FILE", "NE-CALLOUT",
]);

function engineOfNode(node: Node | null): HTMLElement | null {
  let el: Node | null = node;
  if (el && !(el instanceof Element)) el = (el as Node).parentNode;
  while (el instanceof HTMLElement) {
    if (el.classList.contains("ne-engine")) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * 选区所在的「块容器」：默认 `.ne-engine`；若选区两端都落在**同一个引用**内部，
 * 容器就是该 `ne-quote` —— 引用内部的每个 brick 也是可独立编辑的顶层块。
 * LOCAL-CHANGE(261004)：云端引用内的段落/列表各自出柄，且能在引用内跨项多选；
 * 原实现只扫 `.ne-engine` 的直接子级，落在引用内的选区永远识别不到。
 */
function blockContainerOfRange(range: Range): HTMLElement | null {
  const engine = engineOfNode(range.startContainer) || engineOfNode(range.endContainer);
  if (!engine) return null;
  const toEl = (node: Node | null): HTMLElement | null => {
    if (node instanceof HTMLElement) return node;
    // Node.parentElement 在这些 lib 类型里是 Element | null，显式收窄到 HTMLElement。
    return (node?.parentElement ?? null) as HTMLElement | null;
  };
  // Element.closest 返回 Element | null，显式收窄到 HTMLElement。
  const startQuote = (toEl(range.startContainer)?.closest("ne-quote") ?? null) as HTMLElement | null;
  const endQuote = (toEl(range.endContainer)?.closest("ne-quote") ?? null) as HTMLElement | null;
  if (startQuote && startQuote === endQuote && startQuote.parentElement === engine) {
    return startQuote;
  }
  return engine;
}

/**
 * LOCAL-CHANGE(260917 Issue 4)：当前 DOM 选区覆盖的顶层块（文档顺序）。
 * 用户跨块拖选时内核会同步模型选区，getSelectionContent / deleteByRange / insertAtSelection
 * 都按整个选区工作 —— 这就是内核原生的「批量」能力，无需自己逐块搬运。
 */
export function selectedTopBlocks(): HTMLElement[] {
  if (typeof window === "undefined") return [];
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];
  const range = selection.getRangeAt(0);
  const container = blockContainerOfRange(range);
  if (!container) return [];
  // LOCAL-CHANGE(261004)：按选区**端点**取首/末顶层块、再取两者之间的连续块 —— O(选区跨度)，
  // 而不是 O(文档全部块)。该函数如今在 mousemove（块句柄触发路径）上被调用，必须廉价。
  const childIndex = (node: Node | null): number => {
    let el: HTMLElement | null = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
    while (el && el.parentElement !== container) el = el.parentElement;
    if (!el || el.parentElement !== container) return -1;
    return Array.prototype.indexOf.call(container.children, el);
  };
  // 端点可能直接落在容器本身（setStartBefore/setEndAfter）：offset 就是子索引
  // （end 的 offset 指向「之后」，故减 1）。
  const startIdx = range.startContainer === container ? range.startOffset : childIndex(range.startContainer);
  const endIdx = range.endContainer === container ? range.endOffset - 1 : childIndex(range.endContainer);
  if (startIdx < 0 && endIdx < 0) return [];
  const from = Math.max(0, startIdx < 0 ? 0 : startIdx);
  const to = Math.min(container.children.length - 1, endIdx < 0 ? container.children.length - 1 : endIdx);
  const out: HTMLElement[] = [];
  for (let i = from; i <= to; i += 1) {
    const el = container.children[i];
    if (el instanceof HTMLElement && TOP_BLOCK_TAGS.has(el.tagName.toUpperCase())) out.push(el);
  }
  return out;
}

/**
 * 当前是否「多块选区」：覆盖 ≥2 个顶层块，且不属于同一个列表父项整段。
 * 后者（父项 + 子项）按 Issue 3 的「一个整块」处理，不当多选。
 */
export function hasMultiBlockSelection(): boolean {
  const blocks = selectedTopBlocks();
  if (blocks.length < 2) return false;
  const span = blockSpanElements(blocks[0]);
  return !blocks.every((block) => span.indexOf(block) >= 0);
}

/**
 * LOCAL-CHANGE(260917 Issue 4)：把一组顶层块重新设为内核选区。
 * 用途：点击手柄会先让编辑区失焦、选区被浏览器清掉；菜单动作执行前用它把选区「还原」，
 * 之后 getSelectionContent / deleteByRange / insertAtSelection 仍按整段选区批量工作。
 */
export function selectBlocksInEditor(editor: any, blocks: HTMLElement[]): boolean {
  if (!editor || !blocks.length) return false;
  try {
    const range = document.createRange();
    range.setStartBefore(blocks[0]);
    range.setEndAfter(blocks[blocks.length - 1]);
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    selection?.removeAllRanges();
    selection?.addRange(range);
    const modelRange = editor?.engine?.transformDOMRange?.(range);
    if (!modelRange) return false;
    editor.kernel.execCommand("selection", { focus: "end", anchor: "start", ranges: [modelRange] });
    return true;
  } catch {
    return false;
  }
}

/** 当前非折叠选区的 DOM range；没有则 null。 */
function currentSelectionRange(): Range | null {
  const selection = typeof window !== "undefined" ? window.getSelection() : null;
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  return selection.getRangeAt(0);
}

/**
 * LOCAL-CHANGE: 把光标**折叠**放到块内容的末尾（不选中内容）。
 *
 * 为什么需要：容器类命令（alert/columns/collapse）是「用新容器**替换选区**」语义 ——
 * 若先把整块内容全选（selectBlockInEditor）再执行，原文本会被空容器替换掉（实测：
 * 高亮块/分栏转换后 DOM、内核模型 JSON、落盘正文三处都没有原文）。
 * 折叠光标执行时命令只改变块结构、内容随块进入容器，文本得以保留。
 */
export function collapseCaretAtBlockEnd(editor: any, blockElement: HTMLElement | null): boolean {
  if (!blockElement) return false;
  try {
    const domRange = document.createRange();
    domRange.selectNodeContents(blockElement);
    domRange.collapse(false);
    const modelRange = editor?.engine?.transformDOMRange?.(domRange);
    if (!modelRange) return false;
    editor.kernel.execCommand("selection", { focus: "end", anchor: "end", ranges: [modelRange] });
    return true;
  } catch {
    return false;
  }
}

/**
 * LOCAL-CHANGE(260917 复核)：容器/卡片类的「转换并保留内容」载荷与实现。
 *
 * 背景（docs/LAKEX-CONTRACT.md §5.8.1）：内核里 alert/columns/collapse 三个命令是
 * 「删选区 + 插**空**容器」语义，codeblock 更无命令；但内核有官方通用插入通道
 * `insertAtSelection(format, data)` —— 插入时内核按 insert-inode-by-position 自动补
 * `alertHole`/`containerHole` 并把内容包进容器。配合官方 `getNodeContent(blockId, format)`
 * 取原文，即可一次调用把原块替换成「含原文的容器」。全程不碰 utils/blockDoc 的整篇 JSON 读改写。
 *
 * 260917 二次修正（用户实测反馈）：
 *  ① 代码块必须按**卡片 value**生成（不带 hideToolbar ⇒ 工具栏/代码名称正常展示）；
 *     markdown 围栏会给出 hideToolbar:true / mode:'plain' ⇒ 不是完整展示。
 *  ② 源块里含**卡片**（如代码块卡）时，转容器/正文一律**抽取文本**再放进去 ——
 *     直接把 <card> 塞进 alert 会整张丢失；把代码块卡嵌进折叠块/分栏也是错误转化。
 */
const CONTAINER_PAYLOADS: Record<string, (frag: string) => { format: string; data: string }> = {
  // 高亮块：lake 序列化形态是 <blockquote class="lake-alert lake-alert-<type>">，默认 info。
  callout: (frag) => ({
    format: "text/lake",
    data: `<blockquote class="lake-alert lake-alert-info">${frag}</blockquote>`,
  }),
  // 分栏：两栏，首栏放原文，次栏留空段落（与 execCommand("columns", 2) 的产物同构）。
  columns: (frag) => ({
    format: "text/lake",
    data:
      `<article class="lake-columns">`
      + `<article class="lake-column-item" style="width: 50%">${frag}</article>`
      + `<article class="lake-column-item" style="width: 50%"><p><br></p></article>`
      + `</article>`,
  }),
  // 折叠块：<details class="lake-collapse"> + <summary class="lake-summary">。
  collapse: (frag) => ({
    format: "text/lake",
    data: `<details class="lake-collapse" open="true"><summary class="lake-summary"><br></summary>${frag}</details>`,
  }),
};

/** lake 文本转义（抽取卡片文本时用）。 */
function escapeLakeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 把纯文本包成段落/标题 HTML（换行 → <br />），供「抽取卡片文本」放进容器/正文。 */
function textToParagraphHtml(text: string, tag = "p"): string {
  return `<${tag}><span>${escapeLakeText(text).split("\n").join("<br />")}</span></${tag}>`;
}

/**
 * 生成一枚完整展示的代码块卡（与内核自产形态一致）：不带 hideToolbar ⇒ 工具栏与代码名称可见；
 * mode 为空表示纯文本。内核物化时会补齐 autoWrap/lineNumbers/collapsed/name 等默认值。
 */
function codeblockCardHtml(code: string): string {
  const value = { search: "", mode: "", code, heightLimit: true, id: "cb" + Math.random().toString(36).slice(2, 10) };
  return `<card type="inline" name="codeblock" value="data:${encodeURIComponent(JSON.stringify(value))}"></card>`;
}

/** 取块在内核模型里的节点 id（容器 hole 场景回退到内部首个带 id 的元素）。 */
function resolveBlockModelId(blockElement: HTMLElement): string | null {
  const own = blockElement.getAttribute("id");
  if (own) return own;
  const inner = blockElement.querySelector("[id]");
  return inner ? inner.getAttribute("id") : null;
}

/**
 * 用官方 getNodeContent 取块的指定格式内容；取不到返回 null。
 * LOCAL-CHANGE(260917)：列表父项（含子项）必须用「整块选区 + getSelectionContent」，
 * 否则 getNodeContent(id) 只会返回父项那一行、丢掉所有子项（Issue 3）。
 */
function readBlockContent(editor: any, blockElement: HTMLElement, format: string): string | null {
  if (hasMultiBlockSelection()) {
    try {
      const multiValue = editor.execCommand("getSelectionContent", format);
      return typeof multiValue === "string" && multiValue.length > 0 ? multiValue : null;
    } catch {
      return null;
    }
  }
  if (blockSpanElements(blockElement).length > 1) {
    try {
      if (!selectBlockSpanInEditor(editor, blockElement)) return null;
      const selectionValue = editor.execCommand("getSelectionContent", format);
      return typeof selectionValue === "string" && selectionValue.length > 0 ? selectionValue : null;
    } catch {
      return null;
    }
  }
  const id = resolveBlockModelId(blockElement);
  if (!id) return null;
  try {
    const value = editor.execCommand("getNodeContent", id, format);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** 源块最外层的「容器」标签（高亮块 / 分栏 / 折叠块 / 引用）。 */
const CONTAINER_TAGS = ["NE-ALERT-HOLE", "NE-CONTAINER-HOLE", "NE-QUOTE", "NE-HOLE"];
/** 源块 lake 里是否含容器外壳 / 卡片（DOM 标签拿不到时的兜底判据）。 */
const CONTAINER_FRAG_RE = /<blockquote|<details|<article|class="lake-alert|class="lake-columns|class="lake-collapse|<card[\s>]/;

/**
 * 取源块的 lake + 纯文本，并判断它转换前是否需要**先抽取文本**：
 *  - 卡片源（如代码块块卡）：整张塞进 alert 会丢；
 *  - 容器源（高亮块/分栏/折叠块/引用）：直接塞进新容器会「容器套容器」（用户实测：分栏套高亮块）。
 * 段落/标题源不需要抽取（原地换类型即可）。
 */
function readSourceBlock(editor: any, blockElement: HTMLElement): { frag: string | null; plain: string | null; needsExtract: boolean } {
  const frag = readBlockContent(editor, blockElement, "text/lake");
  const plain = readBlockContent(editor, blockElement, "text/plain");
  const tag = (blockElement.tagName || "").toUpperCase();
  const byTag = CONTAINER_TAGS.indexOf(tag) >= 0;
  const byFrag = !!frag && CONTAINER_FRAG_RE.test(frag);
  return { frag, plain, needsExtract: byTag || byFrag };
}

/** 选中一个 DOM 节点**本身**（不是它的内容）作为内核模型选区。 */
function selectNodeInEditor(editor: any, element: HTMLElement): boolean {
  try {
    const domRange = document.createRange();
    domRange.selectNode(element);
    const modelRange = editor?.engine?.transformDOMRange?.(domRange);
    if (!modelRange) return false;
    editor.kernel.execCommand("selection", { focus: "end", anchor: "start", ranges: [modelRange] });
    return true;
  } catch {
    return false;
  }
}

/**
 * 用一次 insertAtSelection 把源块整体替换成给定 lake HTML。
 *
 * ⚠️ 容器源（高亮块/分栏/折叠块/引用）必须**选中容器节点本身**：容器 hole 的
 * `selectNodeContents` 只选到容器**内部**，插入新容器就会变成「容器套容器」
 * （用户实测：分栏套高亮块）。段落/卡片源则选内容即可（实测能整块替换）。
 */
function replaceBlockWithLake(editor: any, blockElement: HTMLElement, data: string): boolean {
  const tag = (blockElement.tagName || "").toUpperCase();
  const isContainer = CONTAINER_TAGS.indexOf(tag) >= 0;
  if (hasMultiBlockSelection()) {
    // 多块选区：保持用户当前选区，内核按「替换整个选区」插入（批量转化 = 一次包裹/一次命令）
  } else if (isContainer) {
    const inner = ((blockElement.matches("blockquote, article, details") && blockElement)
      || blockElement.querySelector("blockquote, article, details")
      || blockElement) as HTMLElement;
    if (!selectNodeInEditor(editor, inner)) return false;
  } else if (!selectWholeBlockForEdit(editor, blockElement)) {
    return false;
  }
  const result = editor.execCommand("insertAtSelection", "text/lake", data);
  return result !== false && result != null;
}

/**
 * 「卡片/容器 → 正文/标题」：源块需要抽取且有文本时，抽取文本替换该块
 * （style 对卡片/容器是 no-op，表现为「点了没反应」）。返回 false 表示不需要抽取，调用方继续走 style。
 */
function convertToTextBlock(editor: any, blockElement: HTMLElement, target: string): boolean {
  const { plain, needsExtract } = readSourceBlock(editor, blockElement);
  if (!needsExtract || plain === null || plain.length === 0) return false;
  return replaceBlockWithLake(editor, blockElement, textToParagraphHtml(plain, target));
}

/**
 * 「卡片/容器 → 引用/列表」：先把源块抽取成段落（新段落会被内核自动选中），再执行内核原生
 * quote / unorderedList / orderedList / taskList —— 这些命令对卡片/容器本身无效
 * （引用 no-op、列表抛 nodeName 错误、容器无反应），抽取成段落后再执行即可正常生效。
 * 返回 false 表示不需要抽取，调用方继续走旧路径。
 */
function convertToNativeBlock(editor: any, blockElement: HTMLElement, command: string): boolean {
  const { plain, needsExtract } = readSourceBlock(editor, blockElement);
  if (!needsExtract || plain === null || plain.length === 0) return false;
  if (!replaceBlockWithLake(editor, blockElement, textToParagraphHtml(plain))) return false;
  try {
    return editor.execCommand(command) !== false;
  } catch {
    return false;
  }
}

/**
 * 「转化为 高亮块/分栏/折叠块/代码块」：一次替换把原文搬进新容器/卡片。
 * 成功返回 true；取不到内容或内核拒绝载荷时返回 false（调用方回退旧行为）。
 */
export function convertBlockPreservingContent(editor: any, blockElement: HTMLElement, target: string): boolean {
  try {
    const { frag, plain, needsExtract } = readSourceBlock(editor, blockElement);
    // 卡片/容器源且有文本 ⇒ 抽取文本，避免「卡片丢 / 容器套容器」。
    const extractText = needsExtract && plain !== null && plain.length > 0;

    if (target === "codeblock") {
      // 代码块：按纯文本取原文，生成「完整展示」的代码块卡（工具栏/代码名称可见）。
      return replaceBlockWithLake(editor, blockElement, codeblockCardHtml(plain || ""));
    }
    const build = CONTAINER_PAYLOADS[target];
    if (!build) return false;
    const source = extractText ? textToParagraphHtml(plain as string) : frag;
    if (!source) return false;
    const { data } = build(source);
    return replaceBlockWithLake(editor, blockElement, data);
  } catch {
    return false;
  }
}

/** 用 Lakex 原生命令做块类型转换（当 JSON 替换不可用时回退） */
/** 多块选区的批量转化：内核命令直接作用于整个选区（一次调用，不逐块搬运）。 */
function runMultiBlockConvert(editor: any, target: string): boolean {
  try {
    if (/^(p|h[1-6])$/.test(target)) return editor.execCommand("style", target) !== false;
    const nativeCommand: Record<string, string> = {
      quote: "quote",
      ul: "unorderedList",
      ol: "orderedList",
      taskList: "taskList",
    };
    if (nativeCommand[target]) return editor.execCommand(nativeCommand[target]) !== false;
    if (target === "callout" || target === "columns" || target === "collapse" || target === "codeblock") {
      const blocks = selectedTopBlocks();
      if (!blocks.length) return false;
      return convertBlockPreservingContent(editor, blocks[0], target);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * LOCAL-CHANGE(261004)「取消引用」：把引用的内部块**原地提升**为顶层块（内容与列表结构保留）。
 * 云端 Edge 实测：引用首行手柄的「转化为」里「引用」是回显(selected)状态，点一下即取消引用
 * （云端把内部块提升为普通段落；我们保留其类型更安全，不丢列表结构）。
 */
function unwrapQuote(editor: any, blockElement: HTMLElement): boolean {
  const id = blockElement.getAttribute("id");
  const frag = readBlockContent(editor, blockElement, "text/lake");
  if (!id || !frag) return false;
  const match = /<blockquote[^>]*>([\s\S]*)<\/blockquote>/i.exec(frag);
  const inner = match && match[1] ? match[1] : "";
  if (!inner.trim()) return false;
  // 落点 = 引用原位（before 的折叠 model position）。用 insertAtPosition（显式模型位置），
  // 不用 insertAtSelection / selectNode —— 后者依赖 transformDOMRange(selectNode)，实测对引用无效，
  // 会退回「再包一层引用」把结构越滚越大。
  const dropModel = dropPositionOf(editor, blockElement, true);
  if (!dropModel || !dropModel.start) return false;
  const insertPos = { id: dropModel.start.node.id, offset: dropModel.start.offset };
  // 先按节点级删掉引用（原位不留空段落），再在同位置插入内部块。
  if (!removeBlockNodesNative(editor, [blockElement])) return false;
  const inserted = editor.execCommand("insertAtPosition", insertPos, "text/lake", inner);
  return inserted !== false && inserted != null;
}

export function runNativeConvert(editor: any, blockElement: HTMLElement, target: string): boolean {
  if (hasMultiBlockSelection()) return runMultiBlockConvert(editor, target);
  // LOCAL-CHANGE(261004)：目标是「引用」而当前块本身就是引用 ⇒ 取消引用（引用项回显 → 点一下取消）。
  if (target === "quote" && (blockElement.tagName || "").toUpperCase() === "NE-QUOTE") {
    if (unwrapQuote(editor, blockElement)) return true;
  }
  // 段落/标题：源块含卡片（代码块等）时先抽取文本（style 对卡片是 no-op，表现为「没反应」）。
  if (/^(p|h[1-6])$/.test(target)) {
    if (convertToTextBlock(editor, blockElement, target)) return true;
    if (!selectWholeBlockForEdit(editor, blockElement)) return false;
    try {
      return editor.execCommand("style", target) !== false;
    } catch {
      return false;
    }
  }
  // 引用/列表：命令对卡片源无效（引用 no-op、列表抛错）⇒ 先抽取文本再执行内核命令。
  const nativeCommand: Record<string, string> = {
    quote: "quote",
    ul: "unorderedList",
    ol: "orderedList",
    taskList: "taskList",
  };
  if (nativeCommand[target] && convertToNativeBlock(editor, blockElement, nativeCommand[target])) {
    return true;
  }

  // LOCAL-CHANGE(260917 复核)：容器/卡片类优先走「转换并保留内容」的官方通用插入通道。
  if (target === "callout" || target === "columns" || target === "collapse" || target === "codeblock") {
    if (convertBlockPreservingContent(editor, blockElement, target)) return true;
    // 取不到内容 / 载荷被内核拒绝 → 退回旧的「折叠光标 + 空容器」行为（不丢数据，但语义弱）。
  }

  // 其余目标用折叠光标：容器类命令会替换选区，全选会吃掉原文本（见上面的说明）。
  if (!collapseCaretAtBlockEnd(editor, blockElement)) return false;

  try {
    // 代码块回退：内核没有「转代码块」命令，只能按「插入代码块卡」落一张空卡。
    if (target === "codeblock") {
      return editor.execCommand("insertCard", "codeblock") !== false;
    }
    const command: Record<string, [string, ...unknown[]]> = {
      quote: ["quote"],
      ul: ["unorderedList"],
      ol: ["orderedList"],
      taskList: ["taskList"],
      callout: ["alert"],
      columns: ["columns", 2],
      collapse: ["collapse"],
    };
    if (!command[target]) return false;
    return editor.execCommand(...command[target]) !== false;
  } catch {
    return false;
  }
}

/** 通过 Lakex 复制整块 DOM（列表父项含子项，Issue 3） */
export function copyDomBlock(editor: any, blockElement: HTMLElement): boolean {
  try {
    if (hasMultiBlockSelection()) {
      const selectionRange = currentSelectionRange();
      if (!selectionRange) return false;
      const result = editor?.renderer?.execCommand?.("copy", selectionRange);
      return result !== false;
    }
    const span = blockSpanElements(blockElement);
    const range = span.length > 1
      ? spanDomRange(span)
      : (() => { const r = document.createRange(); r.selectNode(blockElement); return r; })();
    const result = editor?.renderer?.execCommand?.("copy", range);
    return result !== false;
  } catch {
    return false;
  }
}

/**
 * LOCAL-CHANGE(260918)：用内核「模型事务」摘掉整块**节点**（原位不留空段落）。
 *
 * 为什么不只用 `deleteByRange`：它的语义是「删内容」——范围覆盖根级整块时，内核会在原位补一个
 * 默认段落（framework/kernel/src/model/utils/range/delete-content-by-range.ts 尾部
 * `insertNodeByPosition(u, createElement(defaultElementName))`）⇒ 菜单删除 / 剪切 / 拖拽都会在原位
 * 留下一条空行（实测：删一个段落 顶层块 63→63、空段落 +1；拖拽 63→64）。
 *
 * 内核自己的 deleteAlert / deleteCollapse / deleteCard 等命令走的是节点级删除：
 * 命令上下文 = `kernel._model.editing`，`job.getNodeById(id)` → `job.removeChild(parent, node)` →
 * `commitJob(job)`（外层再 `startTransaction/commit`，与 CommandManager.execute 一致）。
 * 这里用同一条原生路径，**不碰** blockDoc 的整篇 JSON 读改写。
 *
 * ⚠️ 删除前必须把内核算子挪出被删节点（见下方 setSelection）：否则 commitJob 会在
 * `framework/engine/src/view/selection/index.ts` 断言失败并**整个回滚**——症状是「点了删除没反应」，
 * 且此后所有块操作继续报错（实测：复制→剪切→删除 的序列必现）。
 */
function removeBlockNodesNative(editor: any, elements: HTMLElement[]): boolean {
  const editing = editor?.kernel?._model?.editing ?? editor?.renderer?.kernel?._model?.editing;
  if (!editing || typeof editing.newJob !== "function" || typeof editing.commitJob !== "function") return false;
  const ids = elements.map((el) => el.getAttribute("id")).filter((id): id is string => !!id);
  if (!ids.length) return false;
  // 兜底：整篇只剩这些块时不走这里（内核要求文档至少保留一个段落）
  const parent = elements[0]?.parentElement;
  if (!parent || parent.children.length <= ids.length) return false;
  let txn: any = null;
  try {
    if (typeof editing.startTransaction === "function") txn = editing.startTransaction();
    const job = editing.newJob();
    let removed = 0;
    // 删完要把内核算子挪到「被删区间原位」的折叠位置。
    // 为什么必须做：内核算子若仍指向被删节点，commitJob 会在
    // framework/engine/src/view/selection/index.ts 断言失败 → **整个事务回滚**（症状＝点了删除没反应，
    // 且之后所有操作都继续报错）。内核自己的 deleteAlert / deleteCard 同样是「先安置选区，再 removeChild」。
    let anchorParent: any = null;
    let anchorIndex = 0;
    // 从后往前：同父节点按索引定位时不受前面删除影响；最后留下的锚点 = 被删区间起点
    for (let i = ids.length - 1; i >= 0; i -= 1) {
      const node = job.getNodeById?.(ids[i]);
      if (!node || !node.parentNode) continue;
      const parentNode = node.parentNode;
      const index = typeof node.offset === "number" ? node.offset : 0;
      job.removeChild(parentNode, node);
      anchorParent = parentNode;
      anchorIndex = index;
      removed += 1;
    }
    if (!removed) {
      if (txn?.rollback) txn.rollback();
      return false;
    }
    try {
      if (
        anchorParent
        && typeof job.setSelection === "function"
        && typeof job.newRange === "function"
        && typeof job.newPosition === "function"
      ) {
        job.setSelection([job.newRange(job.newPosition(anchorParent, anchorIndex))]);
      }
    } catch { /* 选区复位失败不阻塞删除 */ }
    editing.commitJob(job);
    if (txn?.commit) txn.commit();
    return true;
  } catch {
    try { if (txn?.rollback) txn.rollback(); } catch { /* 忽略 */ }
    return false;
  }
}

/**
 * LOCAL-CHANGE: 用内核原生命令删除整块。
 *
 * 替代 `utils/blockDoc.deleteBlock`（整篇 JSON 读改写：`getDocument('json')` → 改树 →
 * `setDocument('json')`；本仓库实测该路径会重写自定义卡并抹掉内核未注册的卡）。
 * 与菜单「删除」项同一实现，剪切也复用它。
 *
 * 优先走 `removeBlockNodesNative`（节点级删除、原位不留空段落）；仅在模型事务不可用时
 * 退回 `deleteByRange`（会在原位留一个空段落，属兜底而非正常路径）。
 */
export function deleteBlockByRange(editor: any, blockElement: HTMLElement | null): boolean {
  if (!blockElement) return false;
  try {
    const targets = hasMultiBlockSelection() ? selectedTopBlocks() : blockSpanElements(blockElement);
    if (removeBlockNodesNative(editor, targets)) return true;
  } catch {
    /* 落到下面的兜底路径 */
  }
  try {
    // 整块 outer range（首元素前 → 末元素后）：比 selectNode 更稳 —— 列表项的 selectNode
    // 变换后是**折叠**的，deleteByRange 会触发内核断言删不掉；outer range 恒为非折叠。
    const multiRange = hasMultiBlockSelection() ? currentSelectionRange() : null;
    const span = blockSpanElements(blockElement);
    const range = multiRange ?? (span.length > 1
      ? spanDomRange(span)
      : (() => { const r = document.createRange(); r.setStartBefore(blockElement); r.setEndAfter(blockElement); return r; })());
    const transformed = editor.engine.transformDOMRange(range);
    const kernelRef = editor.renderer?.kernel ?? editor.kernel;
    const modelRange = kernelRef.createModelRange(transformed.start, transformed.end);
    editor.kernel.execCommand("deleteByRange", modelRange);
    return true;
  } catch {
    return false;
  }
}

/** 取元素自身或其内部的卡片元素（块卡：ne-card 包在 ne-hole 内）。 */
function cardElementOf(el: HTMLElement): HTMLElement | null {
  const tag = (el.tagName || "").toUpperCase();
  if (tag === "NE-CARD") return el;
  return el.querySelector ? (el.querySelector("ne-card") as HTMLElement | null) : null;
}

/**
 * 移动用的 lake 片段：直接用 `getNodeContent('text/lake')` 的整段结果。
 *
 * 列表项**不能抽裸 <li>**：层级编码在包装 `<ul list=… data-lake-indent="1">` 上，
 * 抽掉包装会丢层级（第二级拖完变第一级）；整段包装交给 `insertAtPosition` 时，
 * 内核会按 `data-lake-indent` 把它**并进相邻的同类列表成为同级兄弟项**（实测保层级）。
 */
function movableFragment(editor: any, el: HTMLElement): string | null {
  return readBlockContent(editor, el, "text/lake");
}

/** 目标元素前/后的折叠 model position（拖拽落点）。 */
function dropPositionOf(editor: any, targetEl: HTMLElement, before: boolean): any {
  const dropRange = document.createRange();
  if (before) dropRange.setStartBefore(targetEl);
  else dropRange.setStartAfter(targetEl);
  dropRange.collapse(true);
  const dropModel = editor.engine.transformDOMRange(dropRange);
  return dropModel && dropModel.start ? dropModel : null;
}

/** 在给定编辑器根内按块 id 重新取元素（内核重渲染后旧引用会脱离文档）。 */
function blockElementById(engineEl: HTMLElement | null, id: string | null): HTMLElement | null {
  if (!engineEl || !id) return null;
  try {
    return engineEl.querySelector(`[id="${id}"]`) as HTMLElement | null;
  } catch {
    return null;
  }
}

/**
 * LOCAL-CHANGE(260917 / 260918)：原生「移动块」——把 sourceEl（整段）移到 targetEl 前/后。
 *
 * 全程内核原生命令，**不碰** `utils/blockDoc.moveBlock` 的整篇 JSON 读改写
 * （实测会把自定义卡 634B→8859B、并抹掉内核未注册卡）：
 *  - 卡片源 → `moveCard(cardId, modelPosition)`：移动已有节点、**逐字节保真**（含卡 id）；
 *  - 其它块 → `getNodeContent('text/lake')` 取原文 → **先摘掉源节点**
 *    （`removeBlockNodesNative`，节点级删除）→ 再按**删除后**的目标位置 `insertAtPosition`。
 *
 * 顺序与落点口径（260918 改，修「每拖一次多一条空行」）：
 *  - 落点 model position 是 `(父节点, 子索引)` 形式，先插后删会让落点索引位移；先删后插索引天然稳定。
 *  - 删源必须**节点级**：deleteByRange 只删内容，范围覆盖整块时内核会在原位补一个空段落
 *    （实测拖段落 顶层块 63→64、空段落 +1）。详见 `removeBlockNodesNative`。
 *  - 插入仍用 `insertAtPosition`（显式模型位置），不用 `insertAtSelection` —— 折叠光标会被吸附到行内，
 *    导致段落融合丢换行、列表项文本并进目标项。
 */
export function moveBlockNative(
  editor: any,
  sourceEl: HTMLElement | null,
  targetEl: HTMLElement | null,
  before: boolean,
): boolean {
  if (!editor || !sourceEl || !targetEl) return false;
  // 多块选区：批量拖拽暂不实现（菜单批量删除/复制/剪切/转化已走整段选区）
  if (hasMultiBlockSelection()) return false;
  // 拖到自身/自身子树（列表父项含子项）= 无效
  const sourceSpan = blockSpanElements(sourceEl);
  if (sourceEl === targetEl || sourceEl.contains(targetEl) || sourceSpan.indexOf(targetEl) > 0) return false;
  try {
    // 卡片：内核 moveCard 直接搬节点（保真），不经过「读-插-删」
    const card = cardElementOf(sourceEl);
    if (card) {
      const cardId = card.getAttribute("id");
      if (!cardId) return false;
      const dropModel = dropPositionOf(editor, targetEl, before);
      if (!dropModel) return false;
      const moved = editor.execCommand("moveCard", cardId, dropModel.start);
      return moved !== false && moved != null;
    }

    const frag = movableFragment(editor, sourceEl);
    if (!frag) return false;
    // 先删源（整段，节点级）：原位不留空段落
    const engineEl = sourceEl.parentElement;
    if (!removeBlockNodesNative(editor, sourceSpan)) return false;
    // 目标元素可能在内核重渲染后换了 DOM 节点 → 按 id 重新取；取不到就放弃（不改数据）
    const targetNow = blockElementById(engineEl, targetEl.getAttribute("id"))
      ?? (targetEl.isConnected ? targetEl : null);
    if (!targetNow) return false;
    const dropModel = dropPositionOf(editor, targetNow, before);
    if (!dropModel) return false;
    const dropPos = { id: dropModel.start.node.id, offset: dropModel.start.offset };
    const inserted = editor.execCommand("insertAtPosition", dropPos, "text/lake", frag);
    return inserted !== false && inserted != null;
  } catch {
    return false;
  }
}

/**
 * LOCAL-CHANGE: 用内核原生命令在块前/后插入新块（默认段落，可指定标题/引用/分割线）。
 *
 * 替代 `utils/blockDoc.insertBlock`（同上：整篇 JSON 读改写）。实现 = 把光标收到块的
 * 首/尾 → `breakLine`（内核断行，实测在目标块旁立刻生成新的 `ne-p`）→ 需要类型时再对该
 * 新块执行 `style` / `quote` / `hr`（命令生效要求光标落在该块内，断行后光标即在新块里）。
 */
export function insertBlockNative(
  editor: any,
  blockElement: HTMLElement | null,
  position: 'before' | 'after',
  target?: string,
): boolean {
  if (!blockElement) return false;
  try {
    const domRange = document.createRange();
    domRange.selectNodeContents(blockElement);
    domRange.collapse(position === 'before');
    const modelRange = editor?.engine?.transformDOMRange?.(domRange);
    if (!modelRange) return false;
    const edge = position === 'before' ? 'start' : 'end';
    editor.kernel.execCommand("selection", { focus: edge, anchor: edge, ranges: [modelRange] });

    if (editor.execCommand("breakLine") === false) return false;
    if (!target || target === "p") return true;
    // 光标此时已在新块里：代码块按「插入代码块卡」落卡（新块是空的，不会被吃掉内容）。
    if (target === "codeblock") return editor.execCommand("insertCard", "codeblock") !== false;
    if (target === "hr") return editor.execCommand("hr") !== false;
    if (/^h[1-6]$/.test(target)) return editor.execCommand("style", target) !== false;

    const command: Record<string, [string, ...unknown[]]> = {
      quote: ["quote"],
      ul: ["unorderedList"],
      ol: ["orderedList"],
      taskList: ["taskList"],
    };
    if (!command[target]) return false;
    return editor.execCommand(...command[target]) !== false;
  } catch {
    return false;
  }
}

/** 复制文本到剪贴板（优先 Clipboard API，失败时回退 execCommand） */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}
