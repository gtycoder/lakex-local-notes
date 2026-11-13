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

/** 移动端原生统计清单路径（listLocalAssetStats 优先于 names/read）。 */
class StatsAssets extends FakeAssets {
  stats = new Map<string, AssetDeclEntry[]>();
  async listLocalAssetStats(space: string, id: string) { return this.stats.get(space + ":" + id) ?? []; }
}

/** 桌面快路径（只列文件名，不读字节）。 */
class NamesAssets extends FakeAssets {
  names = new Map<string, string[]>();
  async listLocalAssetNames(space: string, id: string) { return this.names.get(space + ":" + id) ?? []; }
}

const plan = (over: Partial<SyncPlan> = {}): SyncPlan => ({
  version: 4, reads: [], writes: [], transfers: [], deletes: [], publishes: { lake: [], quickNotes: [] },
  publish: null, intentChanges: [], warnings: [], total: { ops: 0, bytes: 0 }, ...over,
});

describe("E2-1b 资产段：上传差集与声明", () => {
  it("文件在清单里但字节读不出 ⇒ 整条回退 + 告警（不能静默丢弃该附件）", async () => {
    class Unreadable extends NamesAssets {
      unreadable = new Set<string>();
      override async readLocalAsset(space: string, id: string, filename: string) {
        if (this.unreadable.has(filename)) return null;
        return super.readLocalAsset(space, id, filename);
      }
    }
    const ports = new Unreadable();
    ports.setLocal("lake", "a", [{ filename: "old.png", body: "OLD" }]);
    // 远端声明已有 old.png（走 known 快路径），新增 img2.png 但读不出字节
    const remoteDecl = buildAssetDeclaration([asset("old.png", "OLD")]);
    ports.decls.set("lake:a", [asset("old.png", "OLD"), asset("img2.png", "IMG2")]);
    ports.names.set("lake:a", ["old.png", "img2.png"]);
    ports.unreadable.add("img2.png");
    ports.remote.set(declarationKey("lake", "a", remoteDecl.declHash), enc(remoteDecl.serialized));
    const r = await applyAssets(
      plan({ publishes: { lake: ["a"], quickNotes: [] } }),
      { declarations: [{ space: "lake", id: "a", declHash: remoteDecl.declHash, assets: remoteDecl.declaration.assets }] },
      ports,
    );
    expect(r.failedUploads).toEqual([{ space: "lake", id: "a" }]);
    expect(r.assetsHashes).toHaveLength(0); // 不把新声明写进索引（索引条目回退远端旧版本）
    expect(ports.puts.some((k) => k.startsWith("meta/assets/"))).toBe(false);
    expect(r.warnings.some((w) => w.code === "asset_missing" && w.filename === "img2.png")).toBe(true);
  });

  it("附件 PUT 失败 ⇒ 不写新声明 + 条目回退（failedUploads），绝不让声明引用缺失对象", async () => {
    class FailingPut extends FakeAssets {
      failKeys = new Set<string>();
      override async putRemote(key: string, bytes: Uint8Array) {
        if (this.failKeys.has(key)) throw new Error("模拟 PUT 失败");
        return super.putRemote(key, bytes);
      }
    }
    const ports = new FailingPut();
    ports.setLocal("lake", "a", [{ filename: "a.png", body: "AAA" }, { filename: "b.png", body: "BBB" }]);
    ports.failKeys.add(assetKey("a", "a.png"));
    const r = await applyAssets(
      plan({ publishes: { lake: ["a"], quickNotes: [] } }),
      { declarations: [] },
      ports,
    );
    // 整条回退：旧声明（这里本来没有）保持不变、不写新声明、索引条目交给 buildPublishIndex 回退
    expect(r.failedUploads).toEqual([{ space: "lake", id: "a" }]);
    expect(r.assetsHashes).toHaveLength(0);
    expect(ports.puts.some((k) => k.startsWith("meta/assets/"))).toBe(false);
    // 仍要有可诊断的结构化 warning（不是静默失败）
    expect(r.warnings.some((w) => w.code === "asset_missing")).toBe(true);
  });

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

  it("P1-7 非法文件名（空格/中文/超长）：跳过并给 asset_invalid_name，声明不引用、其它照常上传、无 errors", async () => {
    const ports = new StatsAssets();
    const ok = asset("ok.png", "AAA");
    ports.stats.set("lake:a", [
      ok,
      asset("有 空格.png", "BBB"),
      asset("中文.png", "CCC"),
      asset("x".repeat(300) + ".png", "DDD"),
    ]);
    ports.bytes.set("lake:a/ok.png", enc("AAA"));
    const r = await applyAssets(plan({ publishes: { lake: ["a"], quickNotes: [] } }), { declarations: [] }, ports);
    // 不再进 errors（引擎不消费 errors ⇒ UI 静默）；本轮继续，其它资产照常上传。
    expect(r.errors).toEqual([]);
    expect(r.uploaded.files).toBe(1);
    expect(ports.puts.filter((k) => k.startsWith("assets/"))).toEqual([assetKey("a", "ok.png")]);
    // 声明**只引用真实可上传的对象**：非法名不进声明（否则索引会引用一个永远传不上去的对象）。
    const expected = buildAssetDeclaration([ok]);
    expect(ports.puts).toContain(declarationKey("lake", "a", expected.declHash));
    expect(r.assetsHashes).toEqual([{ space: "lake", id: "a", assetsHash: expected.declHash }]);
    const invalid = r.warnings.filter((w) => w.code === "asset_invalid_name");
    expect(invalid.map((w) => w.filename).sort()).toEqual(["x".repeat(300) + ".png", "中文.png", "有 空格.png"].sort());
    expect(invalid.every((w) => w.space === "lake" && w.id === "a" && !!w.detail)).toBe(true);
    expect(r.warnings.some((w) => w.code === "asset_missing")).toBe(false);
  });

  it("P1-7 桌面 names 快路径：非法名先判后跳，不读字节也不进声明", async () => {
    const ports = new NamesAssets();
    ports.names.set("lake:a", ["ok.png", "有 空格.png"]);
    ports.bytes.set("lake:a/ok.png", enc("AAA"));
    const r = await applyAssets(plan({ publishes: { lake: ["a"], quickNotes: [] } }), { declarations: [] }, ports);
    expect(r.errors).toEqual([]);
    expect(r.uploaded.files).toBe(1);
    expect(r.warnings.map((w) => w.code)).toEqual(["asset_invalid_name"]);
    expect(r.warnings[0].filename).toBe("有 空格.png");
    expect(r.assetsHashes[0].assetsHash).toBe(buildAssetDeclaration([asset("ok.png", "AAA")]).declHash);
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

  it("P1-7 远端声明含非法文件名：跳过并告警（不落 pending/errors），其它照常下载", async () => {
    const ports = new FakeAssets();
    ports.remote.set(assetKey("a", "p.png"), enc("PPP"));
    const decl = buildAssetDeclaration([asset("p.png", "PPP")]);
    // 旧版本（或对端）曾把非法名写进声明：远端声明里带着它。
    const assets: AssetDeclEntry[] = [...decl.declaration.assets, { filename: "坏 名.png", size: 3, hash: H("PPP") }];
    const r = await applyAssets(
      plan({ writes: [{ kind: "apply-remote", space: "lake", id: "a", meta: { id: "a", assetsHash: decl.declHash }, bodyHash: H("x") }] }),
      { declarations: [{ space: "lake", id: "a", declHash: decl.declHash, assets }] },
      ports,
    );
    expect(ports.written).toEqual(["p.png"]);          // 合法附件照常下载
    expect(r.failedDownloads).toEqual([]);             // 非法名不落 pending（永远传不成，重试只会刷告警）
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(["asset_invalid_name"]);
    expect(r.warnings[0]).toMatchObject({ space: "lake", id: "a", filename: "坏 名.png" });
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
