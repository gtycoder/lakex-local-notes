/**
 * 移动端 S3Store adapter（HttpFetcher 注入点移动端实现）：
 * 共享 syncEngine（src/core）的对象读写端口 → @aws-sdk/client-s3 + CapacitorHttpHandler（原生 OkHttp）。
 *
 * 端口职责（红线 §3.2）：gunzip/压缩在端口内完成——getObject 返回**已解压**字节；
 * putObject 按 opts.gzip 压缩。syncEngine 不感知 gzip（core 无 gzip 调用）。
 */
import type { S3Store, SyncConfig } from "../../core/syncEngine.js";
import { assertSafeKey, isGzip, isNoSuchKey, normalizeEndpoint } from "../../core/syncUtils.js";
import { CapacitorHttpHandler } from "./capacitorHttpHandler";
import { NativeAssetSync, nativeAssetSyncSupported } from "./nativeAssetSync";

/** WebView 内置 gzip 解压（无需新增依赖）。 */
async function decompressGzip(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** WebView 内置 gzip 压缩（manifest 写入用）。 */
async function compressGzip(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 移动端唯一的 S3 client 工厂（D6，261016）。
 *
 * 背景：原先「测连通」（bridge.createS3Client）与「全部同步」（本文件）各建一套 client，
 * 且**设置不同**——测连通那份没有 responseChecksumValidation 绕行 ⇒ 会出现
 * 「测连通报 Checksum mismatch，真同步却正常」这类难查的不一致（见 SYNC-PROTOCOL §7.3 D6）。
 * 现在两处共用本工厂：传输层分层（Capacitor 原生 HTTP）、checksum 绕行、凭证形态只有一处。
 * ⚠️ D2（261017 定稿）：移动端**只支持虚拟托管风格（forcePathStyle=false）**——
 * 阿里云 OSS / 腾讯云 COS（2024+ 新桶）/ AWS / 七牛均要求或推荐虚拟托管；自建 MinIO/路径风格不在移动端支持范围。
 * 桌面端仍保留开关（不受此约束）。若未来要做，必须 D2（SyncConfig 扩字段+设置页）与 D3（允许 http 内网端点）一起。 */
export interface MobileS3ClientOptions {
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export async function createMobileS3Client(opts: MobileS3ClientOptions): Promise<import("@aws-sdk/client-s3").S3Client> {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    // D7（261017）：与桌面一致，region 缺省用 cn-east-1（空串在 SDK 里行为不稳定）。
    region: opts.region?.trim() || "cn-east-1",
    // D3（261017）：与桌面同一份 normalizeEndpoint（补 https / 去尾斜杠 / 修重复协议）。
    endpoint: normalizeEndpoint(opts.endpoint),
    forcePathStyle: opts.forcePathStyle,
    credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    // 七牛 Kodo：GET 请求默认发 x-amz-checksum-mode 但七牛仅返回 content-md5，导致 SDK 校验 mismatch；
    // 禁用响应严格校验（不触发 SDK 对 body 的 content-md5 比对），避免 "Checksum mismatch"。
    // 这是**两端共用工厂的真正价值**：以前只有同步路径有这行，测连通路径没有。
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: new CapacitorHttpHandler(),
  });
}

export function createCapacitorS3Store(cfg: SyncConfig): S3Store {
  let client: Promise<import("@aws-sdk/client-s3").S3Client> | null = null;
  async function getClient() {
    if (!client) {
      client = createMobileS3Client({
        region: cfg.region,
        endpoint: cfg.endpoint,
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        // D2 261017 定稿：移动端有意只支持虚拟托管（阿里云/腾讯云/AWS/七牛）；自建 MinIO 不在支持范围。
        // 不扩 SyncConfig、不加开关，避免与 D3（移动端未强制 https）产生半套语义。桌面端仍有开关。
        forcePathStyle: false,
      });
    }
    return client;
  }

  async function putBytes(key: string, bytes: Uint8Array): Promise<void> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const c = await getClient();
    await c.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: bytes }));
  }

  let nativeConfig: Promise<boolean> | null = null;
  async function ensureNativeAssetSync(): Promise<boolean> {
    if (!nativeAssetSyncSupported()) return false;
    if (!nativeConfig) {
      nativeConfig = NativeAssetSync.configure({
        endpoint: normalizeEndpoint(cfg.endpoint),
        region: cfg.region?.trim() || "cn-east-1",
        bucket: cfg.bucket,
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        forcePathStyle: false,
      }).then(() => true).catch(() => false);
    }
    return nativeConfig;
  }

  const store: S3Store = {
    async getObject(key: string, opts?: { maxBytes?: number }): Promise<Uint8Array | null> {
      // D1（261016）：与桌面 ObjectStore.getOptional 对齐——键必须过 ASCII 白名单（fail fast）。
      // 理由（见 core/syncUtils 里 SAFE_KEY_RE 的注释）：非 ASCII 键会让 ListObjectsV2 的编码与写入侧不一致 ⇒ GC 列不到对象。
      assertSafeKey(key);
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const c = await getClient();
      try {
        const out = await c.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        if (!out.Body) return null;
        const raw = await out.Body.transformToByteArray();
        // 端口责任：gunzip 在端口内完成（gzip 魔数识别）；正文/资源本就纯字节，gzip 仅 manifest
        const bytes = isGzip(raw) ? await decompressGzip(raw) : raw;
        // 单对象大小护栏（对齐桌面 sync.ts:507/523）：解压后仍超限 → 拒绝（防解压炸弹）
        if (opts?.maxBytes != null && bytes.length > opts.maxBytes) {
          throw new Error(`对象过大（${bytes.length} 字节 > ${opts.maxBytes}）`);
        }
        return bytes;
      } catch (e) {
        // D4（261016）：改用 core 的 isNoSuchKey（与桌面 ObjectStore.getOptional 同一判据）。
        // 桌面注释明确记录「缺失对象的错误名随操作/供应商不同：GetObject=NoSuchKey，部分操作（AWS/七牛 Kodo）
        // 返回 NotFound」——原先这里只认 HTTP 404 状态码 / NoSuchKey ⇒ 移动端可能把"对象缺失"当错误抛出
        // （首次同步判定失败）。判据只允许有一份，就在 core。
        if (isNoSuchKey(e)) return null;
        throw e;
      }
    },
    async putObject(key: string, body: string | Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
      assertSafeKey(key); // D1：对齐桌面 ObjectStore.put
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const c = await getClient();
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
      const out = opts?.gzip ? await compressGzip(bytes) : bytes;
      await c.send(new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: out,
        // D5（261017 真云验证后修）：桌面端一直带 ContentEncoding；移动端补上后
        // manifest 在控制台/S3 工具里不再显示为"未知二进制"，读侧仍保留 gzip 魔数兼容。
        // ⚠️ 不能声明 application/json：CapacitorHttp Android 会优先于 dataType=file
        // 走 JSON 文本分支，把 gzip 字节的 base64 文本当正文发送，导致 SigV4 校验失败。
        // 与桌面的 ObjectStore.put 一致使用 application/octet-stream；gzip 由 ContentEncoding 表达。
        ...(opts?.gzip ? { ContentEncoding: "gzip" as const, ContentType: "application/octet-stream" } : {}),
      }));
    },
    async listObjects(prefix: string): Promise<Array<{ key: string; lastModified: string; size: number }>> {
      const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
      const c = await getClient();
      const out: Array<{ key: string; lastModified: string; size: number }> = [];
      let token: string | undefined;
      do {
        const res = await c.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, ContinuationToken: token }));
        for (const o of res.Contents ?? []) {
          if (o.Key && o.LastModified) out.push({ key: o.Key, lastModified: o.LastModified.toISOString(), size: o.Size ?? 0 });
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
    async deleteMany(keys: string[]): Promise<number> {
      for (const k of keys) assertSafeKey(k); // D1：对齐桌面 ObjectStore.deleteMany（逐键校验）
      const { DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
      const c = await getClient();
      let deleted = 0;
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        const res = await c.send(new DeleteObjectsCommand({ Bucket: cfg.bucket, Delete: { Objects: chunk.map((k) => ({ Key: k })), Quiet: true } }));
        deleted += res.Deleted?.length ?? 0;
      }
      return deleted;
    },
  };

  // 原生资产流式上传（字节不过桥）：core 的 scanLocalAssets 探测到 putObjectStream +
  // SyncDbPort.openLocalAssetStream 同时存在才走流式；非原生平台不挂载 → 自动回退字节路径。
  // 原生运行时失败也回退到字节路径，保证「有则原生、无则回退」。
  if (nativeAssetSyncSupported()) {
    store.putObjectStream = async (key, _size, open) => {
      assertSafeKey(key); // D1：对齐桌面 ObjectStore.putStream
      const handle = await open();
      if (handle == null) throw new Error(`本地资产缺失: ${key}`);
      const localKey = typeof handle === "string" ? handle : (handle as { localKey?: string }).localKey;
      const read = typeof handle === "object" && handle !== null && typeof (handle as { read?: unknown }).read === "function"
        ? (handle as { read: () => Promise<Uint8Array | null> }).read
        : null;
      if (localKey && (await ensureNativeAssetSync())) {
        try {
          await NativeAssetSync.putFile({ key, localKey });
          return;
        } catch {
          // 原生 PUT 失败 → 回退字节路径（下面读取字节重传）
        }
      }
      const bytes = read ? await read() : null;
      if (!bytes) throw new Error(`本地资产读取失败: ${key}`);
      await putBytes(key, bytes);
    };

    // 原生流式下载（字节不过桥）：core 的 downloadNoteAssets 探测到 getObjectToFile + assetFilePath
    // 同时存在才走文件路径；非原生平台不挂载 → 自动回退字节路径。
    store.getObjectToFile = async (key, destPath, opts) => {
      assertSafeKey(key); // D1：移动端专有方法，同样纳入键校验
      if (!(await ensureNativeAssetSync())) throw new Error("native asset sync unavailable");
      const res = await NativeAssetSync.getFile({
        key,
        localKey: destPath,
        maxBytes: opts?.maxBytes,
        expectedSize: opts?.expectedSize,
        expectedSha256: opts?.expectedSha256,
      });
      if (res.status === 404) return null;
      const size = Number(res.size ?? 0);
      const sha256 = String(res.sha256 ?? "");
      if (res.status === "corrupt") return { status: "corrupt", size, sha256 };
      return { status: "ok", size, sha256 };
    };
  }

  return store;
}
