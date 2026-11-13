/**
 * 标签「删除 = 缺席」跨端闭环（261105）：A 删标签 → 下一轮索引里它缺席 → B 以「基线有 / 远端缺席」判定删除。
 * 同时验证本机待删（device_state `tag_deleted`）在远端确认缺席后**结算清空**，不会永久抑制同名标签。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async () => {}, loadAssetBytesFs: async () => null, removeAssetBytesFs: async () => {},
  listNoteAssetKeysFs: async () => [], listQuickNoteAssetKeysFs: async () => [], listAssetKeysFs: async () => [],
  removeNoteAssetsDirFs: async () => {}, removeQuickNoteAssetsDirFs: async () => {},
}));
import { gunzipSync, gzipSync } from "node:zlib";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { writeQuickNoteBody } from "../data/noteBodies.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import { MobileDeviceStore } from "./mobileDeviceStore.js";
import { setBaselineFileForDbForTest } from "../data/v3BaselineFile.js";
import { S3v3SyncEngine } from "../../core/s3v3Engine.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../core/s3v3Ports.js";
import { PENDING_TAG_DELETES_KEY } from "../data/quickNoteTagsRepository.js";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}

// 261113 D1-C：baseline 落文件（测试内存后端是模块级共享）⇒ 每台设备用独立路径，避免两库串基线。
let deviceSeq = 0;
async function freshDevice() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  setBaselineFileForDbForTest(db, "sync-v3/baseline-dev" + (++deviceSeq) + ".json.gz.b64");
  const store = new MobileDeviceStore(db);
  await store.init();
  return { db, store };
}

const T1 = "2026-11-01T00:00:00.000Z";
const TAG_ID = "t_0000000000000001";

describe("标签跨端删除 = 缺席（双移动端，假 S3）", () => {
  it("A 删标签 → B 同步后本地删行并清关联；待删记录在远端确认缺席后结算", async () => {
    const remote = new MemoryRemote();
    const a = await freshDevice();
    const b = await freshDevice();
    try {
      const body = "quick-body";
      await a.db.prepare("INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict) VALUES ('q1',?,?,'',0,?,1,0)")
        .run(T1, T1, sha256Sync(new TextEncoder().encode(body)));
      await a.db.prepare("INSERT INTO tag_link_versions(target_kind,target_id,links_updated_at) VALUES ('quickNote','q1',?)").run(T1);
      await writeQuickNoteBody("q1", body);
      await a.db.prepare("INSERT INTO tags (id,name,sort_order,created_at,updated_at,deleted_at) VALUES (?,?,0,?,?,NULL)").run(TAG_ID, "工作", T1, T1);
      await a.db.prepare("INSERT INTO tag_links (target_kind,target_id,tag_id,position) VALUES ('quickNote','q1',?,0)").run(TAG_ID);

      const engineA = new S3v3SyncEngine({ remote, device: a.store, deviceId: "A" });
      const engineB = new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" });
      await engineA.sync({ onEmptyCloud: "upload" });
      await engineB.sync();
      expect(await b.db.prepare("SELECT name FROM tags WHERE id=?").get(TAG_ID)).toMatchObject({ name: "工作" });
      expect(await b.db.prepare("SELECT tag_id FROM tag_links WHERE target_id='q1'").get()).toMatchObject({ tag_id: TAG_ID });

      // A 删除 = 物理删行 + 记本机待删（等价于 mobileQuickNoteTags.delete 的落库结果）
      await a.db.prepare("DELETE FROM tags WHERE id=?").run(TAG_ID);
      await a.db.prepare("DELETE FROM tag_links WHERE tag_id=?").run(TAG_ID);
      await a.db.prepare("INSERT INTO device_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(PENDING_TAG_DELETES_KEY, JSON.stringify([TAG_ID]));
      await engineA.sync();

      // B：基线有 / 远端缺席 ⇒ 删除压编辑，本地物理删行 + 清关联
      await engineB.sync();
      expect(await b.db.prepare("SELECT 1 FROM tags WHERE id=?").get(TAG_ID)).toBeUndefined();
      expect(await b.db.prepare("SELECT tag_id FROM tag_links WHERE target_id='q1'").all()).toEqual([]);

      // A：远端已确认缺席 ⇒ 待删结算清空（否则同名标签会被永久抑制）
      await engineA.sync();
      expect(await a.db.prepare("SELECT value FROM device_state WHERE key=?").get(PENDING_TAG_DELETES_KEY)).toBeUndefined();
    } finally {
      await a.db.close();
      await b.db.close();
    }
  }, 60_000);
});
