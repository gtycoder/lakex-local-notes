/**
 * 插入命令的「卡片保护区」（261123）。桌面/移动/小记写作卡共用判据（AGENTS §3#14：同一语义只有一套）。
 *
 * 内核 `insertAtSelection` 的官方语义（docs/lakexEditor-developer-docs/08 命令列表）：
 * **「如果选区非折叠，被选中的内容将会被替换为插入内容」**；`insertCard` 同走选区插入/替换。
 * 选区落在卡片上时执行插入类命令 ⇒ 两种坏结果都实测过：
 *   ① 整卡被顶掉（用户 261123 现场：「加密文本」卡被表情整卡替换，数据破坏级）；
 *   ② 静默丢失（模拟器实测：卡聚焦折叠态下插表情/日期卡，内容哪都没落，卡片在但插入物没了）。
 * ⇒ 选区触卡时**一律不执行插入命令**，给明提示（不静默、不吞卡）。
 * 同类入口（文档 dock「＋」面板的 状态/日期/代码块/日历/文本绘图 等 insertCard、小记写作卡的表情/日期）都走同一条判据。
 */

/** 卡片节点选择器：内核卡（ne-card）与其包装洞位（ne-hole）；自研 React 卡都挂在它们里面。 */
const CARD_SELECTOR = "ne-card, ne-hole, [ne-card]";

function insideCard(node: Node | null | undefined): boolean {
  if (!node) return false;
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return !!el?.closest?.(CARD_SELECTOR);
}

/**
 * 当前（或指定）文档选区是否「触卡」——折叠光标落在卡片内，或非折叠选区与卡片相交（整卡/多块选中）。
 * 判据只看 DOM 选区（内核模型选区不可见；DOM 选区是它的投影，触卡面只会更保守不会漏）。
 * 无 document（node 单测）恒 false：该环境没有可破坏的卡片。
 */
export function selectionTouchesCard(sel?: Selection | null): boolean {
  const s = sel ?? (typeof document !== "undefined" ? document.getSelection() : null);
  if (!s || s.rangeCount === 0) return false;
  const range = s.getRangeAt(0);
  if (range.collapsed) return insideCard(range.startContainer);
  if (insideCard(range.startContainer) || insideCard(range.endContainer)) return true;
  const base = range.commonAncestorContainer;
  const baseEl = base.nodeType === 1 ? (base as Element) : base.parentElement;
  const scope = baseEl?.closest?.("[contenteditable]") ?? baseEl;
  if (!scope) return false;
  for (const card of scope.querySelectorAll(CARD_SELECTOR)) {
    try {
      if (range.intersectsNode(card)) return true;
    } catch { /* 节点已脱离文档：当不存在 */ }
  }
  return false;
}

/** 插入被拦时的统一提示（说清发生了什么 + 下一步，DESIGN Voice & Copy）。 */
export const INSERT_BLOCKED_HINT = "光标停在卡片上，未插入（点正文空白处可继续）";

/**
 * 被拦提示的通道（可注入）：移动端入口装 showToast；桌面/其它宿主未装时静默拦下（卡片安全优先）。
 * 不引第二套通知实现（AGENTS §3#14），通道由各宿主自己接。
 */
type InsertBlockedNotifier = (hint: string) => void;
let insertBlockedNotifier: InsertBlockedNotifier | null = null;
export function setInsertBlockedNotifier(fn: InsertBlockedNotifier | null): void {
  insertBlockedNotifier = fn;
}
export function notifyInsertBlocked(): void {
  insertBlockedNotifier?.(INSERT_BLOCKED_HINT);
}
