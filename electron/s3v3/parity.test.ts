import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import type { SyncProgress } from "../syncTypes.js";
import { syncWithV3 } from "./desktopSync.js";
import { restoreMissingBodyFromCloud } from "../syncEngineController.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../src/core/s3v3Ports.js";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}
async function device(label: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-parity-" + label + "-"));
  const store = new Store(root); store.bootstrap();
  return { root, store };
}

describe("v3 与旧协议对齐（261026 parity：进度/冲突留档/警告/缺正文恢复入口）", () => {
  it("冲突留档回执（conflicts/supersededNotes）+ 进度阶段映射", async () => {
    const remote = new MemoryRemote();
    const a = await device("a"); const b = await device("b");
    const nb = a.store.createNotebook("NB");
    a.store.createNoteInAtTopWithContent(nb.id, "Doc1", "v1", [], "n1");
    await syncWithV3(a.store, undefined, { remote, deviceId: "A" });
    await syncWithV3(b.store, undefined, { remote, deviceId: "B" });
    a.store.saveNote("n1", "Doc1", "v2-A");
    await syncWithV3(a.store, undefined, { remote, deviceId: "A" });
    b.store.saveNote("n1", "Doc1", "v2-B");
    const phases = new Set<SyncProgress["phase"]>();
    const messages: string[] = [];
    const r = await syncWithV3(b.store, (p) => { phases.add(p.phase); messages.push(p.message); }, { remote, deviceId: "B" });
    expect(r.conflicts).toBeGreaterThan(0);
    expect(r.supersededNotes.map((x) => x.id)).toContain("n1");
    expect(phases.has("download")).toBe(true);
    expect(phases.has("manifest")).toBe(true);
    // B 本地版本已强制写入历史
    const hist = await fs.readdir(path.join(b.root, "history"));
    expect(hist.length).toBeGreaterThan(0);
  }, 60_000);

  it("编辑锁跨端传播（锁变更不 bump updatedAt，靠字段级 LWW）", async () => {
    const remote = new MemoryRemote();
    const a = await device("la"); const b = await device("lb");
    const nb = a.store.createNotebook("NB");
    a.store.createNoteInAtTopWithContent(nb.id, "LockMe", "body-lock", [], "n1");
    await syncWithV3(a.store, undefined, { remote, deviceId: "A" });
    await syncWithV3(b.store, undefined, { remote, deviceId: "B" });
    a.store.setNoteEditLocked("n1", true); // 只写 is_locked/locked_at，不 bump updated_at
    await syncWithV3(a.store, undefined, { remote, deviceId: "A" });
    await syncWithV3(b.store, undefined, { remote, deviceId: "B" });
    expect(b.store.readNote("n1").isEditLocked).toBe(true);
  }, 60_000);

  it("缺正文恢复的 warning 透传到 SyncResult.warnings（UI 可见）", async () => {
    const remote = new MemoryRemote();
    const a = await device("wa");
    const nb = a.store.createNotebook("NB");
    a.store.createNoteInAtTopWithContent(nb.id, "Doc", "body", [], "n1");
    await syncWithV3(a.store, undefined, { remote, deviceId: "A" });
    await fs.unlink(a.store.getNotePaths("n1").lakePath);
    const r = await syncWithV3(a.store, undefined, { remote, deviceId: "A" });
    expect(r.warnings?.some((w) => w.kind === "local_body_restored" && w.noteId === "n1")).toBe(true);
  }, 60_000);

  it("资源页「缺正文 → 从云端拉回」改走 v3 pointer/index（不再读旧 manifest）", async () => {
    const remote = new MemoryRemote();
    const a = await device("ra");
    const nb = a.store.createNotebook("NB");
    a.store.createNoteInAtTopWithContent(nb.id, "Doc", "recover-me", [], "n1");
    await syncWithV3(a.store, undefined, { remote, deviceId: "A" });
    await fs.unlink(a.store.getNotePaths("n1").lakePath);
    const ok = await restoreMissingBodyFromCloud(a.store, "n1", { remote });
    expect(ok).toEqual({ ok: true, title: "Doc" });
    expect(a.store.readNote("n1").content).toBe("recover-me");

    // hash 不符 → 明确拒绝（绝不写坏正文）
    await fs.unlink(a.store.getNotePaths("n1").lakePath);
    const bodyKey = [...remote.objects.keys()].find((k) => k.startsWith("objects/n1-"))!;
    remote.objects.set(bodyKey, { bytes: new TextEncoder().encode("tampered"), gzip: false });
    const bad = await restoreMissingBodyFromCloud(a.store, "n1", { remote });
    expect(bad).toEqual({ ok: false, reason: "hash-mismatch" });
    expect(await fs.stat(a.store.getNotePaths("n1").lakePath).then(() => true).catch(() => false)).toBe(false);
    // 云端没有该条目 → not-in-cloud
    const missing = await restoreMissingBodyFromCloud(a.store, "nope", { remote });
    expect(missing).toEqual({ ok: false, reason: "not-in-cloud" });
  }, 60_000);
});
