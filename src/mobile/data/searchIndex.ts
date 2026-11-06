import { buildMatchExpression, buildSnippet, escapeLike, segmentToIndexText } from "../../core/search/index.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import { normalizeNoteKind } from "../../core/noteKind.js";
import { searchTextForKind } from "../../core/noteSearchText.js";
import type { SearchResult } from "../../core/searchTypes.js";
import type { MobileSearchResult } from "../search/searchTypes.js";
import type { SearchScope } from "../search/searchScope.js";
import type { MobileDb } from "./sqliteDb.js";
import { readNoteBody } from "./noteBodies.js";

function hashText(text: string): string {
  return sha256Sync(new TextEncoder().encode(text));
}

/** FTS5 虚拟表是否存在（测试环境 sql.js 无 FTS5 → 搜索/索引整体降级为 no-op）。 */
async function hasSearchIndex(d: MobileDb): Promise<boolean> {
  const row = await d.prepare("SELECT 1 AS one FROM sqlite_master WHERE type='table' AND name='notes_fts'").get();
  return !!row;
}

interface NoteRow {
  id: string;
  title: string;
  content_hash: string | null;
  text_cache: string | null;
  /** v6/v7 文档类型：非 doc 的正文是内部 JSON，不能喂 Lake 解析器（见 noteSearchText）。 */
  doc_kind?: string | null;
}

/**
 * 行的纯文本：优先派生缓存 text_cache；缺失时读正文文件现算（与桌面 derivePlainText 同口径）。
 * 正文文件缺失 → 空文本（索引为空，但绝不把 row 当成有正文）。
 */
async function plainForRow(row: NoteRow): Promise<string> {
  if (row.text_cache != null) return row.text_cache;
  const kind = normalizeNoteKind(row.doc_kind);
  const content = await readNoteBody(kind, row.id).catch(() => null);
  if (content == null) return "";
  return searchTextForKind(kind, content).plain ?? "";
}

interface LedgerRow {
  fts_rowid: number;
  title_hash: string;
  body_hash: string;
}

interface PrevRow extends LedgerRow {
  note_id: string;
}

interface IndexStatement {
  statement: string;
  values: unknown[];
}

/**
 * reconcile 每次桥往返处理的文档数：一次 SELECT prev + 一次 SELECT MAX + 一批 executeSet。
 * 20（261026）：批经 Capacitor 桥传输；正文很长的库（实测 text_cache 总计 109MB、单篇均值 53KB）
 * 单批太大时 Android 端 stringify 会直接把进程打爆。20 条/批 ≈ 1MB 级；且 FTS body 已改为
 * SQL 侧从 notes.text_cache 直取，不再随批传输正文（见 reconcile 内注释）。
 */
export const RECONCILE_BATCH_SIZE = 20;

const SEARCH_INDEX_UPSERT_SQL =
  "INSERT INTO search_index(note_id, fts_rowid, title, raw_hash, title_hash, body_hash, indexed_at) VALUES(?,?,?,?,?,?,?) " +
  "ON CONFLICT(note_id) DO UPDATE SET fts_rowid=excluded.fts_rowid, title=excluded.title, raw_hash=excluded.raw_hash, title_hash=excluded.title_hash, body_hash=excluded.body_hash, indexed_at=excluded.indexed_at";

/**
 * 下发一批索引语句：优先 executeSet（原生一次桥往返 + 单事务），无 executeSet 退回单事务逐条；
 * 批量失败逐条重放——reconcile 幂等，跑漏/半成功下次自愈，不整批丢弃。
 * 调用方负责控制批大小（每块 ≈ RECONCILE_BATCH_SIZE 篇文档）。
 */
async function flushIndexStatements(d: MobileDb, statements: IndexStatement[]): Promise<void> {
  if (statements.length === 0) return;
  try {
    if (typeof d.executeSet === "function") {
      await d.executeSet(statements);
    } else {
      await d.transaction(async () => {
        for (const s of statements) await d.prepare(s.statement).run(...s.values);
      });
    }
  } catch {
    for (const s of statements) await d.prepare(s.statement).run(...s.values);
  }
}

