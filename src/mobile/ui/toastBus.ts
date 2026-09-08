/**
 * 移动端提示条总线（对齐思源 dialog/message.ts 的 showMessage 语义）。
 * 思源口径：默认 6000ms 自动消失、点一下即关、type=info|error（error 左侧带 ❗）。
 * 用模块级总线而非 Context/prop drilling：深层组件（回收站、设置子页）都能一行调用。
 */
export type ToastType = "info" | "error";
export interface ToastItem { id: string; text: string; type: ToastType; timeout: number; }

let seq = 0;
let version = 0;
const items = new Map<string, ToastItem>();
const listeners = new Set<() => void>();
const timers = new Map<string, number>();

function emit() { version++; listeners.forEach((l) => l()); }

/** 稳定快照（useSyncExternalStore 要求：内容未变时返回同一引用） */
let cacheVersion = -1;
let cacheList: ToastItem[] = [];
export function getToastSnapshot(): ToastItem[] {
  if (cacheVersion !== version) { cacheVersion = version; cacheList = [...items.values()]; }
  return cacheList;
}

export function showToast(text: string, opts: { type?: ToastType; timeout?: number } = {}): string {
  const id = "t" + ++seq;
  const timeout = opts.timeout ?? 6000;
  items.set(id, { id, text, type: opts.type ?? "info", timeout });
  emit();
  if (timeout > 0) {
    timers.set(id, window.setTimeout(() => hideToast(id), timeout));
  }
  return id;
}

/** 关闭：先摘 timer，再通知（组件侧做退场动画后真正移除） */
export function hideToast(id: string): void {
  const t = timers.get(id);
  if (t != null) { window.clearTimeout(t); timers.delete(id); }
  if (!items.has(id)) return;
  items.delete(id);
  emit();
}

export function listToasts(): ToastItem[] { return [...items.values()]; }

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
