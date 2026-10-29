import { HISTORY_SNAPSHOT_PROTECT_DAYS, type DeviceBaseline, type DeviceState, type S3v3DeviceStore } from "../../core/s3v3DeviceStore.js";
import { normalizeNoteKind, type NoteKind } from "../../core/noteKind.js";
import type { MobileDb } from "../data/sqliteDb.js";
import {
  clearStagingBodies, readBodyStaging, readBodyStagingMany,
  readNoteBody, readNoteBodiesBatch, readQuickNoteBody, removeBodyStaging, statBodyStagingMany, statNoteBodiesBatch,
  statQuickNoteBodiesBatch, writeBodyStaging, writeQuickNoteBody,
} from "../data/noteBodies.js";
import { ensureV3StateTable, loadV3State, readRawV3State, savePersistedV3State, saveV3State, type MobileV3Baseline } from "../data/v3StateRepository.js";
import { createDeviceStoreMeta, createFileBackedAssetIo, type AssetIoPort, type DeviceStoreMeta } from "../../core/s3v3/state/deviceStore.js";
import { createCapacitorAssetFileDriver } from "./capacitorAssetFileDriver.js";
import { createMobilePlatformPort, createMobileBodyFileDriver, type MobilePlatformPortContext } from "./mobilePlatformPort.js";
import { listQuickNoteAssetKeysFs, loadAssetBytesFs, removeAssetBytesFs, saveAssetBytesFs } from "../native/assetFs.js";
import { NativeAssetSync, nativeAssetSyncSupported } from "../native/nativeAssetSync.js";
import * as historyRepository from "../data/historyRepository.js";

/**
 * 移动端 S3v3DeviceStore（E2-4 phase C）：**只做端口装配与正文 staging**，
 * loadState/saveState 的决策/映射/落库顺序全部在 core 单一编排（createDeviceStoreMeta）。
 * - 元数据/正文：notes 表 + BodyStore；正文下载先落 staging 文件，saveState 时由端口钩子搬到最终路径；
 * - 同步账本：sync_v3_state（v2 信封 + baseline）；
 * - 「云端已删除·仅本地」：state.remotePurged ↔ notes/folders/quick_notes.cloud_deleted（DB 投影，UI 徽标读它）；
 *   小记副本保留在 quick 回收站（deleted_at 非空、正文/图片/标签不删），恢复并上传成功后清空标记；
 * - 写侧细节（批量 executeSet 窗口、legacy 正文批写、移动旧口径回收站/小记删除）在 mobilePlatformPort。
 */

export class MobileDeviceStore implements S3v3DeviceStore {
  private readonly db: MobileDb;
  /**
   * 同步下载的正文先落 staging/<id>.body（见 noteBodies staging 注释），这里只记 id；
   * 不在 JS 内存里攒字节（261027 真机 OOM：增量拉 1852 篇正文时单次 writeMany ~300MB JSON）。
   */
  private stagedBodyIds = new Set<string>();
  /** 旧路径残留（兼容测试/历史调用）：新代码不再使用。 */
  private stagedBodies = new Map<string, Uint8Array>();
  private stagedDeletes = new Set<string>();
  private stagedQuickBodies = new Map<string, Uint8Array>();
  private stagedQuickDeletes = new Set<string>();
  /**
   * 本地资产名缓存（261026）：一次原生 listAllAssets 替代「每篇一次 readdir 桥」。
   * 同步期间资产目录只增不减（下载走原生直写，不走 writeAsset），缓存足够用来算差集；
   * 本地新增/删除资产（writeAsset/deleteAssetsDir）会让缓存失效。
   */
  private assetNames: Promise<{ notes: Map<string, string[]>; quick: Map<string, string[]> }> | null = null;

  /** E2-4 phase C：端口写批上下文（本轮标记 + staging id；saveState 入口重置，端口写侧读取）。 */
  private readonly portCtx: MobilePlatformPortContext;

  /** E2-4：资产 IO 已是 core 的单一实现；这里只给「资产键空间驱动 + 缓存失效」钩子。 */
  private readonly assetIo: AssetIoPort;
  /** E2-4 phase C：loadState/saveState 的共享编排（本类只提供窄端口）。 */
  private readonly meta: DeviceStoreMeta;

