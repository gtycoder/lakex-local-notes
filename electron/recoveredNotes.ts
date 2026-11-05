/**
 * 261105 Batch4-D：手动「重建数据」（文件 → 元数据，**必须用户确认**）。
 *
 * 背景/结论（RESILIENCE 契约）：思源把「文件系统反向订正索引」做成自动；我们 S3 v3 是内容寻址
 * + 云端正文副本 + 缺正文恢复链路，文件不是唯一来源 ⇒ 只保留**手动**重建：
 * - 低频扫描（每 24h，可 0 关闭）**只报告**（fileMetadataReconcile，stat-only）；
 * - 重建入口只接受**本次手动扫描列出的候选 id**（路径/大小/mtime/可派生标题），勾选 + 二次确认后才落库。
 *
 * 重建语义：
 * - 正文不可解析/损坏 ⇒ **拒绝**，绝不覆盖原文件（doc = Lake HTML：要求合法 UTF-8、非空、不含 NUL；
 *   usheet/bitable/board/ink 共用 core/docBodySafety 单一判据）；
 * - 标题派生：**核实结论 = 正文里没有标题字段**。`.lake` 是 Lake HTML（标题只在 notes/tree_nodes），
 *   usheet/bitable/board/ink 的 JSON 顶层也没有 title ⇒ doc 退化为「首个 H1~H6 文本」，
 *   其余 kind 尝试 JSON 顶层 title（为未来留口），都没有则用「恢复的笔记 <id 前 8 位>」；
 * - 落点：惰性创建专用笔记本「恢复的笔记」（固定 id = notebook-recovered，不复用兜底笔记本），
 *   重建 notes + tree_nodes 行并标 dirty（随下次同步上传）；**正文文件原样不动**（不写、不删）；
 * - 幂等：行已存在 = skipped；审计：每条一条主进程日志（id/路径/标题/结果）。
 */
import fs from "node:fs";
import path from "node:path";
import { noteBodyRelativePath } from "../src/core/noteBodyPaths.js";
import { normalizeNoteKind, type NoteKind } from "../src/core/noteKind.js";
import { checkDocBody } from "../src/core/docBodySafety.js";
import { scanOrphanBodyFiles, type FileOrphanCandidate } from "./fileMetadataReconcile.js";
import type { RebuildCandidateShape, RebuildNoteResultShape, RebuildResultShape, RebuildScanResultShape } from "../src/lib/types.js";

/** 专用笔记本：固定 id（跨升级稳定，不与兜底「未分类」混用）。 */
export const RECOVERED_NOTEBOOK_ID = "notebook-recovered";
export const RECOVERED_NOTEBOOK_TITLE = "恢复的笔记";

/** 标题兜底：恢复的笔记 + id 前 8 位（与重建语义绑定，UI 与测试共用）。 */
export function fallbackRecoveredTitle(noteId: string): string {
  return RECOVERED_NOTEBOOK_TITLE + " " + noteId.slice(0, 8);
}

export interface DerivedTitle {
  title: string;
  titleSource: "body" | "fallback";
}

/** HTML 片段 → 纯文本（只解最小实体；lake 正文标题是内核写的常规 HTML）。 */
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 标题派生（正文优先，解析不到退化）：
 * - doc（Lake HTML）：首个 H1~H6 文本；
 * - JSON 四族：顶层 `title` 字符串（当前 schema 没有该字段，保留为兼容口）；
 * - 否则 fallback。
 */
export function deriveRecoveredTitle(kind: NoteKind, raw: string, noteId: string): DerivedTitle {
  if (kind === "doc") {
    const match = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/i.exec(raw);
    const heading = match ? htmlToText(match[2]) : "";
    if (heading) return { title: heading.slice(0, 120), titleSource: "body" };
  } else {
    try {
      const parsed = JSON.parse(raw) as { title?: unknown };
      if (parsed && typeof parsed.title === "string" && parsed.title.trim()) {
        return { title: parsed.title.trim().slice(0, 120), titleSource: "body" };
      }
    } catch { /* 坏 JSON 由可读性检查拒绝，这里只做标题派生 */ }
  }
  return { title: fallbackRecoveredTitle(noteId), titleSource: "fallback" };
}

