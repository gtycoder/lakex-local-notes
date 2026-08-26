import { describe, expect, it } from "vitest";
import { scanLocalAssets, type S3Store, type SyncDbPort } from "./syncEngine.js";

const cfg = { endpoint: "e", region: "r", bucket: "b", accessKeyId: "a", secretAccessKey: "s", prefix: "p" };
const ASSET = { filename: "1787733338672_a1b2c3d4.pdf", size: 42, hash: "h".repeat(64) };

interface CallLog {
  gets: string[];
  puts: string[];
  heads: string[];
  putStreams: Array<{ key: string; size: number }>;
  streamsOpened: string[];
}

/** 流式能力完整的内存 S3Store。 */
function makeS3(log: CallLog): S3Store & { map: Map<string, Uint8Array> } {
  const map = new Map<string, Uint8Array>();
  return {
    map,
    async getObject(key: string) { log.gets.push(key); return map.get(key) ?? null; },
    async putObject(key: string, body: string | Uint8Array) { log.puts.push(key); map.set(key, typeof body === "string" ? new TextEncoder().encode(body) : body); },
    async exists(key: string) { log.heads.push(key); return map.has(key); },
    async putObjectStream(key: string, size: number, open?: () => Promise<unknown | null>) {
      log.putStreams.push({ key, size });
      // 对齐真实实现：上传前先 open 流（这里直接消费，验证调用链）
      if (open) await open();
      map.set(key, new TextEncoder().encode("streamed-" + size));
    },
  };
}

/** 流式能力完整的 SyncDbPort 桩（只实现 scanLocalAssets 需要的部分）。 */
function makeDb(log: CallLog): SyncDbPort {
  return {
    async listLocalAssets() { return [ASSET]; },
    async readLocalAsset() { return new TextEncoder().encode("bytes"); },
    async openLocalAssetStream(noteId: string, filename: string) { log.streamsOpened.push(noteId + "/" + filename); return {}; },
  } as unknown as SyncDbPort;
}

describe("scanLocalAssets 流式 + HEAD 选择", () => {
  it("端口支持时：存在性用 HEAD，上传用流式（显式 size），manifest 带 size/hash", async () => {
    const log: CallLog = { gets: [], puts: [], heads: [], putStreams: [], streamsOpened: [] };
    const s3 = makeS3(log);
    const db = makeDb(log);
    const assets = await scanLocalAssets(cfg, s3, db, "n1");

    expect(log.heads).toEqual(["p/assets/n1/1787733338672_a1b2c3d4.pdf"]); // HEAD 探测
    expect(log.gets).toEqual([]); // 不整对象 GET
    expect(log.putStreams).toEqual([{ key: "p/assets/n1/1787733338672_a1b2c3d4.pdf", size: 42 }]);
    expect(log.puts).toEqual([]); // 不走字节上传
    expect(log.streamsOpened).toEqual(["n1/1787733338672_a1b2c3d4.pdf"]);
    expect(assets).toEqual([ASSET]);
    expect(s3.map.has("p/assets/n1/1787733338672_a1b2c3d4.pdf")).toBe(true);
  });

  it("HEAD 命中（远端已有）时跳过上传，仍返回清单条目", async () => {
    const log: CallLog = { gets: [], puts: [], heads: [], putStreams: [], streamsOpened: [] };
    const s3 = makeS3(log);
    s3.map.set("p/assets/n1/1787733338672_a1b2c3d4.pdf", new TextEncoder().encode("existing"));
    const db = makeDb(log);
    const assets = await scanLocalAssets(cfg, s3, db, "n1");

    expect(log.heads).toHaveLength(1);
    expect(log.putStreams).toEqual([]);
    expect(log.streamsOpened).toEqual([]);
    expect(assets).toEqual([ASSET]);
  });

  it("端口不支持流式/HEAD 时回退：整对象 GET 判存在 + 字节上传（移动端/测试桩兼容）", async () => {
    const log: CallLog = { gets: [], puts: [], heads: [], putStreams: [], streamsOpened: [] };
    const s3 = makeS3(log);
    delete (s3 as { exists?: unknown }).exists;
    delete (s3 as { putObjectStream?: unknown }).putObjectStream;
    const db = { async listLocalAssets() { return [ASSET]; }, async readLocalAsset() { return new TextEncoder().encode("bytes"); } } as unknown as SyncDbPort;
    const assets = await scanLocalAssets(cfg, s3, db, "n1");

    expect(log.gets).toEqual(["p/assets/n1/1787733338672_a1b2c3d4.pdf"]); // 整对象 GET 判存在
    expect(log.puts).toEqual(["p/assets/n1/1787733338672_a1b2c3d4.pdf"]); // 字节上传
    expect(log.putStreams).toEqual([]);
    expect(assets).toEqual([ASSET]);
  });
});
