import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import type { DbLike } from "./dbLike.js";
import { AppError } from "../src/core/storeErrors.js";
import { extractAssetRefs, isSafePathSegment, selectHistoryDrops } from "../src/core/storeUtils.js";
import type { LoggerScopes } from "../src/core/logger.js";
import type { HistoryCleanupResult, HistorySettings } from "./storeTypes.js";

/** 历史快照生命周期上下文：DB + 路径 + 跨域回调（由 Store 装配）。 */
export interface HistoryLifecycleContext {
  db: DbLike;
  /** workspace root（history/ 相对于它） */
  root: string;
  logScopes: LoggerScopes;
  /** .lake 正文文件绝对路径 */
  notePathFor: (noteId: string) => string;
  /** 原子写文件（restoreHistory 写回 .lake 用） */
  atomicWrite: (filePath: string, data: string) => void;
  /** 更新笔记缓存（md/plain，restoreHistory 用恢复后的正文重算） */
  updateNoteCaches: (noteId: string, markdown: string | null, plain: string | null) => void;
  /** 按文档类型派生搜索缓存（非 doc 的正文是 JSON，绝不能喂给 Lake HTML 解析器；restoreHistory 用） */
  deriveSearchText: (noteId: string, content: string) => { markdown: string | null; plain: string | null };
  /** 历史保留策略配置（settings 表） */
  getHistorySettings: () => HistorySettings;
  /** 清理某文档"当前正文不引用 + 无历史快照引用"的资源（方案 A，cleanupHistory 逐文档调用） */
  cleanupUnreferencedAssetsForNote: (noteId: string) => void;
}

/**
 * 历史快照生命周期（创建/恢复/手动删除/惰性清理）。
 * 从事务语义到 SQL 全部原样迁移自 Store（REFACTOR：只搬家不改行为）。
 */
export class HistoryLifecycle {
  private readonly ctx: HistoryLifecycleContext;

  constructor(ctx: HistoryLifecycleContext) {
    this.ctx = ctx;
  }

  /** 历史快照目录（相对 workspace root） */
  historyDir(): string {
    return path.join(this.ctx.root, "history");
  }

  historyNoteDir(noteId: string): string {
    return path.join(this.historyDir(), noteId);
  }

  /** gzip 快照正文 → Buffer */
  private gzipContent(content: string): Buffer {
    return zlib.gzipSync(content, { level: 6 });
  }

  /** 读取历史快照正文（解压） */
  private readHistoryContent(filePath: string): string {
    return zlib.gunzipSync(fs.readFileSync(path.join(this.ctx.root, filePath))).toString("utf8");
  }

  /** 24h 内同 hash 是否已有快照（去重防抖，P0-2：不用 UNIQUE） */
  private hasRecentDuplicate(noteId: string, hash: string): boolean {
    const row = this.ctx.db.prepare(
      "SELECT 1 FROM note_history WHERE note_id=? AND content_hash=? AND created_at > ? LIMIT 1"
    ).get(noteId, hash, new Date(Date.now() - 24 * 3600 * 1000).toISOString());
    return !!row;
  }

