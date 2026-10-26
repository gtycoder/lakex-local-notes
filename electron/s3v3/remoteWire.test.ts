import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { decodeRemoteObject } from "./s3Remote.js";
import { isGzipMetadataKey } from "../../src/core/s3v3Keys.js";

/** P0：v3 S3 端口只对 meta/ 与 quick-notes/meta/ 解压；正文/附件按原始字节返回。 */
describe("v3 远端对象 gzip 判定（按 key，不按魔数）", () => {
  it("元数据 key 才允许 gzip 标记", () => {
    expect(isGzipMetadataKey("meta/index/abc.json")).toBe(true);
    expect(isGzipMetadataKey("meta/assets/n1/abc.json")).toBe(true);
    expect(isGzipMetadataKey("quick-notes/meta/index/abc.json")).toBe(true);
    expect(isGzipMetadataKey("quick-notes/meta/assets/q1/abc.json")).toBe(true);
    expect(isGzipMetadataKey("objects/n1-abc.lake")).toBe(false);
    expect(isGzipMetadataKey("assets/n1/a.png")).toBe(false);
    expect(isGzipMetadataKey("quick-notes/assets/q1/a.png")).toBe(false);
    expect(isGzipMetadataKey("quick-notes/objects/abc.qnote")).toBe(false);
  });

  it("元数据 gzip 对象解压", () => {
    const json = new TextEncoder().encode(JSON.stringify({ v: 3, notes: [] }));
    const gz = new Uint8Array(gzipSync(Buffer.from(json)));
    expect(new TextDecoder().decode(decodeRemoteObject("meta/index/x.json", gz))).toBe(JSON.stringify({ v: 3, notes: [] }));
  });

  it("正文/附件即使以 1f 8b 开头也不解压（曾误判为 gzip ⇒ Z_DATA_ERROR）", () => {
    // 构造一个"合法 gzip 字节"当作二进制附件内容：魔数就是 1f 8b
    const raw = new Uint8Array(gzipSync(Buffer.from("this-is-really-an-attachment")));
    expect(raw[0]).toBe(0x1f);
    expect(raw[1]).toBe(0x8b);
    const got = decodeRemoteObject("assets/n1/a.bin", raw);
    expect(got).toEqual(raw);
    const body = decodeRemoteObject("objects/n1-" + "a".repeat(64) + ".lake", raw);
    expect(body).toEqual(raw);
    const qa = decodeRemoteObject("quick-notes/assets/q1/a.bin", raw);
    expect(qa).toEqual(raw);
  });

  it("元数据 key 但字节不是 gzip ⇒ 原样返回", () => {
    const plain = new TextEncoder().encode("{\"v\":3}");
    expect(decodeRemoteObject("meta/pointer.json", plain)).toEqual(plain);
  });
});
