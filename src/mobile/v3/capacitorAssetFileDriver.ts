import type { FileDriver } from "../../core/s3v3/state/ports.js";
import { listNoteAssetKeysFs, listQuickNoteAssetKeysFs, loadAssetBytesFs, removeAssetBytesFs, saveAssetBytesFs } from "../native/assetFs";

/**
 * 移动端资产 `FileDriver`（E2-4 phase B/C 过渡）：把「资产键空间」映射成 FileDriver 伪目录。
 *
 * `assets/{noteId}` → 文档资产目录；`quick/{quickNoteId}` → 小记资产目录；
 * 单文件 = 目录 + "/" + filename（键规则/小记前缀映射仍由 assetFs 单一来源负责）。
 *
 * 性能：`list` 优先用适配器注入的一次性原生清单（native listAllAssets 的缓存），
 * 避免逐篇 readdir 桥往返；写/删后回调失效缓存（与迁移前 invalidateAssetNames 同语义）。
 * `stat` 未使用（资产 IO 不 stat；正文走 noteBodies），返回 null 避免把大文件读回 JS。
 */
export interface CapacitorAssetFileDriverDeps {
  /** 一次性列全部资产名（原生支持时）；返回 null = 未挂载。 */
  listAllNames?: () => Promise<{ notes: Map<string, string[]>; quick: Map<string, string[]> } | null>;
  invalidateNames?: () => void;
}

const DOC_ROOT = "assets";
const QUICK_ROOT = "quick";

function parseDir(path: string): { space: "lake" | "quickNotes"; id: string } | null {
  const clean = path.replace(/\/+$/, "");
  const [root, id, ...rest] = clean.split("/");
  if (rest.length > 0 || !id) return null;
  if (root === DOC_ROOT) return { space: "lake", id };
  if (root === QUICK_ROOT) return { space: "quickNotes", id };
  return null;
}

function parseFile(path: string): { space: "lake" | "quickNotes"; id: string; filename: string } | null {
  const clean = path.replace(/^\/+/, "");
  const parts = clean.split("/");
  if (parts.length !== 3) return null;
  const dir = parseDir(parts[0] + "/" + parts[1]);
  return dir ? { ...dir, filename: parts[2] } : null;
}

function assetKey(space: "lake" | "quickNotes", id: string, filename: string): string {
  return space === "quickNotes" ? "quick-notes/" + id + "/" + filename : id + "/" + filename;
}

export function createCapacitorAssetFileDriver(deps: CapacitorAssetFileDriverDeps = {}): FileDriver {
  const listNames = async (space: "lake" | "quickNotes", id: string): Promise<string[]> => {
    const all = await deps.listAllNames?.();
    if (all) return (space === "quickNotes" ? all.quick : all.notes).get(id) ?? [];
    if (space === "quickNotes") {
      const prefix = "quick-notes/" + id + "/";
      return (await listQuickNoteAssetKeysFs(id)).map((k) => (k.startsWith(prefix) ? k.slice(prefix.length) : k));
    }
    return (await listNoteAssetKeysFs(id)).map((k) => k.slice(id.length + 1));
  };
  return {
    async read(path) {
      const f = parseFile(path);
      if (!f) return null;
      try { return await loadAssetBytesFs(assetKey(f.space, f.id, f.filename)); } catch { return null; }
    },
    async writeAtomic(path, bytes) {
      const f = parseFile(path);
      if (!f) throw new Error("非法资产路径: " + path);
      deps.invalidateNames?.();
      await saveAssetBytesFs(assetKey(f.space, f.id, f.filename), bytes);
    },
    async remove(path) {
      const f = parseFile(path);
      if (!f) return;
      deps.invalidateNames?.();
      await removeAssetBytesFs(assetKey(f.space, f.id, f.filename));
    },
    async removeDir(path) {
      const dir = parseDir(path);
      if (!dir) return;
      // 先失效缓存再列真名（删除期间不能用可能过期的原生清单）
      deps.invalidateNames?.();
      for (const filename of await listNames(dir.space, dir.id)) {
        try { await removeAssetBytesFs(assetKey(dir.space, dir.id, filename)); } catch { /* 已不存在 */ }
      }
      deps.invalidateNames?.();
    },
    async list(path) {
      const dir = parseDir(path);
      if (!dir) return [];
      return await listNames(dir.space, dir.id);
    },
    async mkdir() { /* assetFs 写入时自建父目录 */ },
    async stat() { return null; },
  };
}
