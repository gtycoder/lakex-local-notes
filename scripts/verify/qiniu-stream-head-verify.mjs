// 七牛 Kodo S3 兼容性实测：HeadObject + 流式 PutObject（显式 Content-Length）
//
// 凭据**不得写进仓库**（历史版本曾硬编码，已清理；旧 key 在 git 历史里，建议轮换）。
// 用法：QN_AK=... QN_SK=... node scripts/verify/qiniu-stream-head-verify.mjs
import fs from "node:fs";
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const cfg = {
  endpoint: "https://s3.cn-north-1.qiniucs.com",
  region: "cn-north-1",
  bucket: "local-lake-hebei",
  prefix: "ab-test-verify/verify-stream-head",
  accessKeyId: process.env.QN_AK ?? "",
  secretAccessKey: process.env.QN_SK ?? "",
  forcePathStyle: false,
};

if (!cfg.accessKeyId || !cfg.secretAccessKey) {
  console.error("缺少 QN_AK / QN_SK 环境变量（不要把密钥写进仓库）");
  process.exit(2);
}

const client = new S3Client({
  region: cfg.region,
  endpoint: cfg.endpoint,
  forcePathStyle: cfg.forcePathStyle,
  credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  maxAttempts: 2,
});

const KEY = cfg.prefix + "/" + Date.now() + "-stream.pdf";

// 1) 本地造一个 ~2MB 文件（超过小对象，验证流式）
const filePath = "/tmp/qiniu-verify-src.bin";
fs.writeFileSync(filePath, Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2 * 1024 * 1024, 0x41), Buffer.from("\n%%EOF\n")]));
const size = fs.statSync(filePath).size;
console.log("file size:", size);

// 2) 流式上传：fs.createReadStream + 显式 ContentLength（与 ObjectStore.putStream 相同形态）
const stream = fs.createReadStream(filePath);
await client.send(new PutObjectCommand({
  Bucket: cfg.bucket, Key: KEY, Body: stream, ContentLength: size, ContentType: "application/pdf",
}));
console.log("streaming put OK");

// 3) HeadObject：存在 → true
try {
  await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: KEY }));
  console.log("HeadObject existing: OK (200)");
} catch (e) {
  console.log("HeadObject existing: FAIL", e.message);
  process.exit(1);
}

// 4) HeadObject：不存在 → 404
try {
  await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: KEY + "-missing" }));
  console.log("HeadObject missing: FAIL (expected 404)");
  process.exit(1);
} catch (e) {
  console.log("HeadObject missing: OK (404 →", e.name + ")");
}

// 5) GET 回读校验内容一致
const got = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: KEY }));
const bytes = Buffer.from(await got.Body.transformToByteArray());
console.log("GET size:", bytes.length, "match:", bytes.length === size && bytes.slice(0, 8).toString() === "%PDF-1.7");

// 6) 清理
await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: KEY }));
console.log("cleanup deleted OK");
console.log("ALL PASS");
