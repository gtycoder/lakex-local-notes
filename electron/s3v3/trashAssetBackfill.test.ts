import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import { ensureTrashNoteAssets } from "../syncEngineController.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import type { RemoteObjectInfo, S3v3Remote } from "./ports.js";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string): Promise<Uint8Array | null> {
    const o = this.objects.get(key);
    if (!o) return null;
    return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes;
  }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
    this.objects.set(key, { bytes: opts?.gzip ? new Uint8Array(gzipSync(Buffer.from(bytes))) : new Uint8Array(bytes), gzip: !!opts?.gzip });
  }
  async list(prefix: string): Promise<RemoteObjectInfo[]> {
    return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })).sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix));
    for (const k of keys) this.objects.delete(k);
    return keys.length;
  }
}

describe("回收站附件惰性补拉（v3 parity B6：不再空操作）", () => {
  it("本地附件被删后，ensureTrashNoteAssets 能从 v3 声明差集拉回并校验落盘", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-backfill-"));
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>hello</p>", [], "n1");
    const assetsDir = store.getNotePaths("n1").assetsDir;
    await fs.mkdir(assetsDir, { recursive: true });
    await fs.writeFile(path.join(assetsDir, "a.png"), Buffer.from("PNG-A"));
    const remote = new MemoryRemote();
    const device = new DesktopStoreDevice(store, root, { skipQuickNotesGuard: true });
    await device.init();
    await new S3v3SyncEngine({ remote, device, deviceId: "A" }).sync({ onEmptyCloud: "upload" });
    expect([...remote.objects.keys()].some((k) => k === "assets/n1/a.png")).toBe(true);

    await fs.rm(assetsDir, { recursive: true, force: true });
    const result = await ensureTrashNoteAssets(store, "n1", { remote });
    expect(result.skipped).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(await fs.readFile(path.join(assetsDir, "a.png"), "utf8")).toBe("PNG-A");
  }, 60_000);
});
