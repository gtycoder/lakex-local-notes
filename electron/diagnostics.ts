import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { DbLike } from "./dbLike.js";
import { extractAssetRefs } from "../src/core/storeUtils.js";
import type { OrphanAssetRow } from "./assetRepository.js";
import type { LoggerScopes } from "../src/core/logger.js";

/** 诊断/备份上下文：DB + 路径 + 回调（由 Store 装配）。 */
export interface DiagnosticsContext {
  db: DbLike;
  root: string;
  trashNotebookId: string;
  /** workspace 级资产根目录（note-assets/） */
  noteAssetsDir: string;
  /** 某笔记的 .lake 文件绝对路径 */
  notePathFor: (noteId: string) => string;
  /** 某笔记的资产目录（note-assets/{noteId}）绝对路径 */
  noteAssetsDirFor: (noteId: string) => string;
  logScopes: LoggerScopes;
}

/**
 * 只读诊断 + 一致性备份（原样迁移自 Store；A1/A3）。
 * 红线：体检绝不写库/写文件——诊断自身不能成为新的损坏源。
 */
export class Diagnostics {
  private readonly ctx: DiagnosticsContext;

  constructor(ctx: DiagnosticsContext) {
    this.ctx = ctx;
  }

  /** WAL checkpoint（备份前截断 WAL 用；失败仅告警不抛）。 */
  checkpointWal(): void {
    try { this.ctx.db.pragma("wal_checkpoint(TRUNCATE)"); }
    catch (error) { this.ctx.logScopes.store.warn(`[store] WAL checkpoint failed: ${error instanceof Error ? error.message : String(error)}`); }
  }

  /** 关于页「数据与存储」概览（只读）：库内计数 + 资源目录浅两层遍历（不做全盘扫描）。
   * 小记在独立库（quick-notes/metadata.sqlite3），计数由调用方补（见 registerSystemInfo）。 */
  getStorageOverview(): {
    root: string; dbBytes: number;
    notes: number; notebooks: number; groups: number; trashedNodes: number; tombstones: number;
    historySnapshots: number; historyBytes: number;
    assetFiles: number; assetBytes: number; orphanRows: number;
  } {
    const one = (sql: string, ...args: unknown[]) => Number((this.ctx.db.prepare(sql).get(...args) as { c: number }).c) || 0;
    const statBytes = (file: string): number => {
      try { return fs.statSync(file).size; } catch { return 0; }
    };
    let assetFiles = 0;
    let assetBytes = 0;
    try {
      for (const entry of fs.readdirSync(this.ctx.noteAssetsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(this.ctx.noteAssetsDir, entry.name);
        let files: string[] = [];
        try { files = fs.readdirSync(dir); } catch { continue; }
        for (const f of files) {
          try {
            const st = fs.statSync(path.join(dir, f));
            if (st.isFile()) { assetFiles += 1; assetBytes += st.size; }
          } catch { /* 竞态删除：忽略 */ }
        }
      }
    } catch { /* 目录不存在（全新库）→ 0 */ }
    const hist = this.ctx.db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(size), 0) AS bytes FROM note_history").get() as { c: number; bytes: number };
    return {
      root: this.ctx.root,
      dbBytes: statBytes(path.join(this.ctx.root, "metadata.sqlite3")) + statBytes(path.join(this.ctx.root, "metadata.sqlite3-wal")),
      // 「笔记」与笔记本/分组同口径：只数不在回收站里的（回收站节点另计）
      notes: one("SELECT COUNT(*) AS c FROM notes WHERE deleted_at IS NULL AND trashed_at IS NULL"),
      notebooks: one("SELECT COUNT(*) AS c FROM tree_nodes WHERE node_type='notebook' AND deleted_at IS NULL AND trashed_at IS NULL"),
      groups: one("SELECT COUNT(*) AS c FROM tree_nodes WHERE node_type='group' AND deleted_at IS NULL AND trashed_at IS NULL"),
      trashedNodes: one("SELECT COUNT(*) AS c FROM tree_nodes WHERE deleted_at IS NULL AND trashed_at IS NOT NULL"),
      tombstones: one("SELECT COUNT(*) AS c FROM deleted_notes"),
      historySnapshots: hist.c,
      historyBytes: hist.bytes,
      assetFiles,
      assetBytes,
      orphanRows: one("SELECT COUNT(*) AS c FROM orphan_assets"),
    };
  }

