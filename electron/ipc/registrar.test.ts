import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import { createIpcRegistrar } from "./registrar.js";

/**
 * 浏览器端（HTTP 调用方）的 handleEvent 通道：event.sender.send 必须转到注入的 httpSend
 *（main.ts 里 = webServerController.broadcast），否则 AI 流式 / 同步进度在浏览器端是 no-op。
 */
describe("IPC registrar：HTTP 调用方的事件转发", () => {
  it("handleEvent 里的 event.sender.send 走 httpSend（AI 流式）", async () => {
    const sent: Array<[string, unknown]> = [];
    const ipc = createIpcRegistrar(() => {}, undefined, (channel, payload) => { sent.push([channel, payload]); });
    ipc.handleEvent("ai_chat", async (event) => {
      event.sender.send("ai:stream", { requestId: "r1", delta: "hi" });
      return { ok: true };
    });
    const call = ipc.registry.get("ai_chat")!;
    await expect(call([])).resolves.toEqual({ ok: true });
    expect(sent).toEqual([["ai:stream", { requestId: "r1", delta: "hi" }]]);
  });

  it("未注入 httpSend 时 send 是 no-op（不抛错，调用照常返回）", async () => {
    const ipc = createIpcRegistrar(() => {});
    ipc.handleEvent("sync_now", async (event) => {
      event.sender.send("sync-progress", { phase: "done" });
      return 1;
    });
    await expect(ipc.registry.get("sync_now")!([])).resolves.toBe(1);
  });
});
