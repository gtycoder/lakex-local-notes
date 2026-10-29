import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../syncUtils.js";
import { buildAssetDeclaration, declarationKey, lakeBodyKey, quickNoteBodyKey, serializeDeclaration } from "../protocol/index.js";
import type { SyncPlan } from "../plan/types.js";
import { applyPlan, type ApplyPorts } from "./applyPlan.js";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const H = (s: string) => sha256Hex(enc(s));

class FakePorts implements ApplyPorts {
  remote = new Map<string, Uint8Array>();
  local = new Map<string, Uint8Array>();
  puts: string[] = [];
  written: string[] = [];
  archived: Array<{ space: string; id: string; reason: string }> = [];
  deletedLocal: string[] = [];
  deletedPrefixes: string[] = [];
  deletedKeys: string[] = [];
  failPutFor = new Set<string>();
  async getRemote(key: string) { return this.remote.get(key) ?? null; }
  async putRemote(key: string, bytes: Uint8Array) {
    if (this.failPutFor.has(key)) throw new Error("put-failed " + key);
    this.remote.set(key, bytes); this.puts.push(key);
  }
  async deleteRemoteKeys(keys: string[]) { this.deletedKeys.push(...keys); keys.forEach((k) => this.remote.delete(k)); }
  async deleteRemotePrefix(prefix: string) {
    this.deletedPrefixes.push(prefix);
    const keys = [...this.remote.keys()].filter((k) => k.startsWith(prefix));
    keys.forEach((k) => this.remote.delete(k));
    return keys.length;
  }
  async readLocalBody(space: string, id: string) { return this.local.get(space + ":" + id) ?? null; }
  async writeLocalBody(space: string, id: string, bytes: Uint8Array) { this.local.set(space + ":" + id, bytes); this.written.push(space + ":" + id); }
  async archiveLocal(space: string, id: string, reason: string) { this.archived.push({ space, id, reason }); }
  async deleteLocalBody(space: string, id: string) { this.deletedLocal.push(space + ":" + id); this.local.delete(space + ":" + id); }
}

const plan = (over: Partial<SyncPlan> = {}): SyncPlan => ({
  version: 4, reads: [], writes: [], transfers: [], deletes: [], publishes: { lake: [], quickNotes: [] },
  publish: null, intentChanges: [], warnings: [], total: { ops: 0, bytes: 0 }, ...over,
});

describe("E2-1 Applier：正文上传", () => {
  it("本地正文 → 按计划 key PUT，计数与字节正确", async () => {
    const ports = new FakePorts();
    ports.local.set("lake:a", enc("v2"));
    const r = await applyPlan(plan({
      transfers: [{ op: "put", space: "lake", id: "a", key: lakeBodyKey("a", H("v2")), hash: H("v2"), size: 0, kind: "body" }],
    }), ports);
    expect(ports.puts).toEqual([lakeBodyKey("a", H("v2"))]);
    expect(r.uploaded).toEqual({ documents: 1, quickNotes: 0, bytes: 2 });
    expect(dec(ports.remote.get(lakeBodyKey("a", H("v2")))!)).toBe("v2");
    expect(r.warnings).toEqual([]);
  });

  it("本地缺正文 ⇒ 不上传（绝不把空正文当删除），标记 failedUploads 供 Commit 回退", async () => {
    const ports = new FakePorts();
    const r = await applyPlan(plan({
      transfers: [{ op: "put", space: "lake", id: "a", key: lakeBodyKey("a", H("v2")), hash: H("v2"), size: 0, kind: "body" }],
    }), ports);
    expect(ports.puts).toEqual([]);
    expect(r.failedUploads).toEqual([{ space: "lake", id: "a" }]);
    expect(r.warnings.map((w) => w.code)).toEqual(["local_body_missing"]);
  });

  it("本地字节与计划 hash 不符 ⇒ 不上传（内容地址不得错配）", async () => {
    const ports = new FakePorts();
    ports.local.set("lake:a", enc("tampered"));
    const r = await applyPlan(plan({
      transfers: [{ op: "put", space: "lake", id: "a", key: lakeBodyKey("a", H("v2")), hash: H("v2"), size: 0, kind: "body" }],
    }), ports);
    expect(ports.puts).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(["hash_mismatch"]);
    expect(r.failedUploads).toEqual([{ space: "lake", id: "a" }]);
  });

  it("单对象 PUT 失败不影响其它对象（all-or-isolate）", async () => {
    const ports = new FakePorts();
    ports.local.set("lake:a", enc("va"));
    ports.local.set("lake:b", enc("vb"));
    ports.failPutFor.add(lakeBodyKey("b", H("vb")));
    const r = await applyPlan(plan({
      transfers: [
        { op: "put", space: "lake", id: "a", key: lakeBodyKey("a", H("va")), hash: H("va"), size: 0, kind: "body" },
        { op: "put", space: "lake", id: "b", key: lakeBodyKey("b", H("vb")), hash: H("vb"), size: 0, kind: "body" },
      ],
    }), ports);
    expect(ports.puts).toEqual([lakeBodyKey("a", H("va"))]);
    expect(r.errors.map((e) => e.op)).toEqual(["upload"]);
    expect(r.failedUploads).toEqual([{ space: "lake", id: "b" }]);
  });

  it("小记走 quickNoteBodyKey", async () => {
    const ports = new FakePorts();
    ports.local.set("quickNotes:q", enc("note"));
    await applyPlan(plan({
      transfers: [{ op: "put", space: "quickNotes", id: "q", key: quickNoteBodyKey(H("note")), hash: H("note"), size: 0, kind: "body" }],
    }), ports);
    expect(ports.puts).toEqual([quickNoteBodyKey(H("note"))]);
  });
});

