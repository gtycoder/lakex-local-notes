/**
 * 大纲标签句柄注册表：EditorTab 注册（controller/navigate/refresh），
 * 全局右侧栏按 activeNoteId 取当前标签的大纲句柄。
 */
import type { OutlineController } from "./OutlineController";

export interface OutlineTabHandle {
  controller: OutlineController;
  /** 点击条目 → 定位正文 */
  navigate: (id: string) => void;
  /** 根据当前滚动位置刷新选中高亮（侧栏打开/切换标签时调用） */
  refresh: () => void;
}

const handles = new Map<string, OutlineTabHandle>();
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* 单个订阅者异常不影响其他订阅者 */
    }
  }
}

export function registerOutlineTab(noteId: string, handle: OutlineTabHandle): void {
  handles.set(noteId, handle);
  emit();
}

export function unregisterOutlineTab(noteId: string): void {
  if (handles.delete(noteId)) emit();
}

export function getOutlineTab(noteId: string | null): OutlineTabHandle | null {
  return noteId ? handles.get(noteId) ?? null : null;
}

export function subscribeOutlineTabs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getOutlineTabsVersion(): number {
  return version;
}
