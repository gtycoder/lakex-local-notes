/**
 * Worker pool for image conversion
 * Manages multiple Web Workers for parallel image processing
 */

interface WorkerTask {
  id: string;
  bytes: number[];
  mimeType: string;
  resolve: (bytes: number[]) => void;
  reject: (error: Error) => void;
  worker?: Worker;
  timeoutId?: number;
}

interface WorkerState {
  worker: Worker;
  busy: boolean;
}

/** 单任务超时：worker 卡死/无响应时保证 Promise 一定 settle（审计 #13） */
const TASK_TIMEOUT_MS = 60_000;

export class WorkerPool {
  private workers: WorkerState[] = [];
  private queue: WorkerTask[] = [];
  private taskIdCounter = 0;
  private pendingTasks = new Map<string, WorkerTask>();

  constructor(
    private workerFactory: () => Worker,
    private poolSize: number = 4
  ) {
    this.initializeWorkers();
  }

  private initializeWorkers(): void {
    for (let i = 0; i < this.poolSize; i++) {
      const worker = this.workerFactory();
      worker.onmessage = this.handleWorkerMessage.bind(this);
      worker.onerror = this.handleWorkerError.bind(this);
      this.workers.push({ worker, busy: false });
    }
  }

  private handleWorkerMessage(event: MessageEvent): void {
    const { id, success, bytes, error } = event.data;
    const task = this.pendingTasks.get(id);
    
    if (task) {
      this.pendingTasks.delete(id);
      if (task.timeoutId !== undefined) window.clearTimeout(task.timeoutId);
      
      if (success && bytes) {
        task.resolve(bytes);
      } else {
        task.reject(new Error(error || "Image conversion failed"));
      }
      
      // Mark worker as available and process next task
      const workerState = this.workers.find(w => w.worker === event.target);
      if (workerState) {
        workerState.busy = false;
        this.processQueue();
      }
    }
  }

  private handleWorkerError(event: ErrorEvent | { target: Worker; message?: string }): void {
    const message = event.message || "unknown error";
    console.error("Worker error:", message);
    const failed = event.target;
    const workerState = this.workers.find((w) => w.worker === failed);
    if (workerState) {
      // 审计 #13：拒绝该 worker 上所有 in-flight 任务（Promise 不悬挂），
      // 并 terminate + 替换崩溃 worker——绝不把后续任务再派给坏 worker
      for (const [id, task] of this.pendingTasks) {
        if (task.worker === failed) {
          this.pendingTasks.delete(id);
          if (task.timeoutId !== undefined) window.clearTimeout(task.timeoutId);
          task.reject(new Error(`图片转换 worker 崩溃: ${message}`));
        }
      }
      this.replaceWorker(workerState);
      this.processQueue();
    }
  }

  /** 销毁崩溃 worker 并创建替代实例（保持池大小） */
  private replaceWorker(workerState: WorkerState): void {
    try { workerState.worker.terminate(); } catch { /* 忽略 */ }
    const idx = this.workers.indexOf(workerState);
    if (idx === -1) return;
    const replacement = this.workerFactory();
    replacement.onmessage = this.handleWorkerMessage.bind(this);
    replacement.onerror = this.handleWorkerError.bind(this);
    this.workers[idx] = { worker: replacement, busy: false };
  }

  /**
   * Convert image bytes to PNG using a worker from the pool
   */
  async convertToPng(bytes: number[], mimeType: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const id = `task-${++this.taskIdCounter}`;
      const task: WorkerTask = { id, bytes, mimeType, resolve, reject };
      
      // Find available worker
      const availableWorker = this.workers.find(w => !w.busy);
      
      if (availableWorker) {
        this.executeTask(availableWorker, task);
      } else {
        this.queue.push(task);
      }
    });
  }

  private executeTask(workerState: WorkerState, task: WorkerTask): void {
    workerState.busy = true;
    task.worker = workerState.worker;
    this.pendingTasks.set(task.id, task);
    // 审计 #13：单任务超时——worker 卡死时 reject 并报废该 worker
    task.timeoutId = window.setTimeout(() => {
      if (!this.pendingTasks.has(task.id)) return;
      this.pendingTasks.delete(task.id);
      task.reject(new Error(`图片转换超时（${TASK_TIMEOUT_MS / 1000}s）`));
      this.handleWorkerError({ target: workerState.worker, message: "task timeout" });
    }, TASK_TIMEOUT_MS);
    try {
      workerState.worker.postMessage({
        id: task.id,
        bytes: task.bytes,
        mimeType: task.mimeType
      });
    } catch (error) {
      // 向已死 worker postMessage 会同步抛错：任务必须 settle，worker 必须替换
      if (task.timeoutId !== undefined) window.clearTimeout(task.timeoutId);
      this.pendingTasks.delete(task.id);
      task.reject(new Error(`图片转换 worker 不可用: ${error instanceof Error ? error.message : String(error)}`));
      this.handleWorkerError({ target: workerState.worker, message: "postMessage failed" });
    }
  }

  private processQueue(): void {
    if (this.queue.length === 0) return;
    
    const availableWorker = this.workers.find(w => !w.busy);
    if (availableWorker) {
      const task = this.queue.shift()!;
      this.executeTask(availableWorker, task);
    }
  }

  /**
   * Get pool status
   */
  get status() {
    return {
      totalWorkers: this.workers.length,
      busyWorkers: this.workers.filter(w => w.busy).length,
      queueSize: this.queue.length,
    };
  }

  /**
   * Terminate all workers
   */
  terminate(): void {
    this.workers.forEach(w => w.worker.terminate());
    this.workers = [];
    for (const task of this.pendingTasks.values()) task.reject(new Error("Worker pool terminated"));
    this.pendingTasks.clear();
    this.queue.forEach(task => task.reject(new Error("Worker pool terminated")));
    this.queue = [];
  }
}
