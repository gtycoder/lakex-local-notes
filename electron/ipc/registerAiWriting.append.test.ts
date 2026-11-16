import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ai_writing_append_message 的 handler 级护栏（261116 review 缺口 P1-3）：
 * attachRefs 坏项/超限/角色、docs 模式本机文件拒绝、docs 资产必须来自已选文档。
 * 这些判据此前只有 parity 与 UI 测试，主进程校验删掉也不会红。
 */

const state = vi.hoisted(() => ({
  userData: "",
  mode: "chat" as "chat" | "docs",
  docRefs: [] as Array<{ kind: "note"; id: string; title: string }>,
  appends: [] as Array<Record<string, unknown>>,
}));

vi.mock("electron", () => ({
  app: { getPath: () => state.userData, getVersion: () => "0.0.0-test" },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
}));

import type { IpcMainInvokeEvent } from "electron";

const { registerAiWritingIpc } = await import("./registerAiWriting.js");
type IpcRegistrar = import("./registrar.js").IpcRegistrar;

interface Captured {
  channel: string;
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
}

function captureIpc(): { ipc: IpcRegistrar; handlers: Map<string, { handler: Captured["handler"]; withEvent: boolean }> } {
  const handlers = new Map<string, { handler: Captured["handler"]; withEvent: boolean }>();
  const ipc = {
    handle: (channel: string, handler: Captured["handler"]) => { handlers.set(channel, { handler, withEvent: false }); },
    handleEvent: (channel: string, handler: Captured["handler"]) => { handlers.set(channel, { handler, withEvent: true }); },
    registry: new Map(),
  } as unknown as IpcRegistrar;
  return { ipc, handlers };
}

function build() {
  const repo = {
    listPastedAttachmentTokens: () => new Set<string>(),
    getConversation: (id: string) => (id === "c1" ? {
      id: "c1",
      mode: state.mode,
      title: "t",
      promptText: null,
      docRefs: state.docRefs,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } : null),
    appendMessage: (input: Record<string, unknown>) => {
      state.appends.push(input);
      return { id: "m1", sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z", ...input };
    },
  };
  const { ipc, handlers } = captureIpc();
  registerAiWritingIpc(ipc, { getAiWritingRepository: () => repo } as unknown as import("../store.js").Store);
  const call = async (channel: string, ...args: unknown[]) => {
    const entry = handlers.get(channel);
    if (!entry) throw new Error("channel not registered: " + channel);
    const event = { sender: { send: () => {} } } as unknown as IpcMainInvokeEvent;
    return entry.withEvent ? entry.handler(event, ...args) : (entry.handler as (...a: unknown[]) => unknown)(...args);
  };
  return { call };
}

const localRef = (overrides: Record<string, unknown> = {}) => ({
  kind: "local", token: "loc-a", name: "a.png", size: 3, mimeType: "image/png", ...overrides,
});
const assetRef = (overrides: Record<string, unknown> = {}) => ({ noteId: "n1", filename: "a.png", ...overrides });

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-ai-append-"));
  state.userData = dir;
  state.mode = "chat";
  state.docRefs = [];
  state.appends = [];
});
afterEach(() => {
  fs.rmSync(state.userData, { recursive: true, force: true });
});

describe("ai_writing_append_message · attachRefs 校验", () => {
  it("chat 合法本机图片：落库带 attachRefs", async () => {
    const { call } = build();
    const saved = await call("ai_writing_append_message", { conversationId: "c1", role: "user", content: "看图", attachRefs: [localRef()] });
    expect(saved).toMatchObject({ id: "m1", role: "user" });
    expect(state.appends[0].attachRefs).toEqual([localRef()]);
  });

  it("assistant 带附件 → 拒绝（只有用户消息能带附件）", async () => {
    const { call } = build();
    await expect(call("ai_writing_append_message", { conversationId: "c1", role: "assistant", content: "好", attachRefs: [localRef()] })).rejects.toThrow(/只有用户消息可以带附件/);
    expect(state.appends).toHaveLength(0);
  });

  it("坏项/重复项 → 拒绝（不静默变少一张）", async () => {
    const { call } = build();
    await expect(call("ai_writing_append_message", { conversationId: "c1", role: "user", content: "x", attachRefs: [{ kind: "local", token: "loc-a" }] })).rejects.toThrow(/attachRefs 项无效或重复/);
    await expect(call("ai_writing_append_message", { conversationId: "c1", role: "user", content: "x", attachRefs: [localRef(), localRef()] })).rejects.toThrow(/attachRefs 项无效或重复/);
    expect(state.appends).toHaveLength(0);
  });

  it("超过 AI_WRITING_MAX_ATTACHMENTS → 拒绝", async () => {
    const { call } = build();
    const refs = Array.from({ length: 11 }, (_, i) => localRef({ token: "loc-" + i, name: i + ".png" }));
    await expect(call("ai_writing_append_message", { conversationId: "c1", role: "user", content: "x", attachRefs: refs })).rejects.toThrow(/一次最多发送/);
  });
});

describe("ai_writing_append_message · 模式判据（docs 只收已选文档资产图）", () => {
  it("docs 带本机文件 → 拒绝并给可执行提示", async () => {
    state.mode = "docs";
    state.docRefs = [{ kind: "note", id: "n1", title: "文档1" }];
    const { call } = build();
    await expect(call("ai_writing_append_message", { conversationId: "c1", role: "user", content: "x", attachRefs: [localRef()] })).rejects.toThrow(/多文档推理|本机文件/);
    expect(state.appends).toHaveLength(0);
  });

  it("docs 的资产附件不在已选文档 → 拒绝；在 → 落库", async () => {
    state.mode = "docs";
    state.docRefs = [{ kind: "note", id: "n1", title: "文档1" }];
    const { call } = build();
    await expect(call("ai_writing_append_message", { conversationId: "c1", role: "user", content: "x", attachRefs: [assetRef({ noteId: "n2" })] })).rejects.toThrow(/已选文档|文档/);
    expect(state.appends).toHaveLength(0);

    await call("ai_writing_append_message", { conversationId: "c1", role: "user", content: "x", attachRefs: [assetRef()] });
    expect(state.appends[0].attachRefs).toEqual([assetRef()]);
  });
});
