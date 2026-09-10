import type { ManifestNote } from "./manifestTypes.js";
import { sha256Sync } from "./sha256Sync.js";
import { MAX_ATTACHMENT_BYTES } from "./storeLimits.js";
import type { S3Store, SyncConfig, SyncDbPort, SyncReport } from "./syncEngineTypes.js";

/** P3-3：资产传输并发批大小。桌面实测资产传输是同步长尾（串行逐条 RTT 占耗时 99%）。
 * 现方案：① 存在性用「远端清单声明差集」判定（对齐思源 dejavu，见 scanLocalAssets），彻底去掉每对象一次
 * HEAD 往返（旧实测 20 篇元数据变更 = 335 次 HEAD 全 HIT、0 上传 = 14s 空转）；② 真正缺失者并发上传，
 * 并发 4 路（首传 106 资产 58MB 约 5s），4 路对七牛 Kodo QPS 安全。 */
const ASSET_CONCURRENCY = 4;

/** P3-3：小型并发池（定长车道，无依赖）：worker 按 index 领任务；结果由调用方按
 * 原索引归位（warnings 顺序 / 字节记账保持确定性，对齐串行语义）。 */
export async function runPool<T>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
}

/** 对象存储读取返回字节；正文对象是纯文本 Lake HTML，解码为字符串。 */
export const decodeText = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);

/** D8：下载笔记关联资产（内容寻址 assets/{noteId}/{filename}），校验 size/sha256 后落盘。
 * - strict=false（移动端读优先）：单个资源缺失/损坏 → 该资源跳过 + warning（图片占位），不阻断笔记正文导入。
 * - strict=true（桌面对齐 sync.ts:533-541）：资源缺失/损坏 → 抛 AssetMissingError，调用方跳过整个条目
 *   （不导入半成品；warning 由调用方记 kind=asset_missing）。 */
export class AssetMissingError extends Error {}

/** 回收站惰性下载：只记录 manifest 声明的资产元数据（冻结清点），不下载资源文件。
 * 进回收站不可编辑 → 清点不变；他端删除可能随后被清空 → 先不拉资源；恢复时再强拉全量。 */
export async function recordDeclaredAssetsOnly(db: SyncDbPort, noteId: string, assets: ManifestNote["assets"]): Promise<void> {
  if (typeof db.recordDeclaredAssets === "function") await db.recordDeclaredAssets(noteId, assets ?? []);
}

export async function downloadNoteAssets(cfg: SyncConfig, s3: S3Store, db: SyncDbPort, noteId: string, assets: ManifestNote["assets"], report: SyncReport, strict: boolean): Promise<void> {
  const items = assets ?? [];
  // A 方案：记录 manifest 声明的资产元数据（即使某资源文件本地缺失，上传 union 仍可正确声明）。
  if (typeof db.recordDeclaredAssets === "function") await db.recordDeclaredAssets(noteId, items);
  // 下载侧差集（对称于上传 scanLocalAssets，对齐思源 dejavu「只取缺失块」）：本地已持「同名 + 同 size + 同 sha256」
  // 的资产即逐字节等价（内容寻址，无陈旧风险）→ 跳过 GET；缺失/损坏/变更（不满足精确匹配）仍照常下载或告警/严格拒绝。
  // 治的是最常见浪费：远端只改一行文字 → 对端把整篇未变的图全重下一遍。预扫失败则 localHave=null → 回退全下载（不改旧行为）。
  let localHave: Map<string, { size: number; hash: string }> | null = null;
  if (items.length > 0) {
    try {
      localHave = new Map((await db.listLocalAssets(noteId)).map((a) => [a.filename, { size: a.size, hash: a.hash }]));
    } catch { localHave = null; }
  }
  // P3-3：并发下载（每资产 getObject/校验/saveAsset 相互独立）。worker 不抛错——
  // 失败按索引归位，池结束后统一裁决：warnings 按原顺序入列、首个错误按原顺序抛出，
  // 与旧串行实现的裁决结果逐字节一致（仅失败前的多余请求会发出，结果确定）。
  const errors: Array<Error | null> = new Array(items.length).fill(null);
  const warnings: Array<string | null> = new Array(items.length).fill(null);
  const saved: Array<number> = new Array(items.length).fill(0);
  let aborted = false; // strict 首错后停止落盘（并发车道已在途的请求自然完成但不写盘，防孤儿资产目录）
  await runPool(items, ASSET_CONCURRENCY, async (asset, i) => {
    try {
      // 已在本地且 size+hash 精确匹配 → 无需下载（不记 downloadedBytes、不算缺失、不产 warning；对齐上传侧 skip）。
      if (localHave) {
        const have = localHave.get(asset.filename);
        if (have && have.size === asset.size && have.hash === asset.hash) return;
      }
      const bytes = await s3.getObject(`${cfg.prefix}/assets/${noteId}/${asset.filename}`, { maxBytes: MAX_ATTACHMENT_BYTES });
      if (bytes == null) {
        if (strict) { errors[i] = new AssetMissingError(`资源缺失: ${noteId}/${asset.filename}`); aborted = true; }
        else warnings[i] = `资源缺失（跳过）: ${noteId}/${asset.filename}`;
        return;
      }
      if (bytes.length !== asset.size) {
        // 损坏（声明 size 不符）→ 严格模式整轮中止（对齐桌面：损坏拒绝，不静默接受）
        if (strict) { errors[i] = new Error(`资源大小不符: ${noteId}/${asset.filename}（声明 ${asset.size}，实际 ${bytes.length}）`); aborted = true; }
        else warnings[i] = `资源大小不符（跳过）: ${noteId}/${asset.filename}`;
        return;
      }
      if (sha256Sync(bytes) !== asset.hash) {
        if (strict) { errors[i] = new Error(`资源哈希不符: ${noteId}/${asset.filename}`); aborted = true; }
        else warnings[i] = `资源哈希不符（跳过）: ${noteId}/${asset.filename}`;
        return;
      }
      if (aborted) return; // strict 已首错：不落盘（防半成品孤儿资产）
      await db.saveAsset(noteId, asset.filename, bytes);
      saved[i] = bytes.length;
    } catch (e) {
      // getObject 异常（网络/超限）：与旧实现一致向上传播（两模式均抛，不计入 warning）
      aborted = true;
      errors[i] = e instanceof Error ? e : new Error(String(e));
    }
  });
  for (const w of warnings) if (w) report.warnings.push(w);
  for (const e of errors) if (e) throw e;
  for (const n of saved) report.downloadedBytes += n;
}

