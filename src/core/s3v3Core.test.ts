import { describe, expect, it } from "vitest";
import { assetKey, declarationKey, indexKey, lakeBodyKey, lakePurgePrefixes, quickNoteBodyKey, quickNotePurgePrefixes } from "./s3v3Keys.js";
import {
  buildAssetDeclaration,
  canonicalJson,
  declarationHashOf,
  indexHashOf,
  serializeLakeIndex,
  serializeQuickNotesIndex,
  validateAssetDeclaration,
  validateLakeIndex,
  type LakeIndex,
  type LakeNoteEntry,
  type QuickNotesIndex,
} from "./s3v3Index.js";
import { planLakeMerge, planQuickNotesMerge } from "./s3v3Merge.js";
import { planLakeDeletes, planQuickNotesDeletes } from "./s3v3Gc.js";

const H = (c: string) => c.repeat(64);
const note = (id: string, hash: string, updatedAt = "2026-10-25T00:00:00.000Z"): LakeNoteEntry => ({
  id, title: "T" + id, parentId: null, sortOrder: 0, updatedAt, contentHash: hash,
});
const lake = (notes: LakeNoteEntry[], folders: LakeIndex["folders"] = []): LakeIndex => ({ v: 3, space: "lake", notes, folders });
const qn = (items: QuickNotesIndex["items"]): QuickNotesIndex => ({ v: 3, space: "quickNotes", items });

describe("s3v3Keys", () => {
  it("布局稳定", () => {
    expect(indexKey("lake", H("a"))).toBe("meta/index/" + H("a") + ".json");
    expect(indexKey("quickNotes", H("a"))).toBe("quick-notes/meta/index/" + H("a") + ".json");
    expect(declarationKey("lake", "n1", H("b"))).toBe("meta/assets/n1/" + H("b") + ".json");
    expect(quickNoteBodyKey(H("c"))).toBe("quick-notes/objects/" + H("c") + ".qnote");
    expect(assetKey("n1", "a.png")).toBe("assets/n1/a.png");
    expect(lakeBodyKey("n1", H("a"))).toBe("objects/n1-" + H("a") + ".lake");
    expect(lakePurgePrefixes("n1")).toEqual(["objects/n1-", "assets/n1/", "meta/assets/n1/"]);
    expect(quickNotePurgePrefixes("q1")).toEqual(["quick-notes/assets/q1/", "quick-notes/meta/assets/q1/"]);
  });
  it("非法段被拒", () => {
    expect(() => assetKey("../x", "a.png")).toThrow();
    expect(() => declarationKey("lake", "a/b", H("a"))).toThrow();
  });
});

describe("s3v3Index", () => {
  it("canonical JSON 与排序无关", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    const a = lake([note("n2", H("b")), note("n1", H("a"))]);
    const b = lake([note("n1", H("a")), note("n2", H("b"))]);
    expect(serializeLakeIndex(a)).toBe(serializeLakeIndex(b));
    expect(indexHashOf(serializeLakeIndex(a))).toBe(indexHashOf(serializeLakeIndex(b)));
  });
  it("索引校验：重复 id / 非法 hash 被拒", () => {
    expect(() => validateLakeIndex(lake([note("n1", H("a")), note("n1", H("b"))]))).toThrow();
    expect(() => validateLakeIndex(lake([note("n1", "short")]))).toThrow();
    expect(validateLakeIndex(lake([note("n1", H("a"))])).notes).toHaveLength(1);
  });
  it("声明 hash 与排序无关、校验严格", () => {
    const d1 = buildAssetDeclaration([{ filename: "b.png", size: 2, hash: H("b") }, { filename: "a.png", size: 1, hash: H("a") }]);
    const d2 = buildAssetDeclaration([{ filename: "a.png", size: 1, hash: H("a") }, { filename: "b.png", size: 2, hash: H("b") }]);
    expect(d1.declHash).toBe(d2.declHash);
    expect(declarationHashOf(d1.declaration)).toBe(d1.declHash);
    expect(() => validateAssetDeclaration({ assets: [{ filename: "../x", size: 1, hash: H("a") }] })).toThrow();
    expect(() => validateAssetDeclaration({ assets: [{ filename: "a.png", size: -1, hash: H("a") }] })).toThrow();
  });
  it("小记索引可序列化", () => {
    const idx = qn([{ id: "q1", createdAt: "c", updatedAt: "u", contentHash: H("a") }]);
    expect(serializeQuickNotesIndex(idx)).toContain('"quickNotes"');
  });
});

