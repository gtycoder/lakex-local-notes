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
}

interface WorkerState {
  worker: Worker;
  busy: boolean;
}

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

  private handleWorkerError(event: ErrorEvent): void {
    console.error("Worker error:", event.error);
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
    this.pendingTasks.set(task.id, task);
    workerState.worker.postMessage({
      id: task.id,
      bytes: task.bytes,
      mimeType: task.mimeType
    });
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
    this.queue.forEach(task => task.reject(new Error("Worker pool terminated")));
    this.queue = [];
  }
}