describe("E2-1 Applier：正文下载", () => {
  it("远端正文 → 校验 sha256 后落盘", async () => {
    const ports = new FakePorts();
    ports.remote.set(lakeBodyKey("a", H("v2")), enc("v2"));
    const r = await applyPlan(plan({ reads: [{ kind: "body", space: "lake", id: "a", hash: H("v2") }] }), ports);
    expect(ports.written).toEqual(["lake:a"]);
    expect(dec(ports.local.get("lake:a")!)).toBe("v2");
    expect(r.downloaded).toEqual({ documents: 1, quickNotes: 0, bytes: 2 });
  });

  it("云端正文缺失 ⇒ 不写盘 + remote_incomplete（本地旧正文保持不动）", async () => {
    const ports = new FakePorts();
    ports.local.set("lake:a", enc("old"));
    const r = await applyPlan(plan({ reads: [{ kind: "body", space: "lake", id: "a", hash: H("v2") }] }), ports);
    expect(ports.written).toEqual([]);
    expect(dec(ports.local.get("lake:a")!)).toBe("old");
    expect(r.entries[0].status).toBe("skipped-remote-missing");
    expect(r.warnings.map((w) => w.code)).toEqual(["remote_incomplete"]);
  });

  it("下载字节 hash 不符 ⇒ 不落盘（不把坏字节写进本地真相）", async () => {
    const ports = new FakePorts();
    ports.remote.set(lakeBodyKey("a", H("v2")), enc("corrupt"));
    const r = await applyPlan(plan({ reads: [{ kind: "body", space: "lake", id: "a", hash: H("v2") }] }), ports);
    expect(ports.written).toEqual([]);
    expect(r.entries[0].status).toBe("skipped-hash-mismatch");
    expect(r.warnings.map((w) => w.code)).toEqual(["hash_mismatch"]);
  });

  it("verifyDownloadHashes=false 只用于排障：跳过校验仍落盘", async () => {
    const ports = new FakePorts();
    ports.remote.set(lakeBodyKey("a", H("v2")), enc("corrupt"));
    await applyPlan(plan({ reads: [{ kind: "body", space: "lake", id: "a", hash: H("v2") }] }), ports, { verifyDownloadHashes: false });
    expect(ports.written).toEqual(["lake:a"]);
  });
});

