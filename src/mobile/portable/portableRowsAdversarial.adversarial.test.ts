
import { describe, expect, it } from "vitest";
import {
  mapDesktopTree,
  mapOrphanNoteRow,
  mapQuickNoteRow,
  mapQuickNoteDeletedRow,
  mapTagRow,
  mapTagLinkRow,
  parsePortableBaseline,
  parsePortableContentHashes,
  type DesktopRow,
  type MobileTagLinkRow,
  type MobileTagLinkVersionRow,
  type ParsedPortableBaseline,
} from "./portableMapping";
import { bootstrapRowsFromMobileRows } from "./importPortable";
import { buildBootstrapBaseline, isBootstrapBaseline } from "../../core/portable/bootstrapBaseline";
import type { LakeFolderEntry, LakeNoteEntry, QuickNoteEntry, QuickNoteTagEntry } from "../../core/s3v3/protocol/s3v3Index";

/**
 * 行级对抗档（261123 lead 点单）：坏行 / 恶意行喂进迁移行映射与合并底稿合成。
 * 不变量：**个别坏行只丢该条，绝不毁整包导入**（bootstrapBaseline.ts 头注释的既定语义），
 * 映射层不得抛未捕获异常；行为以 characterization 钉住，缺口进报告。
 */

const H = (ch: string): string => ch.repeat(64);
const TS = "2026-11-09T00:00:00.000Z";

const baselineJson = () => ({
  epoch: "epoch-1",
  generation: 3,
  lakeCommit: H("c"),
  quickNotesCommit: H("d"),
  lake: {
    v: 3,
    space: "lake",
    notes: [{ id: "n1", title: "文档1", parentId: "nb1", sortOrder: 0, updatedAt: TS, contentHash: H("a"), kind: "doc" }],
    folders: [{ id: "nb1", title: "个人笔记", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: TS }],
  },
  quickNotes: { v: 3, space: "quickNotes", items: [{ id: "q1", createdAt: TS, updatedAt: TS, contentHash: H("b") }] },
});
const baseline = (): ParsedPortableBaseline => parsePortableBaseline(baselineJson());

const note = (id: string, over: Partial<LakeNoteEntry> = {}): LakeNoteEntry => ({
  id, title: "t-" + id, parentId: null, sortOrder: 0, updatedAt: TS, contentHash: H("a"), ...over,
});
const folder = (id: string, over: Partial<LakeFolderEntry> = {}): LakeFolderEntry => ({
  id, title: "nb-" + id, parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: TS, space: null, trashedAt: null, deletedFromParentId: null, ...over,
});
const quick = (id: string, over: Partial<QuickNoteEntry> = {}): QuickNoteEntry => ({
  id, createdAt: TS, updatedAt: TS, contentHash: H("b"), ...over,
});

describe("合并底稿合成（buildBootstrapBaseline）坏行容忍", () => {
  it("重复 id 只留第一条；坏 hash / 空 id / 路径型 id 逐条丢弃，其余完好", () => {
    const out = buildBootstrapBaseline({
      notes: [
        note("n-good"),
        note("n-good", { contentHash: H("x"), title: "dup-应被丢弃" }),
        note("n-badhash", { contentHash: "not-a-hash" }),
        note("n-emptyhash", { contentHash: "" }),
        note("", { contentHash: H("z") }),
        note("a/b", { contentHash: H("z") }),
        note("..", { contentHash: H("z") }),
      ],
      folders: [folder("nb1"), folder("nb1", { title: "dup-folder" }), folder("nb-ok")],
      quickItems: [quick("q1"), quick("q1", { contentHash: H("y") }), quick("q-bad", { contentHash: "zzz" })],
    });
    expect(isBootstrapBaseline(out)).toBe(true);
    expect(out.lake.notes.map((n) => n.id)).toEqual(["n-good"]);
    expect(out.lake.notes[0].title).toBe("t-n-good");
    expect(out.lake.folders.map((f) => f.id).sort()).toEqual(["nb-ok", "nb1"]);
    expect(out.lake.folders.find((f) => f.id === "nb1")!.title).toBe("nb-nb1");
    expect(out.quickNotes.items.map((q) => q.id)).toEqual(["q1"]);
  });

  it("毒行混在大量好行里不毁整包（200 好 + 2 毒）", () => {
    const notes = Array.from({ length: 200 }, (_, i) => note("n" + String(i).padStart(4, "0")));
    notes.splice(100, 0, note("n0050", { contentHash: "poison" }), note("n-poison", { contentHash: "bad" }));
    const out = buildBootstrapBaseline({ notes, folders: [], quickItems: [] });
    expect(out.lake.notes).toHaveLength(200);
    expect(out.bootstrap).toBe(true);
  });

  it("全部坏行：底稿为空集而不是抛错（幂等导入的既定语义；characterization）", () => {
    const out = buildBootstrapBaseline({
      notes: [note("", { contentHash: "x" }), note("a/b", { contentHash: H("a") })],
      folders: [folder("")],
      quickItems: [quick("q/../x", { contentHash: "no" })],
    });
    expect(out.lake.notes).toEqual([]);
    expect(out.lake.folders).toEqual([]);
    expect(out.quickNotes.items).toEqual([]);
    expect(out.bootstrap).toBe(true);
  });

  it("quickPurged / quickTags 恶意值不炸（超长 tagIds 等交整体校验兜底）", () => {
    const out = buildBootstrapBaseline({
      notes: [note("n1")],
      folders: [],
      quickItems: [quick("q1")],
      quickTags: [{ id: "qt1", name: "标签", createdAt: TS, updatedAt: TS, sortOrder: 0 } as unknown as QuickNoteTagEntry],
      quickPurged: ["q-dead", "", "a/b"],
    });
    expect(out.quickNotes.items.map((q) => q.id)).toEqual(["q1"]);
  });
});