  /**
   * v3 同步基线（sync-v3/baseline.json.gz）里的 per-note contentHash 投影。
   * 缺失/损坏 → null（体检退化为"只查文件存在"，不误报哈希不符）。只读，不写盘。
   */
  private loadV3BaselineHashes(): Map<string, string> | null {
    try {
      const raw = gunzipSync(fs.readFileSync(path.join(this.ctx.root, "sync-v3", "baseline.json.gz"))).toString("utf8");
      const parsed = JSON.parse(raw) as { lake?: { notes?: Array<{ id?: unknown; contentHash?: unknown }> } };
      const out = new Map<string, string>();
      for (const n of parsed.lake?.notes ?? []) {
        if (typeof n.id === "string" && typeof n.contentHash === "string" && n.contentHash) out.set(n.id, n.contentHash);
      }
      return out;
    } catch { return null; }
  }

  /** 只读三查：① notes↔.lake 文件存在 + **v3 同步基线**（sync-v3/baseline.json.gz 的 per-note contentHash）
   *  与读盘 sha256 一致；② note_history↔快照文件存在；③ orphan_assets 登记文件是否存在（漂移抽查）。
   *  Del-6：原判据读 v2 的 sync_base（v3 从不写 ⇒ 永远"无基线"、比对形同虚设），改为直接对拍 v3 基线。
   *  返回结构化报告（不做任何写操作）。 */
  runDataHealthCheck(): {
    notesChecked: number;
    notesMissingFile: Array<{ id: string; title: string }>;
    notesHashMismatch: Array<{ id: string; title: string }>;
    historyChecked: number;
    historyMissingFile: number;
    historyMissingSample: Array<{ id: number; noteId: string; filePath: string }>;
    orphanRowsChecked: number;
    orphanRowsFileMissing: Array<{ id: number; noteId: string; filename: string }>;
    treeChecked: number;
    treeDanglingParent: Array<{ id: string; title: string; parentId: string }>;
    metaParentMismatch: Array<{ id: string; title: string; noteParent: string | null; treeParent: string | null }>;
    refsChecked: number;
    refsMissingResource: Array<{ noteId: string; filename: string }>;
    checkedAt: string;
  } {
    const checkedAt = new Date().toISOString();
    const notesMissingFile: Array<{ id: string; title: string }> = [];
    const notesHashMismatch: Array<{ id: string; title: string }> = [];
    const baselineHashes = this.loadV3BaselineHashes();
    const noteRows = this.ctx.db.prepare("SELECT id,title,parent_id,is_dirty FROM notes WHERE deleted_at IS NULL AND parent_id != ?").all(this.ctx.trashNotebookId) as Array<{ id: string; title: string; is_dirty: number }>;
    for (const n of noteRows) {
      const lakePath = this.ctx.notePathFor(n.id);
      if (!fs.existsSync(lakePath)) {
        notesMissingFile.push({ id: n.id, title: n.title });
        continue;
      }
      // 基线源 = v3 baseline.lake.notes[].contentHash（Del-6：sync_base 已删）。基线文件缺失/损坏 ⇒ 只查存在。
      const baseHash = baselineHashes?.get(n.id);
      // 只在"我们自认为与云端一致"（synced）时比对基线 hash：本地已编辑待上传（local）的正文
      // 与基线不同是**正常状态**，比了就是天天误报"可能被外部改动"，诊断就失去意义。
      if (!baseHash || n.is_dirty === 1) continue; // 无基线/本地未上传 → 只查存在，不比 hash
      try {
        const diskHash = crypto.createHash("sha256").update(fs.readFileSync(lakePath)).digest("hex");
        if (diskHash !== baseHash) notesHashMismatch.push({ id: n.id, title: n.title });
      } catch { notesMissingFile.push({ id: n.id, title: n.title }); }
    }
    const histRows = this.ctx.db.prepare("SELECT id,note_id,file_path FROM note_history").all() as Array<{ id: number; note_id: string; file_path: string }>;
    const historyMissingSample: Array<{ id: number; noteId: string; filePath: string }> = [];
    let historyMissingFile = 0;
    for (const h of histRows) {
      if (!fs.existsSync(path.join(this.ctx.root, h.file_path))) {
        historyMissingFile++;
        if (historyMissingSample.length < 10) historyMissingSample.push({ id: h.id, noteId: h.note_id, filePath: h.file_path });
      }
    }
    const refsChecked: string[] = [];
    const refsMissingResource: Array<{ noteId: string; filename: string }> = [];
    for (const n of noteRows) {
      const lakePath = this.ctx.notePathFor(n.id);
      if (!fs.existsSync(lakePath)) continue; // 文件缺失已在第一查上报
      try {
        const body = fs.readFileSync(lakePath, "utf8");
        for (const filename of extractAssetRefs(body)) {
          refsChecked.push(filename);
          if (!fs.existsSync(path.join(this.ctx.noteAssetsDirFor(n.id), filename))) {
            refsMissingResource.push({ noteId: n.id, filename });
          }
        }
      } catch { /* 读盘失败已在第一查覆盖 */ }
    }
    // ④ 树完整性：parent_id 指向不存在节点的条目在侧栏/回收站都渲染不出来（"文档凭空消失"），
    //    但仍在同步与资源聚合里——必须能被诊断出来，而不是靠 UI 猜。
    const treeRows = this.ctx.db.prepare(
      "SELECT COUNT(*) AS c FROM tree_nodes WHERE deleted_at IS NULL AND parent_id IS NOT NULL"
    ).get() as { c: number };
    const treeDanglingParent = this.ctx.db.prepare(
      `SELECT t.id, t.title, t.parent_id AS parentId FROM tree_nodes t
       WHERE t.deleted_at IS NULL AND t.parent_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM tree_nodes p WHERE p.id = t.parent_id)
       ORDER BY t.title LIMIT 10`
    ).all() as Array<{ id: string; title: string; parentId: string }>;
    // ④.1 元数据一致性：notes.parent_id 与 tree_nodes.parent_id 不一致（本地自相矛盾）——同类"静默错挂"的现场取证。
    // 远端清单 parent 与本地不同属同步语义（由 syncEngine 字段判据修复），本地两表互斥一定是坏数据。
    const metaParentMismatch = this.ctx.db.prepare(
      `SELECT n.id, n.title, n.parent_id AS noteParent, t.parent_id AS treeParent
       FROM notes n JOIN tree_nodes t ON t.id = n.id
       WHERE n.deleted_at IS NULL AND n.parent_id IS NOT t.parent_id
       ORDER BY n.title LIMIT 10`
    ).all() as Array<{ id: string; title: string; noteParent: string | null; treeParent: string | null }>;
    const orphanRows = this.ctx.db.prepare("SELECT * FROM orphan_assets").all() as OrphanAssetRow[];
    const orphanRowsFileMissing: Array<{ id: number; noteId: string; filename: string }> = [];
    for (const o of orphanRows) {
      if (!fs.existsSync(path.join(this.ctx.root, o.file_path))) {
        orphanRowsFileMissing.push({ id: o.id, noteId: o.note_id, filename: o.filename });
      }
    }
    return {
      notesChecked: noteRows.length,
      notesMissingFile,
      notesHashMismatch,
      historyChecked: histRows.length,
      historyMissingFile,
      historyMissingSample,
      orphanRowsChecked: orphanRows.length,
      orphanRowsFileMissing,
      treeChecked: treeRows.c,
      treeDanglingParent,
      metaParentMismatch,
      refsChecked: refsChecked.length,
      refsMissingResource,
      checkedAt,
    };
  }

  /** A1 一致性 DB 快照：VACUUM INTO 单文件（无 WAL 依赖、可独立打开）。
   * 目标文件必须不存在（VACUUM INTO 语义）；路径含单引号需转义。 */
  backupDatabaseTo(targetPath: string): void {
    const escaped = targetPath.replace(/'/g, "''");
    this.ctx.db.exec(`VACUUM INTO '${escaped}'`);
  }
}