describe("E2-1 Applier：归档 / 声明 / 删除", () => {
  it("归档先执行，reason 原样透传", async () => {
    const ports = new FakePorts();
    const r = await applyPlan(plan({
      writes: [
        { kind: "archive-local", space: "lake", id: "a", reason: "remote-wins" },
        { kind: "archive-local", space: "quickNotes", id: "q", reason: "cloud-absent" },
        { kind: "set-lifecycle", space: "lake", id: "z", lifecycle: "cloud-deleted" },
      ],
    }), ports);
    expect(ports.archived).toEqual([
      { space: "lake", id: "a", reason: "remote-wins" },
      { space: "quickNotes", id: "q", reason: "cloud-absent" },
    ]);
    expect(r.errors).toEqual([]);
  });

  it("声明读取：合法进 declarations，hash 不符只报警不落库", async () => {
    const ports = new FakePorts();
    const built = buildAssetDeclaration([{ filename: "p.png", size: 3, hash: H("abc") }]);
    ports.remote.set(declarationKey("lake", "a", built.declHash), enc(built.serialized));
    const ok = await applyPlan(plan({ reads: [{ kind: "declaration", space: "lake", id: "a", declHash: built.declHash }] }), ports);
    expect(ok.declarations).toEqual([{ space: "lake", id: "a", declHash: built.declHash, assets: [{ filename: "p.png", size: 3, hash: H("abc") }] }]);

    const bad = await applyPlan(plan({ reads: [{ kind: "declaration", space: "lake", id: "a", declHash: H("nope") }] }), ports);
    expect(bad.declarations).toEqual([]);
    expect(bad.warnings.map((w) => w.code)).toEqual(["remote_incomplete"]);

    const other = buildAssetDeclaration([{ filename: "q.png", size: 3, hash: H("abd") }]);
    ports.remote.set(declarationKey("lake", "b", built.declHash), enc(serializeDeclaration(other.declaration)));
    const mismatch = await applyPlan(plan({ reads: [{ kind: "declaration", space: "lake", id: "b", declHash: built.declHash }] }), ports);
    expect(mismatch.warnings.map((w) => w.code)).toEqual(["hash_mismatch"]);
  });

  it("user-purge：按前缀/键删远端对象，并删本地正文", async () => {
    const ports = new FakePorts();
    ports.remote.set(lakeBodyKey("a", H("v1")), enc("v1"));
    ports.remote.set("assets/a/p.png", enc("x"));
    ports.remote.set("meta/assets/a/" + H("d") + ".json", enc("{}"));
    ports.local.set("lake:a", enc("v1"));
    const r = await applyPlan(plan({
      deletes: [{ space: "lake", id: "a", reason: "user-purge", prefixes: ["objects/a-", "assets/a/", "meta/assets/a/"], keys: [lakeBodyKey("a", H("v1"))] }],
    }), ports);
    // 3 个前缀各删 1 个对象（正文已被前缀删掉，但仍按 v3 口径计入 keys 数）⇒ 4。
    expect(r.deletedObjects).toBe(4);
    expect(ports.remote.size).toBe(0);
    expect(ports.deletedLocal).toEqual(["lake:a"]);
  });

  it("幂等：同一 plan 应用两次，副作用集合一致且无错误", async () => {
    const ports = new FakePorts();
    ports.local.set("lake:a", enc("v2"));
    ports.remote.set(lakeBodyKey("a", H("v1")), enc("v1"));
    const p = plan({
      transfers: [{ op: "put", space: "lake", id: "a", key: lakeBodyKey("a", H("v2")), hash: H("v2"), size: 0, kind: "body" }],
      writes: [{ kind: "apply-remote", space: "lake", id: "a", meta: { id: "a" }, bodyHash: H("v1") }],
    });
    const first = await applyPlan(p, ports);
    const putsAfterFirst = [...ports.puts];
    const second = await applyPlan(p, ports);
    expect(second.errors).toEqual([]);
    expect(first.errors).toEqual([]);
    expect(ports.puts).toEqual([...putsAfterFirst, ...putsAfterFirst]);
    expect(second.uploaded).toEqual(first.uploaded);
  });
});
