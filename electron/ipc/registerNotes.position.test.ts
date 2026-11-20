import os from "node:os";
import { describe, expect, it, vi } from "vitest";

/**
 * 261117 用户点单「新建文档位置」的 IPC 层护栏。
 *
 * 渲染层通过 position 可选参数把「顶部新增 / 末尾追加」传给主进程；这里钉住：
 * - 所有创建通道都透传 position（文档 5 种 + 分组 + 笔记本 + create_note 默认落点）；
 * - 缺省/非法值归一为 "bottom"（旧渲染层不传 = 与改造前逐字节一致）；
 * - 不新增 channel（通道数不变，ipcChannelParity 另有断言）。
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

const calls: Array<{ method: string; args: unknown[] }> = [];

function captureIpc(): { ipc: IpcRegistrar; handlers: Map<string, Captured> } {
  const handlers = new Map<string, Captured>();
  const ipc = {
    handle: (channel: string, handler: Captured["handler"]) => { handlers.set(channel, { handler, withEvent: false }); },
    handleEvent: (channel: string, handler: Captured["handler"]) => { handlers.set(channel, { handler, withEvent: true }); },
    registry: new Map(),
  } as unknown as IpcRegistrar;
  return { ipc, handlers };
}

/** 记录创建调用的 store 桩：只实现被测通道需要的方法。 */
function recordingStore(): Record<string, unknown> {
  const record = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); return { id: "new-node" }; };
  return {
    createNote: record("createNote"),
    createNoteIn: record("createNoteIn"),
    createUsheetIn: record("createUsheetIn"),
    createBitableIn: record("createBitableIn"),
    createBoardIn: record("createBoardIn"),
    createInkIn: record("createInkIn"),
    createGroup: record("createGroup"),
    createNotebook: record("createNotebook"),
  };
}

function noopProxy<T extends object>(overrides: Partial<T>): T {
  return new Proxy(overrides as T, {
    get: (target, key) => {
      if (key in target) return (target as Record<string | symbol, unknown>)[key];
      return () => undefined;
    },
  });
}

async function callHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  const { ipc, handlers } = captureIpc();
  registerNotesIpc(
    ipc,
    recordingStore() as unknown as import("../store.js").Store,
    noopProxy<object>({}) as unknown as import("../quickNotes.js").QuickNotesStore,
    noopProxy<object>({}) as unknown as import("../draftJournal.js").DraftJournal,
    "/tmp/lake-position-ipc-test",
    () => {},
    async <T,>(task: () => Promise<T>): Promise<T> => task(),
  );
  const entry = handlers.get(channel);
  if (!entry) throw new Error("channel not registered: " + channel);
  const event = { sender: { send: () => {} } } as unknown as IpcMainInvokeEvent;
  return entry.withEvent ? entry.handler(event, ...args) : (entry.handler as (...a: unknown[]) => unknown)(...args);
}

function lastCall(method: string): unknown[] {
  const hit = [...calls].reverse().find((item) => item.method === method);
  if (!hit) throw new Error("未调用 " + method);
  return hit.args;
}

describe("创建类 IPC：position 透传与归一", () => {
  it("create_note / create_note_in：top 原样透传，缺省与非法值 = bottom", async () => {
    await callHandler("create_note", "标题", "top");
    expect(lastCall("createNote")).toEqual(["标题", "top"]);

    await callHandler("create_note", "标题");
    expect(lastCall("createNote")).toEqual(["标题", "bottom"]);

    await callHandler("create_note_in", null, "标题", "top");
    expect(lastCall("createNoteIn")).toEqual([null, "标题", "top", undefined]);

    await callHandler("create_note_in", "parent-1", "标题", "garbage");
    expect(lastCall("createNoteIn")).toEqual(["parent-1", "标题", "bottom", undefined]);
  });

  // 261120 用户点单「在上方/在下方新建文档」：第 4 参 = 同父级锚点 sort_order。
  // 上方新建传锚点 - 1（可能是 -1 = 插到同级首位），下方新建传锚点本身；非整数一律当未指定。
  it("create_note_in：afterSortOrder 整数透传，非法值当未指定", async () => {
    await callHandler("create_note_in", "p", "标题", "bottom", 3);
    expect(lastCall("createNoteIn")).toEqual(["p", "标题", "bottom", 3]);

    await callHandler("create_note_in", "p", "标题", undefined, -1);
    expect(lastCall("createNoteIn")).toEqual(["p", "标题", "bottom", -1]);

    await callHandler("create_note_in", "p", "标题", undefined, "2");
    expect(lastCall("createNoteIn")).toEqual(["p", "标题", "bottom", undefined]);
  });

  // 261120（目录右键「在上方/在下方新建」二级菜单）：六种 kind 都能带同父级锚点（非整数当未指定）。
  it("四个 kind + 分组：afterSortOrder 锚点整透传（含 -1 = 插到同级首位）", async () => {
    await callHandler("create_usheet_in", "p", "表格", "bottom", 3);
    expect(lastCall("createUsheetIn")).toEqual(["p", "表格", "bottom", 3]);
    await callHandler("create_bitable_in", "p", "多维表", "bottom", -1);
    expect(lastCall("createBitableIn")).toEqual(["p", "多维表", "bottom", -1]);
    await callHandler("create_board_in", "p", "画板", "bottom", "2");
    expect(lastCall("createBoardIn")).toEqual(["p", "画板", "bottom", undefined]);
    await callHandler("create_ink_in", "p", "手写板", "bottom", 0);
    expect(lastCall("createInkIn")).toEqual(["p", "手写板", "bottom", 0]);
    await callHandler("create_group", "p", "分组", "bottom", 5);
    expect(lastCall("createGroup")).toEqual(["p", "分组", "bottom", 5]);
  });

  it("四个 kind + 分组 + 笔记本：全部透传 position", async () => {
    await callHandler("create_usheet_in", "p", "表格", "top");
    expect(lastCall("createUsheetIn")).toEqual(["p", "表格", "top", undefined]);
    await callHandler("create_bitable_in", "p", "多维表", "top");
    expect(lastCall("createBitableIn")).toEqual(["p", "多维表", "top", undefined]);
    await callHandler("create_board_in", "p", "画板", "top");
    expect(lastCall("createBoardIn")).toEqual(["p", "画板", "top", undefined]);
    await callHandler("create_ink_in", "p", "手写板", "top");
    expect(lastCall("createInkIn")).toEqual(["p", "手写板", "top", undefined]);

    await callHandler("create_group", "p", "分组", "top");
    expect(lastCall("createGroup")).toEqual(["p", "分组", "top", undefined]);

    await callHandler("create_notebook", "笔记本", "diary", "top");
    expect(lastCall("createNotebook")).toEqual(["笔记本", "diary", undefined, "top"]);
  });
});
