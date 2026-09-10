import fs from "node:fs";
import path from "node:path";
import type { DbLike } from "./dbLike.js";
import { AppError } from "../src/core/storeErrors.js";
import { extractAssetRefs, isSafePathSegment } from "../src/core/storeUtils.js";
import { sqlParameterBatches } from "../src/core/sqlParameterBatch.js";
import { mimeTypeForFilename } from "../src/core/imageUtils.js";
import { AssetRepository, type OrphanAsset, type OrphanAssetRow } from "./assetRepository.js";

/** 孤儿资产生命周期上下文：DB + 路径回调（由 Store 装配）。 */
export interface OrphanLifecycleContext {
  db: DbLike;
  /** workspace root（orphan_assets.file_path 相对于它） */
  root: string;
  /** 某笔记的资产目录（note-assets/{noteId}）绝对路径 */
  noteAssetsDirFor: (noteId: string) => string;
  /** 资产引用查询（当前正文/历史/保护集） */
  assetRepository: AssetRepository;
}

/**
 * 孤儿资产生命周期（写时登记/保存时对账/列出/预览/删除/全局清理）。
 * 从事务语义到 SQL 全部原样迁移自 Store（REFACTOR：只搬家不改行为）。
 * 红线：被当前正文或任何历史快照引用的资源不是孤儿（三处消费者必须一致）。
 */
export class OrphanLifecycle {
  private readonly ctx: OrphanLifecycleContext;

  constructor(ctx: OrphanLifecycleContext) {
    this.ctx = ctx;
  }

  /** 当前正文引用的资源文件名（复用公共 extractAssetRefs） */
  private referencedFilenames(content: string): Set<string> {
    return extractAssetRefs(content);
  }

  /** 孤儿文件预览：读取 note-assets/{noteId}/{filename} 内容。
   * 图片返回 base64 data URL；文本返回前 64KB；其他返回 null。 */
  previewNoteOrphan(noteId: string, filename: string): { kind: "image" | "text"; data: string; size: number } | null {
    if (!isSafePathSegment(noteId) || !isSafePathSegment(filename)) return null;
    const full = path.join(this.ctx.noteAssetsDirFor(noteId), filename);
    if (!fs.existsSync(full)) return null;
    try {
      const stat = fs.statSync(full);
      const mime = mimeTypeForFilename(filename);
      if (mime.startsWith("image/")) {
        const buf = fs.readFileSync(full);
        return { kind: "image", data: `data:${mime};base64,${buf.toString("base64")}`, size: stat.size };
      }
      const buf = fs.readFileSync(full);
      const text = buf.toString("utf8").slice(0, 65536);
      return { kind: "text", data: text, size: stat.size };
    } catch {
      return null;
    }
  }

  /** 清理某文档"当前正文不引用 + 无历史快照引用"的资源。 */
  cleanupUnreferencedAssetsForNote(noteId: string): void {
    const dir = this.ctx.noteAssetsDirFor(noteId);
    if (!fs.existsSync(dir)) return;
    const disk = fs.readdirSync(dir);
    if (disk.length === 0) return;
    const protectedRefs = this.ctx.assetRepository.getProtectedRefs(noteId);
    for (const filename of disk) {
      if (protectedRefs.has(filename)) continue;
      try { fs.rmSync(path.join(dir, filename), { force: true }); } catch { /* 忽略 */ }
    }
  }

