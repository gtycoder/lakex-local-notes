/**
 * 便携包 zip 读取器（store-only、seek 读、流式解包）—— 与 zipStore.ts 对偶（261122 大统一）。
 *
 * 为什么自研：与写入器同理（AGENTS §3#22 四问），且我们只读自己写的 store-only zip（method 0），
 * 格式面很小。生产用于桌面导入（4GiB 包不整包进内存）；测试用 readStoreZip（小包便捷全读）。
 * 大包路径：readCentralDirectory 只读尾部 + 中央目录；extractEntryToFile 按条目流式落盘并验 CRC。
 */
import fs from "node:fs";
import path from "node:path";
import { crc32Update, validateZipEntryName } from "./zipStore.js";

export interface ZipDirEntry {
  name: string;
  /** 压缩方法（本应用恒 0 = store；其它值一律拒绝）。 */
  method: number;
  crc: number;
  /** 数据字节数（store ⇒ 未压缩 = 压缩）。 */
  size: number;
  localHeaderOffset: number;
}

export interface ZipDirectory {
  entries: ZipDirEntry[];
  zip64: boolean;
  /** 全部条目数据字节和（不含头/目录开销；manifest.counts.bytes 的对账口径）。 */
  dataBytes: number;
  /** zip 文件实际字节数。 */
  fileBytes: number;
  centralDirOffset: number;
  centralDirSize: number;
}

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const U32_MAX = 0xffffffff;
const CHUNK_BYTES = 1024 * 1024;

function notPortableZip(reason: string): Error {
  return new Error("便携包文件无效：" + reason);
}

/** 读中央目录（只读文件尾与目录块；条目本身不读）。 */
export function readCentralDirectory(filePath: string): ZipDirectory {
  const fd = fs.openSync(filePath, "r");
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 22) throw notPortableZip("文件过小");
    // EOCD 在文件尾 22 + 最长 65535 注释的窗口内。
    const tailStart = Math.max(0, size - (22 + 0xffff));
    const tail = Buffer.alloc(size - tailStart);
    fs.readSync(fd, tail, 0, tail.length, tailStart);
    let eocd = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === EOCD_SIG) { eocd = tailStart + index; break; }
    }
    if (eocd < 0) throw notPortableZip("缺少 EOCD");
    const eocdBuf = Buffer.alloc(22);
    fs.readSync(fd, eocdBuf, 0, 22, eocd);
    let count = eocdBuf.readUInt16LE(10);
    let centralOffset = eocdBuf.readUInt32LE(16);
    let centralSize = eocdBuf.readUInt32LE(12);
    let zip64 = false;
    if (count === 0xffff || centralOffset === U32_MAX || centralSize === U32_MAX) {
      zip64 = true;
      const locator = Buffer.alloc(20);
      fs.readSync(fd, locator, 0, 20, eocd - 20);
      if (locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIG) throw notPortableZip("zip64 locator 缺失");
      const zip64Eocd = Number(locator.readBigUInt64LE(8));
      const z = Buffer.alloc(56);
      fs.readSync(fd, z, 0, 56, zip64Eocd);
      if (z.readUInt32LE(0) !== ZIP64_EOCD_SIG) throw notPortableZip("zip64 EOCD 缺失");
      count = Number(z.readBigUInt64LE(32));
      centralSize = Number(z.readBigUInt64LE(40));
      centralOffset = Number(z.readBigUInt64LE(48));
    }
    const centralBytes = centralSize;
    if (centralBytes < 0 || centralBytes > size) throw notPortableZip("中央目录偏移非法");
    const central = Buffer.alloc(centralBytes);
    fs.readSync(fd, central, 0, centralBytes, centralOffset);
    const entries: ZipDirEntry[] = [];
    let cursor = 0;
    let dataBytes = 0;
    for (let index = 0; index < count; index += 1) {
      if (cursor + 46 > centralBytes || central.readUInt32LE(cursor) !== CENTRAL_SIG) throw notPortableZip("中央目录损坏");
      const method = central.readUInt16LE(cursor + 10);
      const crc = central.readUInt32LE(cursor + 16);
      const compressed = central.readUInt32LE(cursor + 20);
      const uncompressed = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLength = central.readUInt16LE(cursor + 32);
      const localOffset = central.readUInt32LE(cursor + 42);
      const name = central.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
      if (method !== 0) throw notPortableZip("只支持 store 条目：" + name);
      if (compressed !== uncompressed) throw notPortableZip("store 条目大小不一致：" + name);
      if (compressed === U32_MAX) throw notPortableZip("单条目超过 4GiB 不支持：" + name);
      entries.push({ name, method, crc, size: uncompressed, localHeaderOffset: localOffset });
      dataBytes += uncompressed;
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return { entries, zip64, dataBytes, fileBytes: size, centralDirOffset: centralOffset, centralDirSize: centralBytes };
  } finally {
    fs.closeSync(fd);
  }
}

