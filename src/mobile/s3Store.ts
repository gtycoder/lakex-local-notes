/**
 * 移动端 S3Store adapter（HttpFetcher 注入点移动端实现）：
 * 共享 syncEngine（src/core）的对象读写端口 → @aws-sdk/client-s3 + CapacitorHttpHandler（原生 OkHttp）。
 *
 * 端口职责（红线 §3.2）：gunzip/压缩在端口内完成——getObject 返回**已解压**字节；
 * putObject 按 opts.gzip 压缩。syncEngine 不感知 gzip（core 无 gzip 调用）。
 */
import type { S3Store, SyncConfig } from "../core/syncEngine.js";
import { isGzip } from "../core/syncUtils.js";
import { CapacitorHttpHandler } from "./capacitorHttpHandler";

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

export function createCapacitorS3Store(cfg: SyncConfig): S3Store {
  let client: Promise<import("@aws-sdk/client-s3").S3Client> | null = null;
  async function getClient() {
    if (!client) {
      const { S3Client } = await import("@aws-sdk/client-s3");
      client = Promise.resolve(
        new S3Client({
          region: cfg.region,
          endpoint: cfg.endpoint,
          forcePathStyle: false,
          credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
          // 七牛 Kodo：GET 请求默认发 x-amz-checksum-mode 但七牛仅返回 content-md5，导致 SDK 校验 mismatch；
          // 禁用响应严格校验（不触发 SDK 对 body 的 content-md5 比对），避免 "Checksum mismatch"
          responseChecksumValidation: "WHEN_REQUIRED",
          requestHandler: new CapacitorHttpHandler(),
        })
      );
    }
    return client;
  }

  return {
    async getObject(key: string): Promise<Uint8Array | null> {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const c = await getClient();
      try {
        const out = await c.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        if (!out.Body) return null;
        const raw = await out.Body.transformToByteArray();
        // 端口责任：gunzip 在端口内完成（gzip 魔数识别）；正文/资源本就纯字节，gzip 仅 manifest
        return isGzip(raw) ? await decompressGzip(raw) : raw;
      } catch (e) {
        const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
        if (status === 404 || (e as { name?: string }).name === "NoSuchKey") return null;
        throw e;
      }
    },
    async putObject(key: string, body: string | Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const c = await getClient();
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
      const out = opts?.gzip ? await compressGzip(bytes) : bytes;
      await c.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: out }));
    },
  };
}
