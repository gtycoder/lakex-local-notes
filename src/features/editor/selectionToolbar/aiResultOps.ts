/**
 * AI 结果落到文档的**两个操作**（用户 261005 定稿）—— **单一来源**。
 *
 * 为什么要抽出来：文字浮栏的 AI 面板和**块句柄菜单**的 AI 面板必须是同一套插入/替换语义，
 * 否则「两套 AI 结果处理」会漂移（AGENTS §3.14 单一来源）。
 *
 * - **插入到选区后**：分隔线 + 「以下内容由 AI 生成」+ AI 正文（原生 markdown）+ 分隔线；
 *   落点用内核 `insertAtPosition`（原块一个字节不动，见契约 §5.16）。
 * - **替换选区**：原样插入 AI 输出，不背包引用/标记（Lake 容器装不下表格）。
 */
import { applyModelRange, positionAfterModelRange, type CapturedModelRange } from "./aiModelSelection";
import { buildAiInsertMarkdown } from "./aiInsertMarker";
import type { LakeEditorInstance } from "../lakeRuntime";

/** AI 结果落点只需要内核命令面（`insertAtPosition` / `insertAtSelection`），不是整个编辑器。 */
type AiCommandTarget = Pick<LakeEditorInstance, "execCommand">;

/**
 * AI 结果自动选中新内容时要认的**行级块**。
 * ⚠️ 插入前记集合、插入后取差集**必须用同一个选择器**，否则差集失真（会漏选或多选）。
 */
export const SELECTABLE_BLOCKS = "ne-quote, ne-p, ne-h1, ne-h2, ne-h3, ne-h4, ne-h5, ne-h6, ne-tli, ne-oli, ne-alert, ne-collapse";

/** 引擎内当前所有可自动选中的行级块（插入前快照用）。 */
export function blockSetOf(container: HTMLElement): Set<Element> {
  const engine = container.querySelector(".ne-engine");
  return new Set<Element>(engine ? Array.from(engine.querySelectorAll(SELECTABLE_BLOCKS)) : []);
}

/**
 * 插入完成后**自动选中刚插入的块**（用户 261004）。用 DOM 实现：内核模型选区捕获后可能已随渲染失效
 * （applyModelRange 实测返回 false —— 它内部自己吞掉异常），而新增块在 DOM 里是确定的
 * ⇒ 插入前后各取一次集合，差集就是新块。
 */
export function selectNewBlocks(container: HTMLElement, before: Set<Element>, skipFirst = false): void {
  const engine = container.querySelector(".ne-engine");
  if (!engine) return;
  let fresh = Array.from(engine.querySelectorAll(SELECTABLE_BLOCKS))
    .filter((el) => !before.has(el));
  // 「插入到选区后」带标记（分隔线 + 「AI 生成」提示）：第一块是新加的提示段，跳过它，只选中 AI 正文。
  if (skipFirst) fresh = fresh.slice(1);
  if (fresh.length === 0) return;
  try {
    const range = document.createRange();
    range.setStartBefore(fresh[0]);
    range.setEndAfter(fresh[fresh.length - 1]);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  } catch { /* 选区设置失败不影响已插入内容 */ }
}

/** 「插入到选区后」：落点 = 模型选区末端所在顶层块之后。返回是否执行。 */
export function applyAiInsertAfter(editor: AiCommandTarget, container: HTMLElement, range: CapturedModelRange | null, text: string): boolean {
  try {
    const pos = positionAfterModelRange(range);
    if (!pos) return false;   // 拿不到模型选区落点就不改文档（宁可不动，也不破坏原格式）
    const before = blockSetOf(container);
    editor?.execCommand?.("insertAtPosition", pos, "text/markdown", buildAiInsertMarkdown(text));
    // 插入后自动选中新内容；跳过前置的「AI 生成」提示段。
    window.setTimeout(() => selectNewBlocks(container, before, true), 0);
    return true;
  } catch { return false; }
}

/**
 * 「替换选区」：模型选区优先（设回内核 ⇒ 非折叠 = 替换）；模型选区可能已随渲染失效，
 * 故可再补一条 DOM 兜底（`domRange`：打开前的 DOM 选区）。返回是否执行。
 */
export function applyAiReplace(editor: AiCommandTarget, container: HTMLElement, range: CapturedModelRange | null, text: string, domRange?: Range | null): boolean {
  try {
    const before = blockSetOf(container);
    applyModelRange(editor, range);   // best-effort
    if (domRange) {
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(domRange); }
    }
    editor?.execCommand?.("insertAtSelection", "text/markdown", text);
    window.setTimeout(() => selectNewBlocks(container, before), 0);
    return true;
  } catch { return false; }
}
