/**
 * 桌面 → 手机 便携包导出（docs/PORTABLE-TRANSFER.md §2）。
 *
 * 流程：VACUUM INTO 两份 DB 一致性快照（由 store/quickNotes 注入回调执行）→ 按白名单遍历
 * 工作区（正文/资源/小记/基线，**不含历史快照**）→ 生成 portable.json → 流式写 store-only zip。
 *
 * 红线：
 * - 包里不写任何密钥/设备本地状态（settings.json、window-state.json、sync-v3/state.json 均不在白名单）；
 * - 总大小 ≤4GiB（先预检，写了过大再删半成品）；
 * - 遍历只走白名单目录 ⇒ history/draft-journal/logs/backups 天然不会进包。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { NOTE_BODY_DIR, NOTE_BODY_EXT, quickNoteBodyRelativePath } from "../../src/core/noteBodyPaths.js";
import { NOTE_KINDS, type NoteKind } from "../../src/core/noteKind.js";
import {
  assertPortableSize,
  PORTABLE_FORMAT,
  PORTABLE_FORMAT_VERSION,
  PORTABLE_FILE_EXTENSION,
  PORTABLE_LIMIT_BYTES,
  type PortableBaselineRef,
  type PortableCounts,
  type PortableExportProgress,
  type PortableExportResult,
} from "../../src/core/portable/portableFormat.js";
import { writeStoreZip, type ZipEntrySource } from "./zipStore.js";

/** 正文目录（zip 内 desktop/<dir>/<相对路径>）；扩展名只作说明，收集时按目录整体遍历。 */
const BODY_DIRS = ["notes", "usheets", "bitables", "boards", "inks"] as const;

export type PortableFileKind = "body" | "asset" | "quick-item" | "quick-asset";

export interface CollectedPortableFile {
  /** zip 内路径（posix）。 */
  zipPath: string;
  absPath: string;
  size: number;
  mtime: Date;
  kind: PortableFileKind;
}

function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

/** 递归列出目录下所有普通文件（跳过符号链接/特殊文件；目录不存在 = 空）。 */
function walkFiles(root: string): Array<{ rel: string; abs: string; size: number; mtime: Date }> {
  const out: Array<{ rel: string; abs: string; size: number; mtime: Date }> = [];
  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { visit(abs); continue; }
      if (!entry.isFile()) continue;
      try {
        const stat = fs.statSync(abs);
        out.push({ rel: toPosix(path.relative(root, abs)), abs, size: stat.size, mtime: stat.mtime });
      } catch { /* 竞态删除：忽略 */ }
    }
  };
  visit(root);
  return out;
}

/** 白名单收集（spec §2 的包内布局）。history/draft-journal/logs/backups 等不在白名单里。 */
export function collectPortableFiles(workspaceRoot: string): CollectedPortableFile[] {
  const files: CollectedPortableFile[] = [];
  const add = (kind: PortableFileKind, zipPrefix: string, dir: string): void => {
    for (const file of walkFiles(path.join(workspaceRoot, dir))) {
      files.push({ zipPath: "desktop/" + zipPrefix + "/" + file.rel, absPath: file.abs, size: file.size, mtime: file.mtime, kind });
    }
  };
  for (const dir of BODY_DIRS) add("body", dir, dir);
  add("asset", "note-assets", "note-assets");
  add("quick-item", "quick-notes/items", path.join("quick-notes", "items"));
  add("quick-asset", "quick-notes/assets", path.join("quick-notes", "assets"));
  return files;
}

/** 解压 desktop 的 sync-v3/baseline.json.gz → 包内 desktop/sync-v3/baseline.json。
 *  - 有云端基线：正常写入并让 manifest 带 baseline ref；
 *  - 纯离线（从未同步过）：返回 null，由 buildOfflineHashes 生成仅含内容哈希的本地基线文件（manifest baseline = null）。 */
