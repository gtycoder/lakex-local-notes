/**
 * 同步清单（Manifest）共享类型（lake-core）。
 * 单一来源迁自 electron/sync.ts / electron/quickNotesSync.ts；
 * 供移动端与同步对账纯函数（lakeReconcile / quickNoteReconcile）复用。
 */

/** Lake 笔记清单条目。 */
export interface ManifestNote {
  id: string; title: string; parentId: string | null; sortOrder: number;
  updatedAt: string; contentHash: string; isConflict: boolean;
  /** v3：只读锁元数据（独立于正文哈希，按 lockedAt 字段级 LWW 合并） */
  isLocked?: boolean;
  lockedAt?: string | null;
  /** 文档自定义图标（可选字段，旧清单无此字段时本地保持原样） */
  icon?: string | null;
  assets: { filename: string; size: number; hash: string }[];
  deleted?: boolean;
  deletedAt?: string;
  /** 回收站条目：进入回收站时间（自动过期基准）与删除前父目录（恢复位置）。 */
  trashedAt?: string | null;
  deletedFromParentId?: string | null;
}

/** 目录树清单条目（notebook/group）。 */
export interface ManifestFolder {
  id: string; title: string; parentId: string | null;
  sortOrder: number; nodeType: "notebook" | "group";
  icon: string | null;
  updatedAt: string;
  /** 被删文件夹：进入回收站时间与删除前父目录（恢复位置）。 */
  trashedAt?: string | null;
  deletedFromParentId?: string | null;
  /** v5 folder 墓碑：该目录已被彻底删除（purge）。条目永久保留防他端复活（对齐 notes B4 语义）。
   * 墓碑为纯元数据条目（无正文对象）；远端恢复较新（活跃条目 updatedAt > deletedAt）时墓碑让位。 */
  deleted?: true;
  deletedAt?: string;
}

/** Lake 笔记同步清单。 */
export interface Manifest {
  version: number; workspaceId: string; commitId: string;
  prevCommitId: string | null;                 // 上一份 commitId（本设备上次读取/写入的 commit）
  createdAt: string; notes: ManifestNote[];
  /** 目录树（notebook/group）。 */
  folders: ManifestFolder[];
}

/** Quick Notes 独立清单条目（V1：文本 + 图片）。 */
export interface ManifestItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  contentHash: string;
  isConflict: boolean;
  assets: Array<{ id: string; filename: string; mimeType: string; width: number | null; height: number | null; size: number; hash: string }>;
  deleted?: boolean;
  deletedAt?: string;
}

/** Quick Notes 独立清单。 */
export interface QuickNotesManifest {
  version: number;
  workspaceId: string;
  commitId: string;
  createdAt: string;
  items: ManifestItem[];
}