/** 数据区起始偏移（本地头 + 名 + extra 之后；store 条目数据紧随其后）。
 *  顺带核对本地头 CRC/大小/文件名与中央目录一致（防目录被篡改后读错数据区）。 */
function dataStartOf(fd: number, entry: ZipDirEntry): number {
  const head = Buffer.alloc(30);
  fs.readSync(fd, head, 0, 30, entry.localHeaderOffset);
  if (head.readUInt32LE(0) !== LOCAL_SIG) throw notPortableZip("本地头损坏：" + entry.name);
  const localNameLength = head.readUInt16LE(26);
  const localExtraLength = head.readUInt16LE(28);
  if (head.readUInt32LE(14) !== entry.crc || head.readUInt32LE(22) !== entry.size) {
    throw notPortableZip("本地头与中央目录不一致：" + entry.name);
  }
  const nameBuf = Buffer.alloc(localNameLength);
  fs.readSync(fd, nameBuf, 0, localNameLength, entry.localHeaderOffset + 30);
  if (nameBuf.toString("utf8") !== entry.name) throw notPortableZip("本地头文件名不一致：" + entry.name);
  return entry.localHeaderOffset + 30 + localNameLength + localExtraLength;
}

/** 读单个条目到内存（只适合小条目：清单/基线等）。 */
export function readEntryData(filePath: string, entry: ZipDirEntry): Buffer {
  const fd = fs.openSync(filePath, "r");
  try {
    const start = dataStartOf(fd, entry);
    const data = Buffer.alloc(entry.size);
    fs.readSync(fd, data, 0, entry.size, start);
    if (crc32Update(0, data) !== entry.crc) throw notPortableZip("CRC 不匹配：" + entry.name);
    return data;
  } finally {
    fs.closeSync(fd);
  }
}

/** 流式解出一个条目到文件（边写边验 CRC；失败删掉半截文件并抛可读原因）。 */
export function extractEntryToFile(filePath: string, entry: ZipDirEntry, destPath: string): void {
  validateZipEntryName(entry.name);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const fd = fs.openSync(filePath, "r");
  const out = fs.openSync(destPath, "w");
  try {
    let position = dataStartOf(fd, entry);
    let remaining = entry.size;
    let crc = 0;
    const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, Math.max(1, entry.size)));
    while (remaining > 0) {
      const want = Math.min(chunk.length, remaining);
      const got = fs.readSync(fd, chunk, 0, want, position);
      if (got <= 0) throw notPortableZip("条目数据被截断：" + entry.name);
      fs.writeSync(out, chunk, 0, got);
      crc = crc32Update(crc, chunk.subarray(0, got));
      position += got;
      remaining -= got;
    }
    if (crc !== entry.crc) throw notPortableZip("CRC 不匹配：" + entry.name);
  } catch (error) {
    try { fs.closeSync(out); } catch { /* 尽力 */ }
    try { fs.rmSync(destPath, { force: true }); } catch { /* 尽力 */ }
    throw error;
  } finally {
    try { fs.closeSync(fd); } catch { /* 尽力 */ }
    try { fs.closeSync(out); } catch { /* 已关 */ }
  }
}

export function sumEntrySizes(entries: ZipDirEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.size, 0);
}

export interface ReadZipEntry {
  name: string;
  data: Buffer;
  crc: number;
}

/** 便捷全读（小包测试断言用；大包请走 readCentralDirectory + extractEntryToFile）。 */
export function readStoreZip(filePath: string): ReadZipEntry[] {
  const directory = readCentralDirectory(filePath);
  return directory.entries.map((entry) => {
    const data = readEntryData(filePath, entry);
    return { name: entry.name, data, crc: entry.crc };
  });
}

export function readStoreZipNames(filePath: string): string[] {
  return readCentralDirectory(filePath).entries.map((entry) => entry.name);
}
