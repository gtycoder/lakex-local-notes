/**
 * 手写板保存 / 捕获管线的**纯逻辑**（261112 R2-S10 阶段①，从 InkPad.tsx 搬出）。
 *
 * 为什么单独成砖：这段是「落笔 → 标脏 → 500ms 防抖 → 现算序列化 → 与磁盘基线判等价 → 交父层保存」
 * 的完整决策链，但原来的护栏全是**源码文本断言**（inkPadWiring / inkOpenReadOnly 里 grep InkPad.tsx），
 * 改一行实现就红、却测不到「防抖到底是不是 500ms / 等价时到底写不写盘」。搬到这里后可以按行为测。
 *
 * 三条不变量（改这里先读）：
 *  1. **热路径不序列化**：序列化只发生在 savePending / capture（serialize 回调由宿主注入）。
 *  2. **标脏只通知一次**：dirty 从 false → true 时调 markDirty（父层据此在标签上打脏标记）。
 *  3. **CORE-03 打开只读**：与磁盘原文等价（规范形态逐字节相等）⇒ 不写盘；capture 交磁盘原文。
 *     磁盘侧规范形态惰性算一次并缓存（正文可达 10 MiB，不能每次保存整篇解析两遍）。
 */

/** 落笔后的保存防抖窗口（ms）。P5 实测：300 页批注文档一次 inkToBody 26.7ms，不能每笔都算。 */
export const INK_SAVE_DEBOUNCE_MS = 500;

export type InkCanonicalizer = (body: string) => string | null;

export interface InkDiskBaseline {
  /** 当前正文是否与「打开时的磁盘原文」等价（CORE-03 判据）。 */
  isSameAsDisk(body: string): boolean;
}

/**
 * 磁盘基线：缓存磁盘原文的规范形态，只在第一次比较时算（canonicalize 可注入，便于测试与复用 core 判据）。
 * canonicalize 返回 null（无法解析）⇒ 一律视为不等价（宁可多写一次，也不把坏正文当"没改"吞掉）。
 */
export function createInkDiskBaseline(diskBody: string, canonicalize: InkCanonicalizer): InkDiskBaseline {
  let canonical: string | null | undefined;
  return {
    isSameAsDisk(body: string): boolean {
      if (canonical === undefined) canonical = canonicalize(diskBody);
      return canonical !== null && canonical === body;
    },
  };
}

export interface InkSaveDebounceIO {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  readonly delayMs?: number;
}

export interface InkSavePipelineInput {
  /** 定时器实现（宿主传 window 适配；测试可注入假定时器）。 */
  io: InkSaveDebounceIO;
  isDirty(): boolean;
  /** dirty false → true 时调用一次（父层打脏标记）。 */
  markDirty(): void;
  clearDirty(): void;
  /** 现算整篇正文；失败返回 null（保留 dirty，下次再试）。 */
  serialize(): string | null;
  isSameAsDisk(body: string): boolean;
  /** 真正交给父层保存（onChange）。 */
  emit(body: string): void;
}

export interface InkSavePipeline {
  /** 落笔/擦除/撤销等所有正文改动入口：标脏（首次通知）+ 重置 500ms 计时。 */
  scheduleSave(): void;
  /** 立即跑一次保存（若 dirty）。 */
  savePending(): void;
  /** 取消在途计时并立即保存（卸载/完成编辑/返回）。 */
  flushSave(): void;
}

/**
 * 保存管线：dirty 判定 + 500ms 防抖 + 序列化 + 与磁盘等价则丢弃。
 * 纯闭包实现（不依赖 React）；宿主只负责把 refs/回调注入进来。
 */
export function createInkSavePipeline(input: InkSavePipelineInput): InkSavePipeline {
  const delayMs = input.io.delayMs ?? INK_SAVE_DEBOUNCE_MS;
  let timer: number | null = null;

  const savePending = (): void => {
    if (!input.isDirty()) return;
    const body = input.serialize();
    if (body === null) return; // 序列化失败：保留 dirty，正文不丢
    input.clearDirty();
    if (input.isSameAsDisk(body)) return; // CORE-03：与磁盘等价 ⇒ 不写盘
    input.emit(body);
  };

  const scheduleSave = (): void => {
    if (!input.isDirty()) input.markDirty();
    if (timer !== null) input.io.clearTimeout(timer);
    timer = input.io.setTimeout(() => {
      timer = null;
      savePending();
    }, delayMs);
  };

  const flushSave = (): void => {
    if (timer !== null) {
      input.io.clearTimeout(timer);
      timer = null;
    }
    savePending();
  };

  return { scheduleSave, savePending, flushSave };
}

export interface InkCaptureInput {
  /** 只读（阅读态 / 已锁定的文档）：交父层最新正文，绝不交出可写正文。 */
  readOnly: boolean;
  /** 父层最新正文 = 阅读态下盘上正文（不能用挂载时的旧 diskBody，否则会覆盖刚保存的正文）。 */
  latestContent: string;
  serialize(): string | null;
  isSameAsDisk(body: string): boolean;
  diskBody: string;
}

/**
 * 编辑态「现算」捕获（onEditorCapture）：宿主在完成编辑 / 切标签 / 返回时调用。
 * 顺序即语义：只读 → 最新正文；序列化失败 → null（父层不写）；等价磁盘 → 磁盘原文；否则当前正文。
 */
export function captureInkBody(input: InkCaptureInput): string | null {
  if (input.readOnly) return input.latestContent;
  const body = input.serialize();
  if (body === null) return null;
  return input.isSameAsDisk(body) ? input.diskBody : body;
}
