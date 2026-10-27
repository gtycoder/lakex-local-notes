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
import { sha256Hex } from "../../src/core/syncUtils.js";
import { lakeBodyKey } from "../../src/core/s3v3Keys.js";

/** 弱网注入计划：remaining 次（可按 key 过滤）的 GET/PUT 抛错；消耗完自动恢复。 */
interface FailurePlan {
  remaining: number;
  match?: (key: string) => boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  gets = 0;
  puts = 0;
  /** 每 key 的 GET 次数（断点/重复下载断言用）。 */
  getsByKey = new Map<string, number>();
  /** 每 key 的 PUT 次数（重复上传/幂等断言用）。 */
  putsByKey = new Map<string, number>();
  /** 全部 PUT 键序列（顺序断言/重复键扫描用）。 */
  putKeys: string[] = [];
  /** 注入「第一次 GET 失败」（模拟传输中断；旧 API，保留兼容）。 */
  failOnce = new Set<string>();
  /** 注入「第一次 PUT 失败」。 */
  failPutOnce = new Set<string>();
  /** 弱网延迟（每次 get/put 前等待；默认 0 = 不改变现有用例耗时）。 */
  latencyMs = 0;
  private failGetPlan: FailurePlan | null = null;
  private failPutPlan: FailurePlan | null = null;

  /** 接下来 n 次 GET 失败（可按 key 过滤）。 */
  injectGetFailures(n: number, match?: (key: string) => boolean): void { this.failGetPlan = { remaining: n, ...(match ? { match } : {}) }; }
  /** 接下来 n 次 PUT 失败（可按 key 过滤）。 */
  injectPutFailures(n: number, match?: (key: string) => boolean): void { this.failPutPlan = { remaining: n, ...(match ? { match } : {}) }; }
  clearInjections(): void { this.failGetPlan = null; this.failPutPlan = null; this.failOnce.clear(); this.failPutOnce.clear(); this.latencyMs = 0; }
  resetCounters(): void { this.gets = 0; this.puts = 0; this.getsByKey.clear(); this.putsByKey.clear(); this.putKeys = []; }

  private hitPlan(plan: FailurePlan | null, key: string): boolean {
    if (!plan || plan.remaining <= 0 || (plan.match && !plan.match(key))) return false;
    plan.remaining -= 1;
    return true;
  }

  async get(key: string): Promise<Uint8Array | null> {
    if (this.latencyMs > 0) await sleep(this.latencyMs);
    this.gets += 1;
    this.getsByKey.set(key, (this.getsByKey.get(key) ?? 0) + 1);
    if (this.failOnce.has(key)) {
      this.failOnce.delete(key);
      throw new Error("injected-get-failure");
    }
    if (this.hitPlan(this.failGetPlan, key)) throw new Error("injected-get-failure");
    const o = this.objects.get(key);
    if (!o) return null;
    return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes;
  }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
    if (this.latencyMs > 0) await sleep(this.latencyMs);
    this.puts += 1;
    this.putKeys.push(key);
    this.putsByKey.set(key, (this.putsByKey.get(key) ?? 0) + 1);
    if (this.failPutOnce.has(key)) {
      this.failPutOnce.delete(key);
      throw new Error("injected-put-failure");
    }
    if (this.hitPlan(this.failPutPlan, key)) throw new Error("injected-put-failure");
    this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false });
  }
  async list(prefix: string): Promise<RemoteObjectInfo[]> {
    if (this.latencyMs > 0) await sleep(this.latencyMs);
    return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length }));
  }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}

export interface ConformanceHarness {
  sync(opts?: { onEmptyCloud?: "upload" | "stay" }): Promise<S3v3SyncReport>;
  /** parentId 缺省 = 平台自选目录；指定时必须原样落在该目录下（跨端 id 保真）。 */
  seedNote(id: string, title: string, body: string, parentId?: string): Promise<void>;
  /** 用指定 id 新建笔记本（用于跨端目录 id 保真与父子关系断言）。 */
  seedFolder(id: string, title: string): Promise<void>;
  /** 活跃目录 id 列表（含平台内置种子目录；断言用 includes）。 */
  listFolderIds(): Promise<string[]>;
  /** 文档当前落库的父目录 id（缺失/悬空时返回本机解析后的真实父；null = 根层）。 */
  noteParentId(id: string): Promise<string | null>;
  /** 用户行为：删除目录（真实平台 API，子树随删）。 */
  deleteFolder(id: string): Promise<void>;
  seedAsset(id: string, filename: string, bytes: Uint8Array): Promise<void>;
  readAsset(id: string, filename: string): Promise<Uint8Array | null>;
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

export type HarnessFactory = ((remote: S3v3Remote) => Promise<ConformanceHarness>) & {
  /**
   * 平台能力声明（只用于已确认的跨端差异，不改规格本身）：
   * - restoreFallsBackToDefaultNotebook=false：恢复文档时原父已删**不会**回落到兜底笔记本
   *   （移动端已知缺口）。该场景对这类平台记为 expected-fail（it.fails），平台修好后删掉此标志即可转正。
   */
  capabilities?: { restoreFallsBackToDefaultNotebook?: boolean };
};

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

