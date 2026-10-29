/**
 * 引擎端口 → v4 `RoundPorts` 的适配器（E2-3 切换的最后一层接线）。
 *
 * 为什么单独成文件而不是直接塞进引擎：`S3v3DeviceStore`（20+ 可选方法、原生流式/批量退化）与
 * `S3v3Remote`（gzip 标记、原生 getToFile）是既有的复杂端口；四相只需要其中**很小**的一部分。
 * 把「用哪些、怎么退化」写死在这里，引擎那边最后就只剩一次 `runSyncRound(createRoundPorts(...))`。
 *
 * 退化规则（与 v3 引擎一致，改这里等于改同步语义）：
 *  - 资产清单优先 `listAssetStats`（原生 filename→size/sha256，不读字节）；缺失/异常 ⇒ 退化为
 *    `listAssets` + `readAsset` + JS sha256（不得把「读不出字节」当成「没有资产」：直接跳过该文件，
 *    由 applyAssets 的既有规则决定声明是否保留）。
 *  - 归档：Lake 走 `archiveBody(id, null)`（适配器自己读正文留档）；小记走可选的 `archiveQuickNote`，
 *    未实现时退化为 no-op（小记无历史快照，产品定稿）。
 */
import type { S3v3Remote } from "../../s3v3Ports.js";
import type { S3v3DeviceStore } from "../../s3v3DeviceStore.js";
import type { PendingDelete } from "../../s3v3Gate.js";
import { sha256Hex } from "../../syncUtils.js";
import type { AssetDeclEntry } from "../protocol/index.js";
import type { Space } from "../plan/types.js";
import type { IntentLogState } from "./intentLog.js";
import type { RoundPorts } from "./runSyncRound.js";

export interface RoundPortsDeps {
  remote: Pick<S3v3Remote, "get" | "put" | "deleteMany" | "deleteByPrefix"> & Partial<Pick<S3v3Remote, "getRange" | "getToFile" | "putFromFile">>;
  device: Pick<S3v3DeviceStore,
    | "readBody" | "writeBody" | "deleteBody" | "archiveBody"
    | "readQuickBody" | "writeQuickBody" | "deleteQuickBody"
    | "listAssets" | "readAsset" | "writeAsset"
    | "listQuickAssets" | "readQuickAsset" | "writeQuickAsset"> &
    Partial<Pick<S3v3DeviceStore, "listAssetStats" | "listQuickAssetStats" | "archiveQuickNote" | "assetNativePath" | "assetNativePathFor">>;
  /** 大对象 Range 分片阈值（字节；<=0 或缺失 ⇒ 整对象 GET）。 */
  largeAssetChunkBytes?: number;
  loadIntentLog(): Promise<IntentLogState>;
  saveIntentLog(state: IntentLogState): Promise<void>;
  loadPending(): Promise<PendingDelete[]>;
  savePending(pending: PendingDelete[]): Promise<void>;
}

async function localAssets(deps: RoundPortsDeps, space: Space, id: string): Promise<AssetDeclEntry[]> {
  const statsFn = space === "lake" ? deps.device.listAssetStats : deps.device.listQuickAssetStats;
  if (statsFn) {
    try {
      const list = await statsFn.call(deps.device, id);
      return list.map((s) => ({ filename: s.filename, size: s.size, hash: s.hash }));
    } catch { /* 退化到字节路径 */ }
  }
  const filenames = space === "lake" ? await deps.device.listAssets(id) : await deps.device.listQuickAssets(id);
  const out: AssetDeclEntry[] = [];
  for (const filename of filenames) {
    const bytes = space === "lake" ? await deps.device.readAsset(id, filename) : await deps.device.readQuickAsset(id, filename);
    if (!bytes) continue; // 读不出字节 ≠ 没有资产：跳过该文件，交给上层声明保留规则
    out.push({ filename, size: bytes.length, hash: sha256Hex(bytes) });
  }
  return out;
}

