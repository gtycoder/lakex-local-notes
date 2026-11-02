/**
 * 手写板元素 id 生成（页 / 笔迹 / 导入页共用）。
 * 独立成文件是为了让 InkPad 与导入管线用同一份实现，避免两处各写一套 randomUUID 兜底。
 */
export function newInkId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
