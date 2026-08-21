/**
 * Serializes async work per key while allowing unrelated keys to run in parallel.
 * A rejected task never blocks the next task for the same key.
 */
export class KeyedAsyncQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, task: () => T | Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(task);
    const tail = operation.then(() => undefined, () => undefined);
    this.tails.set(key, tail);

    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });

    return operation;
  }

  wait(key: string): Promise<void> {
    return this.tails.get(key) ?? Promise.resolve();
  }
}