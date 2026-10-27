/** Shared Quick Note domain types are defined in src/lib for mobile reuse. */
export type {
  QuickNoteContent,
  QuickNoteDocument,
  QuickNoteImage,
  QuickNoteSummary,
  SaveQuickNoteInput,
} from "../src/lib/types.js";

export interface QuickNoteImageInput {
  /**
   * 文件字节。桌面走 Electron IPC 结构化克隆 ⇒ 传 `Uint8Array`（避免 `number[]` 的高内存/慢序列化，
   * 附件上限 100MiB 时差别是几百 MB 的临时数组）；移动端走 HTTP JSON ⇒ 仍是 `number[]`，两种都收。
   */
  bytes: Uint8Array | number[];
  filename: string;
}

export interface QuickNoteDeleted {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
  conversionTargetNoteId: string | null;
  readyToSync: boolean;
  /** 非空 = 已彻底删除（purged_at）。 */
  purgedAt?: string | null;
}

export interface QuickNoteConversion {
  sourceQuickNoteId: string;
  targetNoteId: string;
  targetNotebookId: string;
  state: "prepared" | "target_created" | "source_deleted_waiting_sync" | "complete";
  createdAt: string;
  updatedAt: string;
}