  constructor(db: MobileDb) {
    this.db = db;
    this.portCtx = {
      stagedBodyIds: this.stagedBodyIds,
      stagedBodies: this.stagedBodies,
      remotePurged: new Set<string>(),
      remoteTrashedAt: new Map<string, string>(),
      newlyCloudDeletedQuick: new Set<string>(),
    };
    this.assetIo = createFileBackedAssetIo({
      files: createCapacitorAssetFileDriver({
        // 原生 listAllAssets 缓存（性能关键）；未挂载/旧 APK ⇒ null 回退逐篇扫描。
        listAllNames: async () => (nativeAssetSyncSupported() ? await this.loadAssetNames() : null),
        invalidateNames: () => this.invalidateAssetNames(),
      }),
      assetDirFor: (id: string) => "assets/" + id,
      quickAssetDirFor: (id: string) => "quick/" + id,
    });
    this.meta = createDeviceStoreMeta({
      platform: createMobilePlatformPort(db, this.portCtx),
      // 小记正文本轮写入在内存 staging（writeQuickBody）⇒ 驱动先看 staging，否则共享编排会当成缺正文跳过。
      files: createMobileBodyFileDriver(db, { stagedQuickBodies: () => this.stagedQuickBodies }),
      assets: this.assetIo,
      state: {
        read: () => readRawV3State(db),
        // baseline 与本行同 JSON 是既有约定（E3-1「baseline 不动」）：core 只生成信封，落盘归本端。
        write: async (persisted) => {
          const side = await loadV3State(db);
          await savePersistedV3State(db, persisted, side.baseline ?? null);
        },
      },
      baseline: { load: async () => (await loadV3State(db)).baseline },
      // 正文 staging 在文件（stagedBodyIds），旧内存 map 仅兼容；saveState 消费后整份清空（与旧实现一致）。
      stagedBodies: {
        get: (id) => this.stagedBodies.get(id),
        has: (id) => this.stagedBodyIds.has(id),
        clear: () => {
          this.stagedBodyIds.clear();
          this.stagedBodies.clear();
          this.stagedDeletes.clear();
          this.stagedQuickBodies.clear();
          this.stagedQuickDeletes.clear();
        },
      },
      log: (message: string) => console.info(message),
    });
  }

  async init(): Promise<void> {
    await ensureV3StateTable(this.db);
    // 上一轮崩溃可能留下 staging 正文；清理后由云端按 hash 重新下载。
    await clearStagingBodies().catch(() => undefined);
  }

  private async kindOf(id: string): Promise<NoteKind> {
    const row = await this.db.prepare("SELECT doc_kind FROM notes WHERE id=?").get(id) as { doc_kind?: string | null } | undefined;
    return normalizeNoteKind(row?.doc_kind);
  }

  /**
   * E2-4 phase C：loadState/saveState 都是 core 单一编排（createDeviceStoreMeta）。
   * 本适配器只提供移动版 PlatformDataPort + 正文 FileDriver + 信封读写端口。
   */
  async loadState(): Promise<DeviceState | null> { return await this.meta.loadState(); }

  /**
   * E2-4 phase C-3b-2：saveState 已上收到 core 单一编排（createDeviceStoreMeta.saveState）。
   * 本类只做「本轮标记交给端口 + 交给共享编排」，不再自带任何落库决策/SQL。
   * 逐字段等价性由 mobile/v3 的对拍用例（conformance.mobile / mobileCloudDeleted / remParity / historySnapshot）
   * 与 deviceStoreMeta 的内存端口测试共同锁住。
   */
  async saveState(state: DeviceState): Promise<void> {
    // 本轮标记（与迁移前同一口径）：文档按 state.remotePurged 分派「云端已删除·仅本地」副本；
    // 回收站时间戳落远端 trashedAt（不是本地 now）；投影再并入本轮新打标的小记副本。
    // 端口持有的是同一批 Set/Map 实例 ⇒ 必须原地 clear+add（重新赋值不会同步给端口）。
    this.portCtx.remotePurged.clear();
    for (const id of state.remotePurged ?? []) this.portCtx.remotePurged.add(id);
    this.portCtx.remoteTrashedAt.clear();
    for (const n of state.lake.notes) if (n.trashedAt) this.portCtx.remoteTrashedAt.set(n.id, n.trashedAt);
    this.portCtx.newlyCloudDeletedQuick.clear();
    await this.meta.saveState(state);
  }

