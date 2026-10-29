import { nextSortOrder } from "../../core/treeRules.js";
import { normalizeNoteKind } from "../../core/noteKind.js";
import { withWriteLock } from "../sync/maintenanceLocks";
import type { MobileDb } from "./sqliteDb.js";
import { readNoteBody } from "./noteBodies.js";

/**
 * 移动端「同步仍需要的本地存储最小面」（D-7，261028）。
 *
 * v2 同步引擎删除后（v3 只走 `S3v3DeviceStore` = mobile/v3/mobileDeviceStore.ts），原 `SyncDbPort`
 * 的 40+ 个方法只剩两族还有调用方（bridge 层）：
 *  - **兜底笔记本**：新建文档时解析父目录（bridge/notes.ts · defaultNotebookId）；
 *  - **墓碑族**：deleted_notes 读取/发布记账、folder purge 判定（bridge/sync.ts 的 4 个方法）。
 * 其余 v2 方法（applyRemoteNote/getSyncBase/asset 传输/零变更早退/批量窗口…）零调用，已随本次收口删除。
 *
 * 锁语义保持 v2 时期一致：每次端口调用进出各一次写域片段锁（网络往返不在锁内 ⇒ I1/I3）。
 */

/** 墓碑签名/发布记账的条目形态（与 electron/store.ts 的 listDeletedNotesForSync 字段同义）。 */
export interface SyncTombstone {
  id: string;
  deletedAt: string;
  title?: string;
  nodeType?: string;
  parentId?: string | null;
  sortOrder?: number;
  updatedAt?: string;
}

export interface MobileLocalStorePort {
  /** 兜底父笔记本 id（无"默认笔记本"概念：任意存在的笔记本，无则懒建"未分类"）。 */
  defaultNotebookId(): Promise<string>;
  /** 全部删除墓碑（发布判据由 waterline 决定，端口不再逐行记账）。 */
  listDeletedNotesForSync(): Promise<SyncTombstone[]>;
  /** 读墓碑笔记的删除前内容（读失败/不支持 → null；本端当前实现按正文文件读）。 */
  readDeletedContent(id: string): Promise<string | null>;
  /** 彻底删除的 folder/group（deleted_notes 带 node_type='folder'）：下载过滤用，防远端目录复活。 */
  isFolderPurged(id: string): Promise<boolean>;
}

function noteKindOf(row: Record<string, unknown>): ReturnType<typeof normalizeNoteKind> {
  return normalizeNoteKind(row.doc_kind ?? row.kind);
}

export function createMobileLocalStorePort(getDb: () => MobileDb): MobileLocalStorePort {
  const port: MobileLocalStorePort = {
    async defaultNotebookId() {
      const d = getDb();
      // 没有默认笔记本概念：优先复用任意未删除笔记本，否则兜底创建"未分类"。
      const row = await d.prepare("SELECT id FROM folders WHERE node_type='notebook' AND trashed_at IS NULL ORDER BY sort_order LIMIT 1").get() as { id: string } | undefined;
      if (row) return row.id;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const maxRow = await d.prepare("SELECT MAX(sort_order) AS m FROM folders WHERE parent_id IS NULL AND trashed_at IS NULL").get() as { m: number | null } | undefined;
      await d.prepare("INSERT INTO folders (id, title, parent_id, sort_order, node_type, icon, updated_at, is_dirty) VALUES (?,?,NULL,?,?,?,?,1)")
        .run(id, "未分类", nextSortOrder(maxRow?.m ?? null), "notebook", "X", now);
      return id;
    },
    async listDeletedNotesForSync() {
      const d = getDb();
      const rows = await d.prepare("SELECT id,title,parent_id,sort_order,updated_at,deleted_at,node_type FROM deleted_notes ORDER BY deleted_at").all() as Array<{ id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string; deleted_at: string; node_type: string | null }>;
      return rows.map((r) => ({ id: String(r.id), title: String(r.title), parentId: r.parent_id, sortOrder: r.sort_order, updatedAt: String(r.updated_at), deletedAt: String(r.deleted_at), nodeType: r.node_type ?? "note" }));
    },
    async readDeletedContent(id: string): Promise<string | null> {
      const d = getDb();
      const row = await d.prepare("SELECT doc_kind FROM notes WHERE id=?").get(id) as { doc_kind?: string | null } | undefined;
      if (!row) return null;
      return readNoteBody(noteKindOf(row), id);
    },

    async isFolderPurged(id: string): Promise<boolean> {
      const d = getDb();
      // 判定必须永久（对齐桌面）：node_type='folder' 墓碑只由 purge 写入，purged_at 会在 S3 前缀
      // 删除成功后被清空——旧实现看 purged_at ⇒ 保护失效，云端残留的活跃条目被重新导入复活。
      return !!(await d.prepare("SELECT 1 FROM deleted_notes WHERE id=? AND node_type='folder'").get(id));
    },
  };
  // 写域片段锁（I1/I3）：端口方法内部不得再调本端口（同域嵌套会自锁）。
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(port)) {
    out[key] = (...args: unknown[]) => withWriteLock(() => (value as (...a: unknown[]) => unknown)(...args));
  }
  return out as unknown as MobileLocalStorePort;
}
