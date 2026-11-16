import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AI 写作附件 IPC 的 **handler 级**护栏（261116 review P1-3）。
 *
 * 为什么需要：这三个通道此前只有四面 parity（通道名一致）+ UI 测试，**参数校验一行都没被测**。
 * 把 `isSafePathSegment` / `toUint8Array` / MIME 白名单 / 10MB 上限 / attachRefs 形状判据删掉，
 * 不会有任何测试红 —— 而这正是「坏输入只在运行时炸」的典型面。
 */

const state = vi.hoisted(() => ({
  userData: "",
  dialogPaths: [] as string[],
  dialogCanceled: false,
}));

vi.mock("electron", () => ({
  app: { getPath: () => state.userData, getVersion: () => "0.0.0-test" },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {
    showOpenDialog: async () => ({ canceled: state.dialogCanceled, filePaths: state.dialogPaths }),
  },
}));

import type { IpcMainInvokeEvent } from "electron";

const { registerAiWritingIpc } = await import("./registerAiWriting.js");
type IpcRegistrar = import("./registrar.js").IpcRegistrar;

interface Captured {
  channel: string;
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
}

/** 注意：`handle` 的 handler 只收业务参数；`handleEvent` 的 handler 收 (event, ...args)。 */
function captureIpc(): { ipc: IpcRegistrar; handlers: Map<string, { handler: Captured["handler"]; withEvent: boolean }> } {
  const handlers = new Map<string, { handler: Captured["handler"]; withEvent: boolean }>();
  const ipc = {
    handle: (channel: string, handler: Captured["handler"]) => { handlers.set(channel, { handler, withEvent: false }); },
    handleEvent: (channel: string, handler: Captured["handler"]) => { handlers.set(channel, { handler, withEvent: true }); },
    registry: new Map(),
  } as unknown as IpcRegistrar;
  return { ipc, handlers };
}

const repo = {
  listPastedAttachmentTokens: () => new Set<string>(),
  getConversation: () => null,
  appendMessage: () => ({ id: "m1" }),
  listConversations: () => [],
  createConversation: () => ({ id: "c1" }),
  updateConversationComposer: () => null,
  deleteConversation: () => {},
};

function build() {
  const { ipc, handlers } = captureIpc();
  registerAiWritingIpc(ipc, { getAiWritingRepository: () => repo } as unknown as import("../store.js").Store);
  // 一律 async：同步抛错也要变成 rejected promise，`.rejects` 才接得住（与真实 registrar 行为一致）。
  const call = async (channel: string, ...args: unknown[]) => {
    const entry = handlers.get(channel);
    if (!entry) throw new Error("channel not registered: " + channel);
    const event = { sender: { send: () => {} } } as unknown as IpcMainInvokeEvent;
    return entry.withEvent ? entry.handler(event, ...args) : (entry.handler as (...a: unknown[]) => unknown)(...args);
  };
  return { handlers, call };
}

let userData = "";
beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "lake-ai-ipc-"));
  state.userData = userData;
  state.dialogPaths = [];
  state.dialogCanceled = false;
});
afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("ai_save_pasted_image：参数校验（坏 bytes / 非图片 MIME / 超 10MB）", () => {
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

  it("坏 bytes（非 Uint8Array/数组）→ 可执行错误，不落盘", async () => {
    const { call } = build();
    await expect(call("ai_save_pasted_image", { not: "bytes" }, "image/png")).rejects.toThrow(/粘贴图片数据无效/);
    await expect(call("ai_save_pasted_image", new Uint8Array(0), "image/png")).rejects.toThrow(/粘贴图片数据无效/);
    const attachmentsDir = path.join(userData, "ai-attachments");
    expect(fs.existsSync(attachmentsDir) ? fs.readdirSync(attachmentsDir) : [], "坏输入不该落盘").toEqual([]);
  });

  it("非图片 MIME → 拒绝并点名支持格式（含 HEIC 的转换提示）", async () => {
    const { call } = build();
    await expect(call("ai_save_pasted_image", new Uint8Array(PNG), "text/plain")).rejects.toThrow(/不支持的粘贴类型：text\/plain（只支持 PNG\/JPEG\/WebP\/GIF\/BMP）/);
    await expect(call("ai_save_pasted_image", new Uint8Array(PNG), "image/heic")).rejects.toThrow(/HEIC\/HEIF 请先转换为 JPEG\/PNG/);
  });

  it("超 10MB → 拒绝，不写盘", async () => {
    const { call } = build();
    await expect(call("ai_save_pasted_image", new Uint8Array(10 * 1024 * 1024 + 1), "image/png")).rejects.toThrow(/粘贴图片过大（上限 10MB）/);
    expect(fs.existsSync(path.join(userData, "ai-attachments"))).toBe(false);
  });

  it("合法：回引用（不泄露路径），文件落在 <userData>/ai-attachments", async () => {
    const { call } = build();
    const ref = await call("ai_save_pasted_image", new Uint8Array(PNG), "image/png", "截图.png") as { token: string; name: string; size: number };
    expect(ref.token.startsWith("paste-")).toBe(true);
    expect(JSON.stringify(ref)).not.toContain(userData);
    expect(fs.existsSync(path.join(userData, "ai-attachments", ref.token.slice("paste-".length)))).toBe(true);
  });
});

