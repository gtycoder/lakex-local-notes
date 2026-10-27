/**
 * 桌面 × 移动混合端 conformance（同一 MemoryRemote）：验证两种真实适配器在同一云端并发收敛。
 *
 * 背景：桌面/移动各自单端 conformance 只能证明「与本平台的引擎配合正确」；真实用户是多端混合，
 * 这里把 DesktopStoreDevice（真实 Store + better-sqlite3）与 MobileDeviceStore（sql.js + BodyStore）
 * 接到同一 MemoryRemote 上，覆盖首次并发、并发编辑不同文档、同时编辑同一篇三类场景。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

// 移动端资产存储：一台移动设备一份内存表（同 src/mobile/v3/deviceConformance.mobile.test.ts）。
const assetState = vi.hoisted(() => ({ current: new Map<string, Uint8Array>() }));
vi.mock("../../src/mobile/native/assetFs", () => ({
  saveAssetBytesFs: async (key: string, bytes: Uint8Array) => { assetState.current.set(key, new Uint8Array(bytes)); },
  loadAssetBytesFs: async (key: string) => assetState.current.get(key) ?? null,
  removeAssetBytesFs: async (key: string) => { assetState.current.delete(key); },
  listNoteAssetKeysFs: async (noteId: string) => [...assetState.current.keys()].filter((k) => k.startsWith(noteId + "/")),
  listQuickNoteAssetKeysFs: async (id: string) => [...assetState.current.keys()].filter((k) => k.startsWith("quick-notes/" + id + "/")),
  listAssetKeysFs: async () => [...assetState.current.keys()],
}));

import { describe, expect, it } from "vitest";
import { MemoryRemote } from "./deviceConformance.js";
import { Store } from "../store.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { S3v3SyncEngine } from "../../src/core/s3v3Engine.js";
import { SqlJsAsyncDb, SqlJsDb } from "../../src/mobile/data/sqliteDb.js";
import { applyMobileSchema } from "../../src/mobile/data/schema.js";
import { createNote, readNote, saveNote } from "../../src/mobile/data/noteRepository.js";
import { setBodyStoreBackendForTest, type BodyStoreBackend } from "../../src/mobile/native/bodyStore.js";
import { MobileDeviceStore } from "../../src/mobile/v3/mobileDeviceStore.js";

interface MixedDevice {
  sync(opts?: { onEmptyCloud?: "upload" | "stay" }): Promise<Awaited<ReturnType<S3v3SyncEngine["sync"]>>>;
  seedNote(id: string, title: string, body: string): Promise<void>;
  editNote(id: string, title: string, body: string): Promise<void>;
  readBody(id: string): Promise<string | null>;
  activeIds(): Promise<string[]>;
  close(): Promise<void>;
}

function fsBackend(dir: string): BodyStoreBackend {
  const abs = (rel: string): string => path.join(dir, rel);
  const backend: BodyStoreBackend = {
    async readText(rel) { try { return await fs.readFile(abs(rel), "utf8"); } catch { return null; } },
    async writeText(rel, text) { await fs.mkdir(path.dirname(abs(rel)), { recursive: true }); await fs.writeFile(abs(rel), text, "utf8"); return Buffer.byteLength(text); },
    async writeTextMany(items) { let bytes = 0; for (const i of items) { await fs.mkdir(path.dirname(abs(i.path)), { recursive: true }); await fs.writeFile(abs(i.path), i.text, "utf8"); bytes += Buffer.byteLength(i.text); } return bytes; },
    async readTextMany(paths) { return Promise.all(paths.map((p) => backend.readText(p))); },
    async statTextMany(paths) { return Promise.all(paths.map((p) => backend.stat(p))); },
    async remove(rel) { await fs.rm(abs(rel), { force: true }); },
    async stat(rel) { try { const st = await fs.stat(abs(rel)); return { exists: true, size: st.size }; } catch { return { exists: false, size: 0 }; } },
    async readSnapshot(rel) { return backend.readText(rel); },
    async writeSnapshot(rel, text) { return backend.writeText(rel, text); },
  };
  return backend;
}

async function desktopDevice(remote: MemoryRemote): Promise<MixedDevice> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-mixed-desktop-"));
  const store = new Store(root); store.bootstrap();
  const adapter = new DesktopStoreDevice(store, root, { skipQuickNotesGuard: true });
  await adapter.init();
  const engine = new S3v3SyncEngine({ remote, device: adapter, deviceId: "mixed-desktop-" + Math.random().toString(36).slice(2, 8) });
  let nbId: string | null = null;
  const ensureNotebook = (): string => { if (!nbId) nbId = store.createNotebook("NB").id; return nbId; };
  return {
    sync: (opts) => engine.sync(opts ?? {}),
    seedNote: async (id, title, body) => { store.createNoteInAtTopWithContent(ensureNotebook(), title, body, [], id); },
    editNote: async (id, title, body) => { store.saveNote(id, title, body); },
    readBody: async (id) => { const bytes = await adapter.readBody(id); return bytes ? new TextDecoder().decode(bytes) : null; },
    activeIds: async () => {
      const trash = new Set(store.listTrash().map((t) => t.id));
      return store.listNoteSummaries().map((s) => s.id).filter((id) => !trash.has(id)).sort();
    },
    close: async () => { await fs.rm(root, { recursive: true, force: true }); },
  };
}

async function mobileDevice(remote: MemoryRemote): Promise<MixedDevice> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-mixed-mobile-"));
  const backend = fsBackend(root);
  const assetStore = new Map<string, Uint8Array>();
  setBodyStoreBackendForTest(backend);
  assetState.current = assetStore;
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  const device = new MobileDeviceStore(db);
  await device.init();
  const engine = new S3v3SyncEngine({ remote, device, deviceId: "mixed-mobile-" + Math.random().toString(36).slice(2, 8) });
  const use = async <T>(fn: () => Promise<T>): Promise<T> => {
    setBodyStoreBackendForTest(backend);
    assetState.current = assetStore;
    return await fn();
  };
  return {
    sync: (opts) => use(() => engine.sync(opts ?? {})),
    seedNote: (id, title, body) => use(() => createNote(db, id, title, body, null, new Map())),
    editNote: (id, title, body) => use(async () => {
      const cur = await readNote(db, id);
      await saveNote(db, id, title, body, cur?.parentId ?? null, new Map());
    }),
    readBody: (id) => use(async () => { const bytes = await device.readBody(id); return bytes ? new TextDecoder().decode(bytes) : null; }),
    activeIds: () => use(async () => { const rows = await db.prepare("SELECT id FROM notes WHERE trashed_at IS NULL ORDER BY id").all() as Array<{ id: string }>; return rows.map((r) => r.id); }),
    close: async () => { await db.close(); setBodyStoreBackendForTest(null); await fs.rm(root, { recursive: true, force: true }); },
  };
}

/** 两台设备最终看到同一批活跃 id（平台种子差异已由「同批 id 集合」承担）。 */
async function converge(a: MixedDevice, b: MixedDevice): Promise<void> {
  for (let round = 0; round < 2; round++) { await a.sync(); await b.sync(); }
}

