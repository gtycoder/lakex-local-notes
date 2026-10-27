#!/usr/bin/env node
/**
 * S3 条件写 / 一致性 / 清理能力探测（v3 同步协议迁移前置实验）
 *
 * 用法：
 *   S3V3_ENDPOINT=... S3V3_REGION=... S3V3_BUCKET=... S3V3_PREFIX=... \
 *   S3V3_AK=... S3V3_SK=... node scripts/s3-v3-probe.mjs
 *
 * 说明：
 * - 只操作 S3V3_PREFIX 下的 _s3v3probe/<runId>/ 键，结束会尝试清理。
 * - 不打印任何密钥；报告写 /tmp/s3v3-probe-report.json。
 * - 结果用于决定 v3 走「条件写 (If-Match)」还是「持久删除意图」降级。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  GetBucketVersioningCommand,
  GetObjectLockConfigurationCommand,
  GetBucketReplicationCommand,
} from "@aws-sdk/client-s3";

const E = process.env;
const need = ["S3V3_ENDPOINT", "S3V3_REGION", "S3V3_BUCKET", "S3V3_PREFIX", "S3V3_AK", "S3V3_SK"];
for (const k of need) {
  if (!E[k]) {
    console.error("缺少环境变量:", k);
    process.exit(2);
  }
}
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14) + "-" + crypto.randomBytes(3).toString("hex");
const basePrefix = E.S3V3_PREFIX.replace(/^\/+|\/+$/g, "");
const root = basePrefix + "/_s3v3probe/" + runId;
const client = new S3Client({
  region: E.S3V3_REGION,
  endpoint: E.S3V3_ENDPOINT,
  credentials: { accessKeyId: E.S3V3_AK, secretAccessKey: E.S3V3_SK },
  forcePathStyle: String(E.S3V3_FORCE_PATH_STYLE || "false") === "true",
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
const Bucket = E.S3V3_BUCKET;
const created = new Set();
const results = [];
const startedAt = Date.now();
const mask = (s) => String(s || "").replace(new RegExp((E.S3V3_AK || "").replace(/[.*+?^$()|[\]\\]/g, "\\$&"), "g"), "***").replace(new RegExp((E.S3V3_SK || "").replace(/[.*+?^$()|[\]\\]/g, "\\$&"), "g"), "***");

function record(name, ok, detail) {
  results.push({ name, ok, detail: typeof detail === "string" ? mask(detail) : detail });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " — " + (typeof detail === "string" ? mask(detail) : JSON.stringify(detail)) : ""));
}
function errInfo(e) {
  return { name: e?.name, status: e?.$metadata?.httpStatusCode, code: e?.Code || e?.code, message: mask(e?.message || String(e)).slice(0, 260) };
}
const keyOf = (p) => root + "/" + p;
const body = (s) => Buffer.from(typeof s === "string" ? s : JSON.stringify(s));
async function put(Key, Body, extra = {}) {
  const out = await client.send(new PutObjectCommand({ Bucket, Key, Body, ...extra }));
  created.add(Key);
  return out;
}
async function getText(Key) {
  const out = await client.send(new GetObjectCommand({ Bucket, Key }));
  const chunks = [];
  for await (const c of out.Body) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}
async function list(prefix) {
  const out = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, MaxKeys: 1000 }));
  return (out.Contents || []).map((c) => c.Key);
}

try {
  // 1) 覆盖写后读一致性
  const rwKey = keyOf("rw.txt");
  let rwBad = 0;
  let rwMaxMs = 0;
  for (let i = 0; i < 30; i++) {
    const t0 = Date.now();
    await put(rwKey, "v" + i);
    const got = await getText(rwKey);
    rwMaxMs = Math.max(rwMaxMs, Date.now() - t0);
    if (got !== "v" + i) rwBad++;
  }
  record("overwrite-read-after-write (30x)", rwBad === 0, { mismatches: rwBad, maxMs: rwMaxMs });

  // 2) 条件写：If-None-Match *
  const condKey = keyOf("cond.txt");
  await put(condKey, "a");
  let ifNoneRejected = false;
  let ifNoneDetail = null;
  try {
    await put(condKey, "b", { IfNoneMatch: "*" });
  } catch (e) {
    ifNoneRejected = true;
    ifNoneDetail = errInfo(e);
  }
  record("conditional PUT If-None-Match:* on existing key is rejected", ifNoneRejected, ifNoneDetail || "服务器接受了写入（不支持条件写或忽略该头）");

  // 3) 条件写：If-Match 正确/错误 ETag
  let etag = null;
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket, Key: condKey }));
    etag = head.ETag;
  } catch (e) { /* ignore */ }
  let ifMatchOk = false;
  let ifMatchDetail = null;
  if (etag) {
    try {
      await put(condKey, "c", { IfMatch: etag });
      ifMatchOk = true;
    } catch (e) { ifMatchDetail = errInfo(e); }
  }
  record("conditional PUT If-Match correct ETag succeeds", ifMatchOk, ifMatchDetail || (etag ? undefined : "未取到 ETag"));
  let ifMatchRejected = false;
  let ifMatchRejDetail = null;
  try {
    await put(condKey, "d", { IfMatch: '"00000000000000000000000000000000"' });
  } catch (e) { ifMatchRejected = true; ifMatchRejDetail = errInfo(e); }
  record("conditional PUT If-Match wrong ETag is rejected", ifMatchRejected, ifMatchRejDetail || "错 ETag 也写成功");

  // 4) 并发抢锁（If-None-Match:*），20 轮
  const raceRounds = 20;
  let doubleHold = 0;
  const raceDetail = [];
  for (let i = 0; i < raceRounds; i++) {
    const k = keyOf("lock-" + i + ".json");
    const payloads = ["A", "B"];
    const outcomes = await Promise.allSettled(payloads.map((p) => put(k, p, { IfNoneMatch: "*" })));
    const okCount = outcomes.filter((o) => o.status === "fulfilled").length;
    if (okCount > 1) doubleHold++;
    if (i < 3) raceDetail.push(outcomes.map((o) => (o.status === "fulfilled" ? "ok" : (o.reason?.name || "err"))));
  }
  record("concurrent lock acquire has no double-hold (If-None-Match:*)", doubleHold === 0, { rounds: raceRounds, doubleHold, samples: raceDetail });

  // 5) PUT 后 LIST 可见性
  const listKey = keyOf("list-vis.txt");
  await put(listKey, "x");
  const listed = await list(listKey);
  record("list-after-put sees key immediately", listed.includes(listKey), { found: listed.length });

  // 6) DeleteObjects 批量
  const delKeys = [];
  for (let i = 0; i < 10; i++) {
    const k = keyOf("del-" + i + ".txt");
    await put(k, "d" + i);
    delKeys.push(k);
  }
  let deleteOk = false;
  let deleteDetail = null;
  try {
    const out = await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: delKeys.map((Key) => ({ Key })), Quiet: false } }));
    delKeys.forEach((k) => created.delete(k));
    const still = await list(root + "/del-");
    deleteOk = still.length === 0;
    deleteDetail = { deleted: out.Deleted?.length || 0, errors: out.Errors?.length || 0, still: still.length };
  } catch (e) { deleteDetail = errInfo(e); }
  record("deleteObjects batch works", deleteOk, deleteDetail);

  // 7) 桶配置（versioning / object lock / replication）
  for (const [name, Cmd] of [["getBucketVersioning", GetBucketVersioningCommand], ["getObjectLockConfiguration", GetObjectLockConfigurationCommand], ["getBucketReplication", GetBucketReplicationCommand]]) {
    try {
      const out = await client.send(new Cmd({ Bucket }));
      record(name, true, JSON.stringify(out).slice(0, 300));
    } catch (e) {
      record(name, false, errInfo(e));
    }
  }

  // 8) multipart 中止残留
  let mpOk = false;
  let mpDetail = null;
  const mpKey = keyOf("multipart.bin");
  try {
    const createdMp = await client.send(new CreateMultipartUploadCommand({ Bucket, Key: mpKey }));
    const UploadId = createdMp.UploadId;
    const part = await client.send(new UploadPartCommand({ Bucket, Key: mpKey, UploadId, PartNumber: 1, Body: crypto.randomBytes(5 * 1024 * 1024) }));
    const listedMp = await client.send(new ListMultipartUploadsCommand({ Bucket, Prefix: root + "/multipart" }));
    const before = (listedMp.Uploads || []).length;
    await client.send(new AbortMultipartUploadCommand({ Bucket, Key: mpKey, UploadId }));
    await new Promise((r) => setTimeout(r, 1000));
    const listedMp2 = await client.send(new ListMultipartUploadsCommand({ Bucket, Prefix: root + "/multipart" }));
    const after = (listedMp2.Uploads || []).length;
    mpOk = before >= 1 && after === 0;
    mpDetail = { before, after, partETag: !!part.ETag };
  } catch (e) { mpDetail = errInfo(e); }
  record("multipart abort removes in-progress upload", mpOk, mpDetail);
} catch (e) {
  record("fatal", false, errInfo(e));
} finally {
  // 清理：删除所有已创建键（分批）
  try {
    const keys = [...created];
    for (let i = 0; i < keys.length; i += 200) {
      const chunk = keys.slice(i, i + 200);
      await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }));
    }
    const leftover = await list(root + "/");
    record("cleanup", leftover.length === 0, { leftover: leftover.length });
  } catch (e) {
    record("cleanup", false, errInfo(e));
  }
  const report = { runId, endpoint: E.S3V3_ENDPOINT, bucket: Bucket, prefix: basePrefix, elapsedMs: Date.now() - startedAt, results };
  fs.writeFileSync("/tmp/s3v3-probe-report.json", JSON.stringify(report, null, 2));
  console.log("\n报告: /tmp/s3v3-probe-report.json");
}
