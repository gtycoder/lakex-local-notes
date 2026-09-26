/**
 * 快照式撤销/重做（多维表文档）。T 为不可变快照（组件里存 BitableTable[]）。
 * 只做「压栈/出栈」，不关心快照内容，便于单测；组件层负责在 doc 变化时 push、撤销时用返回值替换。
 */
export interface SnapshotHistory<T> {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  push(snapshot: T): void;
  undo(current: T): T | null;
  redo(current: T): T | null;
  clear(): void;
}

export function createSnapshotHistory<T>(limit = 100): SnapshotHistory<T> {
  const past: T[] = [];
  const future: T[] = [];
  return {
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    push(snapshot) {
      past.push(snapshot);
      if (past.length > limit) past.shift();
      future.length = 0;
    },
    undo(current) {
      if (past.length === 0) return null;
      future.push(current);
      return past.pop()!;
    },
    redo(current) {
      if (future.length === 0) return null;
      past.push(current);
      return future.pop()!;
    },
    clear() { past.length = 0; future.length = 0; },
  };
}
