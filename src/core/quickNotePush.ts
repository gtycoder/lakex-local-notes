/**
 * 单条小记推送（用户 261013 需求：「保存并同步」按钮 —— 只把当前这条小记推到 S3，不管别的小记）。
 *
 * ## 为什么不是"调一次完整同步"
 * 完整同步要扫全部小记（读盘、比对、上传差异、下载对账），大库下慢且不可预期；
 * 这里只处理**一条**：对象按内容哈希寻址 ⇒ PUT 幂等，天然适合"只推这一条"。
 *
 * ## 铁律：读远端清单 → **只 upsert 这一条** → 写回
 * 小记清单是**单文件覆盖写、没有 CAS**（quick-notes/manifests/latest.json）。
 * 所以**绝不能**写一份"只含当前小记"的清单 —— 那等于向所有端声明"小记全集就这一条"，
 * 他端会把未声明的小记按"云端没有"处理（墓碑/GC 误删）。这与完整同步里
 * "远端 active 但本地本轮未持有的条目必须原样保留"（quickNotesSyncEngine P1-1）是同一条原则。
 * 护栏见 quickNotePush.test.ts 的「其余条目逐字节不变」。
 *
 * ## 两条退回完整同步的路径（都不静默降级）
 * 1. 云端**还没有清单**（首次同步）：写"只有这一条"的清单等于谎称全集 ⇒ 退回一次完整同步建立正确清单；
 * 2. 该条在远端是**墓碑**且本机没有显式恢复标记：墓碑权威（AGENTS §3#3，删除压编辑）⇒ 不许复活，
 *    退回完整同步让既有的墓碑/恢复语义处理。
 *
 * ## 记账走 I2 守卫
 * setBaseHash + markSyncedGuarded（"未变才标"）：推送期间用户又编辑 ⇒ 不标 synced，下轮重传（不丢编辑）。
 */
import { sha256Sync } from "./sha256Sync.js";
import type { ManifestItem, QuickNotesManifest } from "./manifestTypes.js";
import {
  MAX_QUICK_MANIFEST_BYTES,
  markSyncedGuarded,
  parseManifest,
  randomUUID,
  syncQuickNotesViaEngine,
  type QuickNotesSyncDbPort,
  type QuickNotesSyncResult,
} from "./quickNotesSyncEngine.js";
import type { S3Store, SyncConfig } from "./syncEngine.js";
import { quickNoteKeys } from "./quickNoteKeys.js";

/** 单条推送的结果。full-sync = 按上文两条路径退回了一次完整小记同步。 */
export type QuickNotePushOutcome =
  | { status: "pushed"; uploadedContent: boolean; uploadedAssets: number; unchanged: boolean; manifestId: string | null }
  | { status: "full-sync"; reason: "no-remote-manifest" | "remote-deleted"; result: QuickNotesSyncResult }
  | { status: "not-found" };

/**
 * 把某一条小记推送到 S3（含其图片），并把它 upsert 进远端清单。
 * 其它小记在云端**逐字段保持原样**；Lake 侧完全不受影响（小记是独立子空间）。
 */
export async function pushQuickNote(
  cfg: SyncConfig,
  s3: S3Store,
  qn: QuickNotesSyncDbPort,
  id: string,
): Promise<QuickNotePushOutcome> {
  // 小记 key 布局的单一来源（单条推送与整轮同步必须指向同一批对象）
  const { objectKey, assetKey, manifestKey } = quickNoteKeys(cfg.prefix);

  const local = (await qn.listLocalQuickNotes()).find((item) => item.id === id);
  if (!local) return { status: "not-found" };

  const content = await qn.readContent(id);
  if (content === null) throw new Error(`本地小记内容读取失败: ${id}`);
  const contentHash = sha256Sync(content);
  if (contentHash !== local.contentHash) throw new Error(`本地小记索引与内容不一致: ${id}`);

  const rawManifest = await s3.getObject(manifestKey, { maxBytes: MAX_QUICK_MANIFEST_BYTES });
  if (!rawManifest) {
    return { status: "full-sync", reason: "no-remote-manifest", result: await syncQuickNotesViaEngine(cfg, s3, qn) };
  }
  // 清单解析失败（含重复 ID）属云端数据异常：抛出，不静默降级（与完整同步同口径）
  const remote = parseManifest(rawManifest);
  const remoteItem = remote.items.find((item) => item.id === id);

  if (remoteItem?.deleted && !(await qn.isRestorePending(id))) {
    return { status: "full-sync", reason: "remote-deleted", result: await syncQuickNotesViaEngine(cfg, s3, qn) };
  }

  const assets: ManifestItem["assets"] = local.images.map(({ id: imageId, filename, mimeType, width, height, size, hash }) => ({ id: imageId, filename, mimeType, width, height, size, hash }));
  const activeRemote = remoteItem && !remoteItem.deleted ? remoteItem : null;

  let uploadedContent = false;
  if (!activeRemote || activeRemote.contentHash !== contentHash) {
    await s3.putObject(objectKey(contentHash), content);
    uploadedContent = true;
  }

  const remoteAssetHashes = new Map((activeRemote?.assets ?? []).map((asset) => [asset.filename, asset.hash] as const));
  let uploadedAssets = 0;
  for (const asset of assets) {
    const bytes = await qn.readAsset(id, asset.filename);
    if (bytes === null) throw new Error(`本地小记图片缺失: ${id}/${asset.filename}`);
    if (bytes.length !== asset.size || sha256Sync(bytes) !== asset.hash) throw new Error(`本地小记图片校验失败: ${id}/${asset.filename}`);
    if (remoteAssetHashes.get(asset.filename) === asset.hash) continue;
    await s3.putObject(assetKey(id, asset.filename), bytes);
    uploadedAssets += 1;
  }

  const signature = (list: Array<{ filename: string; hash: string }>) => list.map((a) => `${a.filename}:${a.hash}`).sort().join("|");
  // 已是最新（远端同 id、同正文、同图片集）⇒ 不写清单：避免"没改动也产生一次清单写入"给多端 GC 添噪声。
  const unchanged = activeRemote !== null && activeRemote.contentHash === contentHash && signature(activeRemote.assets) === signature(assets);

  let manifestId: string | null = null;
  if (!unchanged) {
    const nextItem: ManifestItem = {
      id, createdAt: local.createdAt, updatedAt: local.updatedAt,
      contentHash, isConflict: local.isConflict, assets,
    };
    const items = remote.items.some((item) => item.id === id)
      ? remote.items.map((item) => (item.id === id ? nextItem : item))
      : [...remote.items, nextItem];
    const manifest: QuickNotesManifest = {
      version: remote.version,
      workspaceId: remote.workspaceId,
      commitId: randomUUID(),
      createdAt: new Date().toISOString(),
      items,
    };
    await s3.putObject(manifestKey, `${JSON.stringify(manifest, null, 2)}\n`, { gzip: true });
    manifestId = manifest.commitId;
  }

  await qn.setBaseHash(id, contentHash);
  await markSyncedGuarded(qn, id, contentHash);
  qn.log(`[perf] quick-push ${id} content=${uploadedContent ? "up" : "skip"} assets=${uploadedAssets} manifest=${unchanged ? "skip" : manifestId}`);
  return { status: "pushed", uploadedContent, uploadedAssets, unchanged, manifestId };
}
