/**
 * 资产存储：Capacitor Filesystem（B1，M2 正式方案）。
 *
 * 目录布局与桌面一致：note-assets/{noteId}/{filename}（Directory.Data 下）。
 * 桌面 = userData/note-assets/{noteId}/{file}；移动端 = app 私有 Data 目录同构。
 * 替换 POC 的 IndexedDB 资产持久化（大文件 IndexedDB 不适合，且与桌面不同构）。
 */
import { Filesystem, Directory } from "@capacitor/filesystem";

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

/** 确保 note-assets/{noteId} 目录存在（递归）。 */
async function ensureNoteDir(noteId: string): Promise<void> {
  try {
    await Filesystem.mkdir({ path: `${ROOT}/${noteId}`, directory: Directory.Data, recursive: true });
  } catch {
    // 已存在（mkdir 对已存在目录抛错）——忽略
  }
}

export async function saveAssetBytesFs(key: string, bytes: Uint8Array): Promise<void> {
  const [noteId, ...rest] = key.split("/");
  const filename = rest.join("/");
  if (!noteId || !filename) throw new Error(`非法资产键: ${key}`);
  await ensureNoteDir(noteId);
  // data 传 base64；不传 encoding（Android 原生默认按 base64 解码写入；UTF8 会把 base64 当文本写坏）
  await Filesystem.writeFile({
    path: `${ROOT}/${noteId}/${filename}`,
    data: bytesToBase64(bytes),
    directory: Directory.Data,
    recursive: true,
  });
}

export async function loadAssetBytesFs(key: string): Promise<Uint8Array | null> {
  const [noteId, ...rest] = key.split("/");
  const filename = rest.join("/");
  if (!noteId || !filename) return null;
  try {
    const res = await Filesystem.readFile({
      path: `${ROOT}/${noteId}/${filename}`,
      directory: Directory.Data,
    });
    return base64ToBytes(String(res.data)); // 未传 encoding → Android 原生返回 base64
  } catch {
    return null; // 文件不存在/读取失败
  }
}

/** 删除已持久化资产文件（不存在时静默成功）。 */
export async function removeAssetBytesFs(key: string): Promise<void> {
  const [noteId, ...rest] = key.split("/");
  const filename = rest.join("/");
  if (!noteId || !filename) return;
  try {
    await Filesystem.deleteFile({
      path: ROOT + "/" + noteId + "/" + filename,
      directory: Directory.Data,
    });
  } catch {
    // 文件不存在/删除失败——静默（幂等删除语义）
  }
}

/** 列出单个普通笔记目录下的资产键（{noteId}/{file}）。 */
export async function listNoteAssetKeysFs(noteId: string): Promise<string[]> {
  try {
    const dir = await Filesystem.readdir({ path: `${ROOT}/${noteId}`, directory: Directory.Data });
    return dir.files.filter((f) => f.type === "file").map((f) => `${noteId}/${f.name}`);
  } catch {
    return []; // 目录不存在或损坏时按无资产处理
  }
}

/** 列出单条小记目录下的资产键（quick-notes/{quickNoteId}/{file}）。 */
export async function listQuickNoteAssetKeysFs(quickNoteId: string): Promise<string[]> {
  try {
    const dir = await Filesystem.readdir({ path: `${ROOT}/quick-notes/${quickNoteId}`, directory: Directory.Data });
    return dir.files.filter((f) => f.type === "file").map((f) => `quick-notes/${quickNoteId}/${f.name}`);
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
    entries = root.files.filter((f) => f.type === "directory" && f.name && f.name !== "." && f.name !== "..");
  } catch {
    return keys;
  }
  for (const entry of entries) {
    if (entry.name === "quick-notes") {
      try {
        const quickRoot = await Filesystem.readdir({ path: `${ROOT}/quick-notes`, directory: Directory.Data });
        for (const quickNote of quickRoot.files.filter((f) => f.type === "directory")) {
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
