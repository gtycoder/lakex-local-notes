/**
 * 移动端资产传输性能观测（诊断用，280925 移动同步性能专项）。
 *
 * 目的：把「图片/附件过桥」的成本拆成可量化的桶——HTTP 往返、JS base64 编解码、
 * Filesystem 读写——为「原生资产同步插件（字节不过桥）」立项提供实测依据。
 * 只统计、不改变行为；快照经 window.__lakePerf.snapshot() 暴露给 CDP。
 */
export interface PerfBucket {
  count: number;
  bytes: number;
  ms: number;
}

export interface AssetPerfStats {
  /** 所有 CapacitorHttp 往返（网络 + 原生侧 base64）。 */
  http: PerfBucket;
  /** path 含 /assets/ 的 CapacitorHttp 往返（图片/附件专用）。 */
  assetHttp: PerfBucket;
  /** JS 侧 btoa（PUT 请求体编码）。 */
  b64Encode: PerfBucket;
  /** path 含 /assets/ 的 JS btoa（资产上传编码）。 */
  assetB64Encode: PerfBucket;
  /** JS 侧 atob（响应体解码）。 */
  b64Decode: PerfBucket;
  /** path 含 /assets/ 的 JS atob（资产下载解码）。 */
  assetB64Decode: PerfBucket;
  /** Filesystem.writeFile（含父目录 mkdir）。 */
  fsWrite: PerfBucket;
  /** Filesystem.readFile。 */
  fsRead: PerfBucket;
}

function bucket(): PerfBucket {
  return { count: 0, bytes: 0, ms: 0 };
}

export const assetPerf: AssetPerfStats = {
  http: bucket(),
  assetHttp: bucket(),
  b64Encode: bucket(),
  assetB64Encode: bucket(),
  b64Decode: bucket(),
  assetB64Decode: bucket(),
  fsWrite: bucket(),
  fsRead: bucket(),
};

/** 记录一次操作：count +1、bytes/ms 累加。 */
export function recordPerf(target: PerfBucket, ms: number, bytes: number): void {
  target.count += 1;
  target.bytes += bytes;
  target.ms += ms;
}

/** 清空所有桶（每个阶段前调用，得到该阶段净耗时）。 */
export function resetAssetPerf(): void {
  for (const key of Object.keys(assetPerf) as Array<keyof AssetPerfStats>) {
    const b = assetPerf[key];
    b.count = 0;
    b.bytes = 0;
    b.ms = 0;
  }
}

/** 深拷贝快照（避免调用方后续 reset 影响引用）。 */
export function snapshotAssetPerf(): AssetPerfStats {
  const out = {} as AssetPerfStats;
  for (const key of Object.keys(assetPerf) as Array<keyof AssetPerfStats>) {
    out[key] = { ...assetPerf[key] };
  }
  return out;
}
