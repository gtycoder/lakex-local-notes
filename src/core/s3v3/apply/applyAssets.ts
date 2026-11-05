/**
 * v4 Apply 的资产段（E2-1b）：消费 plan.publishes + 已取回的声明，只做**声明差集的 PUT/GET**。
 *
 * 规则（AGENTS §3#11 的 v3 语义，原样搬到 applier）：
 *  - 资产按 filename 内容寻址（同名同内容）；差集 = 文件名集合差，**不逐对象 HEAD**；
 *  - 上传侧声明**永远全量**：新声明 = 本机资产全集（filename 升序，规范化序列化）；
 *  - **非法文件名的资产跳过并结构化告警**（P1-7：`asset_invalid_name`，带 filename/原因），本轮继续：
 *    本机侧构建的新声明**只引用能上传的文件名**（声明必须只引用真实存在的对象）；
 *    远端旧声明里的非法名只跳过、不据此改写声明（保留原声明 + 告警，无法构造对象键的文件本来也不可下载）；
 *  - **数据安全**：本机资产为空但云端声明非空 ⇒ 视为「附件未落地」，**不写空声明**（否则下一轮 GC 会把云端附件判孤儿删掉），
 *    改为按云端声明自愈下载并保留原 assetsHash（261026 真机事故的护栏）；
 *  - 下载侧按「filename + size/hash 都相同」跳过；坏字节不落盘（sha256 校验）；
 *  - 幂等：同一 plan 重复应用不产生新的 PUT（已存在且一致的资产跳过）。
 */
import { assetKey, buildAssetDeclaration, declarationHashOf, declarationKey, isValidSafeSegment, quickNoteAssetKey, type AssetDeclEntry } from "../protocol/index.js";
import { sha256Hex } from "../../syncUtils.js";
import { runTransferPipeline } from "../../s3v3Transfer.js";
import type { PlanWarning, Space, SyncPlan } from "../plan/types.js";

/** 资产段需要的最小 IO 面（adapter 侧负责「文件名→本地字节」）。 */
export interface AssetPorts {
  getRemote(key: string): Promise<Uint8Array | null>;
  putRemote(key: string, bytes: Uint8Array): Promise<void>;
  /** 本机资产清单（filename/size/hash）；空数组 = 确实没有文件。 */
  listLocalAssets(space: Space, id: string): Promise<AssetDeclEntry[]>;
  /** 可选快路径：只列文件名（不读字节）。声明里已有的文件名可直接复用远端 size/hash（同名同内容）。 */
  listLocalAssetNames?(space: Space, id: string): Promise<string[]>;
  /** 可选最快路径：原生「filename→size/hash」清单（完全不读字节）。 */
  listLocalAssetStats?(space: Space, id: string): Promise<AssetDeclEntry[]>;
  readLocalAsset(space: Space, id: string, filename: string): Promise<Uint8Array | null>;
  writeLocalAsset(space: Space, id: string, filename: string, bytes: Uint8Array): Promise<void>;
  /** 可选：按 size/hash 读取远端资产（大对象走 Range 分片；缺省退回 getRemote）。 */
  readRemoteAsset?(key: string, size: number, hash: string): Promise<Uint8Array | null>;
  /** 可选：本机原生资产相对路径（移动端 = 跳过 JS 桥）。 */
  assetNativePath?(space: Space, id: string, filename: string): Promise<string | null>;
  /** 可选：原生流式下载到本机路径（字节不进 JS）。 */
  getRemoteToFile?(key: string, destPath: string, expected: { size: number; sha256: string }): Promise<"ok" | "missing" | "corrupt" | "unsupported">;
  /** 可选：原生流式上传本机文件。 */
  putRemoteFromFile?(key: string, localPath: string): Promise<boolean>;
}

export interface AssetContext {
  /** applyPlan 返回的声明（= 远端在用的资产集）。 */
  declarations: Array<{ space: Space; id: string; declHash: string; assets: AssetDeclEntry[] }>;
}

export interface ApplyAssetsOptions {
  concurrency?: number;
  /** 首拉/全量重拉的 lazy 档：只上传声明，不下载媒体（打开文档时再补，v3 deferAssets 同义）。 */
  deferDownloads?: boolean;
  onProgress?: (p: { phase: "asset-put" | "asset-get"; done: number; total: number; bytes: number }) => void;
}

