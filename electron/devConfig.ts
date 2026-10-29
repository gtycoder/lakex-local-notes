/**
 * Optional development-only S3 seed.
 *
 * Credentials intentionally come only from the environment. A fresh dev
 * profile without these variables remains local-only until the user configures
 * S3 in Settings, which is safer than shipping a shared credential in source.
 */
export interface DevS3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

const DEFAULT_ENDPOINT = "https://s3.cn-north-1.qiniucs.com";
const DEFAULT_REGION = "cn-north-1";
const DEFAULT_BUCKET = "local-lake-hebei";
const DEFAULT_PREFIX = "lakex-local-notes";

function envOrDefault(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key]?.trim();
  return value || fallback;
}

/** Read the optional dev seed without ever embedding credentials in code. */
export function readDevS3Settings(env: NodeJS.ProcessEnv = process.env): DevS3Settings | null {
  const accessKeyId = env.LAKE_DEV_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.LAKE_DEV_S3_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) return null;

  return {
    endpoint: envOrDefault(env, "LAKE_DEV_S3_ENDPOINT", DEFAULT_ENDPOINT),
    region: envOrDefault(env, "LAKE_DEV_S3_REGION", DEFAULT_REGION),
    bucket: envOrDefault(env, "LAKE_DEV_S3_BUCKET", DEFAULT_BUCKET),
    prefix: envOrDefault(env, "LAKE_DEV_S3_PREFIX", DEFAULT_PREFIX),
    accessKeyId,
    secretAccessKey,
    forcePathStyle: false,
  };
}