export function createRoundPorts(deps: RoundPortsDeps): RoundPorts {
  const { device } = deps;
  return {
    getRemote: (key) => deps.remote.get(key),
    putRemote: (key, bytes, opts) => deps.remote.put(key, bytes, opts),
    deleteRemoteKeys: (keys) => deps.remote.deleteMany(keys),
    deleteRemotePrefix: (prefix) => deps.remote.deleteByPrefix(prefix),

    readLocalBody: (space, id) => (space === "lake" ? device.readBody(id) : device.readQuickBody(id)),
    writeLocalBody: (space, id, bytes) => (space === "lake" ? device.writeBody(id, bytes) : device.writeQuickBody(id, bytes)),
    deleteLocalBody: (space, id) => (space === "lake" ? device.deleteBody(id) : device.deleteQuickBody(id)),
    async archiveLocal(space, id) {
      if (space === "lake") return device.archiveBody(id, await device.readBody(id));
      if (device.archiveQuickNote) return device.archiveQuickNote(id);
      return undefined; // 小记无历史快照（产品定稿）：不留副本
    },

    listLocalAssets: (space, id) => localAssets(deps, space, id),
    listLocalAssetNames: (space, id) => (space === "lake" ? device.listAssets(id) : device.listQuickAssets(id)),
    listLocalAssetStats: device.listAssetStats
      ? async (space, id) => (space === "lake"
        ? (await device.listAssetStats!(id)).map((s) => ({ filename: s.filename, size: s.size, hash: s.hash }))
        : device.listQuickAssetStats ? (await device.listQuickAssetStats(id)).map((s) => ({ filename: s.filename, size: s.size, hash: s.hash })) : [])
      : undefined,
    async readRemoteAsset(key, size, hash) {
      const getRange = deps.remote.getRange;
      const chunk = deps.largeAssetChunkBytes ?? 0;
      if (!getRange || chunk <= 0 || size <= chunk) return deps.remote.get(key);
      const parts = Math.min(8, Math.max(2, Math.ceil(size / chunk)));
      const partSize = Math.ceil(size / parts);
      try {
        const slices = await Promise.all(Array.from({ length: parts }, (_, index) => {
          const start = index * partSize;
          if (start >= size) return Promise.resolve(new Uint8Array(0));
          return getRange.call(deps.remote, key, start, Math.min(size, start + partSize));
        }));
        if (slices.some((slice) => slice === null)) return deps.remote.get(key);
        const total = slices.reduce((sum, slice) => sum + (slice?.length ?? 0), 0);
        if (total !== size) return deps.remote.get(key);
        const out = new Uint8Array(size);
        let offset = 0;
        for (const slice of slices) { if (!slice) continue; out.set(slice, offset); offset += slice.length; }
        if (sha256Hex(out) !== hash) return deps.remote.get(key);
        return out;
      } catch { return deps.remote.get(key); }
    },
    readLocalAsset: (space, id, filename) => (space === "lake" ? device.readAsset(id, filename) : device.readQuickAsset(id, filename)),
    writeLocalAsset: (space, id, filename, bytes) => (space === "lake" ? device.writeAsset(id, filename, bytes) : device.writeQuickAsset(id, filename, bytes)),
    // 原生流式（移动端字节不过 JS 桥；桌面不实现 ⇒ 走字节路径）。
    assetNativePath: async (space, id, filename) => {
      if (device.assetNativePathFor) return device.assetNativePathFor(space, id, filename);
      if (space === "lake" && device.assetNativePath) return device.assetNativePath(id, filename);
      return null;
    },
    getRemoteToFile: (key, destPath, expected) => (deps.remote.getToFile ? deps.remote.getToFile(key, destPath, expected) : Promise.resolve("unsupported" as const)),
    putRemoteFromFile: (key, localPath) => (deps.remote.putFromFile ? deps.remote.putFromFile(key, localPath) : Promise.resolve(false)),

    loadIntentLog: () => deps.loadIntentLog(),
    saveIntentLog: (state) => deps.saveIntentLog(state),
    loadPending: () => deps.loadPending(),
    savePending: (pending) => deps.savePending(pending),
  };
}
