/**
 * 261106 批量导出 IPC：export_notes_batch（数据层见 electron/batchExport.ts）。
 *
 * 契约：入参 { ids, dirPath?, boardImages? }；dirPath 缺省时主进程弹目录选择框（取消 ⇒ { ok:false, cancelled:true }）。
 * boardImages = 渲染层交回的画板图像字节（{ [id]: { bytes, format: "png" | "svg" } }）⇒ 主进程内嵌成 PDF；
 * 缺字节的画板返回 skipped。返回 { ok, results:[...], summary:{total,done,failed,skipped}, dirPath }。
 *
 * 另有受控写盘 write_batch_export_file（渲染层自己产出的图像字节落进本次选择框选中的导出目录）。
 *
 * 安全：dirPath 给了就必须是本进程系统选择框的返回值（与 export_note 同一判据，见 exportDirState）。
 * 只读：本通道不写源数据、不标 dirty、不广播（不进 TREE_CHANGING_CHANNELS）。
 */
import { BrowserWindow, dialog, shell } from "electron";
import type { IpcRegistrar } from "./registrar.js";
import type { Store } from "../store.js";
import {
  exportNotesBatch,
  normalizeBoardImages,
  sanitizeBatchExportTitle,
  uniqueBatchExportPath,
  type BatchExportOptions,
  type BatchExportResult,
} from "../batchExport.js";
import { MAX_BOARD_IMAGE_BYTES, sniffBoardImageFormat, writeFileAtomicSync } from "../boardImagePdf.js";
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
    const raw = (payload ?? {}) as { ids?: unknown; dirPath?: unknown; boardImages?: unknown };
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
    // 画板字节：渲染层先渲染再传（见 src/features/board/boardSnapshot.ts）；非法条目丢弃 ⇒ 该画板 skipped。
    const boardImages = normalizeBoardImages(raw.boardImages);
    return runBatch({ store: deps.store, ids, dirPath, boardImages, log: (message) => console.info(message) });
  });

  /**
   * 261106 task-95：受控写盘 —— 渲染层产出的画板 PNG/SVG 字节落到**本次选择框选中的导出目录**。
   * 约束（防变成通用文件系统能力）：dirPath 必须是 pickedExportDir；ext 白名单 png/svg；
   * bytes ≤ 50MB 且魔数/结构与 ext 一致；命名复用批量导出的唯一命名（同名「 (2)」）；tmp→rename 原子写。
   */
  ipc.handle("write_batch_export_file", (payload: unknown) => {
    const raw = (payload ?? {}) as { dirPath?: unknown; fileName?: unknown; ext?: unknown; bytes?: unknown };
    if (typeof raw.dirPath !== "string" || !raw.dirPath) throw new IpcInputError("导出目录无效");
    if (raw.dirPath !== pickedExportDir()) throw new IpcInputError("导出目录无效：请先通过系统选择框选择目录");
    const ext = raw.ext === "svg" ? "svg" : raw.ext === "png" ? "png" : null;
    if (!ext) throw new IpcInputError("只允许写入 png/svg（批量导出其它格式由主进程生成）");
    const bytes = raw.bytes instanceof Uint8Array
      ? raw.bytes
      : Array.isArray(raw.bytes)
        ? Uint8Array.from(raw.bytes.filter((item): item is number => typeof item === "number"))
        : null;
    if (!bytes || bytes.byteLength === 0) throw new IpcInputError("文件字节为空");
    if (bytes.byteLength > MAX_BOARD_IMAGE_BYTES) {
      throw new IpcInputError("文件超过 " + Math.round(MAX_BOARD_IMAGE_BYTES / 1024 / 1024) + "MB 上限");
    }
    const sniffed = sniffBoardImageFormat(bytes);
    if (sniffed !== ext) throw new IpcInputError("文件内容与扩展名不一致（" + ext + "）");
    const baseTitle = sanitizeBatchExportTitle(String(raw.fileName ?? "board"));
    const targetPath = uniqueBatchExportPath(raw.dirPath, baseTitle, ext);
    writeFileAtomicSync(targetPath, bytes);
    return { ok: true, path: targetPath };
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
