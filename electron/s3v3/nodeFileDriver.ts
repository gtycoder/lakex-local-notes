import { promises as fs } from "node:fs";
import type { FileDriver } from "../../src/core/s3v3/state/ports.js";

/**
 * 桌面 `FileDriver`（E2-4）：普通 fs。
 * 原子写 = 同目录临时文件 + rename（与旧适配器 writeAtomic 同语义）；路径是不透明字符串（Store 的绝对路径）。
 */
export function createNodeFileDriver(): FileDriver {
  return {
    async read(path: string): Promise<Uint8Array | null> {
      try { return new Uint8Array(await fs.readFile(path)); } catch { return null; }
    },
    async writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
      const tmp = path + ".tmp-" + process.pid + "-" + Date.now();
      await fs.writeFile(tmp, bytes);
      await fs.rename(tmp, path);
    },
    async remove(path: string): Promise<void> {
      try { await fs.unlink(path); } catch { /* 不存在 */ }
    },
    async removeDir(path: string): Promise<void> {
      await fs.rm(path, { recursive: true, force: true });
    },
    async list(path: string): Promise<string[]> {
      try { return (await fs.readdir(path)).filter((name) => !name.endsWith(".tmp")); } catch { return []; }
    },
    async mkdir(path: string): Promise<void> {
      await fs.mkdir(path, { recursive: true });
    },
    async stat(path: string): Promise<{ size: number; mtimeMs: number } | null> {
      try { const s = await fs.stat(path); return { size: s.size, mtimeMs: s.mtimeMs }; } catch { return null; }
    },
  };
}
