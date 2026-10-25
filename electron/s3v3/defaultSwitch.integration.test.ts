import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { syncNowViaEngine } from "../syncEngineController.js";
import { Store } from "../store.js";
import { S3v3S3Remote } from "./s3Remote.js";

const enabled = process.env.S3V3_IT === "1" && !!process.env.S3V3_ENDPOINT && !!process.env.S3V3_BUCKET && !!process.env.S3V3_AK && !!process.env.S3V3_SK;
const describeIt = enabled ? describe : describe.skip;

describeIt("默认协议转正：syncNowViaEngine 无 env 走 v3，空云端从本地初始化", () => {
  it("真实 S3：首次默认同步上传 + 二次空跑", async () => {
    const prefix = (process.env.S3V3_PREFIX || "lake-notes-v3-dev1") + "/_cutover/" + randomUUID();
    const remote = new S3v3S3Remote({ endpoint: process.env.S3V3_ENDPOINT!, region: process.env.S3V3_REGION || "cn-north-1", bucket: process.env.S3V3_BUCKET!, accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK!, prefix, forcePathStyle: false });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-cutover-"));
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Doc A", "<p>hello v3 default</p>", [], "cutover-a");
    store.saveS3Settings({ endpoint: process.env.S3V3_ENDPOINT!, region: process.env.S3V3_REGION || "cn-north-1", bucket: process.env.S3V3_BUCKET!, accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK!, prefix, forcePathStyle: false });
    delete process.env.LAKE_SYNC_PROTOCOL;
    try {
      const r1 = await syncNowViaEngine(store, () => undefined);
      expect(r1.manifestId.startsWith("v3-g")).toBe(true);
      expect(r1.uploaded).toBeGreaterThanOrEqual(1);
      const r2 = await syncNowViaEngine(store, () => undefined);
      expect(r2.manifestId.startsWith("v3-g")).toBe(true);
      const ptr = await remote.get("meta/pointer.json");
      expect(ptr).not.toBeNull();
    } finally {
      await remote.deleteByPrefix("").catch(() => {});
    }
  }, 120_000);
});
