import { describe, expect, it } from "vitest";
import { createZip, crc32, ZipWriter } from "./zipArchive.js";

const decoder = new TextDecoder();

/** 极简 ZIP 读取器（只解析 store 方式产物，用于验证写入器结构）。 */
function readZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("no EOCD");
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const entries: Array<{ name: string; data: Uint8Array; crc: number }> = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("bad central directory signature");
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("bad local header signature");
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    entries.push({ name, data: bytes.subarray(dataStart, dataStart + size), crc });
    p += 46 + nameLen;
  }
  return entries;
}

describe("ZIP 写入器（store 方式）", () => {
  it("crc32 标准测试向量", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("createZip 产出可解析的标准 ZIP：中文/路径名 UTF-8、数据与 CRC 正确", () => {
    const csv = new TextEncoder().encode("文本,附件\r\n甲,附件/图.png\r\n");
    const png = new TextEncoder().encode("PNG-BYTES");
    const zip = createZip([
      { name: "数据.csv", data: csv },
      { name: "附件/图 1.png", data: png },
    ]);
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(["数据.csv", "附件/图 1.png"]);
    expect(decoder.decode(entries[0].data)).toBe("文本,附件\r\n甲,附件/图.png\r\n");
    expect(decoder.decode(entries[1].data)).toBe("PNG-BYTES");
    expect(entries[0].crc).toBe(crc32(csv));
    expect(entries[1].crc).toBe(crc32(png));
  });

  it("流式 ZipWriter 分块写出后拼接，结构与 createZip 等价", () => {
    const chunks: Uint8Array[] = [];
    const writer = new ZipWriter((chunk) => chunks.push(chunk));
    writer.addFile("a.txt", new TextEncoder().encode("A"));
    writer.addFile("目录/b.txt", new TextEncoder().encode("BB"));
    writer.finish();
    let length = 0;
    for (const chunk of chunks) length += chunk.length;
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
    const entries = readZip(joined);
    expect(entries.map((e) => e.name)).toEqual(["a.txt", "目录/b.txt"]);
    expect(decoder.decode(entries[0].data)).toBe("A");
    expect(decoder.decode(entries[1].data)).toBe("BB");
  });
});
