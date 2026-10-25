import { describe, expect, it } from "vitest";
import { createS3v3RemoteWithClient } from "./s3v3Remote.js";

class FakeS3 {
  store = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async send(command: unknown): Promise<unknown> {
    const cmd = command as { constructor: { name: string }; input: Record<string, unknown> };
    const input = cmd.input;
    switch (cmd.constructor.name) {
      case "PutObjectCommand": {
        const body = input.Body as Uint8Array;
        this.store.set(String(input.Key), { bytes: new Uint8Array(body), gzip: input.ContentEncoding === "gzip" });
        return {};
      }
      case "GetObjectCommand": {
        const o = this.store.get(String(input.Key));
        if (!o) { const e = new Error("missing"); (e as unknown as { name: string }).name = "NoSuchKey"; throw e; }
        return { Body: { transformToByteArray: async () => o.bytes } };
      }
      case "ListObjectsV2Command": {
        const prefix = String(input.Prefix ?? "");
        const keys = [...this.store.keys()].filter((k) => k.startsWith(prefix)).sort();
        return { Contents: keys.map((k) => ({ Key: k, Size: this.store.get(k)!.bytes.length, LastModified: new Date(0) })), IsTruncated: false };
      }
      case "DeleteObjectsCommand": {
        const del = input.Delete as { Objects: Array<{ Key: string }> };
        for (const o of del.Objects) this.store.delete(o.Key);
        return { Deleted: del.Objects.length };
      }
      default: throw new Error("unexpected command " + cmd.constructor.name);
    }
  }
}

describe("移动端 S3v3Remote（fake S3 client）", () => {
  it("prefix 隔离、gzip 往返、list 相对 key、deleteByPrefix", async () => {
    const fake = new FakeS3();
    const remote = createS3v3RemoteWithClient(fake as never, "bucket", "test/prefix");
    await remote.put("objects/n1-" + "a".repeat(64) + ".lake", new TextEncoder().encode("body"), { gzip: true });
    expect(fake.store.has("test/prefix/objects/n1-" + "a".repeat(64) + ".lake")).toBe(true);
    const got = await remote.get("objects/n1-" + "a".repeat(64) + ".lake");
    expect(new TextDecoder().decode(got!)).toBe("body");
    expect(await remote.get("missing")).toBeNull();
    const items = await remote.list("objects/");
    expect(items.map((x: { key: string }) => x.key)).toEqual(["objects/n1-" + "a".repeat(64) + ".lake"]);
    expect(items[0].size).toBeGreaterThan(0);
    expect(await remote.deleteByPrefix("objects/")).toBe(1);
    expect(await remote.get("objects/n1-" + "a".repeat(64) + ".lake")).toBeNull();
  });
});
