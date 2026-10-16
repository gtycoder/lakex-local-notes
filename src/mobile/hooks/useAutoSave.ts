/**
 * 移动端自动保存：内容变化防抖 1s（对齐桌面 useSavePipeline 的 SAVE_DEBOUNCE_MS）后落盘。
 *
 * 审计 F05：旧实现把 flush 写成「清掉全部 timer」——完成当前文档时会把**别篇待保存任务取消掉**。
 * 现在 flush 会立即保存挂起的（全部或指定）文档；cancel 才是明确丢弃，两者分开命名。
 * 卸载/工作区离开不应依赖 cleanup 保证落盘：显式调用 flush，cleanup 只做取消兜底。
 */
import { useCallback, useEffect, useRef } from "react";

const DEBOUNCE_MS = 1000;

type Pending = { timer: number; title: string; content: string; plain?: string };

export function useAutoSave(save: (id: string, title: string, content: string, plain?: string) => void) {
  const timers = useRef<Map<string, Pending>>(new Map());
  const saveRef = useRef(save);
  saveRef.current = save;

  const schedule = useCallback((id: string, title: string, content: string, plain?: string) => {
    const existing = timers.current.get(id);
    if (existing) window.clearTimeout(existing.timer);
    const timer = window.setTimeout(() => {
      timers.current.delete(id);
      saveRef.current(id, title, content, plain);
    }, DEBOUNCE_MS);
    timers.current.set(id, { timer, title, content, plain });
  }, []);

  /** 立即保存挂起的文档（关闭/完成/返回前调用）；不传 id = 全部。返回后 timer 不再触发。 */
  const flush = useCallback((id?: string) => {
    const entries: Array<[string, Pending]> = id === undefined
      ? [...timers.current.entries()]
      : (timers.current.has(id) ? [[id, timers.current.get(id)!]] : []);
    for (const [key, entry] of entries) {
      window.clearTimeout(entry.timer);
      timers.current.delete(key);
      saveRef.current(key, entry.title, entry.content, entry.plain);
    }
  }, []);

  /** 明确丢弃挂起的保存（不写盘）。与 flush 区分命名。 */
  const cancel = useCallback((id?: string) => {
    if (id === undefined) {
      timers.current.forEach((entry) => window.clearTimeout(entry.timer));
      timers.current.clear();
      return;
    }
    const entry = timers.current.get(id);
    if (entry) { window.clearTimeout(entry.timer); timers.current.delete(id); }
  }, []);

  useEffect(() => () => cancel(), [cancel]);

  return { schedule, flush, cancel };
}