/** 扫描本地资产：只上传云端缺失者，返回该笔记**完整**资产清单（H3 与软删上云共用）。
 *
 * 存在性判定采用「远端清单声明差集」（对齐思源 dejavu：以刚下载的 cloud 最新索引已声明的
 * chunk 集合做减法，只传缺的）——而非逐对象 HEAD 探测。理由：
 *  1. 稳态同步里资产几乎都已在云端，逐对象 HEAD 只是把「确认无需上传」的成本摊到每次同步
 *     （实测：20 篇仅元数据变更 → 335 次 HEAD 全 HIT、0 字节上传 = 14s 纯往返空转）。
 *  2. 我们下载的 remote 清单本身就是「云端当前引用集」的权威快照（发布顺序=先对象后清单），
 *     且 GC 只删「未被任何清单引用」的对象（S3-GC-DESIGN：本地为真相、S3 只是镜像 + 年龄保护 + 差集删除），
 *     所以「remote 清单声明了该资产」⇒ 该对象此刻被引用 ⇒ 未被 GC ⇒ 云端确实存在。无需再 HEAD。
 *  3. 关键安全点：返回值仍是**完整** localAssets（全量写进 manifest.assets）——
 *     只对「上传动作」做差集，绝不裁剪「清单声明」。清单声明一旦被裁剪，他端 GC 会把
 *     仍在用的资产判为未引用而误删（AGENTS #11 恢复红线）。
 *
 * cloudDeclaredFilenames：本笔记在**已下载远端清单**中声明的资产文件名集合；缺省（如新笔记 /
 * 桶被重置 → rn 为 null）传空集 → 全部本地资产都按缺失上传。
 * 上传优先流式（s3.putObjectStream + db.openLocalAssetStream 同时可用），否则字节路径（移动端零改动）。
 * stats 传入时累计实际上传字节数（流式取声明 size，字节路径取 bytes.length）。
 * 守卫（勿回退）：**禁止**以 `rn.assets` 直接充当 manifest 声明来跳过本地重扫——`rn.assets` 只是「上轮远端声明」，
 * 本地可能有未声明的新增/上次失败未传的资产，复用以声明冒充清单 = 裁剪声明 = 违反红线（他端 GC 误删在用资产）。
 * 每次必须 `db.listLocalAssets` 实扫、远端声明只作 skip 集。外部前提（契约外不检测）：无带外删除；资产按 filename 内容寻址。
 * 导出供单元测试直接覆盖差集/流式选择逻辑。 */
export async function scanLocalAssets(
  cfg: SyncConfig, s3: S3Store, db: SyncDbPort, noteId: string,
  stats?: { uploadedBytes: number },
  cloudDeclaredFilenames?: ReadonlySet<string>,
): Promise<ManifestNote["assets"]> {
  const localAssets = await db.listLocalAssets(noteId);
  const canStream = !!s3.putObjectStream && typeof db.openLocalAssetStream === "function";
  // P3-3：并发上传（仅缺失者）。worker 不抛错——错误按索引归位，池结束后按原顺序抛首个错误
  // （与旧串行「逐个 await、首错即止」裁决一致）；字节记账按索引归位（流式=声明 size，字节路径=bytes.length）。
  const uploadedSize: Array<number | null> = new Array(localAssets.length).fill(null);
  const errors: Array<unknown> = new Array(localAssets.length).fill(null);
  await runPool(localAssets, ASSET_CONCURRENCY, async (a, i) => {
    try {
      // 已在远端清单声明 → 认定云端存在，跳过上传（不再 HEAD 探测）；但仍保留在返回清单里（全量声明）。
      if (cloudDeclaredFilenames?.has(a.filename)) return;
      const key = `${cfg.prefix}/assets/${noteId}/${a.filename}`;
      if (canStream && s3.putObjectStream) {
        await s3.putObjectStream(key, a.size, () => db.openLocalAssetStream!(noteId, a.filename));
        uploadedSize[i] = a.size;
      } else {
        const bytes = await db.readLocalAsset(noteId, a.filename);
        if (bytes) {
          await s3.putObject(key, bytes);
          uploadedSize[i] = bytes.length;
        }
      }
    } catch (e) {
      errors[i] = e;
    }
  });
  for (const e of errors) if (e) throw e;
  if (stats) {
    for (const n of uploadedSize) if (n != null) stats.uploadedBytes += n;
  }
  return localAssets.map((a) => ({ filename: a.filename, size: a.size, hash: a.hash }));
}