/** 读正文（严格 UTF-8 + 无 NUL）：损坏/读不出返回可读原因，不抛。 */
export function readRecoveredBodyText(absPath: string): { ok: true; text: string } | { ok: false; reason: string } {
  let bytes: Buffer;
  try { bytes = fs.readFileSync(absPath); } catch (error) {
    return { ok: false, reason: "正文文件读取失败：" + (error instanceof Error ? error.message : String(error)) };
  }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return { ok: false, reason: "正文不是合法 UTF-8（可能已损坏）" }; }
  if (bytes.includes(0)) return { ok: false, reason: "正文包含二进制内容（可能已损坏）" };
  if (!text.trim()) return { ok: false, reason: "正文为空（没有可恢复的内容）" };
  return { ok: true, text };
}

/** 正文可读性（与「打开=只读」同源判据）：不可解析/结构不对 ⇒ 拒绝重建。 */
export function assertRecoveredBodyReadable(kind: NoteKind, text: string): { ok: true } | { ok: false; reason: string } {
  if (kind === "doc") return { ok: true };
  const checked = checkDocBody(kind, text);
  return checked.status === "ok"
    ? { ok: true }
    : { ok: false, reason: "正文无法解析（" + (checked.reason === "invalid-json" ? "不是合法 JSON" : "结构不符合 " + kind + " 文档") + "）" };
}

/** 扫描候选补全：读正文 → 派生标题 + 可重建性（**只读**，不写库/文件）。 */
export function inspectRecoveredCandidate(root: string, candidate: FileOrphanCandidate): RebuildCandidateShape {
  const kind = candidate.kind;
  const absPath = path.join(root, noteBodyRelativePath(kind, candidate.noteId));
  const read = readRecoveredBodyText(absPath);
  if (!read.ok) {
    return { ...candidate, kind, title: fallbackRecoveredTitle(candidate.noteId), titleSource: "fallback", rebuildable: false, reason: read.reason };
  }
  const readable = assertRecoveredBodyReadable(kind, read.text);
  const derived = deriveRecoveredTitle(kind, read.text, candidate.noteId);
  return {
    ...candidate,
    kind,
    title: derived.title,
    titleSource: derived.titleSource,
    rebuildable: readable.ok,
    ...(readable.ok ? {} : { reason: readable.reason }),
  };
}

export interface RecoveredNoteInsert {
  id: string;
  title: string;
  kind: NoteKind;
  content: string;
}

/** 重建落库端口（Store 实现；服务只做决策/校验，写库在 Store 单事务里）。 */
export interface RecoveredNotesStorePort {
  listKnownNoteIds(): Iterable<string>;
  hasNote(id: string): boolean;
  rebuildRecoveredNotes(rows: readonly RecoveredNoteInsert[]): Array<{ id: string; status: "created" | "skipped" }>;
}

export interface RecoveredNotesServiceDeps {
  root: string;
  store: RecoveredNotesStorePort;
  log?: (message: string) => void;
  now?: () => Date;
}

/** 手动扫描 + 手动重建的编排（状态只保留「本次扫描候选」，进程内）。 */
export class RecoveredNotesService {
  private readonly deps: RecoveredNotesServiceDeps;
  private lastScan: Map<string, RebuildCandidateShape> | null = null;

  constructor(deps: RecoveredNotesServiceDeps) {
    this.deps = deps;
  }

  private iso(): string { return (this.deps.now ?? (() => new Date()))().toISOString(); }

