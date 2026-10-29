/**
 * 从 v3 云端恢复一条“缺正文”的小记（替代旧 quick-notes manifest 恢复路径）。
 * 只读 pointer/quick index/body/declaration/assets；写入由 QuickNotesStore.importRemoteQuickNote 完成。
 */
import { sha256Hex } from "../../src/core/syncUtils.js";
import {
  declarationKey,
  indexKey,
  quickNoteAssetKey,
  quickNoteBodyKey,
  S3V3_POINTER_KEY,
} from "../../src/core/s3v3/protocol/s3v3Keys.js";
import { parseQuickNotesIndexBytes, validateAssetDeclaration, type QuickNoteEntry } from "../../src/core/s3v3/protocol/s3v3Index.js";
import type { S3v3Remote } from "../../src/core/s3v3Ports.js";
import { validatePointer } from "../../src/core/s3v3/protocol/s3v3Types.js";

export interface V3QuickNoteSnapshot {
  entry: QuickNoteEntry;
  content: Uint8Array;
  assets: Array<{ filename: string; bytes: Uint8Array }>;
}

export async function fetchQuickNoteFromV3(remote: S3v3Remote, id: string): Promise<V3QuickNoteSnapshot | null> {
  const rawPointer = await remote.get(S3V3_POINTER_KEY);
  if (!rawPointer) return null;
  let pointerRaw: unknown;
  try { pointerRaw = JSON.parse(new TextDecoder().decode(rawPointer)); } catch { return null; }
  const parsedPointer = validatePointer(pointerRaw);
  if (!parsedPointer.ok) return null;
  const pointer = parsedPointer.pointer;
  const indexBytes = await remote.get(indexKey("quickNotes", pointer.quickNotes.commit));
  if (!indexBytes) return null;
  const index = parseQuickNotesIndexBytes(indexBytes).index;
  const entry = index.items.find((it) => it.id === id);
  if (!entry) return null;
  const content = await remote.get(quickNoteBodyKey(entry.contentHash));
  if (!content || sha256Hex(content) !== entry.contentHash) return null;
  const assets: Array<{ filename: string; bytes: Uint8Array }> = [];
  if (entry.assetsHash) {
    const declBytes = await remote.get(declarationKey("quickNotes", id, entry.assetsHash));
    if (!declBytes) return null;
    let declRaw: unknown;
    try { declRaw = JSON.parse(new TextDecoder().decode(declBytes)); } catch { return null; }
    const decl = validateAssetDeclaration(declRaw);
    for (const asset of decl.assets) {
      const bytes = await remote.get(quickNoteAssetKey(id, asset.filename));
      if (!bytes || bytes.length !== asset.size || sha256Hex(bytes) !== asset.hash) return null;
      assets.push({ filename: asset.filename, bytes });
    }
  }
  return { entry, content, assets };
}
