/**
 * 便携包导出 IPC（桌面，261109；spec docs/PORTABLE-TRANSFER.md）。
 *
 * 最小三通道：
 * - portable_export_status：入口可用性（云同步开 + 上轮同步成功 + 无待同步）+ 本进程上次导出结果；
 * - portable_export_pick_dir：系统目录选择框（返回路径不可由渲染层伪造，run 只认这一次选择）；
 * - portable_export_run：执行导出（进度走 portable-export-progress 事件，不占通道）。
 *
 * 可用性在这里**再判一次**（渲染层禁用态只是提示；真正拦截在主进程），避免绕过 UI 导出不一致的包。
 */
import { dialog } from "electron";
import { IpcInputError } from "../ipcLimits.js";
import type { IpcRegistrar } from "./registrar.js";
import type {
  PortableExportAvailability,
  PortableExportProgress,
  PortableExportResult,
  PortableExportStatus,
} from "../../src/core/portable/portableFormat.js";
import { exportPortablePackage } from "../portable/portableExport.js";
import { importPortablePackageOnDesktop } from "../portable/portableImport.js";

export interface PortableIpcDeps {
  workspaceRoot: () => string;
  /** 导入 staging 父目录（与工作区同卷；main 注入 <userData>/portable-import）。 */
  stagingParent: () => string;
  appVersion: () => string;
  /** 主库 + 小记库 VACUUM INTO 到 targetRoot（main 里接 store/quickNotes）。 */
  snapshotDatabases: (targetRoot: string) => void;
  availability: () => PortableExportAvailability;
  /** 云同步当前状态（UI 用来决定「导出前先同步一次」以及文案）。 */
  cloudState: () => { active: boolean; lastSyncedAt: string | null };
  /** 导出前强制同步一次（仅主进程执行；云同步启用时 run 前调用，任何入口都绕不过）。 */
  beforeExport?: () => Promise<unknown>;
  counts: () => { folders: number; quickNotes: number; tags: number };
  /** 进度广播（main 注入窗口 webContents + Web SSE）。 */
  broadcastProgress?: (progress: PortableExportProgress) => void;
  /** 覆盖系统目录选择（测试注入）；缺省用 Electron dialog。 */
  pickDirectory?: () => Promise<string | null>;
  /** 覆盖便携包文件选择（测试注入）；缺省用 Electron dialog（.zip.lln）。 */
  pickPackageFile?: () => Promise<string | null>;
  now?: () => Date;
}

async function defaultPickPackageFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "选择便携包",
    buttonLabel: "导入",
    filters: [{ name: "LakexLocalNotes 便携包", extensions: ["lln"] }],
    properties: ["openFile"],
  });
  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
}

async function defaultPickDirectory(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "选择便携包导出目录",
    buttonLabel: "导出到此目录",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
}

export function registerPortableIpc(ipc: IpcRegistrar, deps: PortableIpcDeps): void {
  let pickedDir: string | null = null;
  let pickedPackage: string | null = null;
  let running = false;
  let importRunning = false;
  let lastExport: PortableExportStatus["lastExport"] = null;

  ipc.handle("portable_export_status", (): PortableExportStatus => {
    const cloud = deps.cloudState();
    return { availability: deps.availability(), lastExport, cloudActive: cloud.active, lastSyncedAt: cloud.lastSyncedAt };
  });

  ipc.handle("portable_export_pick_dir", async () => {
    const dir = await (deps.pickDirectory ?? defaultPickDirectory)();
    if (dir) pickedDir = dir;
    return dir;
  });

  ipc.handle("portable_import_pick_file", async () => {
    const file = await (deps.pickPackageFile ?? defaultPickPackageFile)();
    if (file) pickedPackage = file;
    return file;
  });

  ipc.handle("portable_import_run", async () => {
    if (importRunning) throw new IpcInputError("已有导入任务在进行中，请稍候");
    if (!pickedPackage) throw new IpcInputError("请先选择便携包文件");
    const zipPath = pickedPackage;
    importRunning = true;
    try {
      const result = importPortablePackageOnDesktop({
        zipPath,
        workspaceRoot: deps.workspaceRoot(),
        stagingParent: deps.stagingParent(),
      });
      if (!result.ok) {
        throw new IpcInputError("便携包导入失败：" + (result.reason ?? "未知原因") + (result.rolledBack === false ? "；且回滚失败，请人工检查工作区目录" : ""));
      }
      return result;
    } finally {
      importRunning = false;
    }
  });

  ipc.handle("portable_export_run", async (): Promise<PortableExportResult> => {
    if (running) throw new IpcInputError("已有导出任务在进行中，请稍候");
    const availability = deps.availability();
    if (!availability.available) throw new IpcInputError(availability.reason);
    if (!pickedDir) throw new IpcInputError("请先选择导出目录");
    const targetDir = pickedDir;
    running = true;
    try {
      // 云端启用时先在主进程同步一次：渲染层/Web/未来入口都走同一道门，不依赖 UI 自觉。
      if (deps.cloudState().active) {
        try {
          await deps.beforeExport?.();
        } catch (error) {
          throw new IpcInputError("导出前同步失败：" + (error instanceof Error ? error.message : String(error)));
        }
      }
      const result = await exportPortablePackage({
        workspaceRoot: deps.workspaceRoot(),
        targetDir,
        appVersion: deps.appVersion(),
        snapshotDatabases: deps.snapshotDatabases,
        counts: deps.counts(),
        now: deps.now,
        onProgress: (progress) => deps.broadcastProgress?.(progress),
      });
      lastExport = { path: result.path, bytes: result.bytes, exportedAt: (deps.now?.() ?? new Date()).toISOString() };
      return result;
    } finally {
      running = false;
    }
  });
}
