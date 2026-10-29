import { createRequire } from "node:module";
const require = createRequire("/Users/admin/file/local-lake/lakex-local-notes/package.json");
const { S3Client, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const c = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, credentials: { accessKeyId: process.env.S3_AK, secretAccessKey: process.env.S3_SK }, forcePathStyle: false });
const r = await c.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, MaxKeys: 3 }));
console.log("S3_OK keyCount=" + (r.KeyCount ?? 0) + " sample=" + JSON.stringify((r.Contents||[]).map(o=>o.Key)));
