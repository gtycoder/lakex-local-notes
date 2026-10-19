/**
 * 资产存储：Capacitor Filesystem（B1，M2 正式方案）。
 *
 * 目录布局与桌面一致：note-assets/{noteId}/{filename}（Directory.Data 下）。
 * 桌面 = userData/note-assets/{noteId}/{file}；移动端 = app 私有 Data 目录同构。
 * 替换 POC 的 IndexedDB 资产持久化（大文件 IndexedDB 不适合，且与桌面不同构）。
 */
import { Filesystem, Directory } from "@capacitor/filesystem";
import { isSafePathSegment } from "../../core/storeUtils.js";
import { quickNoteAssetRelativePath } from "../../core/noteBodyPaths.js";
import { assetPerf, recordPerf } from "./assetPerf";

const ROOT = "note-assets";
/** 小记图片：与桌面同构（quick-notes/assets/{id}/{filename}），URL/同步键仍是 quick-notes/{id}/{file}。 */
const QUICK_ROOT = "quick-notes/assets";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
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
  // 小记资源键 quick-notes/{id}/{file} → 物理落在 quick-notes/assets/{id}/{file}（路径规则来自 core 单一来源）。
  if (segments[0] === "quick-notes") {
    if (segments.length !== 3) throw new Error(`非法资产键: ${key}`);
    return quickNoteAssetRelativePath(segments[1], segments[2]);
  }
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
  const parent = path.split("/").slice(0, -1).join("/");
  // 并发防竞态（压测2 260910）：4 路并发 saveAsset 写同一个新建笔记目录时，Android 原生
  // writeFile(recursive:true) 偶发 OS-PLUG-FILE-0011「Missing parent directory」（目录创建竞态，
  // 同目录并发下一个成功一个失败）。写前显式 mkdir 父目录（幂等，已存在错误忽略）+ 失败重试一次。
  // 性能观测：base64 编码（JS CPU）与整段写盘（含 mkdir 桥往返 + 原生解码写文件）分别计时。
  const encodeStart = Date.now();
  const base64 = bytesToBase64(bytes);
  recordPerf(assetPerf.b64Encode, Date.now() - encodeStart, bytes.length);
  const writeStart = Date.now();
  if (parent) {
    await Filesystem.mkdir({ path: parent, directory: Directory.Data, recursive: true }).catch(() => { /* 已存在 */ });
  }
  // data 传 base64；不传 encoding（Android 原生默认按 base64 解码写入；UTF8 会把 base64 当文本写坏）
  const write = () => Filesystem.writeFile({
    path,
    data: base64,
    directory: Directory.Data,
    recursive: true,
  });
  try {
    await write();
  } catch (error) {
    if (/Missing parent directory|OS-PLUG-FILE-0011/i.test(error instanceof Error ? error.message : String(error))) {
      await Filesystem.mkdir({ path: parent, directory: Directory.Data, recursive: true }).catch(() => { /* 已存在 */ });
      await write();
    } else {
      throw error;
    }
  }
  recordPerf(assetPerf.fsWrite, Date.now() - writeStart, bytes.length);
}

export async function loadAssetBytesFs(key: string): Promise<Uint8Array | null> {
  const path = requireAssetPath(key);
  try {
    const readStart = Date.now();
    const res = await Filesystem.readFile({
      path,
      directory: Directory.Data,
    });
    const readMs = Date.now() - readStart;
    // 未传 encoding → Android 原生返回 base64
    const decodeStart = Date.now();
    const bytes = base64ToBytes(String(res.data));
    recordPerf(assetPerf.b64Decode, Date.now() - decodeStart, bytes.length);
    recordPerf(assetPerf.fsRead, readMs, bytes.length);
    return bytes;
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
    const dir = await Filesystem.readdir({ path: `${QUICK_ROOT}/${quickNoteId}`, directory: Directory.Data });
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
    // 旧版本的 quick-notes 曾放在 note-assets/quick-notes/ 下；新布局在 quick-notes/assets（见上）。
    entries = root.files.filter((f) => f.type === "directory" && f.name !== "quick-notes" && isSafePathSegment(f.name));
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    keys.push(...await listNoteAssetKeysFs(entry.name));
  }
  try {
    const quickRoot = await Filesystem.readdir({ path: QUICK_ROOT, directory: Directory.Data });
    for (const quickNote of quickRoot.files.filter((f) => f.type === "directory" && isSafePathSegment(f.name))) {
      keys.push(...await listQuickNoteAssetKeysFs(quickNote.name));
    }
  } catch {
    // 小记资源目录不存在/损坏时跳过
  }
  return keys;
}
