import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `list_note_image_assets` 的 handler 级护栏（261116 review P1-3）。
 *
 * 这个通道给 AI 写作选图器按文档列图片；它把渲染层传进来的 noteId 拼进磁盘路径 ——
 * **路径段校验**是唯一防线（`isSafePathSegment`），删掉不会有任何测试红。这里把它钉住。
 */

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir(), getVersion: () => "0.0.0-test" },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => "", openExternal: async () => {} },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (b: Buffer) => Buffer.from(b), decryptString: (b: Buffer) => b.toString() },
  net: { fetch: vi.fn() },
}));

import type { IpcMainInvokeEvent } from "electron";

const { registerNotesIpc } = await import("./registerNotes.js");
type IpcRegistrar = import("./registrar.js").IpcRegistrar;

interface Captured {
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
  withEvent: boolean;
}

function captureIpc(): { ipc: IpcRegistrar; handlers: Map<string, Captured> } {
  const handlers = new Map<string, Captured>();
  const ipc = {
    handle: (channel: string, handler: Captured["handler"]) => { handlers.set(channel, { handler, withEvent: false }); },
    handleEvent: (channel: string, handler: Captured["handler"]) => { handlers.set(channel, { handler, withEvent: true }); },
    registry: new Map(),
  } as unknown as IpcRegistrar;
  return { ipc, handlers };
}

let noteAssetsRoot = "";
let noteIdCalls: string[] = [];

/** 只实现被测通道需要的方法；其余 store/quickNotes/drafts 方法一律 no-op（注册期不应调用它们）。 */
function noopProxy<T extends object>(overrides: Partial<T>): T {
  return new Proxy(overrides as T, {
    get: (target, key) => {
      if (key in target) return (target as Record<string | symbol, unknown>)[key];
      return () => undefined;
    },
  });
}

// 一律 async：同步抛错也变成 rejected promise（与真实 registrar 一致）。
async function callHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  const { ipc, handlers } = captureIpc();
  const store = noopProxy<Record<string, unknown>>({
    noteAssetsPathFor: (noteId: string) => {
      noteIdCalls.push(noteId);
      return path.join(noteAssetsRoot, noteId);
    },
  });
  registerNotesIpc(
    ipc,
    store as unknown as import("../store.js").Store,
    noopProxy<object>({}) as unknown as import("../quickNotes.js").QuickNotesStore,
    noopProxy<object>({}) as unknown as import("../draftJournal.js").DraftJournal,
    "/tmp/lake-notes-test-workspace",
    () => {},
    async <T,>(task: () => Promise<T>): Promise<T> => task(),
  );
  const entry = handlers.get(channel);
  if (!entry) throw new Error("channel not registered: " + channel);
  const event = { sender: { send: () => {} } } as unknown as IpcMainInvokeEvent;
  return entry.withEvent ? entry.handler(event, ...args) : (entry.handler as (...a: unknown[]) => unknown)(...args);
}

beforeEach(() => {
  noteAssetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lake-image-assets-"));
  noteIdCalls = [];
});
afterEach(() => {
  fs.rmSync(noteAssetsRoot, { recursive: true, force: true });
});

describe("list_note_image_assets（AI 写作选图器）", () => {
  it("只列图片：png/jpg/webp 进结果，txt 与非文件条目跳过，按名字排序", async () => {
    const dir = path.join(noteAssetsRoot, "note-1");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "b.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
    fs.writeFileSync(path.join(dir, "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(path.join(dir, "c.webp"), Buffer.from("RIFF"));
    fs.writeFileSync(path.join(dir, "note.txt"), "x");
    fs.mkdirSync(path.join(dir, "nested.png")); // 目录即使叫 .png 也不算

    const out = await callHandler("list_note_image_assets", "note-1") as Array<{ filename: string; size: number; mimeType: string }>;
    expect(out.map((item) => item.filename)).toEqual(["a.png", "b.jpg", "c.webp"]);
    expect(out[0]).toMatchObject({ mimeType: "image/png", size: 4 });
  });

  it("目录不存在 → 空数组（不抛错，选图器不至于挂）", async () => {
    await expect(callHandler("list_note_image_assets", "no-such-note")).resolves.toEqual([]);
  });

  it("非法 noteId（路径段穿越/空/控制字符）→ 明确报错，且**不碰磁盘**", async () => {
    for (const bad of ["../etc", "a/b", "..", "", "nul\u0000byte", "x\\y"]) {
      await expect(callHandler("list_note_image_assets", bad), JSON.stringify(bad)).rejects.toThrow(/非法笔记 id/);
    }
    expect(noteIdCalls, "非法 id 不该走到 store.noteAssetsPathFor").toEqual([]);
  });

  it("非字符串 noteId → 报错（不静默当成空 id 去列根目录）", async () => {
    await expect(callHandler("list_note_image_assets", 42)).rejects.toThrow(/非法笔记 id/);
    await expect(callHandler("list_note_image_assets", undefined)).rejects.toThrow(/非法笔记 id/);
  });
});
