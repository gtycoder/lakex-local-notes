import { describe, expect, it } from "vitest";
import { scanLocalAssets, type S3Store, type SyncDbPort } from "./syncEngine.js";

const cfg = { endpoint: "e", region: "r", bucket: "b", accessKeyId: "a", secretAccessKey: "s", prefix: "p" };
const PDF = { filename: "1787733338672_a1b2c3d4.pdf", size: 42, hash: "h".repeat(64) };
const PNG = { filename: "1787733338699_eeee1111.png", size: 10, hash: "i".repeat(64) };

interface CallLog {
  gets: string[];
  puts: string[];
  putStreams: Array<{ key: string; size: number }>;
  streamsOpened: string[];
}

/** 流式能力完整的内存 S3Store（不再提供 exists——同步引擎已改用「远端清单声明差集」判存在）。 */
function makeS3(log: CallLog): S3Store & { map: Map<string, Uint8Array> } {
  const map = new Map<string, Uint8Array>();
  return {
    map,
    async getObject(key: string) { log.gets.push(key); return map.get(key) ?? null; },
    async putObject(key: string, body: string | Uint8Array) { log.puts.push(key); map.set(key, typeof body === "string" ? new TextEncoder().encode(body) : body); },
    async putObjectStream(key: string, size: number, open?: () => Promise<unknown | null>) {
      log.putStreams.push({ key, size });
      if (open) await open();
      map.set(key, new TextEncoder().encode("streamed-" + size));
    },
  };
}

/** 流式能力完整的 SyncDbPort 桩（只实现 scanLocalAssets 需要的部分）。 */
function makeDb(log: CallLog, assets = [PDF]): SyncDbPort {
  return {
    async listLocalAssets() { return assets; },
    async readLocalAsset() { return new TextEncoder().encode("bytes"); },
    async openLocalAssetStream(noteId: string, filename: string) { log.streamsOpened.push(noteId + "/" + filename); return {}; },
  } as unknown as SyncDbPort;
}

describe("scanLocalAssets 远端清单声明差集 + 流式选择", () => {
  it("未声明的资产：不 HEAD/不 GET，直接流式上传（显式 size），返回完整清单条目", async () => {
    const log: CallLog = { gets: [], puts: [], putStreams: [], streamsOpened: [] };
    const s3 = makeS3(log);
    const db = makeDb(log);
    const assets = await scanLocalAssets(cfg, s3, db, "n1");

    expect(log.gets).toEqual([]);            // 不再整对象 GET 判存在
    expect(log.putStreams).toEqual([{ key: "p/assets/n1/1787733338672_a1b2c3d4.pdf", size: 42 }]);
    expect(log.puts).toEqual([]);
    expect(log.streamsOpened).toEqual(["n1/1787733338672_a1b2c3d4.pdf"]);
    expect(assets).toEqual([PDF]);
    expect(s3.map.has("p/assets/n1/1787733338672_a1b2c3d4.pdf")).toBe(true);
  });

  it("远端清单已声明的资产 → 跳过上传（无任何网络探测），但仍全量返回清单条目（GC 安全）", async () => {
    const log: CallLog = { gets: [], puts: [], putStreams: [], streamsOpened: [] };
    const s3 = makeS3(log);
    const db = makeDb(log);
    const cloud = new Set([PDF.filename]);
    const assets = await scanLocalAssets(cfg, s3, db, "n1", undefined, cloud);

    expect(log.putStreams).toEqual([]);      // 不重复上传
    expect(log.puts).toEqual([]);
    expect(log.gets).toEqual([]);            // 也不 GET 探测
    expect(log.streamsOpened).toEqual([]);
    expect(assets).toEqual([PDF]);           // 关键：清单仍完整声明该资产
  });

  it("混合：已声明的跳过、未声明的上传（差集），一次扫描只传缺的", async () => {
    const log: CallLog = { gets: [], puts: [], putStreams: [], streamsOpened: [] };
    const s3 = makeS3(log);
    const db = makeDb(log, [PDF, PNG]);
    const cloud = new Set([PDF.filename]);   // PDF 已在云端，PNG 是新增
    const assets = await scanLocalAssets(cfg, s3, db, "n1", undefined, cloud);

    expect(log.putStreams.map((p) => p.key)).toEqual(["p/assets/n1/1787733338699_eeee1111.png"]);
    expect(assets).toEqual([PDF, PNG]);       // 两者都写进 manifest.assets
  });

  it("端口不支持流式（移动端/测试桩）：未声明资产走字节上传路径", async () => {
    const log: CallLog = { gets: [], puts: [], putStreams: [], streamsOpened: [] };
    const s3 = makeS3(log);
    delete (s3 as { putObjectStream?: unknown }).putObjectStream;
    const db = { async listLocalAssets() { return [PDF]; }, async readLocalAsset() { return new TextEncoder().encode("bytes"); } } as unknown as SyncDbPort;
    const assets = await scanLocalAssets(cfg, s3, db, "n1");

    expect(log.puts).toEqual(["p/assets/n1/1787733338672_a1b2c3d4.pdf"]); // 直接字节上传，不 GET 探测
    expect(log.gets).toEqual([]);
    expect(assets).toEqual([PDF]);
  });
});
