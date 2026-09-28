/**
 * S3 兼容客户端（七牛 Kodo 等）与连接检查。
 * 从原 electron/sync.ts 拆出，只负责传输层；同步编排在 syncEngineController。
 */
import zlib from "node:zlib";
import {
  S3Client,
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  type PutObjectCommandInput,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import type { Store } from "./store.js";
import { createSilentLoggerScopes, type LoggerScopes } from "../src/core/logger.js";
import {
  isGzip,
  normalizeEndpoint,
  validateS3Settings,
  errorMessage,
  isNoSuchKey,
  assertSafeKey,
  chunkArray,
  type S3Settings,
} from "../src/core/syncUtils.js";

/** 单次 S3 请求超时（连接/首字节/整体）。避免网络黑洞让同步无限挂起、
 *  进而把 before-quit 的“等同步完成再退出”变成无法退出。 */
const S3_REQUEST_TIMEOUT_MS = 30_000;
/** W-6：Get/Put 大对象（25MiB 图片/正文）传输超时放宽到 120s——
 *  <1MB/s 弱网下 30s 会误杀传输并触发无效重试（元数据小命令仍走 30s）。 */
const S3_TRANSFER_TIMEOUT_MS = 120_000;

// ===== ObjectStore：S3 兼容客户端（七牛云等） =====
export class ObjectStore {
  private client: S3Client;
  private bucket: string;
  private prefix: string;
  private log: LoggerScopes;

  constructor(settings: S3Settings, logScopes: LoggerScopes = createSilentLoggerScopes()) {
    this.log = logScopes;
    this.bucket = settings.bucket.trim();
    this.prefix = settings.prefix.trim().replace(/^\/+|\/+$/g, "");
    this.client = new S3Client({
      region: settings.region.trim() || "cn-east-1",
      // 参照思源 NormalizeEndpoint：规范化 endpoint（协议/斜杠/尾部）
      endpoint: normalizeEndpoint(settings.endpoint),
      forcePathStyle: settings.forcePathStyle,
      credentials: {
        accessKeyId: settings.accessKeyId.trim(),
        secretAccessKey: settings.secretAccessKey.trim(),
      },
      maxAttempts: 3,
      requestHandler: undefined,
    });
  }

  private key(suffix: string): string {
    return this.prefix ? `${this.prefix}/${suffix}` : suffix;
  }

  async test(): Promise<void> {
    const t0 = Date.now();
    try {
      // 七牛 Kodo S3 兼容层不支持 HeadBucket（对存在的桶也会返回 404/UnknownError），
      // 改用 ListObjectsV2 探测连接与桶存在性。
      await this.send(new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }));
      this.log.s3.info(`[perf] test ${Date.now() - t0}ms ok`);
    } catch (error) {
      this.log.s3.warn(`[perf] test FAIL ${Date.now() - t0}ms: ${errorMessage(error)}`);
      throw new Error(`S3 连接失败: ${errorMessage(error)}`);
    }
  }

  /** V5 §5.6：getOptional 支持按用途单对象上限（maxBytes 对解压后字节生效，防投毒 OOM） */
  async getOptional(key: string, opts?: { maxBytes?: number }): Promise<Buffer | null> {
    assertSafeKey(key);
    const t0 = Date.now();
    try {
      const output = await this.send<GetObjectCommandOutput>(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      const bytes = output.Body ? Buffer.from(await output.Body.transformToByteArray()) : Buffer.alloc(0);
      // manifest 等 gzip 对象透明解压（按魔数识别；ContentEncoding 自动解压与原始字节两种响应均兼容）
      const out = isGzip(bytes) ? zlib.gunzipSync(bytes) : bytes;
      if (opts?.maxBytes !== undefined && out.length > opts.maxBytes) {
        throw new Error(`S3 对象过大 (${key}): ${out.length}B > ${opts.maxBytes}B`);
      }
      this.log.s3.info(`[perf] get ${key} ${Date.now() - t0}ms (${bytes.length}B${out !== bytes ? ` -> ${out.length}B gzip` : ""})`);
      return out;
    } catch (error) {
      if (isNoSuchKey(error)) { this.log.s3.info(`[perf] get ${key} ${Date.now() - t0}ms MISS`); return null; }
      this.log.s3.warn(`[perf] get ${key} FAIL ${Date.now() - t0}ms: ${errorMessage(error)}`);
      throw new Error(`S3 读取失败 (${key}): ${errorMessage(error)}`);
    }
  }

  async put(key: string, bytes: Buffer, contentType: string, opts?: { cacheControl?: "no-cache" | "no-store"; gzip?: boolean }): Promise<void> {
    assertSafeKey(key);
    const t0 = Date.now();
    let body = bytes;
    const command: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: this.key(key),
      Body: body,
      ContentType: contentType,
      CacheControl: opts?.cacheControl ?? "no-cache",
    };
    if (opts?.gzip) {
      body = zlib.gzipSync(bytes, { level: 9 });
      command.Body = body;
      command.ContentEncoding = "gzip";
    }
    try {
      await this.send(new PutObjectCommand(command));
      this.log.s3.info(`[perf] put ${key} ${Date.now() - t0}ms (${body.length}B${opts?.gzip ? ` gzip of ${bytes.length}B` : ""})`);
    } catch (error) {
      this.log.s3.warn(`[perf] put ${key} FAIL ${Date.now() - t0}ms: ${errorMessage(error)}`);
      throw new Error(`S3 上传失败 (${key}): ${errorMessage(error)}`);
    }
  }

  /** 流式上传（大附件用）：Body 直接给 Node Readable，显式 Content-Length（避免 aws-chunked，
   * 七牛 Kodo 兼容性已验证）。失败抛错，调用方重试/下轮同步重传（幂等对账语义）。 */
  async putStream(key: string, size: number, open: () => Promise<import("node:stream").Readable | null>): Promise<void> {
    assertSafeKey(key);
    const stream = await open();
    if (!stream) return; // 本地文件缺失（已删除）→ 视为无此资产
    try {
      await this.send<Record<string, unknown>>(new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(key),
        Body: stream,
        ContentLength: size,
        ContentType: "application/octet-stream",
        CacheControl: "no-cache",
      }));
      this.log.s3.info(`[perf] put-stream ${key} ${Date.now()}ms (${size}B)`);
    } catch (error) {
      this.log.s3.warn(`[perf] put-stream ${key} FAIL ${Date.now()}ms: ${errorMessage(error)}`);
      throw new Error("S3 上传失败 (" + key + "): " + errorMessage(error));
    }
  }
  /** ListObjectsV2 分页列出前缀下键（相对键 + LastModified + Size；Size 供 GC 诊断/清理统计体积用，云端缺失记 0）。 */
  async list(prefix: string): Promise<Array<{ key: string; lastModified: string; size: number }>> {
    const t0 = Date.now();
    const fullPrefix = this.key(prefix);
    const out: Array<{ key: string; lastModified: string; size: number }> = [];
    let continuationToken: string | undefined;
    let pages = 0;
    do {
      pages += 1;
      const output = await this.send<ListObjectsV2CommandOutput>(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: fullPrefix,
        ContinuationToken: continuationToken,
      }));
      for (const obj of output.Contents ?? []) {
        if (typeof obj.Key !== "string") continue;
        out.push({ key: this.unkey(obj.Key), lastModified: obj.LastModified?.toISOString() ?? "", size: typeof obj.Size === "number" ? obj.Size : 0 });
      }
      continuationToken = output.NextContinuationToken;
    } while (continuationToken);
    this.log.s3.info(`[perf] list ${prefix} ${Date.now() - t0}ms (${out.length} keys, ${pages} pages)`);
    return out;
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    const t0 = Date.now();
    try {
      await this.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      this.log.s3.info(`[perf] delete ${key} ${Date.now() - t0}ms`);
    } catch (error) {
      if (isNoSuchKey(error)) return;
      this.log.s3.warn(`[perf] delete ${key} FAIL ${Date.now() - t0}ms: ${errorMessage(error)}`);
      throw new Error(`S3 删除失败 (${key}): ${errorMessage(error)}`);
    }
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const t0 = Date.now();
    for (const chunk of chunkArray(keys, 1000)) {
      for (const k of chunk) assertSafeKey(k);
      try {
        await this.send(new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((k) => ({ Key: this.key(k) })), Quiet: true },
        }));
      } catch (error) {
        this.log.s3.warn(`[perf] deleteMany ${chunk.length} keys FAIL ${Date.now() - t0}ms: ${errorMessage(error)}`);
        throw new Error(`S3 批量删除失败 (${chunk.length} 键): ${errorMessage(error)}`);
      }
    }
    this.log.s3.info(`[perf] deleteMany ${keys.length} keys ${Date.now() - t0}ms`);
  }

  /** 前缀删除：列出 + 分批删除（用于 purge）。404 与空列表均幂等。 */
  async deletePrefix(prefix: string): Promise<number> {
    const t0 = Date.now();
    const items = await this.list(prefix);
    const keys = items.map((i) => i.key);
    await this.deleteMany(keys);
    this.log.s3.info(`[perf] deletePrefix ${prefix} ${Date.now() - t0}ms (${keys.length} keys)`);
    return keys.length;
  }

  /** 统一带超时发送命令：超时通过 AbortSignal 中断底层请求（NodeHttpHandler 支持）。
   *  Get/Put 走大对象超时（W-6），其余元数据命令走短超时。 */
  private async send<T>(command: GetObjectCommand | PutObjectCommand | ListObjectsV2Command | DeleteObjectCommand | DeleteObjectsCommand): Promise<T> {
    const isTransfer = command instanceof GetObjectCommand || command instanceof PutObjectCommand;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), isTransfer ? S3_TRANSFER_TIMEOUT_MS : S3_REQUEST_TIMEOUT_MS);
    try {
      // AWS SDK client.send 不接受命令联合类型（已知 TS 痛点）：调用点类型已约束，这里集中一处断言。
      return await this.client.send(command as never, { abortSignal: controller.signal }) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private unkey(full: string): string {
    return this.prefix && full.startsWith(`${this.prefix}/`) ? full.slice(this.prefix.length + 1) : full;
  }
}

// ===== 对外 API =====

export async function testConnection(store: Store): Promise<string> {
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  validateS3Settings(settings);
  const remote = new ObjectStore(settings, store.logScopes);
  await remote.test();
  return "连接成功，Bucket 可访问";
}