  async loadBaseline(): Promise<DeviceBaseline | null> {
    const s = await loadV3State(this.db);
    return (s.baseline as DeviceBaseline | null) ?? null;
  }
  async saveBaseline(baseline: DeviceBaseline): Promise<void> {
    const s = await loadV3State(this.db);
    // 发布成功后才写 baseline：此时这些条目已与云端一致，必须清 UI 待同步标记；
    // 否则 is_dirty 永远停在 1（同步候选虽由三方比对得出，UI 会一直显示“待同步”）。
    const sets: Array<{ sql: string; ids: string[] }> = [
      { sql: "UPDATE notes SET is_dirty=0, restore_pending_at=NULL WHERE is_purged=0 AND id IN (", ids: baseline.lake.notes.map((n) => n.id) },
      { sql: "UPDATE folders SET is_dirty=0 WHERE is_purged=0 AND id IN (", ids: baseline.lake.folders.map((f) => f.id) },
      { sql: "UPDATE quick_notes SET is_dirty=0, restore_pending_at=NULL WHERE id IN (", ids: baseline.quickNotes.items.map((q) => q.id) },
    ];
    await this.db.transaction(async () => {
      for (const { sql, ids } of sets) {
        for (let i = 0; i < ids.length; i += 400) {
          const part = ids.slice(i, i + 400);
          if (part.length === 0) continue;
          const ph = part.map(() => "?").join(",");
          await this.db.prepare(sql + ph + ")").run(...part);
        }
      }
    });
    await saveV3State(this.db, { ...s, baseline: baseline as MobileV3Baseline });
  }

