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
  it("注册 export_notes_batch / open_export_dir / write_batch_export_file 三个通道", () => {
    expect(harness().channels().sort()).toEqual(["export_notes_batch", "open_export_dir", "write_batch_export_file"]);
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

describe("export_notes_batch：boardImages（画板字节透传）", () => {
  const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

  it("合法字节原样传给导出实现；非法条目丢弃（该画板最终 skipped）", async () => {
    const h = harness();
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/picked"] });
    await h.call("export_notes_batch", {
      ids: ["a"],
      boardImages: {
        "board-1": { bytes: Array.from(PNG), format: "png" },
        "board-2": { bytes: Array.from(PNG), format: "svg" }, // 内容与声明不符 ⇒ 丢弃
        "board-3": { bytes: [], format: "png" },             // 空字节 ⇒ 丢弃
        "board-4": "not-an-object",                          // 形状不对 ⇒ 丢弃
      },
    });
    const options = h.runBatch.mock.calls[0][0] as BatchExportOptions;
    expect(Object.keys(options.boardImages ?? {})).toEqual(["board-1"]);
    expect(options.boardImages?.["board-1"].format).toBe("png");
    expect(options.boardImages?.["board-1"].bytes.byteLength).toBe(PNG.byteLength);
  });
});

describe("write_batch_export_file：受控写盘", () => {
  const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const SVG = new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));

  it("目录未授权 / 扩展名不在白名单 / 字节为空 / 内容与扩展名不符 ⇒ IpcInputError", () => {
    const h = harness();
    expect(() => h.call("write_batch_export_file", { dirPath: "/etc", fileName: "a", ext: "png", bytes: Array.from(PNG) })).toThrowError(IpcInputError);
    rememberPickedExportDir("/tmp/picked");
    expect(() => h.call("write_batch_export_file", { dirPath: "/tmp/picked", fileName: "a", ext: "pdf", bytes: Array.from(PNG) })).toThrowError(IpcInputError);
    expect(() => h.call("write_batch_export_file", { dirPath: "/tmp/picked", fileName: "a", ext: "png", bytes: [] })).toThrowError(IpcInputError);
    expect(() => h.call("write_batch_export_file", { dirPath: "/tmp/picked", fileName: "a", ext: "svg", bytes: Array.from(PNG) })).toThrowError(IpcInputError);
  });

  it("合法写入：清洗文件名 + 同名「 (2)」+ 原子落盘（读回字节一致）", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-write-board-"));
    try {
      const h = harness();
      rememberPickedExportDir(dir);
      const first = h.call("write_batch_export_file", { dirPath: dir, fileName: "画板/1", ext: "png", bytes: Array.from(PNG) }) as { ok: boolean; path: string };
      expect(first.ok).toBe(true);
      expect(path.basename(first.path)).toBe("画板 1.png");
      expect(new Uint8Array(fs.readFileSync(first.path))).toEqual(PNG);
      // 同名再来一次 ⇒ 「 (2)」，不覆盖
      const second = h.call("write_batch_export_file", { dirPath: dir, fileName: "画板 1", ext: "png", bytes: Array.from(PNG) }) as { path: string };
      expect(path.basename(second.path)).toBe("画板 1 (2).png");
      // SVG 也允许（内容校验通过）
      const svgTarget = h.call("write_batch_export_file", { dirPath: dir, fileName: "图", ext: "svg", bytes: Array.from(SVG) }) as { path: string };
      expect(path.basename(svgTarget.path)).toBe("图.svg");
      expect(fs.readFileSync(svgTarget.path, "utf8")).toContain("<svg");
      // 没有 .tmp 残留
      expect(fs.readdirSync(dir).filter((name) => name.includes(".tmp-"))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