  /** 创建历史快照。content 缺省时读磁盘 .lake；protectedDays>0 时写 protected_until（冲突归档保护，B3）。
   * 返回快照 id；同 hash 且 24h 内已有则跳过返回 null。 */
  createHistorySnapshot(noteId: string, content?: string, force = false, protectedDays?: number): number | null {
    const t0 = Date.now();
    if (!isSafePathSegment(noteId)) throw new AppError("InvalidInput", `无效的笔记 ID: ${noteId}`);
    const lakePath = this.ctx.notePathFor(noteId);
    if (!fs.existsSync(lakePath)) return null;
    const body = content ?? fs.readFileSync(lakePath, "utf8");
    const hash = crypto.createHash("sha256").update(body).digest("hex");
    // force=true 只在"用户手动创建快照"这类显式意图下使用（同 hash 也写）；
    // 自动快照 / 恢复前留档 / 云端覆盖留档都是 force=false，走 24h 同 hash 防抖。
    if (!force && this.hasRecentDuplicate(noteId, hash)) return null;
    const refs = [...extractAssetRefs(body)];
    const gz = this.gzipContent(body);
    const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19); // YYYY-MM-DD-HH-mm-ss
    const filename = `${ts}-${hash.slice(0, 16)}.lake.gz`;
    const relPath = `history/${noteId}/${filename}`;
    const absPath = path.join(this.ctx.root, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, gz);
    // created_at 用单调时间：同毫秒内多条快照会撞（UNIQUE 已去，但排序需稳定），
    // 若与上一条同毫秒则 +1ms，保证 ORDER BY created_at DESC 稳定（P2-4）。
    let created = new Date().toISOString();
    const lastRow = this.ctx.db.prepare("SELECT created_at FROM note_history WHERE note_id=? ORDER BY created_at DESC LIMIT 1").get(noteId) as { created_at: string } | undefined;
    if (lastRow && created <= lastRow.created_at) {
      created = new Date(new Date(lastRow.created_at).getTime() + 1).toISOString();
    }
    const protectedUntil = protectedDays && protectedDays > 0
      ? new Date(new Date(created).getTime() + protectedDays * 24 * 3600 * 1000).toISOString()
      : null;
    const info = this.ctx.db.prepare(
      "INSERT INTO note_history(note_id,file_path,content_hash,created_at,size,refs_json,ref_count,protected_until) VALUES(?,?,?,?,?,?,?,?)"
    ).run(noteId, relPath, hash, created, gz.length, JSON.stringify(refs), refs.length, protectedUntil);
    const id = Number(info.lastInsertRowid);
    this.ctx.logScopes.history.info(`[perf] snapshot ${noteId} ${Date.now() - t0}ms id=${id}${force ? " force" : ""} (body=${body.length}B, gz=${gz.length}B, refs=${refs.length})`);
    return id;
  }

  /** 恢复历史版本。
   * 1) 恢复前留档当前版本（可反悔；同 hash 24h 内已有则跳过，避免重复）
   * 2) 解压写回 .lake + 更新缓存/FTS
   * 3) 重算 hash → setBaseHash + markSynced（恢复=新基线，非本地新修改，P0-1）
   */
  restoreHistory(historyId: number): void {
    const t0 = Date.now();
    const row = this.ctx.db.prepare("SELECT note_id,file_path FROM note_history WHERE id=?").get(historyId) as
      { note_id: string; file_path: string } | undefined;
    if (!row) throw new AppError("NotFound", `历史快照不存在: ${historyId}`);
    const noteId = row.note_id;
    if (!isSafePathSegment(noteId)) throw new AppError("InvalidInput", `无效的笔记 ID: ${noteId}`);
    // 1) 恢复前留档（默认防抖：24h 内同内容已有快照则跳过，避免自动快照+覆盖留档产生重复；
    //    若表里没有（含被手动删除）会重新写，可反悔保障不丢）
    this.createHistorySnapshot(noteId, undefined, false);
    // 2) 解压写回
    const body = this.readHistoryContent(row.file_path);
    this.ctx.atomicWrite(this.ctx.notePathFor(noteId), body);
    // 3) 更新缓存/FTS（用恢复的正文）
    const titleRow = this.ctx.db.prepare("SELECT title FROM notes WHERE id=?").get(noteId) as { title: string } | undefined;
    if (titleRow) {
      const { markdown, plain } = this.ctx.deriveSearchText(noteId, body);
      this.ctx.updateNoteCaches(noteId, markdown, plain);
    }
    // 4) 同步语义（P0-1，与 S3-GC v4 §5.2 一致）：恢复 = 本地写回 + 待上传。
    // 不再 setBaseHash/setLastUploadedHash/markSynced；保持恢复前 base/lastUploaded，
    // 下次同步上传覆盖（远端被他人改则接受远端、恢复版已入历史）。
    const now = new Date().toISOString();
    const tx = this.ctx.db.transaction(() => {
      this.ctx.db.prepare("UPDATE notes SET sync_state='local', updated_at=? WHERE id=?").run(now, noteId);
      this.ctx.db.prepare("UPDATE tree_nodes SET sync_state='local' WHERE id=?").run(noteId);
    });
    tx();
    this.ctx.logScopes.history.info(`[perf] restore ${noteId} from history#${historyId} ${Date.now() - t0}ms`);
  }

  /** 手动删除单个历史快照（文件 + DB）。调用方随后刷新孤儿列表（顺序 §5）。 */
  deleteHistory(historyId: number): void {
    const t0 = Date.now();
    const row = this.ctx.db.prepare("SELECT file_path FROM note_history WHERE id=?").get(historyId) as { file_path: string } | undefined;
    if (!row) throw new AppError("NotFound", `历史快照不存在: ${historyId}`);
    this.ctx.db.prepare("DELETE FROM note_history WHERE id=?").run(historyId);
    try { fs.rmSync(path.join(this.ctx.root, row.file_path), { force: true }); } catch { /* 忽略 */ }
    // 若目录空则清理
    this.pruneEmptyHistoryDirs();
    this.ctx.logScopes.history.info(`[perf] delete-history ${historyId} ${Date.now() - t0}ms`);
  }

  /** 惰性清理：每文档超 100 份删最旧；created_at < 30 天删。
   * 删除后对受影响文档重算引用，无引用资源物理删（方案 A）。 */
  cleanupHistory(): HistoryCleanupResult {
    const t0 = Date.now();
    // P5 + M8：保留策略可配置（份数硬上限 + 天数兜底 + 分层保留判定）
    const cfg = this.ctx.getHistorySettings();
    const result: HistoryCleanupResult = { deletedSnapshots: 0, freedBytes: 0 };
    const notes = this.ctx.db.prepare("SELECT DISTINCT note_id FROM note_history").all() as Array<{ note_id: string }>;
    for (const { note_id } of notes) {
      const rows = this.ctx.db.prepare(
        "SELECT id,file_path,created_at,protected_until FROM note_history WHERE note_id=? ORDER BY created_at ASC"
      ).all(note_id) as Array<{ id: number; file_path: string; created_at: string; protected_until: string | null }>;
      if (rows.length === 0) continue;
      const nowIso = new Date().toISOString();
      // B3：先幂等解除已到期保护（protected_until 已过 → 清 NULL，使该行回归普通保留策略）；
      // 未到期的受保护行即使命中 drops 也不删（冲突归档是唯一可恢复副本，保护窗口内不自动清理；手动删除不受限）。
      for (const r of rows) {
        if (r.protected_until != null && r.protected_until <= nowIso) {
          this.ctx.db.prepare("UPDATE note_history SET protected_until=NULL WHERE id=?").run(r.id);
          r.protected_until = null;
        }
      }
      const drops = selectHistoryDrops(rows.map((r) => r.created_at), { maxSnapshots: cfg.maxSnapshots, retentionDays: cfg.retentionDays });
      const expired = rows.filter((r) => drops.has(r.created_at) && r.protected_until == null);
      if (expired.length === 0) continue;
      for (const e of expired) {
        this.ctx.db.prepare("DELETE FROM note_history WHERE id=?").run(e.id);
        try {
          const p = path.join(this.ctx.root, e.file_path);
          result.freedBytes += fs.statSync(p).size;
          fs.rmSync(p, { force: true });
          result.deletedSnapshots++;
        } catch { /* 忽略 */ }
      }
      // 方案 A：清理后重算该文档引用，无引用资源物理删
      this.ctx.cleanupUnreferencedAssetsForNote(note_id);
    }
    this.pruneEmptyHistoryDirs();
    this.ctx.logScopes.history.info(`[perf] cleanup-history ${Date.now() - t0}ms (deleted=${result.deletedSnapshots}, freed=${result.freedBytes}B)`);
    return result;
  }

  /** 清理空的历史文档目录 */
  pruneEmptyHistoryDirs(): void {
    const root = this.historyDir();
    if (!fs.existsSync(root)) return;
    for (const d of fs.readdirSync(root)) {
      const p = path.join(root, d);
      try { if (fs.statSync(p).isDirectory() && fs.readdirSync(p).length === 0) fs.rmdirSync(p); } catch { /* 忽略 */ }
    }
  }
}
