import { afterEach, describe, expect, it, vi } from "vitest";

const dialogMock = vi.hoisted(() => ({ showOpenDialog: vi.fn() }));
vi.mock("electron", () => ({
  dialog: { showOpenDialog: dialogMock.showOpenDialog },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}));

import { registerBatchExportIpc } from "./registerBatchExport.js";
import { rememberPickedExportDir } from "./exportDirState.js";
import type { BatchExportOptions, BatchExportResult } from "../batchExport.js";
import { IpcInputError } from "../ipcLimits.js";

/**
 * 261106 批量导出 IPC：目录弹框/取消、dirPath 必须是本进程选择框返回值、ids 校验、转接导出实现。
 * 真导出逻辑由 electron/batchExport.test.ts 覆盖；这里只守通道契约与授权边界。
 */
type Handler = (...args: unknown[]) => unknown;

const okResult: BatchExportResult = {
  ok: true,
  results: [{ id: "a", ok: true, format: "pdf", path: "/tmp/out/a.pdf" }],
  summary: { total: 1, done: 1, failed: 0, skipped: 0 },
  dirPath: "/tmp/out",
};

function harness() {
  dialogMock.showOpenDialog.mockReset();
  rememberPickedExportDir(null);
  const runBatch = vi.fn(async (_options: BatchExportOptions): Promise<BatchExportResult> => okResult);
  const handlers = new Map<string, Handler>();
  const ipc = {
    handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
    handleEvent: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
    registry: new Map(),
  };
  registerBatchExportIpc(ipc as unknown as Parameters<typeof registerBatchExportIpc>[0], {
    store: {} as unknown as BatchExportOptions["store"],
    showOpenDialog: dialogMock.showOpenDialog as never,
    runBatch,
  });
  return { runBatch, channels: () => [...handlers.keys()], call: (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args) };
}

afterEach(() => { dialogMock.showOpenDialog.mockReset(); rememberPickedExportDir(null); });

describe("export_notes_batch：通道与目录授权", () => {
  it("只注册 export_notes_batch 与 open_export_dir 两个通道（261106 task-88 打开所在文件夹）", () => {
    expect(harness().channels()).toEqual(["export_notes_batch", "open_export_dir"]);
  });

  it("open_export_dir：只允许最近一次选择框选中的目录（渲染层任意路径 ⇒ IpcInputError）", async () => {
    const h = harness();
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/picked"] });
    await h.call("export_notes_batch", { ids: ["a"] });
    // 授权目录 = 主进程记住的那个
    await expect(h.call("open_export_dir", "/etc")).rejects.toBeInstanceOf(IpcInputError);
    await expect(h.call("open_export_dir", "")).rejects.toBeInstanceOf(IpcInputError);
  });

  it("缺省 dirPath ⇒ 主进程弹目录框；用户取消 ⇒ { cancelled:true } 且不导出", async () => {
    const h = harness();
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const result = await h.call("export_notes_batch", { ids: ["a"] }) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: false, cancelled: true, reason: "cancelled" });
    expect(dialogMock.showOpenDialog).toHaveBeenCalledTimes(1);
    expect(dialogMock.showOpenDialog.mock.calls[0][1]).toMatchObject({ properties: ["openDirectory", "createDirectory"] });
    expect(h.runBatch).not.toHaveBeenCalled();
  });

  it("缺省 dirPath 且选中目录 ⇒ 记入授权 + 以该目录导出", async () => {
    const h = harness();
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/picked"] });
    const result = await h.call("export_notes_batch", { ids: ["a"] }) as BatchExportResult;
    expect(result).toEqual(okResult);
    expect(h.runBatch).toHaveBeenCalledTimes(1);
    expect(h.runBatch.mock.calls[0][0]).toMatchObject({ ids: ["a"], dirPath: "/tmp/picked" });
    // 授权已记住：下一次可以直接传 dirPath
    const second = await h.call("export_notes_batch", { ids: ["b"], dirPath: "/tmp/picked" }) as BatchExportResult;
    expect(second).toEqual(okResult);
  });

  it("渲染层传任意 dirPath（未经选择框）⇒ IpcInputError", async () => {
    const h = harness();
    await expect(h.call("export_notes_batch", { ids: ["a"], dirPath: "/etc" })).rejects.toBeInstanceOf(IpcInputError);
    expect(h.runBatch).not.toHaveBeenCalled();
  });

  it("ids 非法/为空 ⇒ IpcInputError（不弹框、不导出）", async () => {
    const h = harness();
    await expect(h.call("export_notes_batch", { ids: "a" })).rejects.toBeInstanceOf(IpcInputError);
    await expect(h.call("export_notes_batch", { ids: [] })).rejects.toBeInstanceOf(IpcInputError);
    await expect(h.call("export_notes_batch", {})).rejects.toBeInstanceOf(IpcInputError);
    expect(dialogMock.showOpenDialog).not.toHaveBeenCalled();
    expect(h.runBatch).not.toHaveBeenCalled();
  });
});
