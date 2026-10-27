import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { gunzipSync, gzipSync } from "node:zlib";
import { isGzipMetadataKey } from "../../src/core/s3v3Keys.js";
import type { RemoteObjectInfo, S3v3Remote, S3v3Settings } from "./ports.js";

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;
}

/**
 * P0：只有元数据对象按 gzip 解压；正文/附件即使字节恰好以 1f8b 开头也原样返回。
 * 单独导出便于单测（不需要真实 S3）。
 */
export function decodeRemoteObject(rel: string, bytes: Uint8Array): Uint8Array {
  if (!isGzipMetadataKey(rel) || !isGzip(bytes)) return bytes;
  return new Uint8Array(gunzipSync(bytes));
}

export class S3v3S3Remote implements S3v3Remote {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(settings: S3v3Settings) {
    if (!settings.endpoint || !settings.bucket || !settings.accessKeyId || !settings.secretAccessKey) throw new Error("S3 配置不完整");
    if (!settings.prefix) throw new Error("S3 前缀不能为空");
    this.client = new S3Client({
      region: settings.region,
      endpoint: settings.endpoint,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      forcePathStyle: !!settings.forcePathStyle,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    this.bucket = settings.bucket;
    this.prefix = settings.prefix.replace(/^\/+|\/+$/g, "") + "/";
  }

  private key(rel: string): string {
    return this.prefix + rel;
  }

  async get(rel: string): Promise<Uint8Array | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(rel) }));
      const chunks: Buffer[] = [];
      for await (const c of out.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
      return decodeRemoteObject(rel, new Uint8Array(Buffer.concat(chunks)));
    } catch (e) {
      const err = e as { name?: string; $metadata?: { httpStatusCode?: number }; Code?: string };
      if (err.name === "NoSuchKey" || err.name === "NotFound" || err.$metadata?.httpStatusCode === 404 || err.Code === "NoSuchKey") return null;
      throw e;
    }
  }

  /** 大对象分片下载（261027）：Range 头只取 [start,end) 字节。 */
  async getRange(rel: string, start: number, end: number): Promise<Uint8Array | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.key(rel),
        Range: "bytes=" + start + "-" + (end - 1),
      }));
      const chunks: Buffer[] = [];
      for await (const c of out.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
      return new Uint8Array(Buffer.concat(chunks));
    } catch (e) {
      const err = e as { name?: string; $metadata?: { httpStatusCode?: number }; Code?: string };
      if (err.name === "NoSuchKey" || err.name === "NotFound" || err.$metadata?.httpStatusCode === 404 || err.Code === "NoSuchKey") return null;
      throw e;
    }
  }

  async put(rel: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
    // level 1：索引/声明是 JSON，压缩率几乎相同但 CPU 明显更低（大库增量发布更快）
      const body = opts?.gzip ? gzipSync(Buffer.from(bytes), { level: 1 }) : Buffer.from(bytes);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.key(rel),
      Body: body,
      ...(opts?.gzip ? { ContentEncoding: "gzip" } : {}),
    }));
  }

  async list(relPrefix: string): Promise<RemoteObjectInfo[]> {
    const out: RemoteObjectInfo[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: this.key(relPrefix),
        ContinuationToken: token,
        MaxKeys: 1000,
      }));
      for (const c of res.Contents ?? []) {
        if (!c.Key) continue;
        const rel = c.Key.startsWith(this.prefix) ? c.Key.slice(this.prefix.length) : c.Key;
        out.push({ key: rel, size: c.Size ?? 0, lastModified: c.LastModified ? c.LastModified.getTime() : undefined });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async deleteMany(keys: string[]): Promise<void> {
    // 七牛实测：500 键单次 DeleteObjects 约 7.2s（14.4ms/键），远慢于并发单对象 DELETE（8 并发约 4.1ms/键）；
    // 261025 用户批准并发 12；失败即抛出留给 pending 重试。
    const unique = [...new Set(keys)];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(12, unique.length) }, async () => {
      while (cursor < unique.length) {
        const key = unique[cursor++];
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      }
    });
    await Promise.all(workers);
  }

  async deleteByPrefix(relPrefix: string): Promise<number> {
    const items = await this.list(relPrefix);
    if (items.length === 0) return 0;
    await this.deleteMany(items.map((i) => i.key));
    return items.length;
  }
}