  /** 手动扫描（只读）：只 stat + 读正文派生标题；结果同时成为「允许重建」的候选白名单。 */
  scan(): RebuildScanResultShape {
    const report = scanOrphanBodyFiles({ root: this.deps.root, knownNoteIds: new Set(this.deps.store.listKnownNoteIds()) });
    const candidates = report.candidates.map((candidate) => inspectRecoveredCandidate(this.deps.root, candidate));
    this.lastScan = new Map(candidates.map((candidate) => [candidate.noteId, candidate]));
    this.deps.log?.("[rebuild] scan " + JSON.stringify({ scannedFiles: report.scannedFiles, candidates: candidates.length, rebuildable: candidates.filter((c) => c.rebuildable).length }));
    return { generatedAt: report.generatedAt, scannedFiles: report.scannedFiles, truncated: report.truncated, candidates };
  }

  /**
   * 重建所选（**只允许本次扫描候选**；非候选 id 直接拒绝整次调用）。
   * 每条结果：created（新建行）/ skipped（行已存在，幂等）/ rejected（正文坏）/ failed（落库异常）。
   */
  async rebuild(ids: unknown): Promise<RebuildResultShape> {
    if (!Array.isArray(ids) || ids.length === 0) throw new Error("请先扫描并勾选要重建的笔记");
    const lastScan = this.lastScan;
    if (!lastScan) throw new Error("请先点击「扫描」得到候选列表，再重建（只允许重建本次扫描出的候选）");
    const unique = [...new Set(ids.filter((id): id is string => typeof id === "string"))];
    if (unique.length !== ids.length) throw new Error("重建参数包含非法 id");
    const notCandidate = unique.filter((id) => !lastScan.has(id));
    if (notCandidate.length > 0) throw new Error("包含非本次扫描候选的笔记 id：" + notCandidate.join("、"));

    const rows: RecoveredNoteInsert[] = [];
    const results = new Map<string, RebuildNoteResultShape>();
    for (const id of unique) {
      const candidate = lastScan.get(id)!;
      const kind = normalizeNoteKind(candidate.kind);
      const absPath = path.join(this.deps.root, noteBodyRelativePath(kind, id));
      // 重建时**重新读一遍**：扫描到重建之间文件可能被改动/删除（不信任旧结果）。
      const read = readRecoveredBodyText(absPath);
      if (!read.ok) { results.set(id, { noteId: id, status: "rejected", title: candidate.title, reason: read.reason }); continue; }
      const readable = assertRecoveredBodyReadable(kind, read.text);
      if (!readable.ok) { results.set(id, { noteId: id, status: "rejected", title: candidate.title, reason: readable.reason }); continue; }
      if (this.deps.store.hasNote(id)) { results.set(id, { noteId: id, status: "skipped", title: candidate.title, reason: "该笔记已存在，跳过（幂等）" }); continue; }
      const derived = deriveRecoveredTitle(kind, read.text, id);
      rows.push({ id, title: derived.title, kind, content: read.text });
      results.set(id, { noteId: id, status: "created", title: derived.title });
    }

    if (rows.length > 0) {
      try {
        const outcomes = this.deps.store.rebuildRecoveredNotes(rows);
        for (const outcome of outcomes) {
          const result = results.get(outcome.id);
          if (!result) continue;
          if (outcome.status === "skipped") { result.status = "skipped"; result.reason = "该笔记已存在，跳过（幂等）"; }
        }
      } catch (error) {
        const reason = "落库失败：" + (error instanceof Error ? error.message : String(error));
        for (const row of rows) { const result = results.get(row.id); if (result) { result.status = "failed"; result.reason = reason; } }
      }
    }

    const ordered = unique.map((id) => results.get(id)!);
    // 审计：每条一行（id/路径/标题/结果），重建前后都不删除任何文件。
    for (const result of ordered) {
      const candidate = lastScan.get(result.noteId)!;
      this.deps.log?.("[rebuild] " + JSON.stringify({ id: result.noteId, path: candidate.relativePath, title: result.title ?? candidate.title, status: result.status, reason: result.reason ?? null }));
    }
    return { generatedAt: this.iso(), notebookId: RECOVERED_NOTEBOOK_ID, results: ordered };
  }
}