export interface ApplyAssetsResult {
  uploaded: { files: number; bytes: number };
  downloaded: { files: number; bytes: number };
  /** 声明 hash 落到索引条目的结果（Commit 消费）；本机无资产且云端有声明时不出现（保留远端 hash）。 */
  assetsHashes: Array<{ space: Space; id: string; assetsHash: string | undefined }>;
  warnings: PlanWarning[];
  errors: Array<{ op: string; detail?: string; error: unknown }>;
  /** 下载失败/缺失的资产（引擎据此落 pendingAssets 账本，下一轮开头重试）。 */
  failedDownloads: Array<{ space: Space; id: string; filename: string; size: number; hash: string }>;
}

const DEFAULT_CONCURRENCY = 8;

const byFilename = (a: AssetDeclEntry, b: AssetDeclEntry) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0);

/**
 * 资产文件名能否进 S3 key（P1-7）：与 `assetKey` 的段校验**同一判据**（`isValidSafeSegment`）。
 * 非法名（空格/中文/超长/遍历）不能靠 try/catch 兜：那样只会进 errors（引擎不消费 ⇒ UI 静默），
 * 还会让「声明引用一个永远传不上去的对象」。所以这里**先判后跳**：跳过该文件并给结构化 warning，
 * 其余资产照常上传/下载，本轮继续。
 */
function isUsableAssetFilename(filename: string): boolean {
  if (typeof filename !== "string" || !isValidSafeSegment(filename)) return false;
  // 超长名（> 主流文件系统单段 255 字节上限）无法稳定落盘/构造对象，同样按非法名跳过并告警。
  return new TextEncoder().encode(filename).length <= MAX_ASSET_FILENAME_BYTES;
}

/** 资产文件名长度上限（字节）：超长名在落盘/对象键上都会失败，必须与「字符白名单」一起判。 */
const MAX_ASSET_FILENAME_BYTES = 255;

/** 差集：本机有、云端声明里没有的资产（按 filename）。 */
function missingOnRemote(local: AssetDeclEntry[], remote: AssetDeclEntry[] | undefined): AssetDeclEntry[] {
  const have = new Set((remote ?? []).map((a) => a.filename));
  return local.filter((a) => !have.has(a.filename));
}

/** 差集：云端声明里有、本机没有（或 size/hash 不一致）的资产。 */
function missingLocally(local: AssetDeclEntry[], remote: AssetDeclEntry[]): AssetDeclEntry[] {
  const have = new Map(local.map((a) => [a.filename, a]));
  return remote.filter((r) => { const l = have.get(r.filename); return !l || l.size !== r.size || l.hash !== r.hash; });
}

