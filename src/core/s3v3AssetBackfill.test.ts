import { describe, expect, it } from "vitest";
import { sha256Hex } from "./syncUtils.js";
import { buildAssetDeclaration, indexHashOf, serializeDeclaration, serializeLakeIndex, type LakeIndex } from "./s3v3/protocol/s3v3Index.js";
import { assetKey, declarationKey, indexKey } from "./s3v3/protocol/s3v3Keys.js";
import { backfillV3Assets, type AssetBackfillPort } from "./s3v3AssetBackfill.js";
import type { RemoteObjectInfo, S3v3Remote } from "./s3v3Ports.js";

const enc = (s: string) => new TextEncoder().encode(s);
const H = (s: string) => sha256Hex(enc(s));
const ISO = "2026-10-25T00:00:00.000Z";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, Uint8Array>();
  async get(key: string): Promise<Uint8Array | null> { return this.objects.get(key) ?? null; }
  async put(key: string, bytes: Uint8Array): Promise<void> { this.objects.set(key, new Uint8Array(bytes)); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: this.objects.get(key)!.length })); }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> { const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of keys) this.objects.delete(k); return keys.length; }
}

function remoteWithAssets(assets: Array<{ filename: string; content: string }>, present: Set<string>) {
  const remote = new MemoryRemote();
  const decl = buildAssetDeclaration(assets.map((a) => ({ filename: a.filename, size: enc(a.content).length, hash: H(a.content) })));
  const lake: LakeIndex = {
    v: 3, space: "lake", folders: [],
    notes: [{ id: "n1", title: "N", parentId: null, sortOrder: 0, updatedAt: ISO, contentHash: H("body"), assetsHash: decl.declHash }],
  };
  const lakeSerialized = serializeLakeIndex(lake);
  const commit = indexHashOf(lakeSerialized);
  remote.put(indexKey("lake", commit), enc(lakeSerialized));
  remote.put(declarationKey("lake", "n1", decl.declHash), enc(serializeDeclaration(decl.declaration)));
  for (const a of assets) if (present.has(a.filename)) remote.put(assetKey("n1", a.filename), enc(a.content));
  const pointer = { v: 3, epoch: "11111111-1111-4111-8111-111111111111", generation: 1, lake: { commit }, quickNotes: { commit: "f".repeat(64) }, createdAt: ISO };
  remote.put("meta/pointer.json", enc(JSON.stringify(pointer)));
  return { remote, decl };
}

function portWithLocal(local: Map<string, string>): AssetBackfillPort & { written: Map<string, string> } {
  const written = new Map<string, string>();
  return {
    written,
    listLocal: async () => [...local.keys()],
    readLocal: async (_id, filename) => (local.has(filename) ? enc(local.get(filename)!) : null),
    writeLocal: async (_id, filename, bytes) => { local.set(filename, new TextDecoder().decode(bytes)); written.set(filename, new TextDecoder().decode(bytes)); },
  };
}

describe("v3 资产惰性补拉（parity B6）", () => {
  it("本地已持同内容跳过；缺失/损坏补下并校验；云端缺对象记 missing", async () => {
    const assets = [
      { filename: "a1.png", content: "A1" },
      { filename: "a2.png", content: "A2" },
      { filename: "a3.png", content: "A3" },
      { filename: "a4.png", content: "A4" },
    ];
    const { remote } = remoteWithAssets(assets, new Set(["a1.png", "a2.png", "a3.png"]));
    const local = new Map<string, string>([["a1.png", "A1"], ["a3.png", "WRONG"]]);
    const port = portWithLocal(local);
    const result = await backfillV3Assets(remote, "lake", "n1", port);
    expect(result.found).toBe(true);
    expect(result.skipped).toBe(1);          // a1 精确匹配
    expect(result.downloaded).toBe(2);       // a2 缺失、a3 本地损坏
    expect(result.missing).toEqual(["a4.png"]);
    expect(result.failed).toEqual([]);
    expect(port.written.get("a2.png")).toBe("A2");
    expect(port.written.get("a3.png")).toBe("A3"); // 拉回的是云端权威内容
    expect(result.warnings.some((w) => w.includes("a4.png"))).toBe(true);
  });

  it("云端无 pointer → found=false 且只回 warning（不抛）", async () => {
    const remote = new MemoryRemote();
    const result = await backfillV3Assets(remote, "lake", "n1", portWithLocal(new Map()));
    expect(result.found).toBe(false);
    expect(result.downloaded).toBe(0);
    expect(result.warnings.some((w) => w.includes("pointer"))).toBe(true);
  });

  it("声明对象被篡改（hash 不符）→ 不下载、回 warning", async () => {
    const { remote, decl } = remoteWithAssets([{ filename: "a1.png", content: "A1" }], new Set(["a1.png"]));
    remote.objects.set(declarationKey("lake", "n1", decl.declHash), enc(JSON.stringify({ assets: [] })));
    const result = await backfillV3Assets(remote, "lake", "n1", portWithLocal(new Map()));
    expect(result.found).toBe(true);
    expect(result.downloaded).toBe(0);
    expect(result.warnings.some((w) => w.includes("hash 不符"))).toBe(true);
  });
});
