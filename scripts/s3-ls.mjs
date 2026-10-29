#!/usr/bin/env node
/**
 * S3 云端对象查看/验证工具（dev 用，只读）。
 *
 * 用法：
 *   node scripts/s3-ls.mjs                     # 列出全部对象（按 objects/assets/manifests/quick-notes 分组）
 *   node scripts/s3-ls.mjs --note <noteId>     # 只看某笔记的 objects/{id}-* 与 assets/{id}/（删除验证用）
 *   node scripts/s3-ls.mjs --prefix objects/   # 任意前缀过滤
 *   node scripts/s3-ls.mjs --count             # 只统计数量
 *   node scripts/s3-ls.mjs --json              # 输出 JSON（便于 grep 键）
 *
 * 配置全部来自环境变量（不会内置共享凭据）：
 *   S3_ENDPOINT S3_REGION S3_BUCKET S3_PREFIX S3_AK S3_SK
 */
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const cfg = {
  endpoint: process.env.S3_ENDPOINT || "https://s3.cn-north-1.qiniucs.com",
  region: process.env.S3_REGION || "cn-north-1",
  bucket: process.env.S3_BUCKET || "local-lake-hebei",
  prefix: process.env.S3_PREFIX || "lakex-local-notes",
  accessKeyId: process.env.S3_AK?.trim() || "",
  secretAccessKey: process.env.S3_SK?.trim() || "",
};

if (!cfg.accessKeyId || !cfg.secretAccessKey) {
  console.error("缺少 S3 凭据：请设置 S3_AK 和 S3_SK 环境变量。");
  process.exit(1);
}

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const noteId = opt("--note");
const prefixFilter = opt("--prefix");
const countOnly = args.includes("--count");
const asJson = args.includes("--json");

const client = new S3Client({
  region: cfg.region,
  endpoint: cfg.endpoint,
  forcePathStyle: false,
  credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
});

async function listAll(fullPrefix) {
  const out = [];
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: cfg.bucket,
      Prefix: fullPrefix,
      ContinuationToken: token,
    }));
    for (const obj of res.Contents ?? []) {
      if (typeof obj.Key !== "string") continue;
      out.push({ key: obj.Key, size: obj.Size ?? 0, lastModified: obj.LastModified?.toISOString() ?? "" });
    }
    token = res.NextContinuationToken;
  } while (token);
  return out;
}

const fullPrefix = cfg.prefix ? `${cfg.prefix}/` : "";
const listPrefix = prefixFilter ? `${fullPrefix}${prefixFilter}` : fullPrefix;
const items = await listAll(listPrefix);

let filtered = items;
if (noteId) {
  const safe = noteId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  filtered = items.filter((i) => i.key.includes(`objects/${safe}-`) || i.key.includes(`assets/${safe}/`) || i.key.includes(`/objects/${safe}-`) || i.key.includes(`/assets/${safe}/`));
}

if (asJson) {
  console.log(JSON.stringify(filtered, null, 2));
} else if (countOnly) {
  console.log(`共 ${filtered.length} 个对象（前缀 ${listPrefix}${noteId ? `，笔记 ${noteId}` : ""}）`);
} else {
  // 分组输出
  const groups = { objects: [], assets: [], manifests: [], "quick-notes": [], other: [] };
  for (const it of filtered) {
    const rel = it.key.startsWith(fullPrefix) ? it.key.slice(fullPrefix.length) : it.key;
    if (rel.startsWith("objects/")) groups.objects.push(it);
    else if (rel.startsWith("assets/")) groups.assets.push(it);
    else if (rel.startsWith("manifests/")) groups.manifests.push(it);
    else if (rel.startsWith("quick-notes/")) groups["quick-notes"].push(it);
    else groups.other.push(it);
  }
  console.log(`Bucket: ${cfg.bucket}  前缀: ${fullPrefix}  共 ${filtered.length} 个对象\n`);
  for (const [g, list] of Object.entries(groups)) {
    if (list.length === 0) continue;
    console.log(`── ${g} (${list.length}) ──`);
    for (const it of list.slice(0, 200)) {
      console.log(`  ${it.key}  ${it.size}B  ${it.lastModified}`);
    }
    if (list.length > 200) console.log(`  … 还有 ${list.length - 200} 个`);
  }
}
