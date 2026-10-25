import type { RemoteObjectInfo, S3v3Remote, S3v3Settings } from "../../core/s3v3Ports.js";
import { assertSafeKey, isGzip, isNoSuchKey, normalizeEndpoint } from "../../core/syncUtils.js";
import { createMobileS3Client } from "../native/s3Store.js";

/**
 * 移动端 S3v3Remote：v3 引擎 ↔ @aws-sdk/client-s3 + CapacitorHttpHandler。
 * - gzip 在端口内完成（get 返回解压后字节；put 按 opts.gzip 压缩并声明 ContentEncoding）。
 * - key 均为**相对前缀**的 v3 key；端口负责加/去 prefix。
 * - 只支持虚拟托管（移动端 D2 定稿），settings.forcePathStyle 被忽略。
 */

async function decompressGzip(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function compressGzip(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

type S3ClientLike = { send(command: unknown): Promise<unknown> };

export function createS3v3RemoteWithClient(client: S3ClientLike, bucket: string, prefix: string): S3v3Remote {
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, "");
  const full = (key: string): string => (cleanPrefix ? cleanPrefix + "/" + key : key);
  const relative = (key: string): string => (cleanPrefix && key.startsWith(cleanPrefix + "/") ? key.slice(cleanPrefix.length + 1) : key);

  return {
    async get(key) {
      assertSafeKey(key);
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: full(key) })) as { Body?: { transformToByteArray?: () => Promise<Uint8Array> } };
        if (!out.Body) return null;
        const raw = await out.Body.transformToByteArray!();
        return isGzip(raw) ? await decompressGzip(raw) : raw;
      } catch (e) {
        if (isNoSuchKey(e)) return null;
        throw e;
      }
    },
    async put(key, bytes, opts) {
      assertSafeKey(key);
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const body = opts?.gzip ? await compressGzip(bytes) : bytes;
      await client.send(new PutObjectCommand({
        Bucket: bucket, Key: full(key), Body: body,
        ...(opts?.gzip ? { ContentEncoding: "gzip", ContentType: "application/octet-stream" } : {}),
      }));
    },
    async list(p: string): Promise<RemoteObjectInfo[]> {
      const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
      const out: RemoteObjectInfo[] = [];
      let token: string | undefined;
      do {
        const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: full(p), ContinuationToken: token })) as { Contents?: Array<{ Key?: string; Size?: number; LastModified?: Date }>; IsTruncated?: boolean; NextContinuationToken?: string };
        for (const o of res.Contents ?? []) {
          if (!o.Key) continue;
          out.push({ key: relative(o.Key), size: o.Size ?? 0, ...(o.LastModified ? { lastModified: o.LastModified.getTime() } : {}) });
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
    async deleteMany(keys) {
      if (keys.length === 0) return;
      for (const k of keys) assertSafeKey(k);
      const { DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk.map((k) => ({ Key: full(k) })), Quiet: true } }));
      }
    },
    async deleteByPrefix(p: string) {
      const keys = (await this.list(p)).map((x) => x.key);
      await this.deleteMany(keys);
      return keys.length;
    },
  };
}

export function createMobileS3v3Remote(settings: S3v3Settings): S3v3Remote {
  let client: Promise<S3ClientLike> | null = null;
  const getClient = (): Promise<S3ClientLike> => {
    if (!client) {
      client = createMobileS3Client({
        region: settings.region, endpoint: settings.endpoint,
        accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey,
        // 移动端 D2：只支持虚拟托管
        forcePathStyle: false,
      }) as unknown as Promise<S3ClientLike>;
    }
    return client;
  };
  const lazyClient: S3ClientLike = { send: async (command) => (await getClient()).send(command) };
  return createS3v3RemoteWithClient(lazyClient, settings.bucket, settings.prefix);
}

export function mobileS3v3Endpoint(settings: S3v3Settings): string {
  return normalizeEndpoint(settings.endpoint);
}
