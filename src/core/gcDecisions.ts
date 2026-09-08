/**
 * GC 保留集纯逻辑（桌面/移动端共用，对齐思源"内核+薄前端"分层）。
 * 从 electron/sync.ts buildLakeGcKeepSet 抽出纯逻辑部分：
 * 桌面端跑在 electron 主进程（ObjectStore + Store），移动端跑在 WebView（S3Store + note_history）。
 */
import type { Manifest } from "./manifestTypes.js";
import { collectManifestRefs } from "./syncUtils.js";

/** GC 保留集：latest manifest 声明的对象/资产引用 + 本机历史快照引用的资产（historyRefs 形如 assets/{noteId}/{filename}）。 */
export function buildGcKeepSet(opts: { manifest: Manifest | null; prefix: string; historyRefs: Iterable<string> }): Set<string> {
  const refs = new Set<string>();
  if (opts.manifest) collectManifestRefs(opts.manifest, refs);
  for (const r of opts.historyRefs) refs.add(r);
  const keep = new Set<string>();
  for (const r of refs) keep.add(`${opts.prefix}/${r}`);
  return keep;
}
