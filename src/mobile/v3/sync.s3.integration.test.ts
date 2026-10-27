import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNote, readNote } from "../data/noteRepository.js";
import { saveQuickNote, readQuickNote } from "../data/quickNotesRepository.js";
import { runMobileV3Sync } from "./sync.js";
import { createS3v3RemoteWithClient } from "./s3v3Remote.js";

const enabled = process.env.S3V3_IT === "1" && !!process.env.S3V3_ENDPOINT && !!process.env.S3V3_BUCKET && !!process.env.S3V3_AK && !!process.env.S3V3_SK;
const describeIt = enabled ? describe : describe.skip;

describeIt("移动端 v3 真实 S3：文档 + 小记双端", () => {
  let prefix = "";
  let client: S3Client;
  beforeAll(() => {
    prefix = (process.env.S3V3_PREFIX || "lake-notes-v3-dev1") + "/_mobile_e2e/" + randomUUID();
    client = new S3Client({ region: process.env.S3V3_REGION || "cn-north-1", endpoint: process.env.S3V3_ENDPOINT!, credentials: { accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK! }, forcePathStyle: false });
  });
  afterAll(async () => {
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, prefix);
    await remote.deleteByPrefix("").catch(() => {});
  });
  it("A 上传 → B 拉取文档与小记", async () => {
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, prefix);
    const a = new SqlJsAsyncDb(await SqlJsDb.open());
    await applyMobileSchema(a);
    await createNote(a, "n1", "Doc", "hello-real-s3", null, new Map());
    await saveQuickNote(a, "q1", "quick-real-s3", []);
    const ra = await runMobileV3Sync(a, { endpoint: process.env.S3V3_ENDPOINT!, region: process.env.S3V3_REGION || "cn-north-1", bucket: process.env.S3V3_BUCKET!, accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK!, prefix }, { remote, deviceId: "A", emptyCloud: "upload" });
    expect(ra.published).toBe(true);
    const b = new SqlJsAsyncDb(await SqlJsDb.open());
    await applyMobileSchema(b);
    const rb = await runMobileV3Sync(b, { endpoint: process.env.S3V3_ENDPOINT!, region: process.env.S3V3_REGION || "cn-north-1", bucket: process.env.S3V3_BUCKET!, accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK!, prefix }, { remote, deviceId: "B" });
    expect(rb.downloadedNotes).toBeGreaterThanOrEqual(1);
    expect((await readNote(b, "n1"))?.content).toBe("hello-real-s3");
    expect((await readQuickNote(b, "q1"))?.content.text).toBe("quick-real-s3");
    await a.close(); await b.close();
  }, 120_000);
});