async function writeIndexRow(d: MobileDb, row: NoteRow, prev: LedgerRow | undefined): Promise<void> {
  const title = row.title ?? "";
  // 优先编辑器写入的纯文本缓存（与桌面同源）；缺失时读正文文件按 kind 派生
  // （usheet/bitable/board 是 JSON 正文，直接 lakeHtmlToPlain 会把 JSON 碎片塞进索引）。
  const plain = await plainForRow(row);
  const titleHash = hashText(title);
  const bodyHash = hashText(plain);
  if (prev && prev.title_hash === titleHash && prev.body_hash === bodyHash) {
    // 纯样式变化：FTS 不动，但 raw_hash/title 账本要跟上，避免每轮 reconcile 重复命中。
    await d.prepare("UPDATE search_index SET title=?, raw_hash=? WHERE note_id=?").run(title, row.content_hash, row.id);
    return;
  }
  await d.transaction(async () => {
    let rowid: number;
    if (prev) {
      rowid = prev.fts_rowid;
      await d.prepare("DELETE FROM notes_fts WHERE rowid=?").run(rowid);
    } else {
      const max = await d.prepare("SELECT IFNULL(MAX(fts_rowid), 0) AS m FROM search_index").get() as { m: number } | undefined;
      rowid = Number(max?.m ?? 0) + 1;
    }
    await d.prepare("INSERT INTO notes_fts(rowid, title, body) VALUES(?,?,?)").run(rowid, segmentToIndexText(title), segmentToIndexText(plain));
    await d.prepare(SEARCH_INDEX_UPSERT_SQL).run(row.id, rowid, title, row.content_hash, titleHash, bodyHash, new Date().toISOString());
  });
}

/** 单条索引（保存后调用）：按内容 hash 短路，未变不写。 */
export async function indexNote(d: MobileDb, noteId: string): Promise<void> {
  if (!(await hasSearchIndex(d))) return;
  const row = await d.prepare("SELECT id, title, content_hash, text_cache, doc_kind FROM notes WHERE id=?").get(noteId) as NoteRow | undefined;
  if (!row) return;
  const prev = await d.prepare("SELECT fts_rowid, title_hash, body_hash FROM search_index WHERE note_id=?").get(noteId) as LedgerRow | undefined;
  await writeIndexRow(d, row, prev);
}

/** 单条移除（进回收站）。 */
export async function removeNoteFromIndex(d: MobileDb, noteId: string): Promise<void> {
  if (!(await hasSearchIndex(d))) return;
  const prev = await d.prepare("SELECT fts_rowid FROM search_index WHERE note_id=?").get(noteId) as { fts_rowid: number } | undefined;
  if (!prev) return;
  await d.transaction(async () => {
    await d.prepare("DELETE FROM notes_fts WHERE rowid=?").run(prev.fts_rowid);
    await d.prepare("DELETE FROM search_index WHERE note_id=?").run(noteId);
  });
}

