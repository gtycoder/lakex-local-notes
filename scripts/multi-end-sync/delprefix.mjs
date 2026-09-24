import { createRequire } from 'node:module';
const require = createRequire("/Users/admin/file/local-lake/lake-notes-electron/package.json");
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const client = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, credentials: { accessKeyId: process.env.S3_AK, secretAccessKey: process.env.S3_SK }, forcePathStyle: false });
const prefix = process.env.DELPREFIX;
let token, total = 0;
do {
  const r = await client.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: prefix + '/', ContinuationToken: token }));
  const keys = (r.Contents || []).map(function (o) { return o.Key; });
  if (keys.length) { await client.send(new DeleteObjectsCommand({ Bucket: process.env.S3_BUCKET, Delete: { Objects: keys.map(function (Key) { return { Key }; }) } })); total += keys.length; }
  token = r.IsTruncated ? r.NextContinuationToken : undefined;
} while (token);
console.log('deleted ' + total + ' under ' + prefix + '/');
