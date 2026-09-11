/**
 * 移动端自动保存：内容变化防抖 1s（对齐桌面 useSavePipeline 的 SAVE_DEBOUNCE_MS）后落盘。
 * 比桌面版更轻：只做防抖保存，不含草稿 journal / revision 队列（移动端无这些崩溃兜底需求）。
 */
import { useCallback, useEffect, useRef } from "react";

const DEBOUNCE_MS = 1000;

export function useAutoSave(save: (id: string, title: string, content: string, plain?: string) => void) {
  const timers = useRef<Map<string, number>>(new Map());
  const saveRef = useRef(save);
  saveRef.current = save;

  const schedule = useCallback((id: string, title: string, content: string, plain?: string) => {
    const existing = timers.current.get(id);
    if (existing !== undefined) window.clearTimeout(existing);
    const t = window.setTimeout(() => {
      timers.current.delete(id);
      saveRef.current(id, title, content, plain);
    }, DEBOUNCE_MS);
    timers.current.set(id, t);
  }, []);

  /** 立即冲刷所有挂起的保存（关闭/完成/返回前调用，避免与显式保存双写）。 */
  const flush = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current.clear();
  }, []);

  useEffect(() => flush, [flush]);

  return { schedule, flush };
}