describe("桌面 × 移动混合端 conformance（同一 MemoryRemote）", () => {
  it("首次并发 sync：互不破坏，两台收敛同 id/同正文", async () => {
    const remote = new MemoryRemote();
    const desktop = await desktopDevice(remote);
    const mobile = await mobileDevice(remote);
    try {
      await desktop.seedNote("n1", "桌面文档", "<p>desktop-body</p>");
      await mobile.seedNote("m1", "移动文档", "<p>mobile-body</p>");
      const settled = await Promise.allSettled([
        desktop.sync({ onEmptyCloud: "upload" }),
        mobile.sync({ onEmptyCloud: "upload" }),
      ]);
      // 已知缺口（已报告，不自行修）：两端**同时**在空桶上首传时，后启动方可能先读到 pointer=null、
      // 再 list 到对端已上传的对象 ⇒ 抛 `pointer-corrupt: pointer 缺失但云端已有对象`
      // （src/core/s3v3Engine.ts#syncOnce 的 no-baseline 分支；并发首传的确定性竞态）。
      // 用户可见行为：该轮失败、重试一次即恢复；数据不丢。这里按真实行为断言（失败码固定），
      // 失败方补跑一轮后必须与其他端收敛；生产侧修好后把下面「失败方补跑」收紧为「全部 fulfilled」。
      const rejected = settled.filter((s) => s.status === "rejected") as PromiseRejectedResult[];
      for (const r of rejected) expect((r.reason as { code?: string } | null)?.code).toBe("pointer-corrupt");
      expect(rejected.length).toBeLessThanOrEqual(1);
      if (settled[0].status === "rejected") await desktop.sync();
      if (settled[1].status === "rejected") await mobile.sync();
      await converge(desktop, mobile);
      expect(await desktop.activeIds()).toEqual(await mobile.activeIds());
      const idsA = await desktop.activeIds();
      const idsB = await mobile.activeIds();
      expect(idsA).toEqual(idsB);
      for (const id of idsA) {
        expect(await desktop.readBody(id)).toBe(await mobile.readBody(id));
      }
    } finally { await desktop.close(); await mobile.close(); }
  }, 240_000);

  it("桌面改 n1、移动改 n2 后并发 sync：两台最终都看到两份修改", async () => {
    const remote = new MemoryRemote();
    const desktop = await desktopDevice(remote);
    const mobile = await mobileDevice(remote);
    try {
      await desktop.seedNote("n1", "文档一", "<p>v1</p>");
      await desktop.seedNote("n2", "文档二", "<p>v2</p>");
      await desktop.sync({ onEmptyCloud: "upload" });
      await mobile.sync();
      expect(await mobile.activeIds()).toEqual(expect.arrayContaining(["n1", "n2"]));

      await desktop.editNote("n1", "文档一", "<p>desktop-edit-n1</p>");
      await mobile.editNote("n2", "文档二", "<p>mobile-edit-n2</p>");
      await Promise.all([desktop.sync(), mobile.sync()]);
      await converge(desktop, mobile);

      for (const dev of [desktop, mobile]) {
        expect(await dev.readBody("n1")).toBe("<p>desktop-edit-n1</p>");
        expect(await dev.readBody("n2")).toBe("<p>mobile-edit-n2</p>");
      }
    } finally { await desktop.close(); await mobile.close(); }
  }, 240_000);

  it("桌面与移动同时改同一篇：不崩溃、不丢数据、最终两端读到相同内容", async () => {
    const remote = new MemoryRemote();
    const desktop = await desktopDevice(remote);
    const mobile = await mobileDevice(remote);
    try {
      await desktop.seedNote("n1", "同一篇", "<p>base</p>");
      await desktop.sync({ onEmptyCloud: "upload" });
      await mobile.sync();
      expect(await mobile.activeIds()).toContain("n1");

      await desktop.editNote("n1", "同一篇", "<p>desktop-same</p>");
      await mobile.editNote("n1", "同一篇", "<p>mobile-same</p>");
      const settled = await Promise.allSettled([desktop.sync(), mobile.sync()]);
      for (const s of settled) expect(s.status).toBe("fulfilled");
      await converge(desktop, mobile);
      await converge(desktop, mobile); // 冲突后多推一轮，确保两端都拉到赢家

      const bodyA = await desktop.readBody("n1");
      const bodyB = await mobile.readBody("n1");
      expect(bodyA).not.toBeNull();
      expect(bodyA).toBe(bodyB);
      expect(["<p>desktop-same</p>", "<p>mobile-same</p>"]).toContain(bodyA);
    } finally { await desktop.close(); await mobile.close(); }
  }, 240_000);
});
