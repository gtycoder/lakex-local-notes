// @vitest-environment jsdom
/**
 * P1-2 合帧护栏（useAiWriting）：
 * ① 同一帧内多个 delta 只提交最后一次 setStream（合帧）；
 * ② 生成结束当帧必须显示完整内容（flush，不残留截断）；
 * ③ 停止（stop）也走同一 flush 路径。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  runAiChat: vi.fn(),
  cancelAiChat: vi.fn(async () => undefined),
  loadAiSettings: vi.fn(async () => ({ activeProviderId: "deepseek", providers: [{ id: "deepseek", label: "DeepSeek", hasApiKey: true, model: "deepseek-chat" }] })),
  native: {
    aiWritingList: vi.fn(() => later([] as unknown[])),
    aiWritingGet: vi.fn(() => later(null as unknown)),
    aiWritingCreate: vi.fn((input: { mode: string; title: string }) => later({ id: "c1", mode: input.mode, title: input.title, promptText: null, docRefs: [], createdAt: "", updatedAt: "" })),
    aiWritingAppendMessage: vi.fn((input: { role: string; content?: string; attachRefs?: unknown; conversationId: string }) => later({
      id: input.role === "user" ? "u1" : "a1", conversationId: input.conversationId, role: input.role,
      content: input.content ?? "", attachRefs: input.attachRefs, reasoning: null, durationMs: null, stopped: false, error: null, sortOrder: 1, createdAt: "",
    })),
    aiWritingUpdateMessage: vi.fn((id: string, patch: { content?: string; reasoning?: string | null; durationMs?: number | null; stopped?: boolean; error?: string | null }) => later({
      id, conversationId: "c1", role: "assistant", content: patch.content ?? "", reasoning: patch.reasoning ?? null,
      durationMs: patch.durationMs ?? null, stopped: patch.stopped ?? false, error: patch.error ?? null, sortOrder: 2, createdAt: "",
    })),
    aiWritingDeleteLastAssistant: vi.fn(),
    aiWritingComposer: vi.fn(),
    onAiStream: vi.fn(() => () => undefined),
    readNoteCaches: vi.fn(), readNote: vi.fn(), readQuickNote: vi.fn(),
  },
}));

vi.mock("../../lib/ai", () => ({
  runAiChat: h.runAiChat,
  cancelAiChat: h.cancelAiChat,
  newAiRequestId: () => "req-1",
  loadAiEnabled: () => true,
  loadAiSettings: h.loadAiSettings,
}));
vi.mock("../../lib/native", () => ({ native: h.native }));

import { useAiWriting } from "./useAiWriting";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;
let frames: FrameRequestCallback[] = [];

const flushFrames = () => act(() => {
  const callbacks = [...frames];
  frames = [];
  callbacks.forEach((callback) => callback(0));
});
const flushMicro = async (times = 6) => { for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

/** 真实 IPC 一定是异步的（跨进程）⇒ mock 也走一个宏任务，让 React 有机会先落 conversationRef。 */
const later = <T,>(value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), 0));

const state = (): { input: string; stream: number | null; streamId: string | null; busy: boolean; lastContent: string } =>
  JSON.parse(document.querySelector("[data-state]")!.textContent!);

const click = (label: string) => act(() => {
  [...document.querySelectorAll("button")].find((button) => button.textContent === label)!.click();
});

function Harness() {
  const controller = useAiWriting({ active: true });
  const last = controller.messages[controller.messages.length - 1];
  return (
    <div>
      <output data-state>{JSON.stringify({
        input: controller.input,
        stream: controller.stream === null ? null : controller.stream.content.length,
        streamId: controller.stream?.messageId ?? null,
        busy: controller.busy,
        lastContent: last?.content ?? "",
      })}</output>
      <button type="button" onClick={() => controller.setInput("问题")}>type</button>
      <button type="button" onClick={() => controller.send()}>send</button>
      <button type="button" onClick={() => controller.stop()}>stop</button>
    </div>
  );
}

/** 可控的假聊天：拿到 onDelta，由用例决定何时吐 delta / 何时 resolve。 */
function deferredChat() {
  let resolve!: (value: { ok: boolean; text?: string }) => void;
  const sink: { delta: ((value: string) => void) | null } = { delta: null };
  h.runAiChat.mockImplementation((_id: string, _messages: unknown, onDelta?: (value: string) => void) => {
    sink.delta = onDelta ?? null;
    return new Promise<{ ok: boolean; text?: string }>((done) => { resolve = done; });
  });
  return { push: (value: string) => { if (sink.delta) sink.delta(value); }, resolve: (value: { ok: boolean; text?: string }) => resolve(value) };
}

async function startTurn() {
  await flushMicro(); // 等挂载期的 aiWritingList 落定（loading 守卫会挡 send）
  click("type");
  click("send");
  await flushMicro();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames[id - 1] = () => undefined; });
  h.runAiChat.mockReset();
  h.cancelAiChat.mockClear();
  h.native.aiWritingAppendMessage.mockClear();
  h.native.aiWritingUpdateMessage.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => { root!.render(<Harness />); });
});

afterEach(() => {
  act(() => { root?.unmount(); });
  host.remove();
  root = null;
  vi.unstubAllGlobals();
});

describe("useAiWriting · 流式合帧（P1-2）", () => {
  it("同一帧内多个 delta 只提交最后一次：flush 帧前 stream 不更新，flush 后是最新值", async () => {
    const chat = deferredChat();
    await startTurn();
    expect(h.runAiChat).toHaveBeenCalledTimes(1);

    act(() => { chat.push("a"); chat.push("b"); chat.push("c"); });
    // 合帧：帧未执行前不产生 state 更新。
    expect(state().stream).toBeNull();
    expect(frames.length).toBe(1);

    flushFrames();
    expect(state().stream).toBe(3);
    expect(frames.length).toBe(0);

    chat.resolve({ ok: true, text: "abc" });
    await flushMicro();
  });

  it("生成结束当帧显示完整内容（flush 后 stream 清空、占位消息回填全文，不残留截断）", async () => {
    const chat = deferredChat();
    await startTurn();
    const chunks = Array.from({ length: 50 }, (_, index) => "第" + index + "段");
    const full = chunks.join("");
    act(() => { chunks.forEach((chunk) => chat.push(chunk)); });
    flushFrames();
    expect(state().stream).toBe(full.length);

    chat.resolve({ ok: true, text: full });
    await flushMicro();
    const done = state();
    expect(done.stream).toBeNull();
    expect(done.busy).toBe(false);
    // 结束帧必须是完整正文（节流/合帧都不允许残留截断）。
    expect(done.lastContent).toBe(full);
    expect(done.lastContent.length).toBe(full.length);
  });

  it("stop 也走同一 flush 路径：保留已生成片段并标记 stopped", async () => {
    const chat = deferredChat();
    await startTurn();
    act(() => { chat.push("部分"); });
    flushFrames();
    click("stop");
    expect(h.cancelAiChat).toHaveBeenCalledWith("req-1");

    chat.resolve({ ok: true, text: "部分" });
    await flushMicro();
    const done = state();
    expect(done.stream).toBeNull();
    expect(done.lastContent).toBe("部分");
  });
});