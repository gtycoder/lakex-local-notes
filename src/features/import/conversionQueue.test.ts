import { beforeEach, describe, expect, it } from "vitest";
import {
  MarkdownImportError,
  conversionInFlight,
  enqueueConversion,
  resetConversionQueueForTest,
  withTimeout,
} from "./conversionQueue";

/**
 * 导入转换串行队列（D-09 收口：html/markdown 双管线各有一份队列/超时小工具 ⇒ 合一份）。
 * 串行的动机 = 同一时刻只跑一个转换，避免多内核并存的内存峰值（原 markdownImportPipeline 注释口径）。
 */
describe("导入转换串行队列（D-09）", () => {
  beforeEach(() => {
    resetConversionQueueForTest();
  });

  it("串行：前一个任务未完成，后一个不开始", async () => {
    const order: string[] = [];
    const first = enqueueConversion(async () => {
      order.push("a-start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("a-end");
      return 1;
    });
    const second = enqueueConversion(async () => {
      order.push("b-start");
      return 2;
    });
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(["a-start", "a-end", "b-start"]);
  });

  it("inFlight 计数：在途 +1、完成归零；前序失败不堵队列", async () => {
    const holder: { fail?: () => void } = {};
    const first = enqueueConversion(() => new Promise<void>((_resolve, reject) => {
      holder.fail = () => reject(new Error("boom"));
    }));
    const second = enqueueConversion(async () => "ok");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(conversionInFlight()).toBe(1);
    holder.fail?.();
    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
    expect(conversionInFlight()).toBe(0);
  });

  it("超时按 label 给文案（html 侧保持「Word 转换超时」；错误类沿用历史名 MarkdownImportError）", async () => {
    await expect(withTimeout(new Promise<never>(() => undefined), 20, "Word")).rejects.toMatchObject({
      name: "MarkdownImportError",
      code: "render-timeout",
      message: "Word 转换超时（超过 20ms）",
    });
    await expect(withTimeout(new Promise<never>(() => undefined), 20, "Markdown")).rejects.toMatchObject({
      message: "Markdown 转换超时（超过 20ms）",
    });
    expect(new MarkdownImportError("aborted", "x")).toBeInstanceOf(Error);
  });
});
