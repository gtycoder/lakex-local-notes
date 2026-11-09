/**
 * 便携包 zip 写入器（store-only、零依赖、流式）。
 *
 * 为什么自研：便携包最大 4GiB，不能整包进内存；现有依赖里没有 zip 写库，引新依赖要过
 * AGENTS §3#22 四问，而 store-only zip 的格式面很小（本地头 + 数据描述符 + 中央目录 + EOCD）。
 *
 * 格式要点：
 * - method 0（store，不压缩）：spec 明确「store-only，读写快」；
 * - **不用数据描述符**（0x0008）：store 条目若把 CRC/大小放在数据后，Java ZipInputStream
 *   等实现会读成空文件（真机踩坑）。这里每个文件读两遍：先算 CRC/大小写进本地头，再写数据。
 *   （4GiB 上限下多一次顺序读，换来所有解压器兼容。）
 * - 通用位标记 0x0800（UTF-8 文件名）；
 * - 「总大小 ≤4GiB」：写入前由调用方 assertPortableSize 预检，写入时这里再按实际字节硬夹；
 * - 条目数 >65535 时补 ZIP64 EOCD（仅 EOCD，条目本身仍是 32 位字段；大小/偏移受 4GiB 限制不会溢出）。
 */
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { PORTABLE_LIMIT_BYTES } from "../../src/core/portable/portableFormat.js";

export class PortableSizeError extends Error {}

export interface ZipEntrySource {
  /** zip 内路径（posix 分隔，绝对/上级目录/反斜杠一律拒绝）。 */
  name: string;
  /** 已知字节数（来自 stat；写入时实际字节必须一致）。 */
  size: number;
  mtime: Date;
  /** 逐块读取内容（通常 = fs.createReadStream 的 async iterable）。 */
  read: () => AsyncIterable<Uint8Array>;
}

export interface WriteZipOptions {
  /** 硬上限（默认 = 便携包 4GiB）。超出立即失败并删除半成品。 */
  maxBytes?: number;
  onProgress?: (writtenBytes: number) => void;
}

export interface WriteZipResult {
  bytes: number;
  entries: number;
}

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const FLAG_UTF8 = 0x0800;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** 增量 CRC32（ZIP 标准多项式；crc 为上一块返回值，0 起点）。 */
export function crc32Update(crc: number, chunk: Uint8Array): number {
  let value = crc ^ U32_MAX;
  for (let i = 0; i < chunk.length; i += 1) value = CRC_TABLE[(value ^ chunk[i]!) & 0xff]! ^ (value >>> 8);
  return (value ^ U32_MAX) >>> 0;
}

export function crc32(bytes: Uint8Array): number {
  return crc32Update(0, bytes);
}

/** 条目路径校验：拒绝绝对路径 / 上级目录 / 反斜杠 / NUL（导入方也要防 zip-slip，这里先自证）。 */
export function validateZipEntryName(name: string): void {
  if (!name || name.length > 1024) throw new Error("便携包条目路径非法：" + name);
  if (name.startsWith("/") || name.includes(String.fromCharCode(92)) || name.includes(String.fromCharCode(0))) {
    throw new Error("便携包条目路径非法：" + name);
  }
  for (const segment of name.split("/")) {
    if (segment === "" || segment === "." || segment === "..") throw new Error("便携包条目路径非法：" + name);
  }
}

function dosDateTime(mtime: Date): { time: number; date: number } {
  const year = Math.max(1980, mtime.getFullYear());
  return {
    time: (mtime.getHours() << 11) | (mtime.getMinutes() << 5) | Math.floor(mtime.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((mtime.getMonth() + 1) << 5) | mtime.getDate(),
  };
}

function writeChunk(stream: import("node:fs").WriteStream, chunk: Buffer | Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => (error ? reject(error) : resolve()));
  });
}

function closeStream(stream: import("node:fs").WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.once("error", reject);
    stream.end(() => resolve());
  });
}

