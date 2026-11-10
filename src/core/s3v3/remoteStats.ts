/**
 * S3 远端请求计数（261110「保存并同步」提速证据）：包一层 `S3v3Remote`，只数请求、不改语义。
 *
 * 用途：
 *  · 单条推送把请求序列量化成一行 [perf] 证据（pointer 读/索引读/上传/发布各几次）；
 *  · 测试据此断言「最短链」：不读 lake 索引、不 GET 别的小记正文、成功后请求数不随库增长。
 *
 * 只透传原 remote 真正具备的可选能力（getToFile/putFromFile/getRange）：包完若凭空长出方法，
 * 引擎会误判「支持原生流式」而改变行为。
 */
import type { RemoteObjectInfo, S3v3Remote } from "../s3v3Ports.js";

export interface RemoteOpStats {
  /** 按 key 分类的 GET 次数（key 列表按"段"合并：只保留前两级，避免每次同步攒全量 key 字符串）。 */
  gets: number;
  puts: number;
  lists: number;
  deleteMans: number;
  deleteByPrefixes: number;
  getRanges: number;
  getToFiles: number;
  putFromFiles: number;
  /** 被 GET 的 key 明细（单条推送 ≤ 十余条，直接保留原文便于日志/断言）。 */
  getKeys: string[];
  /** 被 PUT 的 key 明细。 */
  putKeys: string[];
  total: number;
}

export interface CountingRemote {
  remote: S3v3Remote;
  stats: RemoteOpStats;
}

export function countRemoteOps(remote: S3v3Remote): CountingRemote {
  const stats: RemoteOpStats = {
    gets: 0, puts: 0, lists: 0, deleteMans: 0, deleteByPrefixes: 0,
    getRanges: 0, getToFiles: 0, putFromFiles: 0, getKeys: [], putKeys: [], total: 0,
  };
  const wrapped: S3v3Remote = {
    async get(key) { stats.gets += 1; stats.total += 1; stats.getKeys.push(key); return await remote.get(key); },
    async put(key, bytes, opts) { stats.puts += 1; stats.total += 1; stats.putKeys.push(key); return await remote.put(key, bytes, opts); },
    async list(prefix): Promise<RemoteObjectInfo[]> { stats.lists += 1; stats.total += 1; return await remote.list(prefix); },
    async deleteMany(keys) { stats.deleteMans += 1; stats.total += 1; return await remote.deleteMany(keys); },
    async deleteByPrefix(prefix) { stats.deleteByPrefixes += 1; stats.total += 1; return await remote.deleteByPrefix(prefix); },
  };
  if (remote.getRange) {
    wrapped.getRange = async (key, start, end) => { stats.getRanges += 1; stats.total += 1; return await remote.getRange!(key, start, end); };
  }
  if (remote.getToFile) {
    wrapped.getToFile = async (key, dest, expected) => { stats.getToFiles += 1; stats.total += 1; return await remote.getToFile!(key, dest, expected); };
  }
  if (remote.putFromFile) {
    wrapped.putFromFile = async (key, local, opts) => { stats.putFromFiles += 1; stats.total += 1; return await remote.putFromFile!(key, local, opts); };
  }
  return { remote: wrapped, stats };
}

/** 一行请求摘要（日志用；不含 key 明细，避免长行）。 */
export function remoteOpSummary(stats: RemoteOpStats): string {
  return "requests=" + stats.total + " get=" + stats.gets + " put=" + stats.puts
    + (stats.lists ? " list=" + stats.lists : "")
    + (stats.deleteMans || stats.deleteByPrefixes ? " del=" + (stats.deleteMans + stats.deleteByPrefixes) : "")
    + (stats.getToFiles ? " getToFile=" + stats.getToFiles : "")
    + (stats.putFromFiles ? " putFromFile=" + stats.putFromFiles : "");
}
