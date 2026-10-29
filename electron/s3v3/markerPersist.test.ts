import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import type { RemoteObjectInfo, S3v3Remote } from "./ports.js";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, { bytes: opts?.gzip ? new Uint8Array(gzipSync(Buffer.from(bytes))) : new Uint8Array(bytes), gzip: !!opts?.gzip }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length, lastModified: 0 })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of keys) this.objects.delete(k); return keys.length; }
}

async function dev(name: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-marker-" + name + "-"));
  const store = new Store(root); store.bootstrap();
  const device = new DesktopStoreDevice(store, root, { skipQuickNotesGuard: true });
  await device.init();
  return { root, store, device, sidecar: path.join(root, "sync-v3", "state.json") };
}
/** E3-1 phase2a：sidecar = v3 信封（records 判别联合）。 */
type SideRecords = Array<{ kind: string; id?: string; noteId?: string }>;
const readSide = async (p: string) => JSON.parse(await fs.readFile(p, "utf8")) as { version?: number; records: SideRecords };
const idsOf = (side: { records: SideRecords }, kind: "cloud-deleted" | "restore"): string[] =>
  side.records.filter((r) => r.kind === kind).map((r) => (kind === "restore" ? r.noteId! : r.id!));

describe("恢复标记持久化（无发布轮 + 单条推送路径）", () => {
  it("恢复后连续多轮无发布：sidecar remotePurged/restorePending 都清空", async () => {
    const remote = new MemoryRemote();
    const a = await dev("a"); const b = await dev("b");
    const nb = a.store.createNotebook("NB");
    a.store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>hi</p>", [], "n1");
    await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync({ onEmptyCloud: "upload" });
    await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
    // A 彻底删除 n1
    a.store.deleteNote("n1"); a.store.purgeTrashItem("n1");
    await new S3v3SyncEngine({ remote, device: a.device, deviceId: "A" }).sync();
    await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
    expect(idsOf(await readSide(b.sidecar), "cloud-deleted")).toContain("n1");
    // B 显式恢复（v3：替换 restore records）
    const s = await readSide(b.sidecar);
    s.records = [...s.records.filter((r) => r.kind !== "restore"), { kind: "restore", noteId: "n1" }];
    await fs.writeFile(b.sidecar, JSON.stringify(s));
    const restoreRound = await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
    expect(restoreRound.uploadedNotes).toBeGreaterThanOrEqual(1);
    expect(idsOf(await readSide(b.sidecar), "cloud-deleted")).toEqual([]);
    // 再连续两轮无发布：标记不得回潮
    for (let i = 0; i < 2; i++) {
      const r = await new S3v3SyncEngine({ remote, device: b.device, deviceId: "B" }).sync();
      expect(r.published).toBe(false);
      const side = await readSide(b.sidecar);
      expect(idsOf(side, "cloud-deleted")).toEqual([]);
      expect(idsOf(side, "restore")).toEqual([]);
    }
  }, 120_000);
});
