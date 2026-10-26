/**
 * 正文文件存储（Android 原生 BodyStore 插件；非原生环境用内存实现）。
 *
 * 为什么不是 @capacitor/filesystem：正文每次保存都要写盘，走 Filesystem 至少多一次 JS↔native
 * 桥往返，且它没有原子替换。BodyStore 在原生一次调用里完成「临时文件 + fsync + rename」，
 * 读/删/stat 也各一次调用；gzip 快照同样在原生做（不让 WebView 依赖 CompressionStream）。
 *
 * 契约（与桌面 docs/STORAGE-LAYERS.md 对齐）：
 * - path 是 **相对 App 私有 Data 目录** 的单根路径（如 notes/{id}.lake、history/{id}/xxx.body.gz）；
 * - 不接受绝对路径 / .. / 反斜杠；越界直接 reject；
 * - write 原子（tmp + fsync + rename），失败不留下半截正文；
 * - read 不存在返回 null（不抛，调用方决定语义）；
 * - snapshot 是 gzip 的正文原文（doc=HTML、usheet/bitable/board=JSON）。
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

interface BodyStorePluginApi {
  write(options: { path: string; data: string }): Promise<{ size: number }>;
  writeMany(options: { items: Array<{ path: string; data: string }> }): Promise<{ written: number; bytes: number }>;
  read(options: { path: string }): Promise<{ exists: boolean; data?: string }>;
  remove(options: { path: string }): Promise<void>;
  stat(options: { path: string }): Promise<{ exists: boolean; size: number }>;
  writeSnapshot(options: { path: string; data: string }): Promise<{ size: number }>;
  readSnapshot(options: { path: string }): Promise<{ exists: boolean; data?: string }>;
}

const NativeBodyStore = registerPlugin<BodyStorePluginApi>("BodyStore");

/** 正文存储后端（测试注入内存实现；原生实现见上）。 */
export interface BodyStoreBackend {
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<number>;
  /** 批量原子写（可选；261026 首拉提速：一次桥调用写多篇）。缺省时调用方逐篇写。 */
  writeTextMany?(items: Array<{ path: string; text: string }>): Promise<number>;
  remove(path: string): Promise<void>;
  stat(path: string): Promise<{ exists: boolean; size: number }>;
  readSnapshot(path: string): Promise<string | null>;
  writeSnapshot(path: string, text: string): Promise<number>;
}

function nativeBackend(): BodyStoreBackend {
  const requireData = (res: { exists: boolean; data?: string }): string | null =>
    res.exists && typeof res.data === "string" ? res.data : null;
  return {
    async readText(path) {
      return requireData(await NativeBodyStore.read({ path }));
    },
    async writeText(path, text) {
      const res = await NativeBodyStore.write({ path, data: text });
      return Number(res?.size ?? text.length);
    },
    async writeTextMany(items) {
      const res = await NativeBodyStore.writeMany({ items: items.map((i) => ({ path: i.path, data: i.text })) });
      return Number(res?.bytes ?? 0);
    },
    async remove(path) {
      await NativeBodyStore.remove({ path });
    },
    async stat(path) {
      const res = await NativeBodyStore.stat({ path });
      return { exists: Boolean(res?.exists), size: Number(res?.size ?? 0) };
    },
    async readSnapshot(path) {
      return requireData(await NativeBodyStore.readSnapshot({ path }));
    },
    async writeSnapshot(path, text) {
      const res = await NativeBodyStore.writeSnapshot({ path, data: text });
      return Number(res?.size ?? 0);
    },
  };
}

/**
 * 内存后端：vitest（无原生环境）与浏览器预览用。
 * ⚠️ 浏览器预览（scripts/mobile-preview.sh）刷新即丢正文 —— 真机/模拟器才是文件存储；
 * 预览只用于看 UI，不要把它当数据环境。
 */
const memoryText = new Map<string, string>();
const memoryBackend: BodyStoreBackend = {
  async readText(path) { return memoryText.has(path) ? memoryText.get(path)! : null; },
  async writeText(path, text) { memoryText.set(path, text); return new TextEncoder().encode(text).length; },
  async writeTextMany(items) { let bytes = 0; for (const i of items) { memoryText.set(i.path, i.text); bytes += new TextEncoder().encode(i.text).length; } return bytes; },
  async remove(path) { memoryText.delete(path); },
  async stat(path) { return { exists: memoryText.has(path), size: new TextEncoder().encode(memoryText.get(path) ?? "").length }; },
  async readSnapshot(path) { return memoryText.has(path) ? memoryText.get(path)! : null; },
  async writeSnapshot(path, text) { memoryText.set(path, text); return new TextEncoder().encode(text).length; },
};

let backend: BodyStoreBackend | null = null;

/** 取当前正文存储后端（原生平台 = Kotlin BodyStore；其余 = 内存）。 */
export function getBodyStore(): BodyStoreBackend {
  if (!backend) backend = Capacitor.isNativePlatform() ? nativeBackend() : memoryBackend;
  return backend;
}

/** 清空内存后端（测试 beforeEach 用；原生后端 no-op）。 */
export function resetMemoryBodyStore(): void {
  memoryText.clear();
}