  async readBody(id: string): Promise<Uint8Array | null> {
    if (this.stagedBodyIds.has(id)) return await readBodyStaging(id);
    const staged = this.stagedBodies.get(id);
    if (staged) return staged;
    if (this.stagedDeletes.has(id)) return null;
    const content = await readNoteBody(await this.kindOf(id), id);
    return content == null ? null : new TextEncoder().encode(content);
  }
  /**
   * 批量读正文（261026 续传提速）：doc_kind 用**一条 SQL** 查齐，正文用**一次 BodyStore.readMany**；
   * 替代「每篇一次 SQL + 一次桥读」。staged 状态优先（与 readBody 同语义）。
   */
  async readBodies(ids: string[]): Promise<Array<Uint8Array | null>> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = await this.db.prepare("SELECT id,doc_kind FROM notes WHERE id IN (" + placeholders + ")").all(...ids) as Array<{ id: string; doc_kind: string | null }>;
    const kindById = new Map(rows.map((row) => [row.id, normalizeNoteKind(row.doc_kind)] as const));
    const stagedIds = ids.filter((id) => this.stagedBodyIds.has(id));
    const stagedBodies = await readBodyStagingMany(stagedIds);
    const stagedById = new Map(stagedIds.map((id, index) => [id, stagedBodies[index]] as const));
    const normalIds = ids.filter((id) => !this.stagedBodyIds.has(id));
    const normalKind = normalIds.map((id) => ({ kind: kindById.get(id) ?? "doc", id }));
    const normalTexts = await readNoteBodiesBatch(normalKind);
    const normalById = new Map(normalIds.map((id, index) => [id, normalTexts[index]] as const));
    return ids.map((id) => {
      if (this.stagedBodyIds.has(id)) return stagedById.get(id) ?? null;
      const staged = this.stagedBodies.get(id);
      if (staged) return staged;
      if (this.stagedDeletes.has(id)) return null;
      const text = normalById.get(id) ?? null;
      return text == null ? null : new TextEncoder().encode(text);
    });
  }
  async readQuickBodies(ids: string[]): Promise<Array<Uint8Array | null>> {
    const out: Array<Uint8Array | null> = [];
    for (const id of ids) out.push(await this.readQuickBody(id));
    return out;
  }
  /** 批量 stat 正文（261026 续传提速）：与 readBodies 同样一条 SQL 查 kind + 一次原生 stat。 */
  async statBodies(ids: string[]): Promise<Array<{ exists: boolean; size: number }>> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = await this.db.prepare("SELECT id,doc_kind FROM notes WHERE id IN (" + placeholders + ")").all(...ids) as Array<{ id: string; doc_kind: string | null }>;
    const kindById = new Map(rows.map((row) => [row.id, normalizeNoteKind(row.doc_kind)] as const));
    const stagedIds = ids.filter((id) => this.stagedBodyIds.has(id));
    const normalIds = ids.filter((id) => !this.stagedBodyIds.has(id));
    const stagedStats = await statBodyStagingMany(stagedIds);
    const normalStats = await statNoteBodiesBatch(normalIds.map((id) => ({ kind: kindById.get(id) ?? "doc", id })));
    const stagedById = new Map(stagedIds.map((id, index) => [id, stagedStats[index]] as const));
    const normalById = new Map(normalIds.map((id, index) => [id, normalStats[index]] as const));
    return ids.map((id) => {
      if (this.stagedBodyIds.has(id)) return stagedById.get(id) ?? { exists: false, size: 0 };
      if (this.stagedBodies.has(id)) return { exists: true, size: this.stagedBodies.get(id)!.length };
      if (this.stagedDeletes.has(id)) return { exists: false, size: 0 };
      return normalById.get(id) ?? { exists: false, size: 0 };
    });
  }
  async statQuickBodies(ids: string[]): Promise<Array<{ exists: boolean; size: number }>> {
    const stats = await statQuickNoteBodiesBatch(ids);
    return stats.map((st, index) => {
      const id = ids[index];
      if (this.stagedQuickBodies.has(id)) return { exists: true, size: this.stagedQuickBodies.get(id)!.length };
      if (this.stagedQuickDeletes.has(id)) return { exists: false, size: 0 };
      return st;
    });
  }
  async writeBody(id: string, bytes: Uint8Array): Promise<void> {
    // 立即写 staging 文件（不占 JS 内存），saveState 时再原子 move 到最终路径。
    this.stagedDeletes.delete(id);
    this.stagedBodies.delete(id);
    this.stagedBodyIds.add(id);
    await writeBodyStaging(id, new TextDecoder().decode(bytes));
  }
  async deleteBody(id: string): Promise<void> {
    this.stagedBodyIds.delete(id);
    this.stagedBodies.delete(id);
    this.stagedDeletes.add(id);
    await removeBodyStaging(id).catch(() => undefined);
  }
  /**
   * v3 覆盖留档（parity F1）：被远端覆盖/远端彻底删除前把本地版本写进移动端历史库。
   * - Lake 文档：走 historyRepository.createHistorySnapshot（受保护 30 天，清理不会先清它）；
   * - 小记：产品定稿「小记没有历史快照」（随手记语义），返回占位值，调用方不视为失败。
   * best-effort：写历史失败不得中断同步（宁可少一份快照，不可让同步失败）。
   */
  async writeHistory(id: string, bytes: Uint8Array): Promise<string> {
    if (id.startsWith("quick-")) return "quick-note-history-skip";
    try {
      const row = await this.db.prepare("SELECT title,parent_id,sort_order FROM notes WHERE id=?").get(id) as
        { title?: string; parent_id?: string | null; sort_order?: number } | undefined;
      if (!row) return "mobile-v3-history-skip";
      await historyRepository.createHistorySnapshot(this.db, id, new TextDecoder().decode(bytes), {
        title: row.title ?? id,
        parentId: row.parent_id ?? null,
        sortOrder: row.sort_order ?? 0,
        protectedDays: HISTORY_SNAPSHOT_PROTECT_DAYS,
      });
      return id;
    } catch (e) {
      console.warn("[v3][history] 写历史快照失败（跳过，不影响同步）:", (e as Error).message);
      return "mobile-v3-history-skip";
    }
  }
  async archiveBody(id: string, bytes: Uint8Array | null): Promise<void> {
    if (bytes) await this.writeHistory(id, bytes);
  }

  private async loadAssetNames(): Promise<{ notes: Map<string, string[]>; quick: Map<string, string[]> }> {
    if (!this.assetNames) {
      this.assetNames = (async () => {
        const out = { notes: new Map<string, string[]>(), quick: new Map<string, string[]>() };
        if (!nativeAssetSyncSupported()) return out;
        try {
          const res = await NativeAssetSync.listAllAssets();
          for (const [id, names] of Object.entries(res.notes ?? {})) out.notes.set(id, [...names].sort());
          for (const [id, names] of Object.entries(res.quickNotes ?? {})) out.quick.set(id, [...names].sort());
        } catch { /* 原生不可用/旧 APK：回退逐篇扫描 */ }
        return out;
      })();
    }
    return this.assetNames;
  }

  private invalidateAssetNames(): void { this.assetNames = null; }

  async listAssets(id: string): Promise<string[]> { return this.assetIo.listAssets(id); }
  /** 原生「文件名→size/sha256」清单：附件差集不必把字节读回 JS（原 P0 大热点）。 */
  async listAssetStats(id: string): Promise<Array<{ filename: string; size: number; hash: string }>> {
    if (!nativeAssetSyncSupported()) throw new Error("native asset stats unsupported");
    const res = await NativeAssetSync.listAssets({ noteId: id });
    return res.assets.map((a) => ({ filename: a.filename, size: Number(a.size), hash: a.hash }));
  }
  async listQuickAssetStats(id: string): Promise<Array<{ filename: string; size: number; hash: string }>> {
    if (!nativeAssetSyncSupported()) throw new Error("native asset stats unsupported");
    const res = await NativeAssetSync.listQuickAssets({ noteId: id });
    return res.assets.map((a) => ({ filename: a.filename, size: Number(a.size), hash: a.hash }));
  }
  // ===== E2-4：资产 IO = core 单一实现（这里只委托）=====
  async readAsset(id: string, filename: string): Promise<Uint8Array | null> { return this.assetIo.readAsset(id, filename); }
  async writeAsset(id: string, filename: string, bytes: Uint8Array): Promise<void> { return this.assetIo.writeAsset(id, filename, bytes); }
  async deleteAssetsDir(id: string): Promise<void> { return this.assetIo.deleteAssetsDir(id); }

  async readQuickBody(id: string): Promise<Uint8Array | null> {
    const staged = this.stagedQuickBodies.get(id);
    if (staged) return staged;
    if (this.stagedQuickDeletes.has(id)) return null;
    const content = await readQuickNoteBody(id);
    return content == null ? null : new TextEncoder().encode(content);
  }
  async writeQuickBody(id: string, bytes: Uint8Array): Promise<void> {
    this.stagedQuickBodies.set(id, bytes);
    this.stagedQuickDeletes.delete(id);
  }
  async deleteQuickBody(id: string): Promise<void> {
    this.stagedQuickBodies.delete(id);
    this.stagedQuickDeletes.add(id);
  }
  async listQuickAssets(id: string): Promise<string[]> { return this.assetIo.listQuickAssets(id); }
  async readQuickAsset(id: string, filename: string): Promise<Uint8Array | null> { return this.assetIo.readQuickAsset(id, filename); }
  async writeQuickAsset(id: string, filename: string, bytes: Uint8Array): Promise<void> { return this.assetIo.writeQuickAsset(id, filename, bytes); }
  async deleteQuickAssetsDir(id: string): Promise<void> { return this.assetIo.deleteQuickAssetsDir(id); }

  /** 单条推送记账（I2）：内容 hash 未变才清 dirty，同时清显式恢复标记。 */
  async markQuickNoteSynced(id: string, expectedContentHash: string): Promise<void> {
    await this.db.prepare("UPDATE quick_notes SET is_dirty=0, restore_pending_at=NULL WHERE id=? AND content_hash=?").run(id, expectedContentHash);
  }

  /** P0-4：原生流式资产的 localKey（相对 note-assets 根，如 `<id>/<file>`）；非原生平台返回 null。 */
  async assetNativePath(id: string, filename: string): Promise<string | null> {
    return await this.assetNativePathFor("lake", id, filename);
  }

  /** 261027：原生 AssetSync 的 localKey 现在是「相对 filesDir 的完整路径」——
   *  lake = note-assets/<id>/<file>，quickNotes = quick-notes/assets/<id>/<file>（与 Kotlin 侧 canonical 校验一致）。 */
  async assetNativePathFor(space: "lake" | "quickNotes", id: string, filename: string): Promise<string | null> {
    if (!nativeAssetSyncSupported()) return null;
    if (!/^[A-Za-z0-9._-]+$/.test(id) || !/^[A-Za-z0-9._-]+$/.test(filename)) return null;
    return space === "lake" ? "note-assets/" + id + "/" + filename : "quick-notes/assets/" + id + "/" + filename;
  }

  /** 轻量落盘同步标记：不跑整轮 saveState（不碰正文/脏标记），只清 v3_state 标记 + DB cloud_deleted 投影。 */
  async persistSyncMarkers(markers: { remotePurged: string[]; restorePending: string[] }): Promise<void> {
    const side = await loadV3State(this.db);
    await this.db.transaction(async () => {
      await this.db.prepare("UPDATE notes SET cloud_deleted=0 WHERE cloud_deleted=1").run();
      await this.db.prepare("UPDATE folders SET cloud_deleted=0 WHERE cloud_deleted=1").run();
      await this.db.prepare("UPDATE quick_notes SET cloud_deleted=0 WHERE cloud_deleted=1").run();
      for (let i = 0; i < markers.remotePurged.length; i += 400) {
        const part = markers.remotePurged.slice(i, i + 400);
        if (part.length === 0) continue;
        const ph = part.map(() => "?").join(",");
        await this.db.prepare("UPDATE notes SET cloud_deleted=1 WHERE id IN (" + ph + ")").run(...part);
        await this.db.prepare("UPDATE folders SET cloud_deleted=1 WHERE id IN (" + ph + ")").run(...part);
        await this.db.prepare("UPDATE quick_notes SET cloud_deleted=1 WHERE id IN (" + ph + ")").run(...part);
      }
    });
    await saveV3State(this.db, { ...side, remotePurged: markers.remotePurged, restorePending: markers.restorePending });
  }

  /**
   * 小记冲突副本（C8，移动端）：双端同改、远端胜出时把本地版本归档进小记回收站。
   * 语义对齐桌面 quickNotes.archiveLocalToTrash：新 id、纯本地（ready_to_sync=0，不向云端发布删除）、
   * 正文与图片按新 id 复制、标签关系一并复制（恢复后是一条带标签的新小记）。
   * 归档后删除旧 id 的图片目录：随后引擎会用远端正文/资源覆盖原条目，留着旧图会被下一轮误声明上传。
   */
  async archiveQuickNote(id: string): Promise<void> {
    const row = await this.db.prepare("SELECT created_at,updated_at,preview_text,image_count,content_hash FROM quick_notes WHERE id=?").get(id) as
      { created_at: string; updated_at: string; preview_text: string; image_count: number; content_hash: string } | undefined;
    if (!row) return;
    const body = await readQuickNoteBody(id);
    if (body == null) return;
    const newId = globalThis.crypto.randomUUID();
    await writeQuickNoteBody(newId, body);
    const oldPrefix = "quick-notes/" + id + "/";
    const oldKeys = await listQuickNoteAssetKeysFs(id);
    for (const key of oldKeys) {
      const bytes = await loadAssetBytesFs(key);
      if (bytes) await saveAssetBytesFs("quick-notes/" + newId + "/" + key.slice(oldPrefix.length), bytes);
    }
    const now = new Date().toISOString();
    const tagRows = await this.db.prepare("SELECT tag_id FROM tag_links WHERE target_kind='quickNote' AND target_id=? ORDER BY position").all(id) as Array<{ tag_id: string }>;
    await this.db.transaction(async () => {
      await this.db.prepare(
        "INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict,restore_pending_at,deleted_at,ready_to_sync) VALUES (?,?,?,?,?,?,1,0,NULL,?,0)"
      ).run(newId, row.created_at, now, row.preview_text, row.image_count, row.content_hash, now);
      for (let i = 0; i < tagRows.length; i++) {
        await this.db.prepare("INSERT OR IGNORE INTO tag_links (target_kind,target_id,tag_id,position) VALUES ('quickNote',?,?,?)").run(newId, tagRows[i].tag_id, i);
      }
      if (tagRows.length > 0) {
        await this.db.prepare("INSERT INTO tag_link_versions (target_kind,target_id,links_updated_at) VALUES ('quickNote',?,?) ON CONFLICT(target_kind,target_id) DO UPDATE SET links_updated_at=excluded.links_updated_at").run(newId, now);
      }
    });
    for (const key of oldKeys) await removeAssetBytesFs(key);
  }

}
