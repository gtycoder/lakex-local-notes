/**
 * 前端撤销栈的纯逻辑（261017，对标思源 `LocalUndo` 的 lite 模式）。
 *
 * 背景：lakex 的 note-mini 编辑器里，键入不进 kernel history（`canUndo=false`）；
 * 文档编辑器虽然能撤，但连续输入会被合并成一帧（"一次撤一段、再撤没有"）。
 * 思源对"没有 kernel 历史"的编辑器用**前端操作日志栈**：本文件就是那份栈的宿主实现，
 * 只存 text/lake 快照 + **光标位置**（对标思源 `restoreUndoFocus`，撤销后光标回到编辑点、不是开头）。
 *
 * 判据全部是纯函数，便于单测；容量按「条数 + 总字符」双上限裁剪，防大文档吃内存。
 */

/** 光标位置描述：块 id + 块内纯文本偏移（内核块元素带 id，恢复快照后按 id 找回来）。 */
export interface CaretPos {
  blockId: string;
  /** 从块起点到光标的纯文本字符数。 */
  offset: number;
}

export interface Snapshot {
  doc: string;
  /** 记录这一帧时的光标位置；取不到（选区跨块/无焦点）时为 null。 */
  pos: CaretPos | null;
  /** 记录这一帧时的**内核模型选区** JSON（恢复后新输入落到哪里由它决定，见 kernelSelection.ts）。 */
  sel: string | null;
}

export interface SnapshotStack {
  /** 快照序列（history[0] = 打开时的正文）。 */
  history: Snapshot[];
  /** 当前所在位置；undo 减小、redo 增大。 */
  index: number;
}

export interface StackLimits {
  maxEntries: number;
  maxTotalChars: number;
}

export const DEFAULT_LIMITS: StackLimits = { maxEntries: 40, maxTotalChars: 8_000_000 };
/** 文档编辑器：快照更大、序列化更贵，条数收一档（仍够逐段撤销）。 */
export const DOC_LIMITS: StackLimits = { maxEntries: 25, maxTotalChars: 4_000_000 };

export function createStack(doc: string, pos: CaretPos | null = null, sel: string | null = null): SnapshotStack {
  return { history: [{ doc, pos, sel }], index: 0 };
}

export function canUndo(stack: SnapshotStack): boolean {
  return stack.index > 0;
}

export function canRedo(stack: SnapshotStack): boolean {
  return stack.index < stack.history.length - 1;
}

const totalChars = (history: Snapshot[]): number => history.reduce((n, s) => n + s.doc.length, 0);

/**
 * 记录一次新快照。规则：
 * - 与当前位置内容相同 ⇒ 忽略（输入法组合中的重复 contentchange 不会造假步）；
 * - 丢弃当前位置之后的重做分支；
 * - 超过条数/总字符上限时从最旧的一端裁剪（保留当前项）。
 */
export function pushSnapshot(
  stack: SnapshotStack,
  snap: Snapshot,
  limits: StackLimits = DEFAULT_LIMITS,
): SnapshotStack {
  if (stack.history[stack.index].doc === snap.doc) return stack;
  const history = stack.history.slice(0, stack.index + 1);
  history.push(snap);
  let index = history.length - 1;
  while (history.length > limits.maxEntries || (history.length > 1 && totalChars(history) > limits.maxTotalChars)) {
    history.shift();
    index--;
  }
  return { history, index: Math.max(0, index) };
}

export function undoStep(stack: SnapshotStack): { stack: SnapshotStack; snap: Snapshot | null } {
  if (!canUndo(stack)) return { stack, snap: null };
  const index = stack.index - 1;
  return { stack: { history: stack.history, index }, snap: stack.history[index] };
}

export function redoStep(stack: SnapshotStack): { stack: SnapshotStack; snap: Snapshot | null } {
  if (!canRedo(stack)) return { stack, snap: null };
  const index = stack.index + 1;
  return { stack: { history: stack.history, index }, snap: stack.history[index] };
}