const emptyCtx = { restorePending: new Set<string>(), purgeIntents: new Set<string>(), folderPurgeIntents: new Set<string>() };

describe("planLakeMerge", () => {
  it("本地新建 → upload；远端新建 → download", () => {
    const p = planLakeMerge(null, lake([note("n1", H("a"))]), lake([note("n2", H("b"))]), emptyCtx);
    expect(p.notes.find((x) => x.id === "n1")?.kind).toBe("upload");
    expect(p.notes.find((x) => x.id === "n2")?.kind).toBe("download");
  });
  it("本地改 → upload；远端改 → download；两边改 → remote-wins-history", () => {
    const baseIdx = lake([note("n1", H("a")), note("n2", H("a")), note("n3", H("a"))]);
    const local = lake([note("n1", H("b")), note("n2", H("a")), note("n3", H("b"))]);
    const remote = lake([note("n1", H("a")), note("n2", H("b")), note("n3", H("c"))]);
    const p = planLakeMerge(baseIdx, local, remote, emptyCtx);
    expect(p.notes.find((x) => x.id === "n1")?.kind).toBe("upload");
    expect(p.notes.find((x) => x.id === "n2")?.kind).toBe("download");
    expect(p.notes.find((x) => x.id === "n3")?.kind).toBe("remote-wins-history");
    expect(p.notes.find((x) => x.id === "n3")?.archiveLocal).toBe(true);
  });
  it("远端彻底删除 → 本地进回收站；本地删除意图 → 远端删除", () => {
    const baseIdx = lake([note("n1", H("a")), note("n2", H("a"))]);
    const local = lake([note("n1", H("a"))]);
    const remote = lake([note("n2", H("a"))]);
    const p = planLakeMerge(baseIdx, local, remote, { ...emptyCtx, purgeIntents: new Set(["n2"]) });
    expect(p.notes.find((x) => x.id === "n1")?.kind).toBe("remote-purged-trash");
    expect(p.notes.find((x) => x.id === "n2")?.kind).toBe("local-purge");
  });
  it("restore_pending 优先：本地有内容 → upload", () => {
    const baseIdx = lake([note("n1", H("a"))]);
    const local = lake([note("n1", H("b"))]);
    const remote = lake([]);
    const p = planLakeMerge(baseIdx, local, remote, { ...emptyCtx, restorePending: new Set(["n1"]) });
    expect(p.notes.find((x) => x.id === "n1")?.kind).toBe("upload");
  });
  it("内容一致但远端元数据更新 → none + applyRemote", () => {
    const baseIdx = lake([note("n1", H("a"), "2026-10-25T00:00:00.000Z")]);
    const local = lake([note("n1", H("a"), "2026-10-25T00:00:00.000Z")]);
    const remote = lake([{ ...note("n1", H("a"), "2026-10-26T00:00:00.000Z"), title: "new" }]);
    const p = planLakeMerge(baseIdx, local, remote, emptyCtx);
    const n = p.notes.find((x) => x.id === "n1")!;
    expect(n.kind).toBe("none");
    expect(n.applyRemote).toBe(true);
  });
  it("目录：本地新建/远端新建/远端删除/本地删除意图", () => {
    const f = (id: string, updatedAt = "2026-10-25T00:00:00.000Z"): LakeIndex["folders"][number] => ({ id, title: id, parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt });
    const baseIdx = lake([], [f("f1"), f("f2"), f("f3")]);
    const local = lake([], [f("f1", "2026-10-26T00:00:00.000Z"), f("f2")]);
    const remote = lake([], [f("f1"), f("f3"), f("f4")]);
    const after = planLakeMerge(baseIdx, local, remote, { ...emptyCtx, folderPurgeIntents: new Set(["f3"]) });
    const kinds = new Map(after.folders.map((x) => [x.id, x.kind]));
    expect(kinds.get("f1")).toBe("upload");
    expect(kinds.get("f2")).toBe("remote-purged-trash");
    expect(kinds.get("f3")).toBe("local-purge");
    expect(kinds.get("f4")).toBe("download");
  });
});