describe("pick_ai_local_files：对话框结果与上限", () => {
  it("取消 → 空数组（不报错）", async () => {
    state.dialogCanceled = true;
    const { call } = build();
    await expect(call("pick_ai_local_files")).resolves.toEqual([]);
  });

  it("超过 10 个 → 拒绝（与 AI_WRITING_MAX_ATTACHMENTS 同口径）", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-pick-"));
    state.dialogPaths = Array.from({ length: 11 }, (_, i) => {
      const file = path.join(dir, "f" + i + ".txt");
      fs.writeFileSync(file, "x");
      return file;
    });
    try {
      const { call } = build();
      await expect(call("pick_ai_local_files")).rejects.toThrow(/一次最多添加 10 个附件/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("选中的都是空文件/目录 → 明确报「无法作为附件」", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-pick-empty-"));
    const empty = path.join(dir, "empty.txt");
    fs.writeFileSync(empty, "");
    state.dialogPaths = [empty, dir];
    try {
      const { call } = build();
      await expect(call("pick_ai_local_files")).rejects.toThrow(/所选文件无法作为附件/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("正常选两个 → 回引用（不含绝对路径）", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-pick-ok-"));
    const a = path.join(dir, "a.ts");
    const b = path.join(dir, "b.txt");
    fs.writeFileSync(a, "export const a = 1;");
    fs.writeFileSync(b, "hello");
    state.dialogPaths = [a, b];
    try {
      const { call } = build();
      const refs = await call("pick_ai_local_files") as Array<{ token: string; name: string }>;
      expect(refs.map((ref) => ref.name)).toEqual(["a.ts", "b.txt"]);
      expect(JSON.stringify(refs)).not.toContain(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ai_writing_append_message：attachRefs 形状判据（不静默丢弃）", () => {
  const base = { conversationId: "c1", role: "user", content: "hi" };

  it("坏项 → 报错（而不是悄悄少一个附件）", async () => {
    const { call } = build();
    await expect(call("ai_writing_append_message", { ...base, attachRefs: [{ token: "x" }] })).rejects.toThrow(/attachRefs 项无效或重复/);
    await expect(call("ai_writing_append_message", { ...base, attachRefs: [{ kind: "local", token: "t", name: "n", size: Number.NaN, mimeType: "text/plain" }] })).rejects.toThrow(/项无效或重复/);
    await expect(call("ai_writing_append_message", { ...base, attachRefs: "nope" })).rejects.toThrow(/attachRefs 必须是数组/);
  });

  it("assistant 不许带附件；超 10 个直接拒", async () => {
    const { call } = build();
    await expect(call("ai_writing_append_message", { ...base, role: "assistant", attachRefs: [{ noteId: "n", filename: "a.png" }] })).rejects.toThrow(/只有用户消息可以带附件/);
    const many = Array.from({ length: 11 }, (_, i) => ({ noteId: "n", filename: "a" + i + ".png" }));
    await expect(call("ai_writing_append_message", { ...base, attachRefs: many })).rejects.toThrow(/一次最多发送 10 个附件/);
  });
});
