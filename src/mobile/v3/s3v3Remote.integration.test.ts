import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { createS3v3RemoteWithClient } from "./s3v3Remote.js";

const enabled = process.env.S3V3_IT === "1" && !!process.env.S3V3_ENDPOINT && !!process.env.S3V3_BUCKET && !!process.env.S3V3_AK && !!process.env.S3V3_SK;
const describeIt = enabled ? describe : describe.skip;

describeIt("移动端 S3v3Remote · 真实 S3（Node 默认 handler 验证端口逻辑）", () => {
  it("gzip put/get、list 相对 key、deleteByPrefix 清空", async () => {
    const prefix = (process.env.S3V3_PREFIX || "lake-notes-v3-dev1") + "/_mobile_remote/" + randomUUID();
    const client = new S3Client({
      region: process.env.S3V3_REGION || "cn-north-1",
      endpoint: process.env.S3V3_ENDPOINT!,
      credentials: { accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK! },
      forcePathStyle: false,
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, prefix);
    try {
      const key = "meta/pointer.json";
      const payload = new TextEncoder().encode(JSON.stringify({ hello: "mobile-v3", n: 1 }));
      await remote.put(key, payload, { gzip: true });
      const got = await remote.get(key);
      expect(new TextDecoder().decode(got!)).toBe(new TextDecoder().decode(payload));
      expect(await remote.get("missing")).toBeNull();
      await remote.put("objects/a.lake", new TextEncoder().encode("body"));
      const items = await remote.list("");
      expect(items.map((x) => x.key)).toEqual(expect.arrayContaining(["meta/pointer.json", "objects/a.lake"]));
      expect(await remote.deleteByPrefix("")).toBeGreaterThanOrEqual(2);
      expect((await remote.list("")).length).toBe(0);
    } finally {
      await remote.deleteByPrefix("").catch(() => {});
    }
  }, 120_000);
});