export function readPortableBaseline(workspaceRoot: string): { ref: PortableBaselineRef; json: string } | null {
  const file = path.join(workspaceRoot, "sync-v3", "baseline.json.gz");
  let raw: string;
  try {
    raw = gunzipSync(fs.readFileSync(file)).toString("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("同步基线文件损坏，无法导出便携包");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("同步基线文件损坏，无法导出便携包"); }
  const value = (parsed ?? {}) as Record<string, unknown>;
  if (typeof value.epoch !== "string" || typeof value.generation !== "number"
    || typeof value.lakeCommit !== "string" || typeof value.quickNotesCommit !== "string") {
    throw new Error("同步基线格式不符，无法导出便携包");
  }
  return {
    ref: { epoch: value.epoch, generation: value.generation, lakeCommit: value.lakeCommit, quickNotesCommit: value.quickNotesCommit },
    json: raw,
  };
}

/**
 * 纯离线导出的内容哈希清单（JSON，仍放在 desktop/sync-v3/baseline.json，供手机映射 content_hash）。
 * 只有 notes/quickNotes 两张 id→sha256 表；manifest.baseline = null ⇒ 手机不写同步基线。
 */
export function buildOfflineHashes(workspaceRoot: string, snapshotRoot: string): Buffer {
  const sha256File = (abs: string): string => createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
  const notes: Record<string, string> = {};
  const quickNotes: Record<string, string> = {};
  const main = new Database(path.join(snapshotRoot, "metadata.sqlite3"), { readonly: true });
  try {
    const rows = main.prepare(
      "SELECT t.note_file_id AS id, n.kind AS kind FROM tree_nodes t JOIN notes n ON n.id=t.note_file_id WHERE t.node_type='note' AND t.note_file_id IS NOT NULL"
    ).all() as Array<{ id: string; kind: string }>;
    for (const row of rows) {
      if (!NOTE_KINDS.includes(row.kind as NoteKind)) continue;
      const body = path.join(workspaceRoot, NOTE_BODY_DIR[row.kind as NoteKind], row.id + NOTE_BODY_EXT[row.kind as NoteKind]);
      if (!fs.existsSync(body)) continue;
      notes[row.id] = sha256File(body);
    }
  } finally { main.close(); }
  const quick = new Database(path.join(snapshotRoot, "quick-notes", "metadata.sqlite3"), { readonly: true });
  try {
    const rows = quick.prepare("SELECT id FROM quick_notes").all() as Array<{ id: string }>;
    for (const row of rows) {
      const body = path.join(workspaceRoot, quickNoteBodyRelativePath(row.id));
      if (fs.existsSync(body)) quickNotes[row.id] = sha256File(body);
    }
  } finally { quick.close(); }
  return Buffer.from(JSON.stringify({ localOnly: true, notes, quickNotes }, null, 2) + "\n", "utf8");
}

/** 计数（manifest.counts）：notes = 正文文件数；assets = 普通资源 + 小记图片；bytes = 内容总字节。 */
export function computePortableCounts(files: CollectedPortableFile[], input: { folders: number; quickNotes: number; tags: number }, extraBytes: number): PortableCounts {
  const notes = files.filter((file) => file.kind === "body").length;
  const assets = files.filter((file) => file.kind === "asset" || file.kind === "quick-asset").length;
  const bytes = files.reduce((sum, file) => sum + file.size, 0) + extraBytes;
  return { notes, folders: input.folders, quickNotes: input.quickNotes, tags: input.tags, assets, bytes };
}

function fileSource(file: CollectedPortableFile): ZipEntrySource {
  return {
    name: file.zipPath,
    size: file.size,
    mtime: file.mtime,
    read: () => fs.createReadStream(file.absPath) as unknown as AsyncIterable<Uint8Array>,
  };
}

function bufferSource(name: string, data: Buffer, mtime: Date): ZipEntrySource {
  return {
    name,
    size: data.length,
    mtime,
    read: async function* () { yield data; },
  };
}

function uniqueZipPath(targetDir: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:T]/g, "-").replace(/\..*$/, "");
  const base = "lakex-portable-" + stamp;
  for (let index = 1; index < 1000; index += 1) {
    const candidate = path.join(targetDir, index === 1 ? base + PORTABLE_FILE_EXTENSION : base + "-" + index + PORTABLE_FILE_EXTENSION);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error("导出目录里同名文件过多，请换一个目录");
}

export interface PortableExportOptions {
  workspaceRoot: string;
  /** 用户选择的目录（不存在会自动创建）。 */
  targetDir: string;
  appVersion: string;
  /** 注入回调：主库 + 小记库 VACUUM INTO 到 targetRoot（main 里接 store/quickNotes）。 */
  snapshotDatabases: (targetRoot: string) => void;
  /** 目录树/小记/标签计数（main 从 store/quickNotes 取）。 */
  counts: { folders: number; quickNotes: number; tags: number };
  now?: () => Date;
  onProgress?: (progress: PortableExportProgress) => void;
  /** 测试用：覆盖 4GiB（仍遵守 99% 余量口径）。 */
  limitBytes?: number;
  /** 测试用：替换离线内容哈希生成（默认从快照 DB + 正文计算）。 */
  offlineHashes?: () => Buffer;
}

export async function exportPortablePackage(options: PortableExportOptions): Promise<PortableExportResult> {
  const now = options.now?.() ?? new Date();
  const limitBytes = options.limitBytes ?? PORTABLE_LIMIT_BYTES;
  const emit = (progress: PortableExportProgress): void => options.onProgress?.(progress);
  if (!fs.existsSync(options.workspaceRoot)) throw new Error("工作区不存在，无法导出便携包");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lakex-portable-"));
  try {
    emit({ phase: "snapshot", filesDone: 0, filesTotal: 2, bytesWritten: 0 });
    const snapshotRoot = path.join(tempRoot, "snapshot");
    fs.mkdirSync(path.join(snapshotRoot, "quick-notes"), { recursive: true });
    options.snapshotDatabases(snapshotRoot);
    const dbFiles = [
      { zipPath: "desktop/metadata.sqlite3", absPath: path.join(snapshotRoot, "metadata.sqlite3") },
      { zipPath: "desktop/quick-notes/metadata.sqlite3", absPath: path.join(snapshotRoot, "quick-notes", "metadata.sqlite3") },
    ];
    for (const db of dbFiles) {
      if (!fs.existsSync(db.absPath)) throw new Error("数据库快照生成失败：缺少 " + db.zipPath);
    }

    emit({ phase: "collect", filesDone: 0, filesTotal: 0, bytesWritten: 0 });
    const files = collectPortableFiles(options.workspaceRoot);
    const baseline = readPortableBaseline(options.workspaceRoot);
    const dbSources = dbFiles.map((db) => {
      const stat = fs.statSync(db.absPath);
      return fileSource({ zipPath: db.zipPath, absPath: db.absPath, size: stat.size, mtime: stat.mtime, kind: "asset" });
    });
    // 有云端基线就用它；纯离线则生成「仅内容哈希」的本地基线文件（import 端看到 manifest.baseline=null 不会写入同步账本）。
    const baselineBuffer = baseline ? Buffer.from(baseline.json, "utf8") : (options.offlineHashes?.() ?? buildOfflineHashes(options.workspaceRoot, snapshotRoot));
    const baselineSource = bufferSource("desktop/sync-v3/baseline.json", baselineBuffer, now);
    const fileSources = files.sort((a, b) => a.zipPath.localeCompare(b.zipPath)).map(fileSource);

    const extraBytes = dbFiles.reduce((sum, db) => sum + fs.statSync(db.absPath).size, 0) + baselineBuffer.length;
    const counts = computePortableCounts(files, options.counts, extraBytes);
    const contentBytes = counts.bytes;
    if (contentBytes > limitBytes * 0.99) {
      if (limitBytes === PORTABLE_LIMIT_BYTES) assertPortableSize(contentBytes);
      throw new Error("数据超过 4GiB 上限，暂不支持分卷：当前约 " + (contentBytes / 1024 / 1024 / 1024).toFixed(2) + "GiB");
    }

    const manifest: Record<string, unknown> = {
      format: PORTABLE_FORMAT,
      formatVersion: PORTABLE_FORMAT_VERSION,
      appVersion: options.appVersion,
      exportedAt: now.toISOString(),
      source: { platform: "desktop" },
      hasHistory: false,
      limitBytes: PORTABLE_LIMIT_BYTES,
      counts,
      baseline: baseline?.ref ?? null,
    };
    const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
    const sources: ZipEntrySource[] = [bufferSource("portable.json", manifestBuffer, now), ...dbSources, ...fileSources, baselineSource];

    fs.mkdirSync(options.targetDir, { recursive: true });
    const zipPath = uniqueZipPath(options.targetDir, now);
    const filesTotal = sources.length;
    let filesDone = 0;
    const tracked = sources.map((source) => {
      // zip 写入是两遍读（先算 CRC/大小、再写数据）⇒ 进度只按文件计一次。
      let counted = false;
      return {
        ...source,
        read: (): AsyncIterable<Uint8Array> => (async function* () {
          yield* source.read();
          if (!counted) {
            counted = true;
            filesDone += 1;
            emit({ phase: "write", filesDone, filesTotal, bytesWritten: 0 });
          }
        })(),
      };
    });
    emit({ phase: "write", filesDone: 0, filesTotal, bytesWritten: 0 });
    const result = await writeStoreZip(zipPath, tracked, {
      maxBytes: limitBytes,
      onProgress: (bytesWritten) => emit({ phase: "write", filesDone, filesTotal, bytesWritten }),
    });
    return { path: zipPath, bytes: result.bytes, entries: result.entries, counts };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
