// @vitest-environment jsdom
/**
 * 模式切换强判据（261116 第四稿）：切模式 = 新会话视图 + 清空 docRefs/attachRefs/输入 + 取消在途请求。
 * 这里用最小 harness 直接跑 hook（native 全部 mock），把状态暴露到 DOM 上断言。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  aiWritingList: vi.fn(async () => [] as unknown[]),
  aiWritingGet: vi.fn(async (_id: string) => null as unknown),
  aiWritingComposer: vi.fn(async () => null),
  aiSaveSettings: vi.fn(),
  aiGetSettings: vi.fn(async () => ({ activeProviderId: "deepseek", providers: [{ id: "deepseek", label: "DeepSeek", hasApiKey: true, model: "deepseek-chat" }] })),
  aiCancel: vi.fn(async () => undefined),
  aiSavePastedImage: vi.fn(async () => ({ kind: "local", token: "paste-t", name: "p.png", size: 3, mimeType: "image/png" })),
  aiWritingAppendMessage: vi.fn(),
  aiWritingUpdateMessage: vi.fn(),
  aiWritingCreate: vi.fn(),
  aiWritingDelete: vi.fn(async () => true),
  aiChat: vi.fn(async () => ({ ok: true, content: "回答" })),
}));
vi.mock("../../lib/native", () => ({
  native: {
    aiWritingList: h.aiWritingList,
    aiWritingGet: h.aiWritingGet,
    aiWritingComposer: h.aiWritingComposer,
    aiGetSettings: h.aiGetSettings,
    aiCancel: h.aiCancel,
    aiSavePastedImage: h.aiSavePastedImage,
    aiWritingAppendMessage: h.aiWritingAppendMessage,
    aiWritingUpdateMessage: h.aiWritingUpdateMessage,
    aiWritingDeleteLastAssistant: vi.fn(),
    aiWritingCreate: h.aiWritingCreate,
    aiWritingRename: vi.fn(),
    aiWritingDelete: h.aiWritingDelete,
    aiChat: h.aiChat,
    pickAiLocalFiles: vi.fn(async () => []),
    onAiStream: vi.fn(() => () => {}),
    readNoteCaches: vi.fn(), readNote: vi.fn(), readQuickNote: vi.fn(),
  },
}));

import { useAiWriting } from "./useAiWriting";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;
const flush = (ms = 30) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

/** 手动 reslove 的 promise：模拟「IPC 尚未返回时用户切走」。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const message = (overrides: Record<string, unknown> = {}) => ({
  id: "m1", conversationId: "c1", role: "user", content: "问题", reasoning: null,
  durationMs: null, stopped: false, error: null, attachRefs: [], sortOrder: 0, createdAt: "",
  ...overrides,
});

function Harness() {
  const controller = useAiWriting({ active: true });
  return (
    <div>
      <output data-testid="state">{JSON.stringify({
        mode: controller.mode,
        docRefs: controller.docRefs.length,
        attachRefs: controller.attachRefs.length,
        attachKeys: controller.attachRefs.map((ref) => ("noteId" in ref ? ref.noteId + "/" + ref.filename : "local")),
        input: controller.input,
        promptText: controller.promptText,
        loadError: controller.loadError,
        messages: controller.messages.length,
        activeId: controller.activeConversation?.id ?? null,
      })}</output>
      <button type="button" onClick={() => controller.selectConversation("c1")}>select</button>
      <button type="button" onClick={() => controller.setMode("chat")}>switch-chat</button>
      <button type="button" onClick={() => controller.setMode("docs")}>switch-docs</button>
      <button type="button" onClick={() => controller.setInput("草稿")}>type</button>
      <button type="button" onClick={() => controller.addAttachments([{ noteId: "n0", filename: "a.png" }, { noteId: "n1", filename: "b.png" }])}>add-attach</button>
      <button type="button" onClick={() => controller.setDocRefs([{ kind: "note", id: "n1", title: "文档1" }])}>prune-docs</button>
      <button type="button" onClick={() => { void controller.pasteImages([{ type: "image/png", size: 3, name: "p.png", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as unknown as File]); }}>paste-image</button>
      <button type="button" onClick={() => controller.send("问题")}>send</button>
    </div>
  );
}

const state = (): Record<string, unknown> => JSON.parse(document.querySelector('[data-testid="state"]')!.textContent!);
const click = (label: string) => act(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
});

beforeEach(() => {
  window.localStorage.setItem("lakex-local-notes-v3.ai.enabled", "1");
  h.aiWritingComposer.mockClear();
  h.aiWritingAppendMessage.mockReset();
  h.aiWritingAppendMessage.mockImplementation(async (input: Record<string, unknown>) => message(input));
  h.aiWritingUpdateMessage.mockReset();
  h.aiWritingUpdateMessage.mockImplementation(async (id: string, patch: Record<string, unknown>) => message({ id, role: "assistant", content: "", ...patch }));
  h.aiWritingCreate.mockReset();
  h.aiWritingDelete.mockReset();
  h.aiWritingDelete.mockResolvedValue(true);
  h.aiChat.mockReset();
  h.aiChat.mockResolvedValue({ ok: true, content: "回答" });
  h.aiWritingGet.mockResolvedValue({
    conversation: {
      id: "c1", mode: "docs", title: "知识库问答", promptText: "分三点",
      docRefs: Array.from({ length: 23 }, (_, i) => ({ kind: "note", id: "n" + i, title: "文档" + i })),
      createdAt: "", updatedAt: "",
    },
    messages: [{ role: "user", content: "问题", attachRefs: [] }],
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => { root!.render(<Harness />); });
});

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  root = null;
  document.body.innerHTML = "";
  window.localStorage.clear();
});

describe("useAiWriting · 模式切换", () => {
  it("docs 会话带 23 篇文档；切到对话写作 = 新视图 + 清空 docRefs/附件/输入 + 不动旧会话", async () => {
    await flush();
    click("select");
    await flush();
    expect(state().mode).toBe("docs");
    expect(state().docRefs).toBe(23);
    click("type");
    click("switch-chat");
    await flush();
    const next = state();
    expect(next.mode).toBe("chat");
    expect(next.docRefs).toBe(0);
    expect(next.attachRefs).toBe(0);
    expect(next.input).toBe("");
    expect(next.promptText).toBeNull();
    expect(next.messages).toBe(0);
    expect(next.activeId).toBeNull();
    // 旧会话不被写改（没有 composer patch、没有自动切换会话）
    expect(h.aiWritingComposer).not.toHaveBeenCalled();
    expect(h.aiWritingGet).toHaveBeenCalledTimes(1);
  });

  it("docs 模式换选文档 ⇒ 引用被移除文档的附件一并清掉（不留悬空附件）", async () => {
    await flush();
    click("select");
    await flush();
    click("add-attach");
    expect((state().attachKeys as string[]).sort()).toEqual(["n0/a.png", "n1/b.png"]);
    click("prune-docs");
    expect(state().docRefs).toBe(1);
    expect(state().attachKeys).toEqual(["n1/b.png"]);
  });

  it("粘贴图片：chat 模式落盘并加引用；docs 模式拒绝且不保存", async () => {
    h.aiSavePastedImage.mockClear();
    await flush();
    click("paste-image");
    await flush();
    expect(h.aiSavePastedImage).toHaveBeenCalledTimes(1);
    expect(state().attachKeys).toEqual(["local"]);

    click("switch-docs"); // 切模式清空附件视图
    await flush();
    h.aiSavePastedImage.mockClear();
    click("paste-image");
    await flush();
    expect(h.aiSavePastedImage).not.toHaveBeenCalled();
    expect(state().attachKeys).toEqual([]);
    expect(String(state().loadError)).toContain("多文档推理");
  });

  it("打开 chat 会话时忽略历史里残留的 docRefs（纯对话判据）", async () => {
    h.aiWritingGet.mockResolvedValueOnce({
      conversation: { id: "c2", mode: "chat", title: "对话", promptText: null, docRefs: [{ kind: "note", id: "n1", title: "旧文档" }], createdAt: "", updatedAt: "" },
      messages: [],
    });
    h.aiWritingList.mockResolvedValueOnce([]);
    await flush();
    click("select");
    await flush();
    expect(state().mode).toBe("chat");
    expect(state().docRefs).toBe(0);
  });
});

describe("useAiWriting · 生成 epoch（review P1-1，延迟 IPC 下切走不泄漏）", () => {
  it("正常 send（append 异步返回）仍会启动请求，不误判 stale", async () => {
    await flush();
    h.aiWritingCreate.mockImplementationOnce(async () => ({ id: "new1", mode: "chat", title: "问题", promptText: null, docRefs: [], createdAt: "", updatedAt: "" }));
    // 真实 IPC 是跨进程 macrotask；用 setTimeout 让 setActiveConversation 的 render 先提交（避免测试假阴性）。
    h.aiWritingAppendMessage.mockImplementationOnce((input: Record<string, unknown>) => new Promise((resolve) => setTimeout(() => resolve(message(input)), 0)));
    click("send");
    await flush(60);
    expect(h.aiChat).toHaveBeenCalledTimes(1);
    expect(state().activeId).toBe("new1");
    expect(state().messages).toBe(2);
  });

  it("send 的 user 消息 append 未返回时切模式：旧异步不写回、不启动请求", async () => {
    await flush();
    click("select");
    await flush();
    const pending = deferred<ReturnType<typeof message>>();
    h.aiWritingAppendMessage.mockImplementationOnce(() => pending.promise);
    click("send");
    await flush(5);
    click("switch-chat");
    await flush(5);
    expect(state().mode).toBe("chat");
    expect(state().messages).toBe(0);
    expect(state().activeId).toBeNull();

    pending.resolve(message());
    await flush();
    expect(state().mode).toBe("chat");
    expect(state().messages).toBe(0);
    expect(state().activeId).toBeNull();
    expect(h.aiChat).not.toHaveBeenCalled();
    expect(h.aiWritingUpdateMessage).not.toHaveBeenCalled();
  });

  it("send 新建会话期间切走：刚建的空会话被清掉，不把旧会话带回新视图", async () => {
    await flush();
    const pending = deferred<Record<string, unknown>>();
    h.aiWritingCreate.mockImplementationOnce(() => pending.promise);
    click("send");
    await flush(5);
    click("switch-docs");
    await flush(5);
    // 建会话返回时 epoch 已变：删除刚建的空会话，不 setActive/不 append 用户消息。
    pending.resolve({ id: "new1", mode: "chat", title: "问题", promptText: null, docRefs: [], createdAt: "", updatedAt: "" });
    await flush();
    expect(h.aiWritingDelete).toHaveBeenCalledWith("new1");
    expect(state().mode).toBe("docs");
    expect(state().activeId).toBeNull();
    expect(state().messages).toBe(0);
    expect(h.aiWritingAppendMessage).not.toHaveBeenCalled();
    expect(h.aiChat).not.toHaveBeenCalled();
  });

  it("选择会话的 get 未返回时切模式：旧结果不回写 active/messages", async () => {
    await flush();
    const pending = deferred<{ conversation: Record<string, unknown>; messages: unknown[] }>();
    h.aiWritingGet.mockImplementationOnce(() => pending.promise);
    click("select");
    await flush(5);
    click("switch-docs");
    await flush(5);
    pending.resolve({
      conversation: { id: "c1", mode: "docs", title: "知识库问答", promptText: null, docRefs: [], createdAt: "", updatedAt: "" },
      messages: [message()],
    });
    await flush();
    expect(state().mode).toBe("docs");
    expect(state().activeId).toBeNull();
    expect(state().messages).toBe(0);
  });
});
