/**
 * 移动端 S3Store adapter（HttpFetcher 注入点移动端实现）：
 * 共享 syncEngine（src/core）的对象读写端口 → @aws-sdk/client-s3 + CapacitorHttpHandler（原生 OkHttp）。
 */
import type { S3Store, SyncConfig } from "../core/syncEngine.js";
import { CapacitorHttpHandler } from "./capacitorHttpHandler";

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
          requestHandler: new CapacitorHttpHandler(),
        })
      );
    }
    return client;
  }

  return {
    async getObject(key: string): Promise<string | null> {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const c = await getClient();
      try {
        const out = await c.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        return out.Body ? await out.Body.transformToString() : null;
      } catch (e) {
        const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
        if (status === 404 || (e as { name?: string }).name === "NoSuchKey") return null;
        throw e;
      }
    },
    async putObject(key: string, body: string | Uint8Array): Promise<void> {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const c = await getClient();
      await c.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body }));
    },
  };
}