  /** 文档级孤儿列表（实时）：磁盘文件 − (当前正文引用 ∪ 历史 refs) */
  listNoteOrphans(noteId: string): Array<{ filename: string; size: number; mimeType: string; protectedByHistory: boolean }> {
    const dir = this.ctx.noteAssetsDirFor(noteId);
    if (!fs.existsSync(dir)) return [];
    const currentRefs = this.ctx.assetRepository.getCurrentContentRefs(noteId);
    const historyRefs = this.ctx.assetRepository.getHistoryRefs(noteId);
    const out: Array<{ filename: string; size: number; mimeType: string; protectedByHistory: boolean }> = [];
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      const inCurrent = currentRefs.has(f);
      const inHistory = historyRefs.has(f);
      if (inCurrent) continue; // 当前引用不是孤儿
      out.push({ filename: f, size: st.size, mimeType: mimeTypeForFilename(f), protectedByHistory: inHistory });
    }
    return out;
  }

  /** 清理文档级孤儿：只删非 protectedByHistory 的文件（被历史引用的跳过）。
   * filenames 缺省清全部可清。 */
  cleanNoteOrphans(noteId: string, filenames?: string[]): { count: number; freedBytes: number } {
    const orphans = this.listNoteOrphans(noteId);
    const targets = orphans.filter((o) => !o.protectedByHistory && (!filenames || filenames.includes(o.filename)));
    let count = 0, freed = 0;
    for (const o of targets) {
      const full = path.join(this.ctx.noteAssetsDirFor(noteId), o.filename);
      try { freed += fs.statSync(full).size; fs.unlinkSync(full); count++; } catch { /* 忽略 */ }
    }
    return { count, freedBytes: freed };
  }

  /** 写盘即登记孤儿（思源式"写时登记、保存时对账"）：
   * 图片下载/插入落盘瞬间正文必然尚未引用它；先登记为孤儿，杜绝"未登记就被同步上传"
   * 的窄窗口（S3 累积无用文件）。随后 saveNote 的 detectOrphans 会按正文引用撤销登记。 */
  registerOrphan(noteId: string, filename: string, size: number, mimeType: string): void {
    try {
      this.ctx.db.prepare(
        `INSERT OR IGNORE INTO orphan_assets(note_id, filename, file_path, size, mime_type)
         VALUES(?,?,?,?,?)`
      ).run(noteId, filename, `note-assets/${noteId}/${filename}`, size, mimeType);
    } catch (error) {
      console.warn("[store] 孤儿登记失败（不影响主流程）:", error);
    }
  }

  detectOrphans(noteId: string, content: string): void {
    const dir = this.ctx.noteAssetsDirFor(noteId);
    if (!fs.existsSync(dir)) return;
    const diskSet = new Set(fs.readdirSync(dir));
    const referencedSet = this.referencedFilenames(content);
    // P2：孤儿登记并入"历史 refs"——被任何历史快照引用的资源不算孤儿，
    // 保证全局 cleanOrphanAssets / 同步跳过上传 / 文档级 listNoteOrphans 三个消费者一致，
    // 避免"本机 SyncPanel 全局清理误删历史引用资源 → 本机历史恢复裂图"。
    const historyRefs = this.ctx.assetRepository.getHistoryRefs(noteId);
    const insert = this.ctx.db.prepare(
      `INSERT OR IGNORE INTO orphan_assets(note_id, filename, file_path, size, mime_type)
       VALUES(?,?,?,?,?)`
    );
    const unorphan = this.ctx.db.prepare("DELETE FROM orphan_assets WHERE note_id=? AND filename=?");
    const tx = this.ctx.db.transaction(() => {
      for (const filename of diskSet) {
        if (referencedSet.has(filename) || historyRefs.has(filename)) {
          unorphan.run(noteId, filename);
        } else {
          const stat = fs.statSync(path.join(dir, filename));
          if (!stat.isFile()) continue;
          insert.run(noteId, filename, `note-assets/${noteId}/${filename}`, stat.size, mimeTypeForFilename(filename));
        }
      }
    });
    tx();
  }

  /** 单条删除未引用资源（与 cleanOrphanAssets 同规则：清理前按当前正文/历史引用再校验）。 */
  deleteOrphanAsset(id: number): { deleted: boolean; freedBytes: number } {
    const row = this.ctx.db.prepare("SELECT * FROM orphan_assets WHERE id=?").get(id) as OrphanAssetRow | undefined;
    if (!row) return { deleted: false, freedBytes: 0 };
    const refs = this.ctx.assetRepository.getProtectedRefs(row.note_id);
    if (refs.has(row.filename)) return { deleted: false, freedBytes: 0 };   // 此刻被引用 → 不删
    const fullPath = path.join(this.ctx.root, row.file_path);
    let freedBytes = 0;
    try {
      if (fs.existsSync(fullPath)) {
        freedBytes = fs.statSync(fullPath).size;
        fs.unlinkSync(fullPath);
      }
      this.ctx.db.prepare("DELETE FROM orphan_assets WHERE id=?").run(row.id);
      return { deleted: true, freedBytes };
    } catch (error) {
      console.warn("[store] 删除孤儿资源失败（保留记录待重试）:", fullPath, error);
      return { deleted: false, freedBytes: 0 };
    }
  }

  /** 读取孤儿文件预览（仅图片返回 dataUrl；其它类型/过大返回 supported=false）。 */
  readOrphanPreview(id: number): { filename: string; mimeType: string; supported: boolean; dataUrl?: string } {
    const row = this.ctx.db.prepare("SELECT * FROM orphan_assets WHERE id=?").get(id) as OrphanAssetRow | undefined;
    if (!row) throw new AppError("NotFound", "资源记录不存在");
    const segments = row.file_path.split("/");
    if (segments.length < 3 || segments[0] !== "note-assets" || !segments.slice(1).every((s) => isSafePathSegment(s))) {
      throw new AppError("InvalidInput", "非法资源路径");
    }
    const mimeType = row.mime_type || "application/octet-stream";
    const fullPath = path.join(this.ctx.root, row.file_path);
    if (!fs.existsSync(fullPath)) throw new AppError("NotFound", "资源文件已不存在");
    if (!mimeType.startsWith("image/")) return { filename: row.filename, mimeType, supported: false };
    const bytes = fs.readFileSync(fullPath);
    if (bytes.length > 32 * 1024 * 1024) return { filename: row.filename, mimeType, supported: false };  // 过大不进弹层
    return { filename: row.filename, mimeType, supported: true, dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}` };
  }

  /** 按 noteId+filename 直接读取 note-assets 下文件预览（未引用资源/历史保护文件共用；路径双段校验）。 */
  readAssetPreview(noteId: string, filename: string): { filename: string; mimeType: string; supported: boolean; dataUrl?: string } {
    if (!isSafePathSegment(noteId) || !isSafePathSegment(filename)) throw new AppError("InvalidInput", "非法资源路径");
    const full = path.join(this.ctx.noteAssetsDirFor(noteId), filename);
    if (!fs.existsSync(full)) throw new AppError("NotFound", "资源文件已不存在");
    const mimeType = mimeTypeForFilename(filename);
    if (!mimeType.startsWith("image/")) return { filename, mimeType, supported: false };
    const bytes = fs.readFileSync(full);
    if (bytes.length > 32 * 1024 * 1024) return { filename, mimeType, supported: false };
    return { filename, mimeType, supported: true, dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}` };
  }

  /** 全局“未引用/被移除资源”汇总：当前正文不再引用的本地资产文件，分两类——
   *   orphan  —— 未引用且不在任何历史快照（可删除，即 orphan_assets 行）；
   *   history —— 仍被某历史快照引用（受保护：只预览不可删）。
   * 用于设置页真正聚合所有文档的孤儿文件（2026-09-03 用户需求）。 */
  listRemovedAssets(): Array<{
    noteId: string; filename: string; status: "orphan" | "history"; orphanId?: number;
    size: number; mimeType: string; noteTitle: string; noteState: "active" | "trash" | "missing"; detectedAt?: string;
  }> {
    const enriched = this.listOrphanAssets() as Array<OrphanAsset & { noteTitle: string; noteState: "active" | "trash" | "missing" }>;
    const out: Array<{
      noteId: string; filename: string; status: "orphan" | "history"; orphanId?: number;
      size: number; mimeType: string; noteTitle: string; noteState: "active" | "trash" | "missing"; detectedAt?: string;
    }> = enriched.map((o) => ({
      noteId: o.noteId, filename: o.filename, status: "orphan", orphanId: o.id,
      size: o.size, mimeType: o.mimeType, noteTitle: o.noteTitle, noteState: o.noteState, detectedAt: o.detectedAt,
    }));
    const seen = new Set(out.map((o) => o.noteId + "/" + o.filename));
    for (const noteId of this.ctx.assetRepository.listNoteIdsWithHistory()) {
      const dir = this.ctx.noteAssetsDirFor(noteId);
      if (!fs.existsSync(dir)) continue;
      const cur = this.ctx.assetRepository.getCurrentContentRefs(noteId);
      const hist = this.ctx.assetRepository.getHistoryRefs(noteId);
      if (hist.size === 0) continue;
      for (const filename of fs.readdirSync(dir)) {
        const key = noteId + "/" + filename;
        if (seen.has(key)) continue;
        if (cur.has(filename) || !hist.has(filename)) continue;   // 仍被当前正文引用 → 非“被移除”
        seen.add(key);
        const full = path.join(dir, filename);
        let size = 0;
        try { if (!fs.statSync(full).isFile()) continue; size = fs.statSync(full).size; } catch { continue; }
        out.push({ noteId, filename, status: "history", size, mimeType: mimeTypeForFilename(filename), noteTitle: noteId, noteState: "active" });
      }
    }
    // 统一补标题/状态（历史保护文档可能不在孤儿集合里）
    const ids = [...new Set(out.map((o) => o.noteId))];
    const notes = sqlParameterBatches(ids).flatMap((batch) => {
      const placeholders = batch.map(() => "?").join(",");
      return this.ctx.db.prepare(`SELECT id, title, trashed_at FROM notes WHERE id IN (${placeholders})`).all(...batch) as Array<{ id: string; title: string; trashed_at: string | null }>;
    });
    const titleBy = new Map(notes.map((n) => [n.id, { title: n.title || "(无标题)", trashed: n.trashed_at != null }]));
    for (const o of out) {
      const info = titleBy.get(o.noteId);
      o.noteTitle = info?.title ?? "（文档已删除）";
      o.noteState = info ? (info.trashed ? "trash" : "active") : "missing";
    }
    out.sort((a, b) => a.noteTitle.localeCompare(b.noteTitle) || a.filename.localeCompare(b.filename));
    return out;
  }

  listOrphanAssets(): OrphanAsset[] {
    const rows = this.ctx.assetRepository.listOrphanAssets();
    if (rows.length === 0) return rows;
    const ids = [...new Set(rows.map((r) => r.noteId))];
    const notes = sqlParameterBatches(ids).flatMap((batch) => {
      const placeholders = batch.map(() => "?").join(",");
      return this.ctx.db.prepare(`SELECT id, title, trashed_at FROM notes WHERE id IN (${placeholders})`).all(...batch) as Array<{ id: string; title: string; trashed_at: string | null }>;
    });
    const titleBy = new Map<string, { title: string; trashed: boolean }>();
    for (const n of notes) titleBy.set(n.id, { title: n.title || "(无标题)", trashed: n.trashed_at != null });
    return rows.map((r) => {
      const info = titleBy.get(r.noteId);
      return {
        ...r,
        noteTitle: info?.title ?? "（文档已删除）",
        noteState: info ? (info.trashed ? "trash" : "active") : "missing",
      } as OrphanAsset;
    });
  }

  /** 某笔记当前登记的孤儿文件名集合（供“孤儿不同步上传”过滤与 UI 幂等）。 */
  orphanFilenamesForNote(noteId: string): Set<string> {
    const rows = this.ctx.db.prepare("SELECT filename FROM orphan_assets WHERE note_id=?").all(noteId) as Array<{ filename: string }>;
    return new Set(rows.map((r) => r.filename));
  }

  cleanOrphanAssets(): { count: number; freedBytes: number } {
    // 审计 #12：仅当文件不存在或删除成功时才删除记录并计数；失败保留记录（UI 可重试）。
    // 清理前再校验一次引用（当前正文/历史快照）——孤儿表是"保存时对账"的快照，
    // 若在"刚插入未保存"的窗口里打开全局清理，避免误删刚写盘但正文尚未引用到的文件。
    const rows = this.ctx.db.prepare("SELECT * FROM orphan_assets").all() as OrphanAssetRow[];
    let count = 0;
    let freedBytes = 0;
    for (const row of rows) {
      const refs = this.ctx.assetRepository.getProtectedRefs(row.note_id);
      if (refs.has(row.filename)) continue;   // 此刻已被当前正文/历史引用 → 撤销孤儿语义，保留文件
      const fullPath = path.join(this.ctx.root, row.file_path);
      try {
        if (fs.existsSync(fullPath)) {
          freedBytes += fs.statSync(fullPath).size;
          fs.unlinkSync(fullPath);
        }
        this.ctx.db.prepare("DELETE FROM orphan_assets WHERE id=?").run(row.id);
        count++;
      } catch (error) {
        console.warn("[store] 清理孤儿资源失败，保留记录待重试:", fullPath, error);
      }
    }
    return { count, freedBytes };
  }
}
