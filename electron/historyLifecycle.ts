import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import type { DbLike } from "./dbLike.js";
import { AppError } from "../src/core/storeErrors.js";
import { extractAssetRefs, isSafePathSegment, selectHistoryDrops } from "../src/core/storeUtils.js";
import {
  HISTORY_FALLBACK_CHUNK_SIZE,
  HISTORY_FALLBACK_MAX_NOTES,
  HISTORY_FALLBACK_TIME_BUDGET_MS,
  historyFallbackBackoffMs,
  isHistoryFallbackRetryDue,
  selectHistoryFallbackNotes,
  type HistoryFallbackNote,
} from "../src/core/historyFallbackPolicy.js";
import type { LoggerScopes } from "../src/core/logger.js";
import type { HistoryCleanupResult, HistorySettings } from "./storeTypes.js";

/** 历史快照生命周期上下文：DB + 路径 + 跨域回调（由 Store 装配）。 */
export interface HistoryLifecycleContext {
  db: DbLike;
  /** 回收站笔记本 id：兜底快照跳过回收站文档（它们不会被编辑，快照只会白占磁盘）。 */
  trashNotebookId: string;
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

/** 账本对「未来 mtime」的容忍窗（时钟漂移）；超出才把账本收敛到 now，正常保存不受影响。 */
const HISTORY_FALLBACK_FUTURE_SKEW_MS = 60_000;

/** 兜底快照单轮结果（调用方只记日志/观测，失败不抛）。 */
export interface HistoryFallbackResult {
  /** 扫描到的活文档数（回收站与缺正文除外；首轮模式 = 本页扫描数）。 */
  scanned: number;
  /** 本轮判定「自上次兜底后有变化」的文档数（受单轮上限约束）。 */
  changed: number;
  /** 实际创建的快照数（24h 同 hash 去重会小于 changed）。 */
  created: number;
  /** 单篇失败数（不影响其余文档；失败篇进入指数退避）。 */
  failed: number;
  /** 正文文件缺失而跳过的文档数。 */
  missingBody: number;
  /** P2-A：因退避窗口未到而跳过的篇数（不计 failed）。 */
  skippedBackoff: number;
  /** P2-A：本次预算用尽、留到下一 tick 的篇数（不丢，只延后）。 */
  deferred: number;
  /** P2-A：清理掉的「已删文档」账本行数。 */
  cleanedLedger: number;
  /** P2-A：本轮是否在首轮游标模式（每 tick 只扫一页，走完自动切回全量选择）。 */
  bootstrap: boolean;
  /** 本轮结束后的游标（null = 已走完首轮/非首轮模式）。 */
  cursor: string | null;
}

export interface HistoryFallbackOptions {
  now?: Date;
  /** 单轮上限（默认 core 的 HISTORY_FALLBACK_MAX_NOTES）。 */
  maxNotes?: number;
  /** P2-A：单次 tick 时间预算（毫秒，默认 20s）；用尽即停，剩余留到下一 tick。 */
  timeBudgetMs?: number;
  /** P2-A：每多少篇让出一次事件循环（默认 12；测试可注入小值）。 */
  chunkSize?: number;
  /** P2-A：首轮游标分页大小（默认 = maxNotes；测试可调小）。 */
  bootstrapPageSize?: number;
  /** P2-A：让出事件循环（默认真实 setImmediate；测试注入计数）。 */
  yieldToEventLoop?: () => Promise<void>;
}

/** 首轮游标 / 首轮完成标记（device_state，设备本地）。 */
const FALLBACK_CURSOR_KEY = "history_fallback_cursor";
const FALLBACK_BOOTSTRAP_DONE_KEY = "history_fallback_bootstrap_done";

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

  /**
   * 同 note 同内容 hash 是否**已存在**快照（261106 定稿：不设时间窗，永远去重）。
   * 旧实现只看 24h（created_at > now-24h）⇒ 同一内容隔天再触发就会留第二份（用户截图
   * 两条同 hash、不同时间、都标「当前」的复现路径之一）。
   */
  private hasDuplicateSnapshot(noteId: string, hash: string): boolean {
    const row = this.ctx.db.prepare(
      "SELECT 1 FROM note_history WHERE note_id=? AND content_hash=? LIMIT 1"
    ).get(noteId, hash);
    return !!row;
  }

