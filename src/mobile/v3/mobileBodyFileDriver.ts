/**
 * 移动端正文 FileDriver（M-06③ 从 v3/mobilePlatformPort.ts 拆出，纯搬移/零行为变化）：
 * 共享 loadState/saveState 的「content_hash 为空时读盘补算」+ 小记正文读取。
 * 路径约定：note:{id}（kind 由 DB 现查）/ qnote:{id}；stat 读一次并缓存字节，避免共享层 stat→read 双读。
 *
 * stagedQuickBodies：引擎本轮通过 writeQuickBody 暂存的小记正文（在 JS 内存，未落盘）。
 * saveState 的共享编排通过本驱动读小记正文 ⇒ 必须先看 staging，否则会把「本轮刚写入的小记」当成缺正文跳过。
 * staging 是瞬态的，不参与缓存。
 * 依赖面只有 noteBodies 正文文件读写（kind 判定走 core/noteKind）；调用方 = v3/mobileDeviceStore。
 */
import { normalizeNoteKind, type NoteKind } from "../../core/noteKind.js";
import type { FileDriver } from "../../core/s3v3/state/ports.js";
import type { MobileDb } from "../data/dbPortTypes.js";
import {
  deleteNoteBodies, deleteQuickNoteBody, readNoteBody, readQuickNoteBody, writeNoteBody, writeQuickNoteBody,
} from "../data/noteBodies.js";

export function createMobileBodyFileDriver(
  db: MobileDb,
  opts: { stagedQuickBodies?: () => ReadonlyMap<string, Uint8Array> } = {},
): FileDriver {
  const cache = new Map<string, Uint8Array | null>();
  const kindOf = async (id: string): Promise<NoteKind> => {
    const row = await db.prepare("SELECT doc_kind FROM notes WHERE id=?").get(id) as { doc_kind?: string | null } | undefined;
    return normalizeNoteKind(row?.doc_kind);
  };
  const readPath = async (path: string): Promise<Uint8Array | null> => {
    if (path.startsWith("qnote:")) {
      const staged = opts.stagedQuickBodies?.().get(path.slice(6));
      if (staged) return new Uint8Array(staged);
    }
    if (cache.has(path)) return cache.get(path)!;
    let bytes: Uint8Array | null = null;
    try {
      if (path.startsWith("note:")) {
        const content = await readNoteBody(await kindOf(path.slice(5)), path.slice(5));
        bytes = content == null ? null : new TextEncoder().encode(content);
      } else if (path.startsWith("qnote:")) {
        const content = await readQuickNoteBody(path.slice(6));
        bytes = content == null ? null : new TextEncoder().encode(content);
      }
    } catch { bytes = null; }
    cache.set(path, bytes);
    return bytes;
  };
  return {
    async read(path) {
      const bytes = await readPath(path);
      return bytes ? new Uint8Array(bytes) : null;
    },
    async stat(path) {
      const bytes = await readPath(path);
      return bytes ? { size: bytes.length, mtimeMs: 0 } : null;
    },
    async writeAtomic(path, bytes) {
      if (path.startsWith("note:")) {
        const id = path.slice(5);
        await writeNoteBody(await kindOf(id), id, new TextDecoder().decode(bytes));
      } else if (path.startsWith("qnote:")) {
        await writeQuickNoteBody(path.slice(6), new TextDecoder().decode(bytes));
      } else throw new Error("非法正文路径: " + path);
      cache.set(path, new Uint8Array(bytes));
    },
    async remove(path) {
      if (path.startsWith("note:")) await deleteNoteBodies(path.slice(5));
      else if (path.startsWith("qnote:")) await deleteQuickNoteBody(path.slice(6));
      cache.delete(path);
    },
    async removeDir() { /* 正文目录按类型组织，不支持整目录删（共享层当前不使用） */ },
    async list() { return []; },
    async mkdir() { /* no-op */ },
  };
}
