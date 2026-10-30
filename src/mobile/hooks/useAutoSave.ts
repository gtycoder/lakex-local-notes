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
type Save = (id: string, title: string, content: string, plain?: string) => void | Promise<void>;
type Options = { onError?: (id: string, error: unknown) => void };

export function useAutoSave(save: Save, options: Options = {}) {
  const timers = useRef<Map<string, Pending>>(new Map());
  const inFlight = useRef<Map<string, Promise<void>>>(new Map());
  const saveRef = useRef(save);
  const onErrorRef = useRef(options.onError);
  saveRef.current = save;
  onErrorRef.current = options.onError;

  const clearTimer = useCallback((id: string) => {
    const entry = timers.current.get(id);
    if (!entry) return;
    window.clearTimeout(entry.timer);
    timers.current.delete(id);
  }, []);

  /**
   * 单飞保存：同一文档最多一个写请求在途。失败时把快照放回 pending，调用方仍能再次 flush；
   * 成功期间如果又来了新版本，继续落最新版本，避免旧快照排队覆盖新内容。
   */
  const drain = useCallback(async (id: string): Promise<void> => {
    const running = inFlight.current.get(id);
    if (running) {
      await running;
      if (timers.current.has(id)) await drain(id);
      return;
    }
    const entry = timers.current.get(id);
    if (!entry) return;
    clearTimer(id);
    let pending: Promise<void>;
    try {
      pending = Promise.resolve(saveRef.current(id, entry.title, entry.content, entry.plain));
    } catch (error) {
      pending = Promise.reject(error);
    }
    const observed = pending.catch((error) => {
      // 失败不丢最新快照；若期间已有更新版本，只保留更新版本。
      if (!timers.current.has(id)) timers.current.set(id, { ...entry, timer: -1 });
      onErrorRef.current?.(id, error);
      throw error;
    }).finally(() => {
      inFlight.current.delete(id);
    });
    inFlight.current.set(id, observed);
    await observed;
    if (timers.current.has(id)) await drain(id);
  }, [clearTimer]);

  const schedule = useCallback((id: string, title: string, content: string, plain?: string) => {
    clearTimer(id);
    const timer = window.setTimeout(() => {
      // ⚠️ 不要先 delete 再 drain：drain 靠 timers 里的快照取内容（删掉 = 静默不保存）。
      // 261030 实测定位：旧实现先 delete，防抖到点后 drain 取不到 entry 直接 return，自动保存从未落盘。
      void drain(id).catch(() => undefined);
    }, DEBOUNCE_MS);
    timers.current.set(id, { timer, title, content, plain });
  }, [clearTimer, drain]);

  /** 立即保存挂起的文档（关闭/完成/返回前调用）；不传 id = 全部。返回真正落盘完成的 Promise。 */
  const flush = useCallback(async (id?: string): Promise<void> => {
    const ids = new Set<string>();
    if (id === undefined) {
      timers.current.forEach((_entry, key) => ids.add(key));
      inFlight.current.forEach((_promise, key) => ids.add(key));
    } else {
      // ⚠️ 指定 id 时也必须等**在途**写：只等 pending timer 会立刻返回，
      // 让调用方（完成编辑）的显式 saveNote 与旧快照并发，旧快照后落盘会覆盖新内容（261030 review）。
      if (timers.current.has(id)) ids.add(id);
      if (inFlight.current.has(id)) ids.add(id);
    }
    await Promise.all([...ids].map((key) => drain(key)));
  }, [drain]);

  /** 明确丢弃挂起的保存（不写盘）。与 flush 区分命名。 */
  const cancel = useCallback((id?: string) => {
    if (id === undefined) {
      timers.current.forEach((entry) => window.clearTimeout(entry.timer));
      timers.current.clear();
      return;
    }
    clearTimer(id);
  }, [clearTimer]);

  useEffect(() => () => cancel(), [cancel]);

  return { schedule, flush, cancel };
}
