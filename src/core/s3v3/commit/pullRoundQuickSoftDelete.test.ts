import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../syncUtils.js";
import { indexHashOf, indexKey, serializeLakeIndex, serializeQuickNotesIndex, type QuickNoteEntry, type S3v3Pointer } from "../protocol/index.js";
import { pullRound, type PullRoundState } from "./pullRound.js";
import type { RoundPorts } from "./runSyncRound.js";
import type { S3v3Remote, RemoteObjectInfo } from "../../s3v3Ports.js";

/**
 * 261124 A1（审计②P1-1）：pull-all（换机/坏库恢复）把**从未同步过的小记**物删（行+正文+图片）
 * —— pullRound 头注释承诺「本地有云端没有 ⇒ 软删进回收站、绝不物理删除」，quick 侧却只记
 * remotePurged 不留条目 ⇒ saveQuickNotes 清扫对「不在 baseline」的行走 discardQuickNote 物理删。
 * 修后契约：本地独有小记一律进 **quickDeletes 软删通道**（进小记回收站可恢复；曾同步过的补
 * 「云端已删除·仅本地」标），与文档侧 trashedLocal 同语义。
 */
describe("A1：pull-all 不物删未同步小记（软删进回收站）", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const ISO = "2026-10-28T00:00:00.000Z";
  const H = (s: string) => sha256Hex(enc(s));

  class MemRemote implements S3v3Remote {
    objects = new Map<string, Uint8Array>();
    async get(key: string) { return this.objects.get(key) ?? null; }
    async put(key: string, bytes: Uint8Array) { this.objects.set(key, new Uint8Array(bytes)); }
    async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: this.objects.get(key)!.length })); }
    async deleteMany(keys: string[]) { keys.forEach((k) => this.objects.delete(k)); }
    async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); ks.forEach((k) => this.objects.delete(k)); return ks.length; }
  }

  const ports = (remote: MemRemote): RoundPorts => ({
    getRemote: (k) => remote.get(k), putRemote: (k, b) => remote.put(k, b),
    deleteRemoteKeys: (ks) => remote.deleteMany(ks), deleteRemotePrefix: (p) => remote.deleteByPrefix(p),
    readLocalBody: async () => null, writeLocalBody: async () => {}, deleteLocalBody: async () => {},
    archiveLocal: async () => {}, listLocalAssets: async () => [], readLocalAsset: async () => null, writeLocalAsset: async () => {},
    loadIntentLog: async () => ({ intents: [], restorePending: [] }), saveIntentLog: async () => {},
    loadPending: async () => [], savePending: async () => {},
  });

  const quickItem = (id: string): QuickNoteEntry => ({
    id, createdAt: ISO, updatedAt: ISO, contentHash: H("body-" + id),
  });

  async function runPullAll(localQuick: QuickNoteEntry[], remoteQuick: QuickNoteEntry[]) {
    const remote = new MemRemote();
    const lakeIdx = { v: 3 as const, space: "lake" as const, notes: [], folders: [] };
    const quickIdx = { v: 3 as const, space: "quickNotes" as const, items: remoteQuick, tags: [] };
    const lakeCommit = indexHashOf(serializeLakeIndex(lakeIdx));
    const quickCommit = indexHashOf(serializeQuickNotesIndex(quickIdx));
    remote.objects.set(indexKey("lake", lakeCommit), enc(serializeLakeIndex(lakeIdx)));
    remote.objects.set(indexKey("quickNotes", quickCommit), enc(serializeQuickNotesIndex(quickIdx)));
    const pointer: S3v3Pointer = { v: 3, epoch: "11111111-1111-4111-8111-111111111111", generation: 1, lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit }, createdAt: ISO };
    const p = ports(remote);
    const { lake, quickNotes } = await (await import("./pullRound.js")).readRemoteIndexes(pointer, p);
    const state: PullRoundState = {
      lake: { v: 3, space: "lake", notes: [], folders: [] },
      quickNotes: { v: 3, space: "quickNotes", items: localQuick, tags: [] },
      folders: [], remotePurged: [], quickDeletes: [],
    };
    return pullRound({ state, remote: { lake, quickNotes }, archiveLocal: true }, p);
  }

  it("从未同步的本地小记 ⇒ quickDeletes 软删通道（绝不物理丢弃）", async () => {
    const out = await runPullAll([quickItem("q-unsynced")], []);
    expect(out.state.quickDeletes).toContain("q-unsynced");
    // 收敛后活跃世界不含它（进回收站语义），但条目 id 已交给软删通道 —— 由 saveQuickNotes 清扫落软删。
    expect(out.state.quickNotes.items.map((q) => q.id)).not.toContain("q-unsynced");
  });

  it("曾同步过（云端仍有的除外）被删除传播的小记同样走软删通道（带「云端已删除」判据由清扫按基线补）", async () => {
    const out = await runPullAll([quickItem("q-known")], []);
    expect(out.state.quickDeletes).toContain("q-known");
  });

  it("云端仍有的小记不进软删通道（正常收敛）", async () => {
    const out = await runPullAll([quickItem("q-live")], [quickItem("q-live")]);
    expect(out.state.quickDeletes ?? []).not.toContain("q-live");
    expect(out.state.quickNotes.items.map((q) => q.id)).toContain("q-live");
  });
});