describe("行映射层坏行（portableMapping）", () => {
  it("mapDesktopTree：重复 tree/note id 与坏字段不抛错（去重/容忍 characterization）", () => {
    const treeRows: DesktopRow[] = [
      { id: "nb1", parent_id: null, node_type: "notebook", title: "本", sort_order: "0", updated_at: TS, is_purged: 0 },
      { id: "nb1", parent_id: null, node_type: "notebook", title: "重复本", sort_order: 1, updated_at: TS, is_purged: 0 },
      { id: "g1", parent_id: "nb1", node_type: "group", title: null, sort_order: null, updated_at: "", is_purged: "1" },
      { id: "", parent_id: null, node_type: "notebook", title: "空 id", sort_order: 0, updated_at: TS, is_purged: 0 },
      { id: "g2", parent_id: "nb1", node_type: "unknown-kind", title: "x", sort_order: 2, updated_at: TS, is_purged: 0 },
    ];
    const noteRows: DesktopRow[] = [
      { id: "n1", title: "d", parent_id: "nb1", sort_order: 0, updated_at: TS, content_hash: H("a"), is_purged: 0 },
      { id: "n1", title: "d-dup", parent_id: "nb1", sort_order: 1, updated_at: TS, content_hash: H("a"), is_purged: 0 },
      { id: "n2", title: 42, parent_id: "missing-parent", sort_order: -5, updated_at: TS, content_hash: null, is_purged: 0 },
    ];
    const mapped = mapDesktopTree(treeRows, noteRows, baseline());
    // characterization：映射层不去重（重复 id 原样穿透，落库时由 SQLite 主键收敛；
    // 合并底稿合成层另有 dedupe 双保险）——不抛错即过，重复口径按现状钉住
    expect(mapped.folders.length).toBeGreaterThanOrEqual(1);
    expect(mapped.notes.length).toBeGreaterThanOrEqual(1);
    const ids = mapped.notes.map((n) => n.id);
    expect(ids.filter((x) => x === "n1").length).toBe(2);
  });

  it("mapQuickNoteRow / mapQuickNoteDeletedRow / mapTagRow / mapTagLinkRow 坏行不抛错", () => {
    expect(mapQuickNoteRow({}, baseline())).toBeNull();
    expect(mapQuickNoteDeletedRow({})).toBeNull();
    expect(mapTagRow({})).toBeNull();
    expect(mapTagLinkRow({ tag_id: "t1", target_kind: "bogus", target_id: "x" })).toBeNull();
    // 字段残缺：返回 null 或带默认值的行，均不得抛错
    expect(() => mapQuickNoteRow({ id: "q1" }, baseline())).not.toThrow();
    expect(() => mapQuickNoteRow({ id: "q1", created_at: TS, updated_at: TS, content_hash: H("b") }, baseline())).not.toThrow();
    expect(() => mapOrphanNoteRow({ id: "n9", title: "孤儿", updated_at: TS, is_purged: 0, deleted_at: TS }, baseline())).not.toThrow();
  });

  it("parsePortableBaseline / parsePortableContentHashes 毒输入", () => {
    expect(() => parsePortableBaseline(42)).toThrow();
    expect(() => parsePortableBaseline({ ...baselineJson(), lake: "not-an-object" })).toThrow();
    expect(() => parsePortableBaseline({ ...baselineJson(), lake: { v: 3, space: "lake", notes: "x", folders: [] } })).toThrow();
    // JSON 原型键：解析为普通 own property，不得污染或抛错
    const parsed = parsePortableBaseline(JSON.parse(JSON.stringify(baselineJson()).replace('"epoch-1"', '"__proto__"')));
    expect(parsed).toBeTruthy();
    // 离线哈希：结构缺失严格抛错（产品语义），非字符串条目静默丢弃
    expect(() => parsePortableContentHashes({ localOnly: true, notes: {}, quickNotes: "junk" })).toThrow(/quickNotes/);
    expect(() => parsePortableContentHashes({ localOnly: true, quickNotes: {} })).toThrow(/notes/);
    const hashes = parsePortableContentHashes({ localOnly: true, notes: { good: H("a"), bad: 123, worse: null }, quickNotes: { qgood: H("b"), qbad: false } });
    expect(hashes.lakeHashById.get("good")).toBe(H("a"));
    expect(hashes.lakeHashById.has("bad")).toBe(false);
    expect([...hashes.quickHashById.keys()]).toEqual(["qgood"]);
  });

  it("bootstrapRowsFromMobileRows：毒 tagLinks / 重复版本行不抛错", () => {
    const out = bootstrapRowsFromMobileRows({
      notes: [],
      folders: [],
      quickNotes: [],
      quickNoteDeleted: [],
      tags: [],
      tagLinks: [
        { tag_id: "t1", target_kind: "note", target_id: "n1" },
        { tag_id: "t1", target_kind: "note", target_id: "n1" },
        { tag_id: "", target_kind: "note", target_id: "n1" },
        { tag_id: "t2", target_kind: "bogus", target_id: "n1" },
      ] as unknown as MobileTagLinkRow[],
      tagLinkVersions: [
        { target_kind: "note", target_id: "n1", links_updated_at: TS },
        { target_kind: "note", target_id: "n1", links_updated_at: "not-a-date" },
      ] as unknown as MobileTagLinkVersionRow[],
    });
    expect(Array.isArray(out.notes)).toBe(true);
    expect(() => buildBootstrapBaseline(out)).not.toThrow();
  });
});
