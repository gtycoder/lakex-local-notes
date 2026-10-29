import { describe, expect, it } from "vitest";
import type { CurrentWorld, PendingDelete } from "../../s3v3Gate.js";
import { executePendingDeletes, type PendingDeletePorts } from "./executePending.js";

const ISO = "2026-10-28T00:00:00.000Z";
const pendingBase = { key: "", targetEpoch: "e", targetGeneration: 2, targetCommit: "c", createdAt: ISO };

const bodyItem = (key: string, noteId: string, oldHash: string): PendingDelete => ({ ...pendingBase, key, kind: "body", noteId, oldHash });
const purgeItem = (key: string, noteId: string): PendingDelete => ({ ...pendingBase, key, kind: "purge-prefix", noteId });
const declItem = (key: string, noteId: string, oldDeclHash: string): PendingDelete => ({ ...pendingBase, key, kind: "declaration", noteId, oldDeclHash });

const world = (over: Partial<CurrentWorld> = {}): CurrentWorld => ({
  lakeCommit: "L2", quickNotesCommit: "Q2", notes: [], quickNotes: [], declarations: {}, quickDeclarations: {}, ...over,
});

class FakeDeletes implements PendingDeletePorts {
  keys: string[] = [];
  prefixes: string[] = [];
  fail = false;
  async deleteRemoteKeys(keys: string[]) { if (this.fail) throw new Error("boom"); this.keys.push(...keys); }
  async deleteRemotePrefix(prefix: string) { if (this.fail) throw new Error("boom"); this.prefixes.push(prefix); return 3; }
}

describe("E2 pending：待删队列执行（门禁单一来源）", () => {
  it("空队列 ⇒ 零操作", async () => {
    const ports = new FakeDeletes();
    const r = await executePendingDeletes([], world(), ports);
    expect(r).toEqual({ deletedObjects: 0, executed: [], wouldExecute: [], remaining: [], warnings: [] });
  });

  it("正文已被替换 ⇒ 删旧对象（键）", async () => {
    const ports = new FakeDeletes();
    const w = world({ notes: [{ id: "a", contentHash: "h2" }] });
    const old = bodyItem("objects/a-h1.lake", "a", "h1");
    const r = await executePendingDeletes([old], w, ports);
    expect(ports.keys).toEqual(["objects/a-h1.lake"]);
    expect(r.deletedObjects).toBe(1);
    expect(r.remaining).toEqual([]);
  });

  it("门禁不放行（仍被引用）⇒ 跳过并出队，不删", async () => {
    const ports = new FakeDeletes();
    const w = world({ notes: [{ id: "a", contentHash: "h1" }] });
    const r = await executePendingDeletes([bodyItem("objects/a-h1.lake", "a", "h1")], w, ports);
    expect(ports.keys).toEqual([]);
    expect(r.executed).toEqual([]);
    expect(r.remaining).toEqual([]); // 出队，不再反复尝试
  });

  it("purge 前缀走 deleteByPrefix 且计数取真实删除数", async () => {
    const ports = new FakeDeletes();
    const w = world(); // 条目已从索引移除
    const r = await executePendingDeletes([purgeItem("assets/a/", "a"), purgeItem("meta/assets/a/", "a")], w, ports);
    expect(ports.prefixes).toEqual(["assets/a/", "meta/assets/a/"]);
    expect(r.deletedObjects).toBe(6);
  });

  it("声明仍被当前索引引用 ⇒ 保守跳过（不会误删在用声明）", async () => {
    const ports = new FakeDeletes();
    const w = world({ notes: [{ id: "a", contentHash: "h1", assetsHash: "d1" }] });
    const r = await executePendingDeletes([declItem("meta/assets/a/d1.json", "a", "d1")], w, ports);
    expect(ports.keys).toEqual([]);
    expect(r.remaining).toEqual([]);
  });

  it("dryRun：只预演不执行、不消费队列", async () => {
    const ports = new FakeDeletes();
    const w = world({ notes: [{ id: "a", contentHash: "h2" }] });
    const r = await executePendingDeletes([bodyItem("objects/a-h1.lake", "a", "h1")], w, ports, { dryRun: true });
    expect(ports.keys).toEqual([]);
    expect(r.wouldExecute).toEqual(["objects/a-h1.lake"]);
    expect(r.remaining).toHaveLength(1);
    expect(r.deletedObjects).toBe(0);
  });

  it("执行失败 ⇒ 不消费队列，保留可执行项等下轮（只降级为 warning）", async () => {
    const ports = new FakeDeletes();
    ports.fail = true;
    const w = world({ notes: [{ id: "a", contentHash: "h2" }] });
    const r = await executePendingDeletes([bodyItem("objects/a-h1.lake", "a", "h1")], w, ports);
    expect(r.remaining.map((p) => p.key)).toEqual(["objects/a-h1.lake"]);
    expect(r.warnings.map((w) => w.code)).toEqual(["cleanup_failed"]);
    expect(r.deletedObjects).toBe(0);
  });
});
