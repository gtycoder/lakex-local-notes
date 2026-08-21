import { describe, expect, it } from "vitest";
import { KeyedAsyncQueue } from "./keyedAsyncQueue.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("KeyedAsyncQueue", () => {
  it("runs tasks for one key in order", async () => {
    const queue = new KeyedAsyncQueue();
    const first = deferred<void>();
    const events: string[] = [];

    const one = queue.run("note-1", async () => {
      events.push("first-start");
      await first.promise;
      events.push("first-end");
    });
    const two = queue.run("note-1", async () => {
      events.push("second");
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["first-start"]);

    first.resolve();
    await Promise.all([one, two]);
    expect(events).toEqual(["first-start", "first-end", "second"]);
  });

  it("allows different keys to run in parallel", async () => {
    const queue = new KeyedAsyncQueue();
    const gate = deferred<void>();
    const events: string[] = [];

    const first = queue.run("note-1", async () => {
      events.push("one-start");
      await gate.promise;
      events.push("one-end");
    });
    const second = queue.run("note-2", async () => {
      events.push("two");
    });

    await second;
    expect(events).toEqual(["one-start", "two"]);

    gate.resolve();
    await first;
    expect(events).toEqual(["one-start", "two", "one-end"]);
  });

  it("continues after a rejected task and wait observes the latest tail", async () => {
    const queue = new KeyedAsyncQueue();
    const failure = queue.run("note-1", async () => {
      throw new Error("expected failure");
    });
    const next = queue.run("note-1", async () => "ok");

    await expect(failure).rejects.toThrow("expected failure");
    await expect(next).resolves.toBe("ok");
    await expect(queue.wait("note-1")).resolves.toBeUndefined();
    await expect(queue.wait("missing")).resolves.toBeUndefined();
  });
});