describe("planQuickNotesMerge", () => {
  const q = (id: string, hash: string, updatedAt = "u1"): QuickNotesIndex["items"][number] => ({ id, createdAt: "c", updatedAt, contentHash: hash });
  it("本地新建上传 / 远端新建下载 / 远端删除本地删", () => {
    const baseIdx = qn([q("q1", H("a")), q("q2", H("a"))]);
    const local = qn([q("q1", H("a")), q("q3", H("b"))]);
    const remote = qn([q("q2", H("a")), q("q4", H("c"))]);
    const p = planQuickNotesMerge(baseIdx, local, remote, new Set());
    const k = new Map(p.items.map((x) => [x.id, x.kind]));
    expect(k.get("q1")).toBe("local-delete");
    expect(k.get("q2")).toBe("download");
    expect(k.get("q3")).toBe("upload");
    expect(k.get("q4")).toBe("download");
  });
  it("两边都改 → remote-wins-history", () => {
    const baseIdx = qn([q("q1", H("a"))]);
    const local = qn([q("q1", H("b"), "u2")]);
    const remote = qn([q("q1", H("c"), "u3")]);
    const p = planQuickNotesMerge(baseIdx, local, remote, new Set());
    expect(p.items[0].kind).toBe("remote-wins-history");
    expect(p.items[0].archiveLocal).toBe(true);
  });
});

describe("planLakeDeletes / planQuickNotesDeletes", () => {
  it("替换正文/移除附件/旧声明/旧索引", () => {
    const prev = lake([{ ...note("n1", H("a")), assetsHash: H("d1") }]);
    const next = lake([{ ...note("n1", H("a")), assetsHash: H("d2") }]);
    const prevDecls = new Map([["n1", { declHash: H("d1"), filenames: ["a.png", "b.png"] }]]);
    const nextDecls = new Map([["n1", { declHash: H("d2"), filenames: ["a.png"] }]]);
    const del = planLakeDeletes({ previous: prev, next, previousDecls: prevDecls, nextDecls, previousCommit: H("old"), nextCommit: H("new") });
    expect(del.some((d) => d.kind === "body")).toBe(false); // hash 未变
    expect(del.some((d) => d.kind === "declaration" && d.oldDeclHash === H("d1"))).toBe(true);
    expect(del.some((d) => d.kind === "asset" && d.filename === "b.png")).toBe(true);
    expect(del.some((d) => d.kind === "index" && d.oldHash === H("old"))).toBe(true);
  });
  it("旧正文替换 → body 待删", () => {
    const prev = lake([note("n1", H("a"))]);
    const next = lake([note("n1", H("b"))]);
    const del = planLakeDeletes({ previous: prev, next, previousDecls: new Map(), nextDecls: new Map(), previousCommit: null, nextCommit: H("n") });
    expect(del.find((d) => d.kind === "body")?.oldHash).toBe(H("a"));
  });
  it("彻底删除 → purge 前缀", () => {
    const prev = lake([note("n1", H("a"))]);
    const next = lake([]);
    const del = planLakeDeletes({ previous: prev, next, previousDecls: new Map(), nextDecls: new Map(), previousCommit: null, nextCommit: H("n") });
    expect(del.filter((d) => d.kind === "purge-prefix")).toHaveLength(3);
  });
  it("小记删除 → 正文对象 + 前缀", () => {
    const prev = qn([{ id: "q1", createdAt: "c", updatedAt: "u", contentHash: H("a") }]);
    const next = qn([]);
    const del = planQuickNotesDeletes({ previous: prev, next, previousDecls: new Map(), nextDecls: new Map(), previousCommit: null, nextCommit: H("n") });
    expect(del.some((d) => d.kind === "quick-note-body" && d.oldHash === H("a"))).toBe(true);
    expect(del.filter((d) => d.kind === "quick-note-purge-prefix")).toHaveLength(2);
  });
});
