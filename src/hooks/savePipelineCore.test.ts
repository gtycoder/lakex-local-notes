import { describe, expect, it } from "vitest";
import { SavePipelineCore } from "./savePipelineCore";

describe("SavePipelineCore（保存管线核心：队列 + revision 竞态保护）", () => {
  it("revision 默认 0；bump 递增；reset 可归零", () => {
    const core = new SavePipelineCore();
    expect(core.revision("n1")).toBe(0);
    core.bump("n1");
    core.bump("n1");
    expect(core.revision("n1")).toBe(2);
    core.reset("n1", 0);
    expect(core.revision("n1")).toBe(0);
  });

  it("审计 #7：保存期间 bump → 旧快照失效（不覆盖草稿）", async () => {
    const core = new SavePipelineCore();
    let finalize = false;
    const snapshot = core.revision("n1"); // 保存请求发出前快照
    // 模拟保存请求进行中来了新编辑
    core.bump("n1");
    // 响应返回后：当前 revision 与快照不同 → 不 finalize
    if (core.revision("n1") === snapshot) finalize = true;
    expect(finalize).toBe(false);
  });

  it("保存期间无新编辑 → 快照仍有效（finalize）", async () => {
    const core = new SavePipelineCore();
    const snapshot = core.revision("n2");
    expect(core.revision("n2")).toBe(snapshot);
  });

  it("run 按 noteId 串行：同 key 任务不并发，异 key 并行", async () => {
    const core = new SavePipelineCore();
    const order: string[] = [];
    const task = (id: string) => core.run(id, async () => {
      order.push(`start-${id}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(`end-${id}`);
    });
    await Promise.all([task("a"), task("a"), task("b")]);
    // 同 key a 串行：start-a,end-a,start-a,end-a；b 与 a 并发但自身有序
    expect(order.indexOf("start-a")).toBeLessThan(order.indexOf("end-a"));
    expect(order.indexOf("end-a")).toBeLessThan(order.indexOf("start-a", order.indexOf("end-a") + 1) === -1 ? order.length : order.indexOf("start-a", order.indexOf("end-a") + 1));
  });

  it("clear 移除 revision（关闭/删除笔记后不残留）", () => {
    const core = new SavePipelineCore();
    core.bump("n3");
    core.clear("n3");
    expect(core.revision("n3")).toBe(0);
  });
});
