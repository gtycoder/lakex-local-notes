import { KeyedAsyncQueue } from "../core/keyedAsyncQueue";

/**
 * 保存管线核心（V5 Phase 4）：串行队列 + revision 竞态保护，纯逻辑可单测。
 * hook（useSavePipeline）仅做 React 包装；移动端可直接复用本核心。
 */
export class SavePipelineCore {
  private readonly queue = new KeyedAsyncQueue();
  private readonly revisions = new Map<string, number>();

  /** 当前 revision（保存请求发出前快照；此后 bump 会使快照失效 → 不覆盖草稿）。 */
  revision(noteId: string): number {
    return this.revisions.get(noteId) ?? 0;
  }

  /** 有新编辑：revision 增长，旧保存响应不得覆盖草稿/清除 dirty（审计 #7）。 */
  bump(noteId: string): void {
    this.revisions.set(noteId, (this.revisions.get(noteId) ?? 0) + 1);
  }

  /** 打开/恢复文档时重置 revision。 */
  reset(noteId: string, revision = 0): void {
    this.revisions.set(noteId, revision);
  }

  /** 关闭/删除笔记：清理 revision（挂起定时器由调用方负责）。 */
  clear(noteId: string): void {
    this.revisions.delete(noteId);
  }

  /** 每笔记串行执行保存任务（同 key 不并发；失败不阻塞后续）。 */
  run<T>(noteId: string, task: () => Promise<T>): Promise<T> {
    return this.queue.run(noteId, task);
  }
}