/** 全量对账：删除已消失/进回收站的账本；为缺失或标题/原始 hash 变化的活跃文档（重）建索引。 */
export async function reconcileIndex(d: MobileDb): Promise<void> {
  if (!(await hasSearchIndex(d))) return;
  const stale = await d.prepare(
    "SELECT si.note_id AS note_id, si.fts_rowid AS fts_rowid FROM search_index si " +
    "LEFT JOIN notes n ON n.id = si.note_id " +
    "WHERE n.id IS NULL OR n.trashed_at IS NOT NULL"
  ).all() as Array<{ note_id: string; fts_rowid: number }>;
  for (let i = 0; i < stale.length; i += RECONCILE_BATCH_SIZE) {
    // 批量删除：一条 DELETE 语句/账本行，每块 executeSet 一次下发。
    const deletes: IndexStatement[] = [];
    for (const row of stale.slice(i, i + RECONCILE_BATCH_SIZE)) {
      deletes.push({ statement: "DELETE FROM notes_fts WHERE rowid=?", values: [row.fts_rowid] });
      deletes.push({ statement: "DELETE FROM search_index WHERE note_id=?", values: [row.note_id] });
    }
    await flushIndexStatements(d, deletes);
  }
  // 分批（keyset）取需要（重）建索引的行：2k 篇的 text_cache 一次性读回会把 Android WebView 堆打爆
  // （261026 实测 OOM：selectSQL 组装 2k × 十几 KB 的 JSON）。按 id 升序、每批 RECONCILE_BATCH_SIZE。
  let cursor = "";
  for (;;) {
    const chunk = await d.prepare(
      "SELECT n.id AS id, n.title AS title, n.content_hash AS content_hash, n.text_cache AS text_cache, n.doc_kind AS doc_kind " +
      "FROM notes n LEFT JOIN search_index si ON si.note_id = n.id " +
      "WHERE n.trashed_at IS NULL AND n.id > ? AND (si.note_id IS NULL OR si.title != n.title OR si.raw_hash IS NULL OR si.raw_hash != n.content_hash) " +
      "ORDER BY n.id LIMIT ?"
    ).all(cursor, RECONCILE_BATCH_SIZE) as unknown as NoteRow[];
    if (chunk.length === 0) break;
    cursor = String(chunk[chunk.length - 1].id);
    const placeholders = chunk.map(() => "?").join(",");
    const prevRows = await d.prepare(
      "SELECT note_id, fts_rowid, title_hash, body_hash FROM search_index WHERE note_id IN (" + placeholders + ")"
    ).all(...chunk.map((row) => row.id)) as unknown as PrevRow[];
    const prevByNote = new Map(prevRows.map((row) => [String(row.note_id), row]));
    const maxRow = await d.prepare("SELECT IFNULL(MAX(fts_rowid), 0) AS m FROM search_index").get() as { m: number } | undefined;
    let nextRowid = Number(maxRow?.m ?? 0) + 1;
    const statements: IndexStatement[] = [];
    const indexedAt = new Date().toISOString();
    for (const row of chunk) {
      const prev = prevByNote.get(row.id);
      const title = row.title ?? "";
      // 与单条路径同口径：优先 text_cache，缺失则读正文文件按 kind 派生（见 plainForRow）。
      const plain = await plainForRow(row);
      const titleHash = hashText(title);
      const bodyHash = hashText(plain);
      if (prev && prev.title_hash === titleHash && prev.body_hash === bodyHash) {
        // 纯样式变化：FTS 不动，但 raw_hash/title 账本要跟上，避免每轮 reconcile 重复命中。
        statements.push({ statement: "UPDATE search_index SET title=?, raw_hash=? WHERE note_id=?", values: [title, row.content_hash, row.id] });
        continue;
      }
      let rowid: number;
      if (prev) {
        rowid = prev.fts_rowid;
        statements.push({ statement: "DELETE FROM notes_fts WHERE rowid=?", values: [rowid] });
      } else {
        rowid = nextRowid++;
      }
      // 正文必须按 segmentToIndexText（CJK 分词）写 FTS，否则中文搜索会失效；
      // 批大小压到 20 条是为了不让一次 executeSet 的 JSON 在 Android 端 stringify 时 OOM
      // （实测 200 条 × 均 53KB 的批会把调试包直接打崩）。
      statements.push({ statement: "INSERT INTO notes_fts(rowid, title, body) VALUES(?,?,?)", values: [rowid, segmentToIndexText(title), segmentToIndexText(plain)] });
      statements.push({ statement: SEARCH_INDEX_UPSERT_SQL, values: [row.id, rowid, title, row.content_hash, titleHash, bodyHash, indexedAt] });
    }
    await flushIndexStatements(d, statements);
  }
}

/** 行 → 搜索结果（摘要口径 = 桌面同一套 buildSnippet；正文优先 text_cache，缺失时读正文文件派生）。 */
async function toDocResult(
  row: Record<string, unknown>,
  matchType: "title" | "body",
  query: string,
  matchedTags?: string[],
): Promise<MobileSearchResult> {
  const title = String(row.title ?? "");
  const kind = normalizeNoteKind(row.doc_kind);
  let plain: string;
  if (row.text_cache != null) {
    plain = String(row.text_cache);
  } else {
    const content = await readNoteBody(kind, String(row.note_id)).catch(() => null);
    plain = content == null ? "" : (searchTextForKind(kind, content).plain ?? "");
  }
  const titleSnippet = matchType === "title" ? buildSnippet(title, query) : "";
  const bodySnippet = buildSnippet(plain, query);
  // 标签命中：摘要优先给**命中的标签名**（不然用户看不出"为什么匹配"）；没有标签摘要时才回落标题/正文片段。
  const tagSnippet = matchedTags && matchedTags.length > 0 ? buildSnippet(matchedTags.join(" "), query) : "";
  const result: MobileSearchResult = {
    id: String(row.note_id),
    title,
    snippet: tagSnippet || (matchType === "title" ? (titleSnippet || bodySnippet) : (bodySnippet || titleSnippet)),
    matchType,
    updatedAt: String(row.updated_at ?? ""),
    parentTitle: row.parent_title ? String(row.parent_title) : null,
  };
  if (matchedTags && matchedTags.length > 0) result.matchedTags = matchedTags;
  return result;
}