/** 写一个 store-only zip（流式；失败时删除半成品，避免用户拿到坏包）。 */
export async function writeStoreZip(filePath: string, entries: ZipEntrySource[], options: WriteZipOptions = {}): Promise<WriteZipResult> {
  const maxBytes = options.maxBytes ?? PORTABLE_LIMIT_BYTES;
  const stream = createWriteStream(filePath);
  await new Promise<void>((resolve, reject) => {
    stream.once("open", () => resolve());
    stream.once("error", reject);
  });
  const central: Buffer[] = [];
  const pending: Buffer[] = [];
  let pendingBytes = 0;
  /** 已真正写进文件的字节数；逻辑位置 = written + pending（本地头偏移用它，读完待写数据才落盘）。 */
  let written = 0;
  const FLUSH_BYTES = 1024 * 1024;

  const progress = () => options.onProgress?.(written + pendingBytes);
  const flush = async (): Promise<void> => {
    if (pendingBytes === 0) return;
    const buffer = pending.length === 1 ? pending[0]! : Buffer.concat(pending);
    pending.length = 0;
    pendingBytes = 0;
    await writeChunk(stream, buffer);
    written += buffer.length;
    progress();
  };
  const write = async (chunk: Buffer | Uint8Array): Promise<void> => {
    if (written + pendingBytes + chunk.length > maxBytes) {
      throw new PortableSizeError("便携包超过 4GiB 上限，暂不支持分卷");
    }
    pending.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    pendingBytes += chunk.length;
    if (pendingBytes >= FLUSH_BYTES) await flush();
  };

  try {
    for (const entry of entries) {
      validateZipEntryName(entry.name);
      if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error("条目大小非法：" + entry.name);
      const nameBuffer = Buffer.from(entry.name, "utf8");
      const { time, date } = dosDateTime(entry.mtime);
      // 第一遍：算 CRC/大小（store 条目的本地头必须带真实值，兼容 Java ZipInputStream）。
      let crc = 0;
      let size = 0;
      for await (const chunk of entry.read()) {
        crc = crc32Update(crc, chunk);
        size += chunk.length;
        if (size > entry.size) throw new Error("文件在导出过程中变大了：" + entry.name);
      }
      if (size !== entry.size) throw new Error("文件在导出过程中被修改：" + entry.name);

      const header = Buffer.alloc(30 + nameBuffer.length);
      header.writeUInt32LE(LOCAL_HEADER_SIG, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(FLAG_UTF8, 6);
      header.writeUInt16LE(0, 8);
      header.writeUInt16LE(time, 10);
      header.writeUInt16LE(date, 12);
      header.writeUInt32LE(crc >>> 0, 14);
      header.writeUInt32LE(size, 18);
      header.writeUInt32LE(size, 22);
      header.writeUInt16LE(nameBuffer.length, 26);
      header.writeUInt16LE(0, 28);
      nameBuffer.copy(header, 30);
      const localOffset = written + pendingBytes;
      await write(header);

      // 第二遍：写数据（再校验一次大小，防两遍之间被改）。
      let writtenSize = 0;
      for await (const chunk of entry.read()) {
        writtenSize += chunk.length;
        if (writtenSize > size) throw new Error("文件在导出过程中变大了：" + entry.name);
        await write(chunk);
      }
      if (writtenSize !== size) throw new Error("文件在导出过程中被修改：" + entry.name);

      const centralHeader = Buffer.alloc(46 + nameBuffer.length);
      centralHeader.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
      centralHeader.writeUInt16LE(20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(FLAG_UTF8, 8);
      centralHeader.writeUInt16LE(0, 10);
      centralHeader.writeUInt16LE(time, 12);
      centralHeader.writeUInt16LE(date, 14);
      centralHeader.writeUInt32LE(crc >>> 0, 16);
      centralHeader.writeUInt32LE(size, 20);
      centralHeader.writeUInt32LE(size, 24);
      centralHeader.writeUInt16LE(nameBuffer.length, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      centralHeader.writeUInt32LE(localOffset, 42);
      nameBuffer.copy(centralHeader, 46);
      central.push(centralHeader);
    }

    await flush();
    const centralDirOffset = written;
    for (const record of central) await write(record);
    await flush();
    const centralDirSize = written - centralDirOffset;
    const count = entries.length;

    if (count > U16_MAX || centralDirSize > U32_MAX || centralDirOffset > U32_MAX) {
      const zip64EocdOffset = written;
      const record = Buffer.alloc(56);
      record.writeUInt32LE(ZIP64_EOCD_SIG, 0);
      record.writeBigUInt64LE(44n, 4);
      record.writeUInt16LE(45, 12);
      record.writeUInt16LE(45, 14);
      record.writeUInt32LE(0, 16);
      record.writeUInt32LE(0, 20);
      record.writeBigUInt64LE(BigInt(count), 24);
      record.writeBigUInt64LE(BigInt(count), 32);
      record.writeBigUInt64LE(BigInt(centralDirSize), 40);
      record.writeBigUInt64LE(BigInt(centralDirOffset), 48);
      await write(record);
      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(ZIP64_LOCATOR_SIG, 0);
      locator.writeUInt32LE(0, 4);
      locator.writeBigUInt64LE(BigInt(zip64EocdOffset), 8);
      locator.writeUInt32LE(1, 16);
      await write(locator);
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIG, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(Math.min(count, U16_MAX), 8);
    eocd.writeUInt16LE(Math.min(count, U16_MAX), 10);
    eocd.writeUInt32LE(centralDirSize, 12);
    eocd.writeUInt32LE(centralDirOffset, 16);
    eocd.writeUInt16LE(0, 20);
    await write(eocd);
    await flush();
    await closeStream(stream);
    return { bytes: written, entries: count };
  } catch (error) {
    stream.destroy();
    await rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  }
}
