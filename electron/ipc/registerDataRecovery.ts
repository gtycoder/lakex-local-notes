/**
 * 261105 Batch4-D：数据恢复相关 IPC（低频扫描设置 + 手动「重建数据」）。
 *
 * 安全边界：
 * - 扫描/重建都**不走网络、不动正文文件**；重建只补 DB 行（Service 只接受本次扫描候选 id）；
 * - 扫描间隔设置走 store.settings（0 = 关闭后台扫描）；变更后重建对账器（main 注入回调）。
 */
import { IpcInputError } from "../ipcLimits.js";
import type { IpcRegistrar } from "./registrar.js";
import { normalizeFileScanIntervalHours } from "../fileMetadataReconcile.js";
import { RecoveredNotesService } from "../recoveredNotes.js";
import type { Store } from "../store.js";

export interface DataRecoveryIpcDeps {
  store: Pick<Store, "getFileScanSettings" | "saveFileScanSettings" | "listNotesSyncMeta" | "hasNote" | "isPurgedNoteId" | "rebuildRecoveredNotes"> & {
    logScopes: { store: { info(message: string): void } };
  };
  workspaceRoot: string;
  /** 设置变更后重建后台对账器（main 注入；未注入 = 只在下次启动生效）。 */
  onFileScanSettingsChanged?: () => void;
}

export function registerDataRecoveryIpc(ipc: IpcRegistrar, deps: DataRecoveryIpcDeps): void {
  const recoveredNotes = new RecoveredNotesService({
    root: deps.workspaceRoot,
    store: {
      listKnownNoteIds: () => deps.store.listNotesSyncMeta().map((note) => note.id),
      hasNote: (id) => deps.store.hasNote(id),
      isPurgedNoteId: (id) => deps.store.isPurgedNoteId(id),
      rebuildRecoveredNotes: (rows) => deps.store.rebuildRecoveredNotes(rows),
    },
    log: (message) => deps.store.logScopes.store.info(message),
  });

  // 低频扫描配置：intervalHours（0 = 关闭后台扫描；手动扫描/重建不受影响）。
  ipc.handle("get_file_scan_settings", () => deps.store.getFileScanSettings());
  ipc.handle("save_file_scan_settings", (settings: unknown) => {
    if (!settings || typeof settings !== "object") throw new IpcInputError("扫描配置格式无效");
    const intervalHours = normalizeFileScanIntervalHours((settings as { intervalHours?: unknown }).intervalHours);
    if (intervalHours === null) throw new IpcInputError("扫描间隔无效（小时，0 = 关闭）");
    deps.store.saveFileScanSettings({ intervalHours });
    deps.store.logScopes.store.info("[reconcile] 扫描间隔设置为 " + intervalHours + "h（0 = 关闭）");
    deps.onFileScanSettingsChanged?.();
    return { intervalHours };
  });

  // 手动扫描（只读）：列出「文件在、行丢」的候选 + 派生标题 + 是否可重建；结果同时成为重建白名单。
  ipc.handle("scan_rebuild_candidates", () => recoveredNotes.scan());

  // 手动重建（只允许本次扫描候选；写库前二次确认在渲染层；正文不可读 ⇒ 逐条 rejected）。
  ipc.handle("rebuild_orphan_notes", (ids: unknown) => recoveredNotes.rebuild(ids));
}