/** 搜索：与桌面同一分词/查询/摘要核心；1/2/3+ 字统一。（= 「全部」范围的标题/正文部分） */
export async function searchNotes(d: MobileDb, query: string, limit = 50): Promise<SearchResult[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  if (!(await hasSearchIndex(d))) return [];
  const match = buildMatchExpression(normalized);
  if (!match) return [];
  const titlePrefix = escapeLike(normalized) + "%";
  const titleContains = "%" + escapeLike(normalized) + "%";
  const rows = await d.prepare(
    "SELECT si.note_id AS note_id, n.title AS title, n.text_cache AS text_cache, n.doc_kind AS doc_kind, n.updated_at AS updated_at, f.title AS parent_title, " +
    "CASE WHEN n.title = ? THEN 0 WHEN n.title LIKE ? ESCAPE '\\' THEN 1 WHEN n.title LIKE ? ESCAPE '\\' THEN 2 ELSE 3 END AS title_match " +
    "FROM notes_fts " +
    "JOIN search_index si ON si.fts_rowid = notes_fts.rowid " +
    "JOIN notes n ON n.id = si.note_id " +
    "LEFT JOIN folders f ON n.parent_id = f.id " +
    "WHERE notes_fts MATCH ? AND n.trashed_at IS NULL " +
    "ORDER BY title_match, bm25(notes_fts, 10.0, 1.0), n.updated_at DESC LIMIT ?"
  ).all(normalized, titlePrefix, titleContains, match, limit) as Array<Record<string, unknown>>;
  return Promise.all(rows.map((row) => toDocResult(row, Number(row.title_match ?? 3) < 3 ? "title" : "body", normalized)));
}
/** 单领域（文档）每次搜索的召回上限：与「全部」范围保持一致，避免切范围时结果条数跳变。 */
export const DOC_SEARCH_SCOPE_LIMIT = 50;

/** 标签名拼接分隔符（U+001F 单元分隔符）：标签名允许含空格，不能用空格拼。 */
const TAG_NAME_SEPARATOR = "\u001f";

function splitTagNames(raw: unknown): string[] {
  const text = String(raw ?? "");
  return text ? text.split(TAG_NAME_SEPARATOR).filter(Boolean) : [];
}

/** 标题范围：只匹配标题（LIKE 子串）。「全部」里的标题命中判定也是 LIKE，两个范围同一套匹配语义。 */
async function searchDocsByTitle(d: MobileDb, query: string, limit: number): Promise<MobileSearchResult[]> {
  const titlePrefix = escapeLike(query) + "%";
  const titleContains = "%" + escapeLike(query) + "%";
  const rows = await d.prepare(
    "SELECT n.id AS note_id, n.title AS title, n.text_cache AS text_cache, n.doc_kind AS doc_kind, n.updated_at AS updated_at, f.title AS parent_title, " +
    "CASE WHEN n.title = ? THEN 0 WHEN n.title LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END AS title_match " +
    "FROM notes n LEFT JOIN folders f ON n.parent_id = f.id " +
    "WHERE n.trashed_at IS NULL AND n.title LIKE ? ESCAPE '\\' " +
    "ORDER BY title_match, n.updated_at DESC LIMIT ?"
  ).all(query, titlePrefix, titleContains, limit) as Array<Record<string, unknown>>;
  return Promise.all(rows.map((row) => toDocResult(row, "title", query)));
}

/**
 * 正文范围：只让正文列参与匹配（标题命中不算「正文」）。
 * FTS5 列过滤语法 `body : (expr)`（已用系统 sqlite3 的 FTS5 实测：前缀词/多词短语括号分组都可用）；
 * 无 FTS（Web 预览/测试）时降级为 text_cache 的 LIKE —— 语义仍是「正文里含这段文字」。
 */
async function searchDocsByBody(d: MobileDb, query: string, limit: number): Promise<MobileSearchResult[]> {
  if (await hasSearchIndex(d)) {
    const match = buildMatchExpression(query);
    if (!match) return [];
    const rows = await d.prepare(
      "SELECT si.note_id AS note_id, n.title AS title, n.text_cache AS text_cache, n.doc_kind AS doc_kind, n.updated_at AS updated_at, f.title AS parent_title " +
      "FROM notes_fts " +
      "JOIN search_index si ON si.fts_rowid = notes_fts.rowid " +
      "JOIN notes n ON n.id = si.note_id " +
      "LEFT JOIN folders f ON n.parent_id = f.id " +
      "WHERE notes_fts MATCH ? AND n.trashed_at IS NULL " +
      "ORDER BY bm25(notes_fts, 1.0, 1.0), n.updated_at DESC LIMIT ?"
    ).all("body : (" + match + ")", limit) as Array<Record<string, unknown>>;
    return Promise.all(rows.map((row) => toDocResult(row, "body", query)));
  }
  const rows = await d.prepare(
    "SELECT n.id AS note_id, n.title AS title, n.text_cache AS text_cache, n.doc_kind AS doc_kind, n.updated_at AS updated_at, f.title AS parent_title " +
    "FROM notes n LEFT JOIN folders f ON n.parent_id = f.id " +
    "WHERE n.trashed_at IS NULL AND IFNULL(n.text_cache, '') LIKE ? ESCAPE '\\' " +
    "ORDER BY n.updated_at DESC LIMIT ?"
  ).all("%" + escapeLike(query) + "%", limit) as Array<Record<string, unknown>>;
  return Promise.all(rows.map((row) => toDocResult(row, "body", query)));
}