export async function applyAssets(
  plan: SyncPlan,
  ctx: AssetContext,
  ports: AssetPorts,
  opts: ApplyAssetsOptions = {},
): Promise<ApplyAssetsResult> {
  const result: ApplyAssetsResult = {
    uploaded: { files: 0, bytes: 0 }, downloaded: { files: 0, bytes: 0 },
    assetsHashes: [], warnings: [], errors: [], failedDownloads: [],
  };
  const rawConcurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const concurrency = Number.isSafeInteger(rawConcurrency) && rawConcurrency >= 1 ? rawConcurrency : DEFAULT_CONCURRENCY;
  const warn = (w: PlanWarning) => result.warnings.push(w);
  /** 非法资产文件名的统一告警（P1-7）：结构化 code + 文件名 + 原因，UI/日志可直接定位。 */
  const warnInvalidAssetName = (space: Space, id: string | undefined, filename: string, detail: string) => {
    warn({ code: "asset_invalid_name", space, ...(id ? { id } : {}), filename, detail });
  };
  const declOf = (space: Space, id: string) => ctx.declarations.find((d) => d.space === space && d.id === id);

  // ---- 上传侧：plan.publishes（含 metadata-only 轮次，正文没变也要走声明） ----
  const putTasks: Array<{ space: Space; id: string; asset: AssetDeclEntry }> = [];
  const declPuts: Array<{ space: Space; id: string; key: string; bytes: Uint8Array; declHash: string }> = [];
  const getTasks: Array<{ space: Space; id: string; asset: AssetDeclEntry }> = [];
  /** 规划阶段已读过的字节（新增文件算 hash 时读一次），上传阶段复用，避免同文件读两次。 */
  const plannedBytes = new Map<string, Uint8Array>();

  for (const space of ["lake", "quickNotes"] as const) {
    for (const id of plan.publishes[space]) {
      try {
        const remote = declOf(space, id);
        // 快路径（与旧 uploadAssets 同口径）：只列文件名，声明里已有的同名资产直接复用远端 size/hash，
        // 只有**新增**文件才读字节算 hash ⇒ 改正文/元数据时 readAsset 0 次。
        // stats 端口在「不支持原生清单」的平台会抛错 ⇒ 退化为文件名/读字节路径（不影响正确性）。
        let stats: AssetDeclEntry[] | null = null;
        if (ports.listLocalAssetStats) {
          try { stats = await ports.listLocalAssetStats(space, id); } catch { stats = null; }
        }
        const names = !stats && ports.listLocalAssetNames ? await ports.listLocalAssetNames(space, id) : null;
        let local: AssetDeclEntry[];
        // P1-7：**先判文件名再读字节/进声明**。非法名（空格/中文/超长）在旧实现里只落 assets.errors
        //（引擎不消费 ⇒ UI 静默），且会被写进声明引用一个永远传不上去的对象。这里统一跳过 + 结构化 warning。
        if (stats) {
          local = [];
          for (const entry of [...stats].sort(byFilename)) {
            if (isUsableAssetFilename(entry.filename)) { local.push(entry); continue; }
            warnInvalidAssetName(space, id, entry.filename, "本机资源文件名不符合同步白名单（仅字母/数字/._-），已跳过");
          }
        } else if (names) {
          const remoteByName = new Map((remote?.assets ?? []).map((a) => [a.filename, a] as const));
          local = [];
          for (const filename of [...names].sort()) {
            // 先判名（不读字节）：非法名平台侧 read 会被拒，也不能进声明/对象键。
            if (!isUsableAssetFilename(filename)) {
              warnInvalidAssetName(space, id, filename, "本机资源文件名不符合同步白名单（仅字母/数字/._-），已跳过");
              continue;
            }
            const known = remoteByName.get(filename);
            if (known) { local.push(known); continue; }
            const bytes = await ports.readLocalAsset(space, id, filename);
            if (!bytes) continue;
            plannedBytes.set(space + ":" + id + "/" + filename, bytes);
            local.push({ filename, size: bytes.length, hash: sha256Hex(bytes) });
          }
        } else {
          local = [];
          for (const entry of [...(await ports.listLocalAssets(space, id))].sort(byFilename)) {
            if (isUsableAssetFilename(entry.filename)) { local.push(entry); continue; }
            warnInvalidAssetName(space, id, entry.filename, "本机资源文件名不符合同步白名单（仅字母/数字/._-），已跳过");
          }
        }
        if (local.length === 0 && remote && remote.assets.length > 0) {
          // 261026 真机事故护栏：空目录 ≠ 用户删光了附件。保留云端声明 + 自愈下载。
          warn({ code: "asset_missing", space, id, detail: "本机资产未落地，保留云端声明不删附件" });
          // 远端声明可能来自旧版本（含非法文件名）⇒ 自愈下载时同样只发能构造对象键的文件。
          const remoteUsable: AssetDeclEntry[] = [];
          for (const asset of remote.assets) {
            if (isUsableAssetFilename(asset.filename)) remoteUsable.push(asset);
            else warnInvalidAssetName(space, id, asset.filename, "远端声明含非法文件名，无法构造对象键，已跳过该附件（声明保持远端版本）");
          }
          if (remoteUsable.length > 0) getTasks.push(...remoteUsable.map((asset) => ({ space, id, asset })));
          // 声明**保持远端版本**（必须回填给 Commit，否则新索引会丢掉 assetsHash）。
          result.assetsHashes.push({ space, id, assetsHash: remote.declHash });
          continue;
        }
        if (local.length === 0) {
          // 与 v3 uploadAssets 一致：本机确实没有资产 ⇒ **不写空声明**（空声明对象纯属垃圾，
          // 且下一轮 GC 还得处理它）。云端也没有声明就清掉 assetsHash；有就保留远端版本。
          result.assetsHashes.push({ space, id, assetsHash: remote?.declHash });
          continue;
        }
        // local 已剔除非法文件名 ⇒ 新声明只引用真实可上传的对象（P1-7 契约：跳过但不引用）。
        const built = buildAssetDeclaration(local);
        for (const asset of missingOnRemote(local, remote?.assets)) putTasks.push({ space, id, asset });
        declPuts.push({ space, id, key: declarationKey(space, id, built.declHash), bytes: new TextEncoder().encode(built.serialized), declHash: built.declHash });
        result.assetsHashes.push({ space, id, assetsHash: built.declHash });
      } catch (error) { result.errors.push({ op: "asset-plan-put", detail: space + ":" + id, error }); }
    }
  }

  // ---- 下载侧：本轮 apply-remote 且带 assetsHash 的条目（声明已在 ctx 里） ----
  const appliedRemote = new Map<string, Space>();
  for (const w of plan.writes) {
    if (w.kind !== "apply-remote") continue;
    const assetsHash = w.meta.assetsHash;
    if (!assetsHash) continue;
    appliedRemote.set(w.space + ":" + w.id, w.space);
  }
  for (const decl of ctx.declarations) {
    const space = decl.space;
    if (!appliedRemote.has(space + ":" + decl.id)) continue;
    if (decl.assets.length === 0) continue;
    try {
      // P1-7：远端声明可能来自旧版本（曾把非法名写进声明）⇒ 跳过该文件名并告警；
      // 不落 failedDownloads（非法名永远传不成，进 pendingAssets 只会每轮重试刷告警）。
      const usable = decl.assets.filter((asset) => {
        if (isUsableAssetFilename(asset.filename)) return true;
        warnInvalidAssetName(space, decl.id, asset.filename, "远端声明含非法文件名，无法构造对象键，已跳过该附件");
        return false;
      });
      if (usable.length === 0) continue;
      // 快路径：只列文件名 → 同名文件视为已持有（内容寻址，同名同内容），不读字节。
      const names = ports.listLocalAssetNames ? await ports.listLocalAssetNames(space, decl.id) : null;
      const missing = names
        ? usable.filter((a) => !names.includes(a.filename))
        : missingLocally(await ports.listLocalAssets(space, decl.id), usable);
      for (const asset of missing) getTasks.push({ space, id: decl.id, asset });
    } catch (error) { result.errors.push({ op: "asset-plan-get", detail: space + ":" + decl.id, error }); }
  }

  // ---- 执行：资产 PUT → 声明 PUT（先对象后声明，v3 同序） ----
  const putRun = await runTransferPipeline(putTasks, concurrency, async (t) => {
    const key = t.space === "lake" ? assetKey(t.id, t.asset.filename) : quickNoteAssetKey(t.id, t.asset.filename);
    // 原生流式上传优先（字节不进 JS）：声明里的 size/hash 来自原生清单，对端仍按内容寻址校验。
    const nativePath = ports.assetNativePath ? await ports.assetNativePath(t.space, t.id, t.asset.filename) : null;
    if (nativePath && ports.putRemoteFromFile) {
      try {
        if (await ports.putRemoteFromFile(key, nativePath)) {
          result.uploaded.files += 1;
          result.uploaded.bytes += t.asset.size;
          return t.asset.size;
        }
      } catch { /* 回退字节路径 */ }
    }
    const cached = plannedBytes.get(t.space + ":" + t.id + "/" + t.asset.filename);
    const bytes = cached ?? await ports.readLocalAsset(t.space, t.id, t.asset.filename);
    if (!bytes) { warn({ code: "asset_missing", space: t.space, id: t.id, filename: t.asset.filename, detail: "本地资产读取失败: " + t.asset.filename }); return 0; }
    if (sha256Hex(bytes) !== t.asset.hash) {
      warn({ code: "hash_mismatch", space: t.space, id: t.id, filename: t.asset.filename, detail: "本地资产 sha256 与声明不符: " + t.asset.filename });
      return 0;
    }
    await ports.putRemote(key, bytes);
    result.uploaded.files += 1;
    result.uploaded.bytes += bytes.length;
    return bytes.length;
  }, { phase: "uploads", onProgress: (p) => opts.onProgress?.({ phase: "asset-put", done: p.done, total: p.total, bytes: p.bytesDone }) });
  for (const e of putRun.errors) {
    const item = putTasks[e.index];
    result.errors.push({ op: "asset-put", detail: item ? item.space + ":" + item.id + "/" + item.asset.filename : undefined, error: e.error });
  }

  for (const d of declPuts) {
    try {
      await ports.putRemote(d.key, d.bytes);
      // 内容寻址自校验：落盘前确认 key 与自己序列化的 hash 一致（防声明 key/内容错配）。
      const parsed = JSON.parse(new TextDecoder().decode(d.bytes)) as { assets?: AssetDeclEntry[] };
      if (declarationHashOf({ assets: parsed.assets ?? [] }) !== d.declHash) {
        warn({ code: "hash_mismatch", space: d.space, id: d.id, detail: "声明 hash 自校验失败: " + d.declHash });
      }
    } catch (error) { result.errors.push({ op: "declaration-put", detail: d.space + ":" + d.id, error }); }
  }

  // ---- 执行：资产 GET（deferDownloads 时整段跳过，留给打开文档时的补拉） ----
  if (!opts.deferDownloads && getTasks.length > 0) {
    const getRun = await runTransferPipeline(getTasks, concurrency, async (t) => {
      const key = t.space === "lake" ? assetKey(t.id, t.asset.filename) : quickNoteAssetKey(t.id, t.asset.filename);
      // 原生流式下载优先：字节不进 JS、校验在原生侧做。
      const nativePath = ports.assetNativePath ? await ports.assetNativePath(t.space, t.id, t.asset.filename) : null;
      if (nativePath && ports.getRemoteToFile) {
        try {
          const status = await ports.getRemoteToFile(key, nativePath, { size: t.asset.size, sha256: t.asset.hash });
          if (status === "ok") {
            result.downloaded.files += 1;
            result.downloaded.bytes += t.asset.size;
            return t.asset.size;
          }
          if (status === "missing" || status === "corrupt") {
            warn({ code: "asset_missing", space: t.space, id: t.id, filename: t.asset.filename, detail: "原生资产下载失败: " + status });
            result.failedDownloads.push({ space: t.space, id: t.id, filename: t.asset.filename, size: t.asset.size, hash: t.asset.hash });
            return 0;
          }
        } catch { /* unsupported/异常 ⇒ 回退字节路径 */ }
      }
      const bytes = ports.readRemoteAsset ? await ports.readRemoteAsset(key, t.asset.size, t.asset.hash) : await ports.getRemote(key);
      if (!bytes) { warn({ code: "asset_missing", space: t.space, id: t.id, filename: t.asset.filename, detail: "云端资产缺失: " + t.asset.filename }); result.failedDownloads.push({ space: t.space, id: t.id, filename: t.asset.filename, size: t.asset.size, hash: t.asset.hash }); return 0; }
      if (t.asset.hash && sha256Hex(bytes) !== t.asset.hash) {
        warn({ code: "hash_mismatch", space: t.space, id: t.id, filename: t.asset.filename, detail: "下载资产 sha256 与声明不符: " + t.asset.filename });
        result.failedDownloads.push({ space: t.space, id: t.id, filename: t.asset.filename, size: t.asset.size, hash: t.asset.hash });
        return 0;
      }
      await ports.writeLocalAsset(t.space, t.id, t.asset.filename, bytes);
      result.downloaded.files += 1;
      result.downloaded.bytes += bytes.length;
      return bytes.length;
    }, { phase: "assets", onProgress: (p) => opts.onProgress?.({ phase: "asset-get", done: p.done, total: p.total, bytes: p.bytesDone }) });
    for (const e of getRun.errors) {
      const item = getTasks[e.index];
      // 单对象 GET 抛错同样要留结构化警告 + 落账（下一轮开头重试）；只进 errors 会让 UI/诊断看不到缺附件。
      if (item) {
        warn({ code: "asset_missing", space: item.space, id: item.id, filename: item.asset.filename, detail: "附件下载失败: " + (e.error instanceof Error ? e.error.message : String(e.error)) });
        result.failedDownloads.push({ space: item.space, id: item.id, filename: item.asset.filename, size: item.asset.size, hash: item.asset.hash });
      }
      result.errors.push({ op: "asset-get", detail: item ? item.space + ":" + item.id + "/" + item.asset.filename : undefined, error: e.error });
    }
  }

  return result;
}
