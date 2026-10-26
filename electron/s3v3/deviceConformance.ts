/**
 * 双端设备适配器一致性（conformance）规格（261026）。
 *
 * 同一组「同步行为规格」分别跑桌面 store 与移动 store，防止后续重构/优化把两端语义改歪：
 * 首轮上传、空跑零写、第二设备拉取、双端编辑互相同步。
 * 只依赖 core 端口 + 引擎，不碰平台细节；平台 harness 负责 seed/edit/read。
 */
import { describe, expect, it } from "vitest";
import { gzipSync, gunzipSync } from "node:zlib";
import type { S3v3Remote, RemoteObjectInfo } from "../../src/core/s3v3Ports.js";
import type { S3v3SyncReport } from "../../src/core/s3v3Engine.js";

export class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  gets = 0;
  puts = 0;
  async get(key: string): Promise<Uint8Array | null> {
    this.gets += 1;
    const o = this.objects.get(key);
    if (!o) return null;
    return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes;
  }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
    this.puts += 1;
    this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false });
  }
  async list(prefix: string): Promise<RemoteObjectInfo[]> {
    return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length }));
  }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}

export interface ConformanceHarness {
  sync(opts?: { onEmptyCloud?: "upload" | "stay" }): Promise<S3v3SyncReport>;
  seedNote(id: string, title: string, body: string): Promise<void>;
  editNote(id: string, title: string, body: string): Promise<void>;
  listActiveIds(): Promise<string[]>;
  listTrashIds(): Promise<string[]>;
  listCloudDeletedIds(): Promise<string[]>;
  trashNote(id: string): Promise<void>;
  restoreNote(id: string): Promise<void>;
  purgeNote(id: string): Promise<void>;
  readBody(id: string): Promise<string | null>;
  close(): Promise<void>;
}

export type HarnessFactory = (remote: S3v3Remote) => Promise<ConformanceHarness>;

async function newDevice(make: HarnessFactory, remote: MemoryRemote): Promise<ConformanceHarness> {
  return await make(remote);
}

export function defineDeviceConformance(name: string, make: HarnessFactory): void {
  describe(name, () => {
    it("首轮上传建立基线；空跑零下载零写入", async () => {
      const remote = new MemoryRemote();
      const dev = await newDevice(make, remote);
      try {
        await dev.seedNote("n1", "标题一", "<p>正文一</p>");
        await dev.seedNote("n2", "标题二", "<p>正文二</p>");
        const first = await dev.sync({ onEmptyCloud: "upload" });
        expect(first.published).toBe(true);
        // 桌面 bootstrap 自带的 welcome-note 也会随首轮上传（端固有差异，不算违规）。
        expect(first.uploadedNotes).toBeGreaterThanOrEqual(2);
        const putsAfterFirst = remote.puts;
        const second = await dev.sync();
        expect(second.downloadedNotes).toBe(0);
        expect(second.uploadedNotes).toBe(0);
        expect(remote.puts).toBe(putsAfterFirst);
        // 桌面 bootstrap 会带一条 welcome-note 种子；两端都只要求包含我们造的这两篇。
        expect(await dev.listActiveIds()).toEqual(expect.arrayContaining(["n1", "n2"]));
        expect(await dev.readBody("n1")).toBe("<p>正文一</p>");
      } finally { await dev.close(); }
    }, 120_000);

    it("第二台设备首拉拿到同 id / 同正文", async () => {
      const remote = new MemoryRemote();
      const a = await newDevice(make, remote);
      const b = await newDevice(make, remote);
      try {
        await a.seedNote("n1", "标题一", "<p>正文一</p>");
        await a.seedNote("n2", "标题二", "<p>正文二</p>");
        await a.sync({ onEmptyCloud: "upload" });
        const pulled = await b.sync();
        expect(pulled.downloadedNotes).toBeGreaterThanOrEqual(2);
        expect(await b.listActiveIds()).toEqual(expect.arrayContaining(["n1", "n2"]));
        expect(await b.readBody("n1")).toBe("<p>正文一</p>");
        expect(await b.readBody("n2")).toBe("<p>正文二</p>");
        // 再空跑一次：B 不重复下载
        const noop = await b.sync();
        expect(noop.downloadedNotes).toBe(0);
      } finally { await a.close(); await b.close(); }
    }, 120_000);

    it("本地移入回收站 → 对端跟随（回收站可见、正文仍在），恢复后回到活跃", async () => {
      const remote = new MemoryRemote();
      const a = await newDevice(make, remote);
      const b = await newDevice(make, remote);
      try {
        await a.seedNote("n1", "标题一", "<p>正文一</p>");
        await a.sync({ onEmptyCloud: "upload" });
        await b.sync();
        expect(await b.listActiveIds()).toContain("n1");

        await a.trashNote("n1");
        await a.sync();
        await b.sync();
        expect(await b.listActiveIds()).not.toContain("n1");
        expect(await b.listTrashIds()).toContain("n1");
        // 正文仍在（回收站是软删，不是墓碑）
        expect(await b.readBody("n1")).toBe("<p>正文一</p>");

        await a.restoreNote("n1");
        await a.sync();
        await b.sync();
        expect(await b.listActiveIds()).toContain("n1");
        expect(await b.listTrashIds()).not.toContain("n1");
      } finally { await a.close(); await b.close(); }
    }, 180_000);

    it("云端彻底删除 → 对端保留回收站副本、正文仍在、打「云端已删除」标记", async () => {
      const remote = new MemoryRemote();
      const a = await newDevice(make, remote);
      const b = await newDevice(make, remote);
      try {
        await a.seedNote("n1", "标题一", "<p>正文一</p>");
        await a.sync({ onEmptyCloud: "upload" });
        await b.sync();
        expect(await b.listActiveIds()).toContain("n1");

        await a.purgeNote("n1");
        await a.sync();
        await b.sync();
        expect(await b.listActiveIds()).not.toContain("n1");
        expect(await b.listTrashIds()).toContain("n1"); // 副本进回收站
        expect(await b.readBody("n1")).toBe("<p>正文一</p>"); // 正文保留（本地是最后副本）
        expect(await b.listCloudDeletedIds()).toContain("n1"); // 标记为「云端已删除 · 仅本地」
        // 多轮同步不复活、不冲掉标记
        await b.sync();
        expect(await b.listActiveIds()).not.toContain("n1");
        expect(await b.listCloudDeletedIds()).toContain("n1");
      } finally { await a.close(); await b.close(); }
    }, 180_000);

    it("双端编辑互相同步（各自改各自、再改对方）", async () => {
      const remote = new MemoryRemote();
      const a = await newDevice(make, remote);
      const b = await newDevice(make, remote);
      try {
        await a.seedNote("n1", "标题一", "<p>正文一</p>");
        await a.seedNote("n2", "标题二", "<p>正文二</p>");
        await a.sync({ onEmptyCloud: "upload" });
        await b.sync();

        await a.editNote("n1", "标题一", "<p>A改过的正文一</p>");
        const aPush = await a.sync();
        expect(aPush.uploadedNotes).toBeGreaterThanOrEqual(1);
        const bPull = await b.sync();
        expect(bPull.downloadedNotes).toBe(1);
        expect(await b.readBody("n1")).toBe("<p>A改过的正文一</p>");

        await b.editNote("n2", "标题二", "<p>B改过的正文二</p>");
        await b.sync();
        const aPull = await a.sync();
        expect(aPull.downloadedNotes).toBe(1);
        expect(await a.readBody("n2")).toBe("<p>B改过的正文二</p>");
      } finally { await a.close(); await b.close(); }
    }, 180_000);
  });
}