    it("带附件文档：A 上传声明+附件字节 → B 拉取到同字节", async () => {
      const remote = new MemoryRemote();
      const a = await newDevice(make, remote);
      const b = await newDevice(make, remote);
      try {
        const img = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5, 250]);
        await a.seedNote("n1", "带图文档", "<p>正文一</p>");
        await a.seedAsset("n1", "a.png", img);
        const up = await a.sync({ onEmptyCloud: "upload" });
        expect(up.published).toBe(true);
        await b.sync();
        const got = await b.readAsset("n1", "a.png");
        expect(got).not.toBeNull();
        expect(Array.from(got as Uint8Array)).toEqual(Array.from(img));
        // B 再同步：附件已存在 ⇒ 不重复下载（引擎按声明差集跳过）
        const putsBefore = remote.puts;
        await b.sync();
        expect(remote.puts).toBe(putsBefore);
      } finally { await a.close(); await b.close(); }
    }, 180_000);

    it("正文传输中断：本轮跳过（有警告）、下轮补齐；已应用正文不重下", async () => {
      const remote = new MemoryRemote();
      const a = await newDevice(make, remote);
      const b = await newDevice(make, remote);
      const enc = (s: string) => new TextEncoder().encode(s);
      const bodyKey = (id: string, text: string) => lakeBodyKey(id, sha256Hex(enc(text)));
      try {
        await a.seedNote("n1", "标题一", "<p>正文一</p>");
        await a.seedNote("n2", "标题二", "<p>正文二</p>");
        await a.sync({ onEmptyCloud: "upload" });

        remote.failOnce.add(bodyKey("n2", "<p>正文二</p>"));
        const first = await b.sync();
        // 不整轮失败：n1 已应用；n2 本轮缺正文，留结构化警告
        expect(await b.listActiveIds()).toContain("n1");
        expect(first.warningDetails.some((w) => w.noteId === "n2")).toBe(true);

        const before = remote.getsByKey.get(bodyKey("n2", "<p>正文二</p>")) ?? 0;
        await b.sync();
        expect(remote.getsByKey.get(bodyKey("n2", "<p>正文二</p>"))).toBe(before + 1);
        expect(await b.readBody("n2")).toBe("<p>正文二</p>");
        // 已应用的 n1 正文只下载过一次（断点续传不重复搬运）
        expect(remote.getsByKey.get(bodyKey("n1", "<p>正文一</p>"))).toBe(1);
      } finally { await a.close(); await b.close(); }
    }, 180_000);

    it("三端交错编辑：最终收敛且不互相覆盖", async () => {
      const remote = new MemoryRemote();
      const a = await newDevice(make, remote);
      const b = await newDevice(make, remote);
      const c = await newDevice(make, remote);
      try {
        await a.seedNote("n1", "标题一", "<p>正文一</p>");
        await a.seedNote("n2", "标题二", "<p>正文二</p>");
        await a.sync({ onEmptyCloud: "upload" });
        await b.sync();
        await c.sync();
        expect(await c.listActiveIds()).toEqual(expect.arrayContaining(["n1", "n2"]));

        // A 改 n1、C 改 n2，先后发布；B 最后拉一次（三端交错）。
        await a.editNote("n1", "标题一", "<p>A改正文一</p>");
        await a.sync();
        await c.editNote("n2", "标题二", "<p>C改正文二</p>");
        await c.sync();
        await b.sync();
        await a.sync(); // A 也拉一次，三端才都收敛

        // 三端最终看到同一份内容。
        for (const dev of [a, b, c]) {
          expect(await dev.readBody("n1")).toBe("<p>A改正文一</p>");
          expect(await dev.readBody("n2")).toBe("<p>C改正文二</p>");
        }
      } finally { await a.close(); await b.close(); await c.close(); }
    }, 240_000);

    /** 活跃文档不得挂在「不存在的活跃目录」上（用户可见的悬空判定）。 */
    const assertNoDanglingActive = async (dev: ConformanceHarness): Promise<void> => {
      const folders = new Set(await dev.listFolderIds());
      for (const id of await dev.listActiveIds()) {
        const pid = await dev.noteParentId(id);
        if (pid === null) continue;
        expect(folders.has(pid), `活跃文档 ${id} 的父目录 ${pid} 不在活跃目录里（悬空）`).toBe(true);
      }
    };

    it("删除含文档的目录：两端不丢数据（文档进回收站、正文可读、目录不再活跃、无活跃悬空）", async () => {
      const remote = new MemoryRemote();
      const a = await newDevice(make, remote);
      const b = await newDevice(make, remote);
      try {
        await a.seedFolder("f1", "目录F");
        await a.seedNote("n1", "标题一", "<p>正文一</p>", "f1");
        await a.sync({ onEmptyCloud: "upload" });
        await b.sync();
        expect(await b.listActiveIds()).toContain("n1");
        expect(await b.noteParentId("n1")).toBe("f1");

        await a.deleteFolder("f1"); // 真实用户行为：目录子树一起进回收站
        await a.sync();
        await b.sync();
        for (const dev of [a, b]) {
          expect(await dev.listActiveIds()).not.toContain("n1"); // 不消失：进回收站
          expect(await dev.listTrashIds()).toContain("n1");
          expect(await dev.readBody("n1")).toBe("<p>正文一</p>"); // 正文仍在（软删）
          expect(await dev.listFolderIds()).not.toContain("f1"); // 目录不再活跃
          await assertNoDanglingActive(dev);
        }
        // 再空跑一轮：不复活、不悬空
        await b.sync();
        expect(await b.listActiveIds()).not.toContain("n1");
      } finally { await a.close(); await b.close(); }
    }, 180_000);

    const cap = make.capabilities ?? {};
    const restoreFallbackIt = cap.restoreFallsBackToDefaultNotebook === false ? it.fails : it;
    restoreFallbackIt("恢复文档时原父已删 → 落兜底笔记本（父目录可解析、对端同父）", async () => {
      const remote = new MemoryRemote();
      const a = await newDevice(make, remote);
      const b = await newDevice(make, remote);
      try {
        await a.seedFolder("f1", "目录F");
        await a.seedNote("n1", "标题一", "<p>正文一</p>", "f1");
        await a.sync({ onEmptyCloud: "upload" });
        await b.sync();
        await a.deleteFolder("f1");
        await a.sync();
        await b.sync();
        expect(await b.listTrashIds()).toContain("n1");

        await b.restoreNote("n1"); // 原父 f1 已删 → 平台应回落到兜底笔记本
        await b.sync();
        await a.sync();
        for (const dev of [a, b]) {
          expect(await dev.listActiveIds()).toContain("n1");
          expect(await dev.readBody("n1")).toBe("<p>正文一</p>");
          const pid = await dev.noteParentId("n1");
          expect(pid).not.toBeNull();
          expect(await dev.listFolderIds()).toContain(pid as string); // 父目录必须真实存在（不悬空）
          await assertNoDanglingActive(dev);
        }
        expect(await a.noteParentId("n1")).toBe(await b.noteParentId("n1")); // 两端同父（id 保真）
      } finally { await a.close(); await b.close(); }
    }, 180_000);

    it("用户删除本地目录后同步：删除传播、正文保留、无悬空（保护目录只防同步误删，不阻止用户删）", async () => {
      const remote = new MemoryRemote();
      const a = await newDevice(make, remote);
      const b = await newDevice(make, remote);
      try {
        await a.seedFolder("f1", "目录F");
        await a.seedNote("n1", "标题一", "<p>正文一</p>", "f1");
        await a.sync({ onEmptyCloud: "upload" });
        await b.sync();
        await b.deleteFolder("f1"); // B 侧用户删除（本地拉取到的目录）
        await b.sync();
        await b.sync();
        await a.sync();
        for (const dev of [a, b]) {
          expect(await dev.listActiveIds()).not.toContain("n1");
          expect(await dev.listTrashIds()).toContain("n1");
          expect(await dev.readBody("n1")).toBe("<p>正文一</p>");
          expect(await dev.listFolderIds()).not.toContain("f1");
          await assertNoDanglingActive(dev);
        }
      } finally { await a.close(); await b.close(); }
    }, 240_000);

    it("弱网：发布中断 1 次 PUT → 本轮不崩溃留待重试，下轮补传且云端正文唯一", async () => {
      const remote = new MemoryRemote();
      const a = await newDevice(make, remote);
      try {
        await a.seedNote("n1", "标题一", "<p>正文一</p>");
        await a.sync({ onEmptyCloud: "upload" });
        await a.editNote("n1", "标题一", "<p>正文一改</p>");
        remote.resetCounters();
        remote.injectPutFailures(1, (k) => k.startsWith("objects/n1-"));
        const r1 = await a.sync();
        expect(r1.published).toBe(false); // 正文没落盘 ⇒ 不发布引用它的索引
        // 上传失败的告警当前走一行式 warnings（结构化 warningDetails 只覆盖「跳过类」）。
        expect(r1.warnings.length).toBeGreaterThan(0);
        expect(r1.warnings.join("\n")).toContain("上传失败");
        const r2 = await a.sync(); // 自动恢复：计划已消耗
        expect(r2.published).toBe(true);
        const bodyKeys = [...remote.objects.keys()].filter((k) => k.startsWith("objects/n1-"));
        expect(bodyKeys).toHaveLength(1); // 无重复 body 键（内容寻址）
        expect(new TextDecoder().decode((await remote.get(bodyKeys[0]))!)).toBe("<p>正文一改</p>");
      } finally { await a.close(); }
    }, 180_000);

    it("弱网：拉取连续 2 轮正文 GET 失败 → 每轮部分应用+警告，第 3 轮补齐且已下载正文不重下", async () => {
      const remote = new MemoryRemote();
      const a = await newDevice(make, remote);
      const b = await newDevice(make, remote);
      const enc = (s: string) => new TextEncoder().encode(s);
      const key1 = lakeBodyKey("n1", sha256Hex(enc("<p>正文一</p>")));
      const key2 = lakeBodyKey("n2", sha256Hex(enc("<p>正文二</p>")));
      try {
        await a.seedNote("n1", "标题一", "<p>正文一</p>");
        await a.seedNote("n2", "标题二", "<p>正文二</p>");
        await a.sync({ onEmptyCloud: "upload" });
        remote.resetCounters();
        for (let round = 0; round < 2; round++) {
          remote.injectGetFailures(1, (k) => k === key2);
          const r = await b.sync();
          expect(r.warningDetails.some((w) => w.noteId === "n2")).toBe(true);
          expect(await b.readBody("n1")).toBe("<p>正文一</p>"); // 部分应用
        }
        await b.sync();
        expect(await b.readBody("n2")).toBe("<p>正文二</p>");
        expect(remote.getsByKey.get(key1)).toBe(1); // 已下载正文不重下
        expect(remote.getsByKey.get(key2)).toBe(3); // 两轮失败 + 第三轮成功
      } finally { await a.close(); await b.close(); }
    }, 240_000);

    it("弱网：延迟 + 索引 GET 失败 1 次 → 本次可重试失败，下一轮收敛", async () => {
      const remote = new MemoryRemote();
      const a = await newDevice(make, remote);
      const b = await newDevice(make, remote);
      try {
        await a.seedNote("n1", "标题一", "<p>正文一</p>");
        await a.sync({ onEmptyCloud: "upload" });
        remote.latencyMs = 2;
        remote.injectGetFailures(1, (k) => k.startsWith("meta/index/"));
        await expect(b.sync()).rejects.toThrow();
        remote.latencyMs = 0;
        await b.sync();
        expect(await b.listActiveIds()).toContain("n1");
        expect(await b.readBody("n1")).toBe("<p>正文一</p>");
      } finally { await a.close(); await b.close(); }
    }, 180_000);

    // 261027 已修：附件失败会记进「待补资产账本」，下一轮同步开头自动重试（成功销账、失败 attempts+1）。
    it("弱网：附件下载失败 → 警告 + 下轮自动同步补齐字节一致", async () => {
      const remote = new MemoryRemote();
      const a = await newDevice(make, remote);
      const b = await newDevice(make, remote);
      const img = new Uint8Array([1, 31, 139, 8, 0, 2, 3, 4, 250, 255]);
      try {
        await a.seedNote("n1", "带图文档", "<p>正文一</p>");
        await a.seedAsset("n1", "a.png", img);
        await a.sync({ onEmptyCloud: "upload" });
        remote.resetCounters();
        remote.injectGetFailures(1, (k) => k === "assets/n1/a.png");
        const r1 = await b.sync();
        expect(r1.warningDetails.some((w) => w.kind === "asset_missing" && w.filename === "a.png")).toBe(true);
        await b.sync();
        const got = await b.readAsset("n1", "a.png");
        expect(got).not.toBeNull();
        expect(Array.from(got as Uint8Array)).toEqual(Array.from(img));
        expect(remote.getsByKey.get("assets/n1/a.png")).toBe(2);
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