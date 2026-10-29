import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../syncUtils.js";
import { createRoundPorts, type RoundPortsDeps } from "./roundPorts.js";

const enc = (s: string) => new TextEncoder().encode(s);

function fakeDeps(over: Partial<RoundPortsDeps> = {}) {
  const bodies = new Map<string, Uint8Array>();
  const quickBodies = new Map<string, Uint8Array>();
  const assets = new Map<string, Map<string, Uint8Array>>();
  const archived: Array<{ id: string; bytes: Uint8Array | null }> = [];
  const quickArchived: string[] = [];
  const remoteObjects = new Map<string, Uint8Array>();
  const remotePuts: Array<{ key: string; gzip?: boolean }> = [];
  const deletedPrefixes: string[] = [];
  let pending: Awaited<ReturnType<RoundPortsDeps["loadPending"]>> = [];
  let intents: Awaited<ReturnType<RoundPortsDeps["loadIntentLog"]>> = { intents: [], restorePending: [] };
  const device = {
    readBody: async (id: string) => bodies.get(id) ?? null,
    writeBody: async (id: string, bytes: Uint8Array) => { bodies.set(id, bytes); },
    deleteBody: async (id: string) => { bodies.delete(id); },
    archiveBody: async (id: string, bytes: Uint8Array | null) => { archived.push({ id, bytes }); },
    readQuickBody: async (id: string) => quickBodies.get(id) ?? null,
    writeQuickBody: async (id: string, bytes: Uint8Array) => { quickBodies.set(id, bytes); },
    deleteQuickBody: async (id: string) => { quickBodies.delete(id); },
    archiveQuickNote: async (id: string) => { quickArchived.push(id); },
    listAssets: async (id: string) => [...(assets.get(id)?.keys() ?? [])].sort(),
    readAsset: async (id: string, filename: string) => assets.get(id)?.get(filename) ?? null,
    writeAsset: async (id: string, filename: string, bytes: Uint8Array) => { const m = assets.get(id) ?? new Map<string, Uint8Array>(); m.set(filename, bytes); assets.set(id, m); },
    listQuickAssets: async () => [],
    readQuickAsset: async () => null,
    writeQuickAsset: async () => {},
  };
  const deps: RoundPortsDeps = {
    remote: {
      get: async (key: string) => remoteObjects.get(key) ?? null,
      put: async (key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) => { remoteObjects.set(key, bytes); remotePuts.push({ key, gzip: opts?.gzip }); },
      deleteMany: async (keys: string[]) => { keys.forEach((k) => remoteObjects.delete(k)); },
      deleteByPrefix: async (prefix: string) => { deletedPrefixes.push(prefix); const ks = [...remoteObjects.keys()].filter((k) => k.startsWith(prefix)); ks.forEach((k) => remoteObjects.delete(k)); return ks.length; },
    },
    device: device as unknown as RoundPortsDeps["device"],
    loadIntentLog: async () => intents,
    saveIntentLog: async (s) => { intents = s; },
    loadPending: async () => pending,
    savePending: async (p) => { pending = p; },
    ...over,
  };
  return { deps, ports: createRoundPorts(deps), bodies, quickBodies, assets, archived, quickArchived, remoteObjects, remotePuts, deletedPrefixes };
}

describe("E2-3 roundPorts：引擎端口适配", () => {
  it("正文/资产读写映射到设备端口；缺少本地字节的资产被跳过（不当成没有资产）", async () => {
    const f = fakeDeps();
    await f.ports.writeLocalBody("lake", "a", enc("v1"));
    expect(new TextDecoder().decode((await f.ports.readLocalBody("lake", "a"))!)).toBe("v1");
    await f.ports.writeLocalAsset("lake", "a", "p.png", enc("PPP"));
    await f.ports.writeLocalAsset("lake", "a", "q.png", enc("QQQ"));
    // 删掉 q.png 字节（模拟「清单有、字节读不出」）：应被跳过而不是产出 size=0 的假声明
    f.assets.get("a")!.delete("q.png");
    const list = await f.ports.listLocalAssets("lake", "a");
    expect(list).toEqual([{ filename: "p.png", size: 3, hash: sha256Hex(enc("PPP")) }]);
  });

  it("归档/删除映射：Lake 走 archiveBody(id,null)，小记走 archiveQuickNote", async () => {
    const f = fakeDeps();
    await f.ports.archiveLocal("lake", "a", "remote-wins");
    await f.ports.archiveLocal("quickNotes", "q", "remote-wins");
    expect(f.archived).toEqual([{ id: "a", bytes: null }]);
    expect(f.quickArchived).toEqual(["q"]);
    await f.ports.deleteLocalBody("lake", "a");
    expect(await f.ports.readLocalBody("lake", "a")).toBeNull();
  });

  it("远端写/删与账本透传：gzip 标记不被吞掉，意图与待删队列原样保存", async () => {
    const f = fakeDeps();
    await f.ports.putRemote("meta/index/x.json", enc("{}"), { gzip: true });
    expect(f.remotePuts).toEqual([{ key: "meta/index/x.json", gzip: true }]);
    f.remoteObjects.set("objects/a-1.lake", enc("x"));
    expect(await f.ports.deleteRemotePrefix("objects/a-")).toBe(1);
    const log = { intents: [{ noteId: "a", targetEpoch: "e", targetGeneration: 2 }], restorePending: ["b"] };
    await f.ports.saveIntentLog(log);
    expect(await f.ports.loadIntentLog()).toEqual(log);
    await f.ports.savePending([]);
    expect(await f.ports.loadPending()).toEqual([]);
  });
});
