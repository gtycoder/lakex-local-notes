/**
 * 仅测试使用：读 store-only zip（EOCD → 中央目录 → 本地头偏移），供 vitest 自证写入结果。
 * 生产代码不 import 本文件（移动端解压由 Kotlin ZipInputStream 负责）。
 */
import fs from "node:fs";
import { crc32 } from "./zipStore.js";

export interface ReadZipEntry {
  name: string;
  data: Buffer;
  crc: number;
}

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export function readStoreZip(filePath: string): ReadZipEntry[] {
  const buffer = fs.readFileSync(filePath);
  let eocd = -1;
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === EOCD_SIG) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error("zip 缺少 EOCD");
  let count = buffer.readUInt16LE(eocd + 10);
  let centralOffset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff) {
    const locator = eocd - 20;
    if (buffer.readUInt32LE(locator) !== ZIP64_LOCATOR_SIG) throw new Error("zip64 locator 缺失");
    const zip64Eocd = Number(buffer.readBigUInt64LE(locator + 8));
    if (buffer.readUInt32LE(zip64Eocd) !== ZIP64_EOCD_SIG) throw new Error("zip64 EOCD 缺失");
    count = Number(buffer.readBigUInt64LE(zip64Eocd + 32));
    centralOffset = Number(buffer.readBigUInt64LE(zip64Eocd + 48));
  }
  const entries: ReadZipEntry[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIG) throw new Error("中央目录损坏");
    const crc = buffer.readUInt32LE(cursor + 16);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIG) throw new Error("本地头损坏：" + name);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + size);
    if (crc32(data) !== crc) throw new Error("CRC 不匹配：" + name);
    entries.push({ name, data: Buffer.from(data), crc });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readStoreZipNames(filePath: string): string[] {
  return readStoreZip(filePath).map((entry) => entry.name);
}
