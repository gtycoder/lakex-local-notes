/**
 * 极简 ZIP 归档写入器（D01 续：多维表「导出为压缩包」）——纯函数，无 DOM / node: 依赖。
 *
 * 只实现 **store（不压缩）** 方式：正文/图片/PDF 本身多为已压缩格式，store 足够且无需引入压缩库。
 * 产出是标准 ZIP（Finder / Windows / 7zip / unzip 均可打开）：本地文件头 + 数据 + 中央目录 + EOCD；
 * 文件名走 UTF-8（通用位标记 bit 11），中文名不乱码。
 *
 * 流式设计：`ZipWriter` 把数据写到调用方注入的 `write` 回调（electron 侧直接写文件描述符），
 * 每次只持有一个条目的字节，避免把整包内容读进内存。
 * 限制：单条目 / 总偏移超过 4GiB 需要 ZIP64，这里明确报错，不静默产出坏包。
 */
const encoder = new TextEncoder();

let crcTable: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** 标准 CRC-32（IEEE 802.3，多项式 0xEDB88320）。 */
export function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}
function u32(value: number): Uint8Array {
  const v = value >>> 0;
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
}
function concat(chunks: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

/** 时间 → DOS date/time（ZIP 头用；1980 之前按 1980-01-01）。 */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xffff, date: day & 0xffff };
}

interface ZipCentralEntry {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

const MAX_UINT32 = 0xffffffff;

/**
 * 流式 ZIP 写入器：`write` 是调用方提供的目的地（接受一段字节）。
 * 用法：`addFile(name, bytes)` 若干次 → `finish()` 写中央目录与 EOCD。
 */
export class ZipWriter {
  private readonly write: (chunk: Uint8Array) => void;
  private readonly entries: ZipCentralEntry[] = [];
  private offset = 0;
  private finished = false;

  constructor(write: (chunk: Uint8Array) => void) {
    this.write = write;
  }

  addFile(name: string, data: Uint8Array, modifiedAt: Date = new Date()): void {
    if (this.finished) throw new Error("ZipWriter 已 finish，不能再添加文件");
    const nameBytes = encoder.encode(name);
    if (nameBytes.length > 0xffff) throw new Error("ZIP 条目名过长");
    if (data.length > MAX_UINT32) throw new Error("单个附件超过 4GiB，暂不支持（需 ZIP64）");
    const { time, date } = dosDateTime(modifiedAt);
    const crc = crc32(data);
    const header = concat([
      u32(0x04034b50),          // local file header signature
      u16(20),                  // version needed
      u16(0x0800),              // flags: UTF-8 filename
      u16(0),                   // method: store
      u16(time), u16(date),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0),
      nameBytes,
    ]);
    this.write(header);
    if (data.length > 0) this.write(data);
    this.entries.push({ nameBytes, crc, size: data.length, offset: this.offset, time, date });
    this.offset += header.length + data.length;
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.offset > MAX_UINT32) throw new Error("归档总大小超过 4GiB，暂不支持（需 ZIP64）");
    const centralOffset = this.offset;
    for (const entry of this.entries) {
      const central = concat([
        u32(0x02014b50),        // central directory header signature
        u16(20), u16(20),       // version made by / needed
        u16(0x0800), u16(0),
        u16(entry.time), u16(entry.date),
        u32(entry.crc), u32(entry.size), u32(entry.size),
        u16(entry.nameBytes.length), u16(0), u16(0),
        u16(0), u16(0), u32(0),
        u32(entry.offset),
        entry.nameBytes,
      ]);
      this.write(central);
      this.offset += central.length;
    }
    const centralSize = this.offset - centralOffset;
    const eocd = concat([
      u32(0x06054b50),
      u16(0), u16(0),
      u16(this.entries.length), u16(this.entries.length),
      u32(centralSize), u32(centralOffset),
      u16(0),
    ]);
    this.write(eocd);
    this.offset += eocd.length;
  }
}

export interface ZipInputEntry {
  name: string;
  data: Uint8Array;
  modifiedAt?: Date;
}

/** 便捷函数（测试/小包用）：把若干条目打成一段 ZIP 字节。 */
export function createZip(entries: readonly ZipInputEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const writer = new ZipWriter((chunk) => chunks.push(chunk));
  for (const entry of entries) writer.addFile(entry.name, entry.data, entry.modifiedAt);
  writer.finish();
  return concat(chunks);
}
