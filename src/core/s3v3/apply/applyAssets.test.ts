import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../syncUtils.js";
import { assetKey, buildAssetDeclaration, declarationKey, type AssetDeclEntry } from "../protocol/index.js";
import type { SyncPlan } from "../plan/types.js";
import { applyAssets, type AssetPorts } from "./applyAssets.js";

const enc = (s: string) => new TextEncoder().encode(s);
const H = (s: string) => sha256Hex(enc(s));
const asset = (filename: string, body: string): AssetDeclEntry => ({ filename, size: body.length, hash: H(body) });

class FakeAssets implements AssetPorts {
  remote = new Map<string, Uint8Array>();
  decls = new Map<string, AssetDeclEntry[]>();
  bytes = new Map<string, Uint8Array>();
  puts: string[] = [];
  written: string[] = [];
  async getRemote(key: string) { return this.remote.get(key) ?? null; }
  async putRemote(key: string, bytes: Uint8Array) { this.remote.set(key, bytes); this.puts.push(key); }
  async listLocalAssets(space: string, id: string) { return this.decls.get(space + ":" + id) ?? []; }
  async readLocalAsset(space: string, id: string, filename: string) { return this.bytes.get(space + ":" + id + "/" + filename) ?? null; }
  async writeLocalAsset(space: string, id: string, filename: string, bytes: Uint8Array) {
    this.bytes.set(space + ":" + id + "/" + filename, bytes); this.written.push(filename);
  }
  setLocal(space: string, id: string, assets: Array<{ filename: string; body: string }>) {
    this.decls.set(space + ":" + id, assets.map((a) => asset(a.filename, a.body)));
    for (const a of assets) this.bytes.set(space + ":" + id + "/" + a.filename, enc(a.body));
  }
}

const plan = (over: Partial<SyncPlan> = {}): SyncPlan => ({
  version: 4, reads: [], writes: [], transfers: [], deletes: [], publishes: { lake: [], quickNotes: [] },
  publish: null, intentChanges: [], warnings: [], total: { ops: 0, bytes: 0 }, ...over,
});

describe("E2-1b 资产段：上传差集与声明", () => {
  it("只 PUT 云端声明里没有的资产；声明永远全量（filename 升序）", async () => {
    const ports = new FakeAssets();
    ports.setLocal("lake", "a", [{ filename: "a.png", body: "AAA" }, { filename: "z.png", body: "ZZZ" }]);
    const remoteDecl = buildAssetDeclaration([asset("z.png", "ZZZ")]);
    ports.remote.set(declarationKey("lake", "a", remoteDecl.declHash), enc(remoteDecl.serialized));
    const r = await applyAssets(
      plan({ publishes: { lake: ["a"], quickNotes: [] } }),
      { declarations: [{ space: "lake", id: "a", declHash: remoteDecl.declHash, assets: remoteDecl.declaration.assets }] },
      ports,
    );
    expect(r.uploaded.files).toBe(1);
    expect(ports.puts.filter((k) => k.startsWith("assets/"))).toEqual([assetKey("a", "a.png")]);
    const expected = buildAssetDeclaration([asset("a.png", "AAA"), asset("z.png", "ZZZ")]);
    expect(ports.puts).toContain(declarationKey("lake", "a", expected.declHash));
    expect(r.assetsHashes).toEqual([{ space: "lake", id: "a", assetsHash: expected.declHash }]);
  });

  it("本机资产为空但云端声明非空 ⇒ 不写空声明（保留远端 hash）并按声明自愈下载", async () => {
    const ports = new FakeAssets();
    const remoteDecl = buildAssetDeclaration([asset("p.png", "PPP")]);
    ports.remote.set(assetKey("a", "p.png"), enc("PPP"));
    const r = await applyAssets(
      plan({ publishes: { lake: ["a"], quickNotes: [] } }),
      { declarations: [{ space: "lake", id: "a", declHash: remoteDecl.declHash, assets: remoteDecl.declaration.assets }] },
      ports,
    );
    expect(ports.puts).toEqual([]);            // 没有空声明、没有资产上传
    // 保留远端 assetsHash（否则新索引丢声明）；同时按声明自愈下载。
    expect(r.assetsHashes).toEqual([{ space: "lake", id: "a", assetsHash: remoteDecl.declHash }]);
    expect(r.downloaded.files).toBe(1);       // 自愈
    expect(r.warnings.map((w) => w.code)).toEqual(["asset_missing"]);
  });

  it("本机无资产且云端也无声明 ⇒ 不写空声明，清掉 assetsHash（与 v3 uploadAssets 一致）", async () => {
    const ports = new FakeAssets();
    const r = await applyAssets(plan({ publishes: { lake: ["a"], quickNotes: [] } }), { declarations: [] }, ports);
    expect(ports.puts).toEqual([]); // 空声明是垃圾对象，v3 也不写
    expect(r.assetsHashes).toEqual([{ space: "lake", id: "a", assetsHash: undefined }]);
    expect(r.warnings).toEqual([]);
  });

  it("本机无资产但云端有声明（哪怕是空声明）⇒ 保留远端 hash，不自作主张清空", async () => {
    const ports = new FakeAssets();
    const emptyDecl = buildAssetDeclaration([]);
    const r = await applyAssets(
      plan({ publishes: { lake: ["a"], quickNotes: [] } }),
      { declarations: [{ space: "lake", id: "a", declHash: emptyDecl.declHash, assets: [] }] },
      ports,
    );
    expect(r.assetsHashes).toEqual([{ space: "lake", id: "a", assetsHash: emptyDecl.declHash }]);
    expect(ports.puts).toEqual([]);
  });

  it("metadata-only 轮次（无 body transfer）仍要走声明：这正是 publishes 存在的理由", async () => {
    const ports = new FakeAssets();
    ports.setLocal("lake", "a", [{ filename: "p.png", body: "PPP" }]);
    const r = await applyAssets(plan({ publishes: { lake: ["a"], quickNotes: [] } }), { declarations: [] }, ports);
    expect(r.uploaded.files).toBe(1);
    expect(r.assetsHashes).toHaveLength(1);
  });

  it("本地资产字节 hash 与清单不符 ⇒ 不上传（内容地址不得错配）", async () => {
    const ports = new FakeAssets();
    ports.setLocal("lake", "a", [{ filename: "p.png", body: "PPP" }]);
    ports.bytes.set("lake:a/p.png", enc("tampered"));
    const r = await applyAssets(plan({ publishes: { lake: ["a"], quickNotes: [] } }), { declarations: [] }, ports);
    expect(r.uploaded.files).toBe(0);
    expect(r.warnings.map((w) => w.code)).toEqual(["hash_mismatch"]);
  });
});

