/**
 * 资产存储：Capacitor Filesystem（B1，M2 正式方案）。
 *
 * 目录布局与桌面一致：note-assets/{noteId}/{filename}（Directory.Data 下）。
 * 桌面 = userData/note-assets/{noteId}/{file}；移动端 = app 私有 Data 目录同构。
 * 替换 POC 的 IndexedDB 资产持久化（大文件 IndexedDB 不适合，且与桌面不同构）。
 */
import { Filesystem, Directory } from "@capacitor/filesystem";
import { isSafePathSegment } from "../core/storeUtils.js";

const ROOT = "note-assets";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function requireAssetPath(key: string): string {
  const segments = key.split("/");
  if (segments.length < 2 || !segments.every(isSafePathSegment)) throw new Error(`非法资产键: ${key}`);
  return [ROOT, ...segments].join("/");
}

function isMissingFileError(error: unknown): boolean {
  if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return true;
  const message = error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  return /(?:ENOENT|does not exist|not found)/i.test(message);
}

export async function saveAssetBytesFs(key: string, bytes: Uint8Array): Promise<void> {
  const path = requireAssetPath(key);
  // data 传 base64；不传 encoding（Android 原生默认按 base64 解码写入；UTF8 会把 base64 当文本写坏）
  await Filesystem.writeFile({
    path,
    data: bytesToBase64(bytes),
    directory: Directory.Data,
    recursive: true,
  });
}

export async function loadAssetBytesFs(key: string): Promise<Uint8Array | null> {
  const path = requireAssetPath(key);
  try {
    const res = await Filesystem.readFile({
      path,
      directory: Directory.Data,
    });
    return base64ToBytes(String(res.data)); // 未传 encoding → Android 原生返回 base64
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

/** 删除已持久化资产文件（不存在时静默成功）。 */
export async function removeAssetBytesFs(key: string): Promise<void> {
  const path = requireAssetPath(key);
  try {
    await Filesystem.deleteFile({
      path,
      directory: Directory.Data,
    });
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
}

/** 列出单个普通笔记目录下的资产键（{noteId}/{file}）。 */
export async function listNoteAssetKeysFs(noteId: string): Promise<string[]> {
  if (!isSafePathSegment(noteId)) return [];
  try {
    const dir = await Filesystem.readdir({ path: `${ROOT}/${noteId}`, directory: Directory.Data });
    return dir.files
      .filter((f) => f.type === "file" && isSafePathSegment(f.name))
      .map((f) => `${noteId}/${f.name}`);
  } catch {
    return []; // 目录不存在或损坏时按无资产处理
  }
}

/** 列出单条小记目录下的资产键（quick-notes/{quickNoteId}/{file}）。 */
export async function listQuickNoteAssetKeysFs(quickNoteId: string): Promise<string[]> {
  if (!isSafePathSegment(quickNoteId)) return [];
  try {
    const dir = await Filesystem.readdir({ path: `${ROOT}/quick-notes/${quickNoteId}`, directory: Directory.Data });
    return dir.files
      .filter((f) => f.type === "file" && isSafePathSegment(f.name))
      .map((f) => `quick-notes/${quickNoteId}/${f.name}`);
  } catch {
    return [];
  }
}

/** 列出全部已持久化资产键；仅供诊断/缓存统计，同步与保存路径应使用按笔记目录的函数。 */
export async function listAssetKeysFs(): Promise<string[]> {
  const keys: string[] = [];
  let entries: Array<{ name: string; type?: string }> = [];
  try {
    const root = await Filesystem.readdir({ path: ROOT, directory: Directory.Data });
    entries = root.files.filter((f) => f.type === "directory" && isSafePathSegment(f.name));
  } catch {
    return keys;
  }
  for (const entry of entries) {
    if (entry.name === "quick-notes") {
      try {
        const quickRoot = await Filesystem.readdir({ path: `${ROOT}/quick-notes`, directory: Directory.Data });
        for (const quickNote of quickRoot.files.filter((f) => f.type === "directory" && isSafePathSegment(f.name))) {
          keys.push(...await listQuickNoteAssetKeysFs(quickNote.name));
        }
      } catch {
        // 小记根目录损坏时跳过
      }
    } else {
      keys.push(...await listNoteAssetKeysFs(entry.name));
    }
  }
  return keys;
}
