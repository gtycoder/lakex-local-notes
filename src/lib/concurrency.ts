/**
 * Concurrency control for async tasks
 * Limits the number of concurrent operations to prevent resource exhaustion
 */

export class ConcurrencyQueue {
  private running = 0;
  private queue: Array<() => Promise<void>> = [];

  constructor(private maxConcurrency: number = 3) {}

  /**
   * Add a task to the queue
   * @param task - Async function to execute
   * @returns Promise that resolves when the task completes
   */
  async add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const wrappedTask = async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.running--;
          this.processNext();
        }
      };

      if (this.running < this.maxConcurrency) {
        this.running++;
        wrappedTask();
      } else {
        this.queue.push(wrappedTask);
      }
    });
  }

  /**
   * Process the next task in the queue
   */
  private processNext(): void {
    if (this.queue.length > 0 && this.running < this.maxConcurrency) {
      this.running++;
      const nextTask = this.queue.shift()!;
      nextTask();
    }
  }

  /**
   * Get current queue status
   */
  get status() {
    return {
      running: this.running,
      queued: this.queue.length,
    };
  }
}

/**
 * Create a new concurrency queue with the specified max concurrency
 */
export function createConcurrencyQueue(maxConcurrency: number = 3): ConcurrencyQueue {
  return new ConcurrencyQueue(maxConcurrency);
}