describe("E2-1b 资产段：下载差集", () => {
  it("按声明差集下载缺失资产；已存在且一致的跳过", async () => {
    const ports = new FakeAssets();
    ports.remote.set(assetKey("a", "p.png"), enc("PPP"));
    ports.remote.set(assetKey("a", "q.png"), enc("QQQ"));
    ports.setLocal("lake", "a", [{ filename: "q.png", body: "QQQ" }]);
    const decl = buildAssetDeclaration([asset("p.png", "PPP"), asset("q.png", "QQQ")]);
    const r = await applyAssets(
      plan({ writes: [{ kind: "apply-remote", space: "lake", id: "a", meta: { id: "a", assetsHash: decl.declHash }, bodyHash: H("x") }] }),
      { declarations: [{ space: "lake", id: "a", declHash: decl.declHash, assets: decl.declaration.assets }] },
      ports,
    );
    expect(ports.written).toEqual(["p.png"]);
    expect(r.downloaded.files).toBe(1);
  });

  it("deferDownloads=true：只上传声明，不下载媒体（首拉 lazy 档）", async () => {
    const ports = new FakeAssets();
    ports.remote.set(assetKey("a", "p.png"), enc("PPP"));
    const decl = buildAssetDeclaration([asset("p.png", "PPP")]);
    const r = await applyAssets(
      plan({ writes: [{ kind: "apply-remote", space: "lake", id: "a", meta: { id: "a", assetsHash: decl.declHash }, bodyHash: H("x") }] }),
      { declarations: [{ space: "lake", id: "a", declHash: decl.declHash, assets: decl.declaration.assets }] },
      ports,
      { deferDownloads: true },
    );
    expect(ports.written).toEqual([]);
    expect(r.downloaded.files).toBe(0);
  });

  it("下载字节 sha256 不符 ⇒ 不落盘", async () => {
    const ports = new FakeAssets();
    ports.remote.set(assetKey("a", "p.png"), enc("corrupt"));
    const decl = buildAssetDeclaration([asset("p.png", "PPP")]);
    const r = await applyAssets(
      plan({ writes: [{ kind: "apply-remote", space: "lake", id: "a", meta: { id: "a", assetsHash: decl.declHash }, bodyHash: H("x") }] }),
      { declarations: [{ space: "lake", id: "a", declHash: decl.declHash, assets: decl.declaration.assets }] },
      ports,
    );
    expect(ports.written).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(["hash_mismatch"]);
  });

  it("幂等：同一 plan 应用两次，第二次不再上传已一致的资产", async () => {
    const ports = new FakeAssets();
    ports.setLocal("lake", "a", [{ filename: "p.png", body: "PPP" }]);
    const p = plan({ publishes: { lake: ["a"], quickNotes: [] } });
    const first = await applyAssets(p, { declarations: [] }, ports);
    expect(first.uploaded.files).toBe(1);
    const afterFirst = ports.puts.length;
    // 第二轮：远端声明已经是上一轮写出的那份 ⇒ 差集为空（幂等的真实前提）。
    const decl = buildAssetDeclaration([asset("p.png", "PPP")]);
    const second = await applyAssets(p, { declarations: [{ space: "lake", id: "a", declHash: decl.declHash, assets: decl.declaration.assets }] }, ports);
    expect(second.uploaded.files).toBe(0);
    expect(ports.puts.filter((k) => k.startsWith("assets/"))).toHaveLength(1);
    expect(ports.puts.length).toBe(afterFirst + 1); // 只重写了一次同 key 声明
    expect(second.assetsHashes[0].assetsHash).toBe(decl.declHash);
  });
});