  // ---- P2-A 首轮游标 / 首轮完成标记（device_state，设备本地；与账本同库） ----
  private readFallbackDeviceState(key: string): string | null {
    const row = this.ctx.db.prepare("SELECT value FROM device_state WHERE key=?").get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  private writeFallbackDeviceState(key: string, value: string | null): void {
    if (value === null) { this.ctx.db.prepare("DELETE FROM device_state WHERE key=?").run(key); return; }
    this.ctx.db.prepare("INSERT INTO device_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  }

  /**
   * 定时兜底快照（Batch4-C + P2-A）：只挑「自上次兜底后有正文变化」的文档（持久账本 + 正文 mtime），
   * 复用 createHistorySnapshot 的 24h 同 hash 去重 / 引用保护 / 保留期清理（语义不变）。
   *
   * P2-A 三件事：
   * - **分片**：stat 与快照每 chunk 篇 await setImmediate 让出事件循环，单 tick 有 20s 时间预算（用尽留到下轮）；
   * - **首轮游标**：账本空时不再每 tick stat 全库——按 id 游标每轮只扫一页，走完自动切回全量 mtime 选择；
   * - **失败退避 + 账本清理**：单篇失败写 fail_count/next_retry_at（指数退避封顶 24h，成功清零），
   *   已删文档（notes 行不存在/deleted_at 非空）的账本行每轮清理。
   */
  async runHistoryFallback(options: HistoryFallbackOptions = {}): Promise<HistoryFallbackResult> {
    const startedAt = Date.now();
    const now = options.now ?? new Date();
    const nowMs = now.getTime();
    const budgetMs = Number.isFinite(options.timeBudgetMs) && (options.timeBudgetMs as number) >= 0
      ? (options.timeBudgetMs as number)
      : HISTORY_FALLBACK_TIME_BUDGET_MS;
    const chunkSize = Number.isFinite(options.chunkSize) && (options.chunkSize as number) > 0
      ? Math.floor(options.chunkSize as number)
      : HISTORY_FALLBACK_CHUNK_SIZE;
    const yieldToEventLoop = options.yieldToEventLoop ?? (() => new Promise<void>((resolve) => setImmediate(resolve)));
    const maxNotes = Number.isFinite(options.maxNotes) && (options.maxNotes as number) > 0
      ? Math.floor(options.maxNotes as number)
      : HISTORY_FALLBACK_MAX_NOTES;
    const pageSize = Number.isFinite(options.bootstrapPageSize) && (options.bootstrapPageSize as number) > 0
      ? Math.max(1, Math.floor(options.bootstrapPageSize as number))
      : maxNotes;
    const result: HistoryFallbackResult = {
      scanned: 0, changed: 0, created: 0, failed: 0, missingBody: 0,
      skippedBackoff: 0, deferred: 0, cleanedLedger: 0, bootstrap: false, cursor: null,
    };
    const budgetExceeded = () => Date.now() - startedAt >= budgetMs;

    // 1) 账本清理：文档已删（行不存在 / 已软删）的账本行不再保留（避免账本无限累积）。
    try {
      const info = this.ctx.db.prepare(
        "DELETE FROM history_fallback_state WHERE note_id NOT IN (SELECT id FROM notes WHERE deleted_at IS NULL)",
      ).run();
      result.cleanedLedger = Number((info as { changes?: number }).changes) || 0;
    } catch { /* 清理失败不影响本轮回填 */ }

    // 2) 账本 + 失败退避（fail_count / next_retry_at；旧行缺失列值按 0/null 处理）。
    const ledgerRows = this.ctx.db.prepare(
      "SELECT note_id, last_body_mtime_ms, fail_count, next_retry_at FROM history_fallback_state",
    ).all() as Array<{ note_id: string; last_body_mtime_ms: number; fail_count?: number | null; next_retry_at?: string | null }>;
    const ledger = new Map<string, number>();
    const failCounts = new Map<string, number>();
    const retryAtMs = new Map<string, number>();
    for (const row of ledgerRows) {
      ledger.set(row.note_id, Number(row.last_body_mtime_ms));
      failCounts.set(row.note_id, Number(row.fail_count ?? 0) || 0);
      const parsed = row.next_retry_at ? Date.parse(row.next_retry_at) : NaN;
      retryAtMs.set(row.note_id, Number.isFinite(parsed) ? parsed : 0);
    }

    // 3) 首轮游标页 vs 全量（首轮只 stat 一页，避免 2 万文档每 tick 全量 stat）。
    result.bootstrap = this.readFallbackDeviceState(FALLBACK_BOOTSTRAP_DONE_KEY) !== "1";
    const cursorBefore = result.bootstrap ? this.readFallbackDeviceState(FALLBACK_CURSOR_KEY) : null;
    let ids: string[];
    if (result.bootstrap) {
      ids = (this.ctx.db.prepare(
        "SELECT id FROM notes WHERE deleted_at IS NULL AND trashed_at IS NULL AND parent_id != ? AND id > ? ORDER BY id LIMIT ?",
      ).all(this.ctx.trashNotebookId, cursorBefore ?? "", pageSize) as Array<{ id: string }>).map((row) => row.id);
    } else {
      ids = (this.ctx.db.prepare(
        "SELECT id FROM notes WHERE deleted_at IS NULL AND trashed_at IS NULL AND parent_id != ? ORDER BY id",
      ).all(this.ctx.trashNotebookId) as Array<{ id: string }>).map((row) => row.id);
    }

    // 4) stat（分片让出；预算命中即停，剩余留到下一 tick）。
    const notes: HistoryFallbackNote[] = [];
    let scannedPrefix = 0;
    let budgetHitDuringScan = false;
    for (let index = 0; index < ids.length; index += 1) {
      if (budgetExceeded() && index > 0) { budgetHitDuringScan = true; result.deferred = ids.length - index; break; }
      const id = ids[index];
      scannedPrefix += 1;
      result.scanned += 1;
      if (isSafePathSegment(id)) {
        try {
          const stat = fs.statSync(this.ctx.notePathFor(id));
          if (stat.isFile()) notes.push({ id, bodyMtimeMs: stat.mtimeMs });
        } catch {
          // 缺正文 = 另一条通道（正文恢复），这里不制造空快照。
          result.missingBody += 1;
        }
      }
      if (scannedPrefix % chunkSize === 0) await yieldToEventLoop();
    }

    // 5) 退避过滤 + 变化选择（24h 同 hash 去重仍由 createHistorySnapshot 负责）。
    const eligible: HistoryFallbackNote[] = [];
    for (const candidate of notes) {
      if (!isHistoryFallbackRetryDue(retryAtMs.get(candidate.id), nowMs)) { result.skippedBackoff += 1; continue; }
      eligible.push(candidate);
    }
    const picked = selectHistoryFallbackNotes({ notes: eligible, ledger, maxNotes, nowMs });
    result.changed = picked.length;
    const overflow = eligible.length > maxNotes && picked.length >= maxNotes;

    // 6) 快照（分片让出 + 时间预算；单篇失败写退避，成功清零）。
    const writeLedger = this.ctx.db.prepare(
      "INSERT INTO history_fallback_state(note_id,last_body_mtime_ms,last_attempt_at,fail_count,next_retry_at) VALUES(?,?,?,?,?) "
      + "ON CONFLICT(note_id) DO UPDATE SET last_body_mtime_ms=excluded.last_body_mtime_ms, last_attempt_at=excluded.last_attempt_at, "
      + "fail_count=excluded.fail_count, next_retry_at=excluded.next_retry_at",
    );
    let processed = 0;
    let budgetHitDuringProcess = false;
    for (const candidate of picked) {
      if (processed > 0 && budgetExceeded()) { budgetHitDuringProcess = true; break; }
      const previousMtime = ledger.get(candidate.id) ?? 0;
      const previousFail = failCounts.get(candidate.id) ?? 0;
      try {
        const snapshotId = this.createHistorySnapshot(candidate.id);
        if (snapshotId !== null) result.created += 1;
        // 即使 24h 同 hash 去重跳过（返回 null）也推进账本：否则下一轮还会重复 stat/读盘同一篇。
        // 时钟明显跑快（mtime 比现在晚 60s 以上）才收敛到 now，避免未来时间戳把后续轮次永久压死。
        const ledgerMs = candidate.bodyMtimeMs > nowMs + HISTORY_FALLBACK_FUTURE_SKEW_MS ? nowMs : candidate.bodyMtimeMs;
        writeLedger.run(candidate.id, ledgerMs, now.toISOString(), 0, null);
      } catch (error) {
        result.failed += 1;
        const nextFail = previousFail + 1;
        const retryIso = new Date(nowMs + historyFallbackBackoffMs(nextFail)).toISOString();
        try { writeLedger.run(candidate.id, previousMtime, now.toISOString(), nextFail, retryIso); }
        catch { /* 账本写失败只影响退避，不影响其余篇 */ }
        this.ctx.logScopes.history.warn(
          "[history] 兜底快照失败 " + candidate.id + "（第 " + nextFail + " 次，退避至 " + retryIso + "）："
          + (error instanceof Error ? error.message : String(error)),
        );
      }
      processed += 1;
      if (processed % chunkSize === 0) await yieldToEventLoop();
    }
    if (budgetHitDuringProcess) result.deferred = Math.max(result.deferred, picked.length - processed);

    // 7) 首轮游标推进：仅当"整页已扫完且处理完"才前进；预算中断只推进已扫前缀，处理中断保持原游标。
    if (result.bootstrap) {
      const completedPage = !budgetHitDuringProcess && !overflow && scannedPrefix >= ids.length;
      const pageExhausted = ids.length < pageSize;
      if (budgetHitDuringProcess || overflow) {
        result.cursor = cursorBefore;
      } else if (completedPage && pageExhausted) {
        this.writeFallbackDeviceState(FALLBACK_BOOTSTRAP_DONE_KEY, "1");
        this.writeFallbackDeviceState(FALLBACK_CURSOR_KEY, null);
        result.cursor = null;
      } else if (budgetHitDuringScan) {
        const lastScanned = scannedPrefix > 0 ? ids[scannedPrefix - 1] : null;
        if (lastScanned && lastScanned !== cursorBefore) {
          this.writeFallbackDeviceState(FALLBACK_CURSOR_KEY, lastScanned);
          result.cursor = lastScanned;
        } else {
          result.cursor = cursorBefore;
        }
      } else {
        const last = ids[ids.length - 1] ?? cursorBefore;
        if (last) {
          this.writeFallbackDeviceState(FALLBACK_CURSOR_KEY, last);
          result.cursor = last;
        }
      }
    }

    this.ctx.logScopes.history.info(
      "[perf] history-fallback " + (Date.now() - startedAt) + "ms (scanned=" + result.scanned + ", changed=" + result.changed
      + ", created=" + result.created + ", failed=" + result.failed + ", skippedBackoff=" + result.skippedBackoff
      + (result.deferred > 0 ? ", deferred=" + result.deferred : "")
      + (result.cleanedLedger > 0 ? ", cleanedLedger=" + result.cleanedLedger : "")
      + (result.bootstrap ? ", bootstrap" : "") + ")",
    );
    return result;
  }

  /** 创建历史快照。content 缺省时读磁盘 .lake；protectedDays>0 时写 protected_until（冲突归档保护，B3）。
   * 返回快照 id；**同 note 同内容 hash 已有快照则跳过返回 null**（261106 定稿：不设时间窗，force 也一样去重——
   * force 仅为历史接口兼容，不再有「手动/强制可重复留档」的例外）。 */
  createHistorySnapshot(noteId: string, content?: string, force = false, protectedDays?: number): number | null {
    const t0 = Date.now();
    if (!isSafePathSegment(noteId)) throw new AppError("InvalidInput", `无效的笔记 ID: ${noteId}`);
    const lakePath = this.ctx.notePathFor(noteId);
    if (!fs.existsSync(lakePath)) return null;
    const body = content ?? fs.readFileSync(lakePath, "utf8");
    const hash = crypto.createHash("sha256").update(body).digest("hex");
    // 261106 定稿：同内容不重复留档（手动「创建快照」/ 兜底 / 冲突留档 / 同步覆盖留档统一口径）。
    // 不再有 24h 时间窗、也不再允许 force 绕过；需要保留某段内容时，第一次留档就是它。
    if (this.hasDuplicateSnapshot(noteId, hash)) {
      this.ctx.logScopes.history.debug?.("[history] 跳过重复快照 " + noteId + " hash=" + hash.slice(0, 8) + (force ? " (force 同样去重)" : ""));
      return null;
    }
    const refs = [...extractAssetRefs(body)];
    const gz = this.gzipContent(body);
    const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19); // YYYY-MM-DD-HH-mm-ss
    // 审计 F07：文件名必须唯一。同秒 + 同内容 + force=true 会生成同一路径，
    // deleteHistory 只 unlink 路径、不知道别行也指向它 ⇒ 删一条会毁掉另一条。加随机后缀。
    // 261019：快照正文对所有 kind 都是「正文原文 gzip」（doc=HTML、usheet/bitable/board=JSON），
    // 扩展名改用中性的 .body.gz。旧快照仍按 note_history.file_path 读取，不做迁移/改名。
    const filename = `${ts}-${hash.slice(0, 16)}-${crypto.randomBytes(4).toString("hex")}.body.gz`;
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
   * 3) 只标本地待上传（P0-1：恢复 = 本地新修改，不回写任何基线；Del-6 后也没有 v2 hash 账本可写）
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
    // 不写任何基线（v3 基线由下一次成功同步的 saveBaseline 落盘），下次同步上传覆盖
    //（远端被他人改则接受远端、恢复版已入历史）。
    const now = new Date().toISOString();
    const tx = this.ctx.db.transaction(() => {
      this.ctx.db.prepare("UPDATE notes SET is_dirty=1, updated_at=? WHERE id=?").run(now, noteId);
      this.ctx.db.prepare("UPDATE tree_nodes SET is_dirty=1 WHERE id=?").run(noteId);
    });
    tx();
    this.ctx.logScopes.history.info(`[perf] restore ${noteId} from history#${historyId} ${Date.now() - t0}ms`);
  }

  /** 手动删除单个历史快照（文件 + DB）。调用方随后刷新孤儿列表（顺序 §5）。 */
  deleteHistory(historyId: number): void {
    const t0 = Date.now();
    const row = this.ctx.db.prepare("SELECT file_path FROM note_history WHERE id=?").get(historyId) as { file_path: string } | undefined;
    if (!row) throw new AppError("NotFound", `历史快照不存在: ${historyId}`);
    // 与 cleanupHistory 同口径：**先删文件再删行**（force 容忍不存在）。反过来的话，文件删失败/中途崩溃
    // 会留下"文件在、行没了"的未登记残留；先删文件时最坏只是"行在、文件没了"，而那条行会被
    // detectOrphans 的反向对账撤掉。
    try { fs.rmSync(path.join(this.ctx.root, row.file_path), { force: true }); } catch { /* 忽略 */ }
    this.ctx.db.prepare("DELETE FROM note_history WHERE id=?").run(historyId);
    // 若目录空则清理
    this.pruneEmptyHistoryDirs();
    this.ctx.logScopes.history.info(`[perf] delete-history ${historyId} ${Date.now() - t0}ms`);
  }

  /**
   * 一次性收敛历史重复行（261106 定稿）：同一 note + 同 content_hash 只保留**最新**一条，
   * 删除其余行与其 .body.gz（同内容 ⇒ refs 相同，不会误删资源引用；不同 hash 一行不动）。
   * 幂等；只处理「同 note 同 hash」，保留行用 created_at DESC,id DESC 取最新。
   * 文件删除失败仍删行（孤儿文件由资源页/孤儿清理兜底，与 deleteHistory 同口径）。
   */
  dedupeHistorySnapshots(): { deletedRows: number; freedBytes: number; groups: number } {
    const t0 = Date.now();
    const rows = this.ctx.db.prepare(
      "SELECT id,note_id,file_path,content_hash,created_at FROM note_history ORDER BY note_id, content_hash, created_at DESC, id DESC",
    ).all() as Array<{ id: number; note_id: string; file_path: string; content_hash: string; created_at: string }>;
    const kept = new Set<string>(); // noteId\0hash（该组最新一条已保留）
    const drop: typeof rows = [];
    for (const row of rows) {
      const key = row.note_id + "\u0000" + row.content_hash;
      if (!kept.has(key)) { kept.add(key); continue; }
      drop.push(row);
    }
    let freedBytes = 0;
    const groups = new Set(drop.map((row) => row.note_id + "\u0000" + row.content_hash)).size;
    for (const row of drop) {
      try {
        const abs = path.join(this.ctx.root, row.file_path);
        if (fs.existsSync(abs)) {
          freedBytes += fs.statSync(abs).size;
          fs.rmSync(abs, { force: true });
        }
      } catch { /* 文件删失败仍删行 */ }
    }
    if (drop.length > 0) {
      const del = this.ctx.db.prepare("DELETE FROM note_history WHERE id=?");
      this.ctx.db.transaction(() => { for (const row of drop) del.run(row.id); })();
    }
    const deletedRows = drop.length;
    if (deletedRows > 0) {
      this.ctx.logScopes.history.warn("[history] 收敛重复快照 " + deletedRows + " 行（" + groups + " 组，释放 " + freedBytes + "B）耗时 " + (Date.now() - t0) + "ms");
    }
    return { deletedRows, freedBytes, groups };
  }

  /** 惰性清理：先收敛同 note 同 hash 重复行，再按保留策略（每文档超 100 份删最旧；created_at < 30 天删）。
   * 删除后对受影响文档重算引用，无引用资源物理删（方案 A）。 */
  cleanupHistory(): HistoryCleanupResult {
    const t0 = Date.now();
    // P5 + M8：保留策略可配置（份数硬上限 + 天数兜底 + 分层保留判定）
    const cfg = this.ctx.getHistorySettings();
    const result: HistoryCleanupResult = { deletedSnapshots: 0, freedBytes: 0, dedupedSnapshots: 0 };
    // 261106：先收敛「同 note 同 hash」重复行（旧 24h 窗口造成的存量重复）；幂等、每天/启动各一次即可。
    const deduped = this.dedupeHistorySnapshots();
    result.dedupedSnapshots = deduped.deletedRows;
    result.freedBytes += deduped.freedBytes;
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
      // DS 复核 A6：先删文件（force，容忍不存在）再事务删行 —— 避免「行已删、文件还在」的孤儿方向。
      // 文件删失败仍删行（孤儿文件由 orphan 清理兜底）；事务保证多行 DELETE 原子。
      for (const e of expired) {
        try {
          const p = path.join(this.ctx.root, e.file_path);
          if (fs.existsSync(p)) {
            result.freedBytes += fs.statSync(p).size;
            fs.rmSync(p, { force: true });
          }
          result.deletedSnapshots++;
        } catch { /* 文件删失败：仍删行，交给孤儿清理 */ }
      }
      const deleteRows = this.ctx.db.prepare("DELETE FROM note_history WHERE id=?");
      this.ctx.db.transaction(() => {
        for (const e of expired) deleteRows.run(e.id);
      })();
      // 方案 A：清理后重算该文档引用，无引用资源物理删
      this.ctx.cleanupUnreferencedAssetsForNote(note_id);
    }
    this.pruneEmptyHistoryDirs();
    this.ctx.logScopes.history.info(`[perf] cleanup-history ${Date.now() - t0}ms (deleted=${result.deletedSnapshots}, deduped=${result.dedupedSnapshots ?? 0}, freed=${result.freedBytes}B)`);
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
