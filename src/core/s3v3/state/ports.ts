/**
 * E2-4 平台驱动端口（单一 DeviceStore 实现的第一层）。
 *
 * 目标布局（docs/SYNC-STATE-CONVERGENCE.md §3.2 / §3.2b）：
 *   `core/s3v3/state/deviceStore.ts` = **唯一编排**（30+ 设备端口方法的决策/映射）；
 *   平台侧只实现 `SqlDriver` / `FileDriver` + 窄 `PlatformDataPort`（notes/folders/assets/history/body 的 CRUD）。
 *
 * 现状（261029，phase A）：本文件先冻结两驱动端口；`deviceStore.ts` 已落地「文件型资产 IO」共享实现，
 * 桌面适配器改为「fs FileDriver + 共享实现」的薄壳。`SqlDriver` / `PlatformDataPort` 的接线
 * （把 loadState/saveState 的编排也收进共享层 + 移动切换）是下一批，接口先按实际调用面冻结，避免各端漂移。
 *
 * 约束：core 不 import electron/node；全部接口异步（桌面同步实现用 Promise 包装）。
 */

/** SQL 驱动（better-sqlite3 / Capacitor SQLite / 内存实现）：只做执行，不做业务判断。 */
export interface SqlDriver {
  all<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T | undefined>;
  run(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
  /** 多语句单事务下发（移动端 executeSet / 桌面 db.transaction 包装）。 */
  execBatch(statements: ReadonlyArray<{ statement: string; values?: readonly unknown[] }>): Promise<void>;
  /** 事务包装：fn 内的驱动调用在同一事务（驱动自行保证失败回滚）。 */
  tx<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * 文件驱动（fs / Capacitor Filesystem / 内存实现）。
 * 路径是不透明字符串：两端各自决定根目录与拼接规则（共享层只用驱动返回的命名空间）。
 */
export interface FileDriver {
  read(path: string): Promise<Uint8Array | null>;
  /** 原子写：临时文件 + rename（失败不得留下半个文件）。 */
  writeAtomic(path: string, bytes: Uint8Array): Promise<void>;
  /** 删除单文件（不存在不抛）。 */
  remove(path: string): Promise<void>;
  /** 递归删除目录（不存在不抛）。 */
  removeDir(path: string): Promise<void>;
  /** 浅层列目录文件名（目录不存在 → []，不抛）。 */
  list(path: string): Promise<string[]>;
  mkdir(path: string): Promise<void>;
  stat(path: string): Promise<{ size: number; mtimeMs: number } | null>;
}

/**
 * 窄数据端口（目标：阶段 B 把 loadState/saveState 编排收进共享层时，平台只实现这些 CRUD）。
 * 本批未接线，先冻结**调用面清单**（对应现有两适配器的分支差异，见 SYNC-DEVICE-CONTRACT §5）：
 *  - notes：按同步元数据列列出 / 按 id 读正文句柄 / 导入远端行 / 应用远端元数据 / 锁 LWW / 软删 / 恢复 / 批量标 synced；
 *  - folders：列出同步目录 / 导入远端目录 / 应用远端元数据 / 删除缺失；
 *  - 墓碑族：listPurgedTombstones / listDeletedNotesForSync / markTombstonesPublished / isFolderPurged；
 *  - 恢复/处理队列：listRestorePendingNoteIds / listBodyRecoveryPending / markBodyRecoveryPending / clearBodyRecoveryPending；
 *  - 小记：listQuickNotesForSync / importRemoteQuickNote / applyRemoteQuickNoteTagLinks / markSyncedIfUnchanged /
 *    listAllDeleted / 回收站与 purge / 标签目录合并；
 *  - 世界投影：listNotesSyncMeta / listFoldersForSync（驱动差异留在 SQL/文件驱动，不在共享层 if(platform)）。
 * 接口形状在阶段 B 接线时用真实调用点回填（现在写死在 core 会变成"没人用的假抽象"）。
 */
