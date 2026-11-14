/**
 * 「隐藏（关闭）一级空间」的**设备本地存储 + 订阅**（261114）。
 *
 * 与默认空间同范式：localStorage 独立键、**不进 S3 / 不参与同步**（换设备各自保留自己的入口）。
 * React 侧用 `useSyncExternalStore` 订阅；set 后同一会话内所有入口（菜单 / Dock / 默认空间下拉）立即重渲染。
 * 键与可关闭列表由两端各自的 `spaceVisibility` 提供（桌面 / 移动 id 不同）。
 */
import { sanitizeHiddenSpaces } from "../core/hiddenSpaces";

type Listener = () => void;
const cache = new Map<string, readonly string[]>();
const listeners = new Map<string, Set<Listener>>();

function storageGet(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readFromStorage<T extends string>(key: string, hideable: readonly T[]): T[] {
  const raw = storageGet(key);
  if (!raw) return [];
  try {
    return sanitizeHiddenSpaces(JSON.parse(raw), hideable);
  } catch {
    return [];
  }
}

/** 读当前隐藏列表（同步、稳定引用；存储不可用/值非法 ⇒ 空数组 = 全部可见）。 */
export function getHiddenSpaces<T extends string>(key: string, hideable: readonly T[]): readonly T[] {
  const cached = cache.get(key);
  if (cached) return cached as readonly T[];
  const value = readFromStorage(key, hideable);
  cache.set(key, value);
  return value;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** 写隐藏列表：只留合法 id、去重、持久化，并通知订阅者。无变化不通知。 */
export function setHiddenSpaces<T extends string>(key: string, next: readonly T[], hideable: readonly T[]): void {
  const value = sanitizeHiddenSpaces([...next], hideable);
  const prev = cache.get(key);
  cache.set(key, value);
  try {
    if (typeof window !== "undefined") {
      if (value.length > 0) window.localStorage.setItem(key, JSON.stringify(value));
      else window.localStorage.removeItem(key);
    }
  } catch {
    // 存储不可用：本次会话仍按新值跑（cache 已更新），只是记不住。
  }
  if (prev && sameList(prev, value)) return;
  for (const listener of listeners.get(key) ?? []) listener();
}

export function subscribeHiddenSpaces(key: string, listener: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/** 仅供测试：清掉内存缓存（不断言 localStorage）。 */
export function resetHiddenSpacesCacheForTest(): void {
  cache.clear();
}
