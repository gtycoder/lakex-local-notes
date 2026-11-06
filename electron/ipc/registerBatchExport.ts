/**
 * 261106 批量导出 IPC：export_notes_batch（数据层见 electron/batchExport.ts）。
 *
 * 契约：入参 { ids, dirPath? }；dirPath 缺省时主进程弹目录选择框（取消 ⇒ { ok:false, cancelled:true }）。
 * 返回 { ok, results:[{id, ok, path?, paths?, format?, skipped?, reason?}], summary:{total,done,failed,skipped}, dirPath }。
 *
 * 安全：dirPath 给了就必须是本进程系统选择框的返回值（与 export_note 同一判据，见 exportDirState）。
 * 只读：本通道不写源数据、不标 dirty、不广播（不进 TREE_CHANGING_CHANNELS）。
 */
import { BrowserWindow, dialog, shell } from "electron";
import type { IpcRegistrar } from "./registrar.js";
import type { Store } from "../store.js";
import { exportNotesBatch, type BatchExportOptions, type BatchExportResult } from "../batchExport.js";
import { pickedExportDir, rememberPickedExportDir } from "./exportDirState.js";
import { IpcInputError } from "../ipcLimits.js";

export interface BatchExportIpcDeps {
  store: Store;
  /** 测试注入：系统目录选择框。 */
  showOpenDialog?: typeof dialog.showOpenDialog;
  /** 测试注入：真正的导出实现（默认 = electron/batchExport.exportNotesBatch）。 */
  runBatch?: (options: BatchExportOptions) => Promise<BatchExportResult>;
}

function focusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

export function registerBatchExportIpc(ipc: IpcRegistrar, deps: BatchExportIpcDeps): void {
  const showOpenDialog = deps.showOpenDialog ?? dialog.showOpenDialog;
  const runBatch = deps.runBatch ?? exportNotesBatch;
  ipc.handle("export_notes_batch", async (payload: unknown) => {
    const raw = (payload ?? {}) as { ids?: unknown; dirPath?: unknown };
    if (!Array.isArray(raw.ids)) throw new IpcInputError("ids 必须是数组");
    const ids = raw.ids.filter((value): value is string => typeof value === "string" && value.length > 0);
    if (ids.length === 0) throw new IpcInputError("请先选择要导出的条目");
    let dirPath: string | null = null;
    if (raw.dirPath !== undefined && raw.dirPath !== null && raw.dirPath !== "") {
      if (typeof raw.dirPath !== "string") throw new IpcInputError("导出目录无效");
      if (raw.dirPath !== pickedExportDir()) throw new IpcInputError("导出目录无效：请先通过系统选择框选择目录");
      dirPath = raw.dirPath;
    } else {
      const result = await showOpenDialog(focusedWindow() ?? undefined as unknown as BrowserWindow, {
        title: "选择导出位置",
        buttonLabel: "导出到此目录",
        properties: ["openDirectory", "createDirectory"],
      });
      const picked = result.canceled ? null : (result.filePaths[0] ?? null);
      if (!picked) {
        rememberPickedExportDir(null);
        return { ok: false, cancelled: true, results: [], summary: { total: 0, done: 0, failed: 0, skipped: 0 }, reason: "cancelled", message: "已取消导出" } as BatchExportResult;
      }
      rememberPickedExportDir(picked);
      dirPath = picked;
    }
    return runBatch({ store: deps.store, ids, dirPath, log: (message) => console.info(message) });
  });

  /**
   * 261106 task-88：批量导出结束后「打开所在文件夹」。
   * 安全：只允许打开**最近一次系统选择框选中的导出目录**（与 dirPath 同一判据 `pickedExportDir`），
   * 不接受渲染层任意路径 —— 避免把「打开目录」变成通用文件系统能力。
   */
  ipc.handle("open_export_dir", async (dirPath: unknown) => {
    if (typeof dirPath !== "string" || !dirPath) throw new IpcInputError("导出目录无效");
    if (dirPath !== pickedExportDir()) throw new IpcInputError("导出目录无效：请先通过系统选择框选择目录");
    const error = await shell.openPath(dirPath);
    return { ok: !error, error: error || undefined, path: dirPath };
  });
}