/**
 * 标签范围：文档标签名（tag_links target_kind='note' → tags.name）。
 * 删除标签 = 缺席：删除会清关系行，这里不读任何墓碑字段（261105 定稿）。
 */
async function searchDocsByTags(d: MobileDb, query: string, limit: number): Promise<MobileSearchResult[]> {
  const rows = await d.prepare(
    "SELECT n.id AS note_id, n.title AS title, n.text_cache AS text_cache, n.doc_kind AS doc_kind, n.updated_at AS updated_at, f.title AS parent_title, " +
    "GROUP_CONCAT(t.name, '" + TAG_NAME_SEPARATOR + "') AS matched_tags " +
    "FROM tag_links tl " +
    "JOIN tags t ON t.id = tl.tag_id " +
    "JOIN notes n ON n.id = tl.target_id " +
    "LEFT JOIN folders f ON n.parent_id = f.id " +
    "WHERE tl.target_kind = 'note' AND t.name LIKE ? ESCAPE '\\' AND n.trashed_at IS NULL " +
    "GROUP BY n.id ORDER BY n.updated_at DESC LIMIT ?"
  ).all("%" + escapeLike(query) + "%", limit) as Array<Record<string, unknown>>;
  return Promise.all(rows.map((row) => toDocResult(row, "body", query, splitTagNames(row.matched_tags))));
}

/**
 * 无 FTS 时的「全部」文档部分：标题 LIKE ∪ 正文 LIKE（去重）。生产原生 SQLite 恒有 FTS5，
 * 这里只服务 Web 预览/旧库；不补的话会出现「标题/正文档能搜到、全部却搜不到」的自相矛盾。
 */
async function searchDocsWithoutFts(d: MobileDb, query: string, limit: number): Promise<MobileSearchResult[]> {
  const titleHits = await searchDocsByTitle(d, query, limit);
  if (titleHits.length >= limit) return titleHits;
  const bodyHits = await searchDocsByBody(d, query, limit);
  const merged: MobileSearchResult[] = [...titleHits];
  const seen = new Set(titleHits.map((hit) => hit.id));
  for (const hit of bodyHits) {
    if (seen.has(hit.id)) continue;
    if (merged.length >= limit) break;
    merged.push(hit);
    seen.add(hit.id);
  }
  return merged;
}

/**
 * 文档搜索（按范围）。「全部」= 标题/正文命中在前（沿用既有排序），**标签独有命中**补在后 ——
 * 「全部」就是不限字段，否则用户按标签名搜文档在默认范围里会一篇都搜不到。
 */
export async function searchDocsByScope(
  d: MobileDb,
  query: string,
  scope: SearchScope,
  limit = DOC_SEARCH_SCOPE_LIMIT,
): Promise<MobileSearchResult[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  if (scope === "title") return searchDocsByTitle(d, normalized, limit);
  if (scope === "body") return searchDocsByBody(d, normalized, limit);
  if (scope === "tags") return searchDocsByTags(d, normalized, limit);
  const primary: MobileSearchResult[] = await hasSearchIndex(d)
    ? await searchNotes(d, normalized, limit)
    : await searchDocsWithoutFts(d, normalized, limit);
  if (primary.length >= limit) return primary;
  const tagHits = await searchDocsByTags(d, normalized, limit);
  const merged: MobileSearchResult[] = [...primary];
  const byId = new Map<string, MobileSearchResult>(primary.map((item) => [item.id, item] as const));
  for (const hit of tagHits) {
    const existing = byId.get(hit.id);
    if (existing) {
      // 同一篇既命中标题/正文又命中标签：只出一条，但把标签名带上（结果行能看出"还命中了标签"）。
      if (hit.matchedTags) existing.matchedTags = hit.matchedTags;
      continue;
    }
    if (merged.length >= limit) break;
    merged.push(hit);
    byId.set(hit.id, hit);
  }
  return merged;
}
