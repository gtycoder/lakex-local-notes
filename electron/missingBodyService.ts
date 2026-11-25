/**
 * 缺正文服务（Store 协作类，C-06 从 store.ts 原样抽出，零行为变化）：正文文件缺失的清单 /
 * 事件驱动恢复队列 / 处置动作（云端拉回、彻底删除）。小记没有历史快照，恢复判据见 core/missingBody。
 * 边界：分组判据单一来源 = src/core/missingBody.missingBodyRecovery（纯函数），本文件只做 DB/文件操作；
 * 读正文/同步不经过本文件 —— 同步**绝不上传空正文**（AGENTS §4 手动删数据红线）。
 * 契约：AGENTS §4「手动删数据（正文文件缺失）」（readNote 返回 bodyMissing 不抛错、资源页三分组）、
 * docs/RESILIENCE.md 缺正文失败面。护栏：syncStateBookkeeping.test.ts（hasSyncBase/入队语义）、store.test.ts。
 */
import fs from "node:fs";
import { missingBodyRecovery, type MissingBodyDoc } from "../src/core/missingBody.js";
import { canTouchNetwork, cloudStateOf } from "../src/core/cloudState.js";
import { normalizeNoteKind } from "../src/core/noteKind.js";
import { TRASH_NOTEBOOK_ID } from "../src/core/syncDecisions.js";
import type { DbLike } from "./dbLike.js";
import type { TrashLifecycle } from "./trashLifecycle.js";
import type { S3Settings, SyncSettings } from "./storeTypes.js";

/** 缺正文服务上下文（由 Store 装配；路径/写盘与 Store 内部同一实现）。 */
export interface MissingBodyServiceContext {
  db: DbLike;
  /** .lake 正文文件绝对路径（与 Store.notePathFor 同源）。 */
  notePathFor: (noteId: string) => string;
  /** 原子写正文文件（与 Store.atomicWrite 同一实现）。 */
  writeNoteBody: (noteId: string, content: string) => void;
  /** 「云端有副本」事实（syncState.markRemoteNoteIds 每轮回填）。 */
  hasRemoteCopy: (noteId: string) => boolean;
  /** 可云恢复判据输入（= 已配置 S3 且允许出网，AGENTS §3#20）。 */
  getS3Settings: () => S3Settings | null;
  getSyncSettings: () => SyncSettings;
  /** 彻底删除入口（先软删进回收站保留可恢复语义，再 purge 写墓碑）。 */
  trash: Pick<TrashLifecycle, "deleteTreeNode" | "purgeTrashItem">;
}

export class MissingBodyService {
  private readonly ctx: MissingBodyServiceContext;

  constructor(ctx: MissingBodyServiceContext) {
    this.ctx = ctx;
  }

  /** 正文文件是否缺失（只 stat，不读正文；启动跳过缺正文文档用）。 */
  isNoteBodyMissing(id: string): boolean {
    return !fs.existsSync(this.ctx.notePathFor(id));
  }

  /**
   * 资源页「缺正文」清单（261023）：只 stat、不读正文；带历史快照数 / v3 云端事实 / 云配置，
   * 供 UI 分组（云可恢复 / 仅历史 / 无备份）与处置。
   */
  listMissingBodies(): MissingBodyDoc[] {
    const rows = this.ctx.db.prepare(`
      SELECT n.id, n.title, n.kind, n.updated_at, n.parent_id,
             (SELECT COUNT(*) FROM note_history h WHERE h.note_id = n.id) AS history_count,
             (SELECT MAX(h.id) FROM note_history h WHERE h.note_id = n.id) AS last_history_id
      FROM notes n
      WHERE n.deleted_at IS NULL AND n.parent_id != ?
    `).all(TRASH_NOTEBOOK_ID) as Array<{ id: string; title: string; kind: string | null; updated_at: string; parent_id: string | null; history_count: number; last_history_id: number | null }>;
    // 可云恢复 = 已配置 S3 **且**允许出网（「关闭云同步 = 完全没配置」红线：关闭时任何路径不出网）。
    // 只配置但关闭同步的库，这条判据为 false，UI 会归到"仅历史 / 无备份"，不会诱导点击后报"云同步不可用"。
    const cloudConfigured = canTouchNetwork(cloudStateOf(this.ctx.getS3Settings() !== null, this.ctx.getSyncSettings()));
    const out: MissingBodyDoc[] = [];
    for (const row of rows) {
      if (fs.existsSync(this.ctx.notePathFor(row.id))) continue;
      const historyCount = Number(row.history_count) || 0;
      // 「曾经同步过」的 v3 事实 = 上一轮成功同步后回填的云端文档集合（desktopSync → markRemoteNoteIds）。
      // Del-6：删掉 sync_base 旧兜底后这是唯一判据（v3 从不写 sync_base，读它只会永远漏判）。
      const hasSyncBase = this.ctx.hasRemoteCopy(row.id);
      out.push({
        id: row.id,
        title: row.title,
        kind: normalizeNoteKind(row.kind) ?? "doc",
        updatedAt: row.updated_at,
        parentId: row.parent_id ?? null,
        historyCount,
        lastHistoryId: row.last_history_id ?? null,
        hasSyncBase,
        cloudConfigured,
        recovery: missingBodyRecovery({ cloudConfigured, hasSyncBase, historyCount }),
      });
    }
    out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    // 事件驱动：体检确实发现了缺正文才入队（正常同步不扫描、零额外 IO）。
    if (out.length > 0) this.markBodyRecoveryPending(out.map((d) => d.id));
    return out;
  }

  /** 缺正文恢复队列（事件驱动）：只在体检/读失败时入队，同步侧只消费一个小数组，不做全库扫描。 */
  markBodyRecoveryPending(ids: string[]): void {
    if (ids.length === 0) return;
    const cur = this.listBodyRecoveryPending();
    const next = [...new Set([...cur, ...ids])];
    this.ctx.db.prepare("INSERT INTO device_state(key,value) VALUES('body_recovery_pending',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));
  }
  listBodyRecoveryPending(): string[] {
    const row = this.ctx.db.prepare("SELECT value FROM device_state WHERE key='body_recovery_pending'").get() as { value: string } | undefined;
    if (!row) return [];
    try { const arr = JSON.parse(row.value); return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []; } catch { return []; }
  }
  clearBodyRecoveryPending(): void {
    this.ctx.db.prepare("DELETE FROM device_state WHERE key='body_recovery_pending'").run();
  }

  /** 从云端恢复正文时落盘（原子写 + fsync；调用方负责校验 hash 与记账）。 */
  writeRestoredBody(noteId: string, content: string): void {
    this.ctx.writeNoteBody(noteId, content);
  }

  /**
   * 彻底删除「缺正文」文档：先走正常删除流程移入回收站（保留 deleted_from_parent_id 语义），
   * 再彻底删除（写 purge 墓碑 ⇒ 云端下架、不会复活）。正文文件本来就不存在，不涉及文件移动。
   */
  purgeMissingBodyNote(id: string): void {
    this.ctx.trash.deleteTreeNode(id);
    this.ctx.trash.purgeTrashItem(id);
  }
}
