/**
 * 运行期资产字节缓存（LRU，P8 · 261103）。
 *
 * 背景：261026 起 `assets` 是模块级 Map，只增不删（上传/小记图片写入后只有「孤儿删除 / 落盘失败」会 delete）。
 * 目标量级 = 20 万附件、单张上限 25MiB ⇒ 长会话内存随上传量线性涨。这里给总字节加 LRU 上界（默认 32MiB），
 * 只留「最近写入/读取」的少数资源；**未命中一律回落到文件读取**（assetFs），正确性不依赖缓存。
 *
 * 语义保持：BoundedAssetCache extends Map，调用点的 get/has/set/delete/迭代/size 全部照旧；
 * 淘汰是纯性能行为，不影响数据（缓存里本来就只有"刚写过的字节"）。
 */
export const ASSET_CACHE_MAX_BYTES = 32 * 1024 * 1024;

export class BoundedAssetCache extends Map<string, Uint8Array> {
  private totalBytes = 0;

  constructor(private readonly maxBytes: number = ASSET_CACHE_MAX_BYTES) {
    super();
  }

  /** 当前缓存字节数（单测/调试用；不是总资产大小）。 */
  get totalCachedBytes(): number {
    return this.totalBytes;
  }

  override set(key: string, value: Uint8Array): this {
    const previous = super.get(key);
    if (previous !== undefined) this.totalBytes -= previous.byteLength;
    super.delete(key); // 重新插入到末尾 = 最近使用
    super.set(key, value);
    this.totalBytes += value.byteLength;
    this.evict();
    return this;
  }

  /** 读也算一次使用（LRU）；未命中返回 undefined，调用方回落文件。 */
  override get(key: string): Uint8Array | undefined {
    const value = super.get(key);
    if (value === undefined) return undefined;
    super.delete(key);
    super.set(key, value); // 触碰只刷新顺序，不改变 totalBytes
    return value;
  }

  override delete(key: string): boolean {
    const value = super.get(key);
    if (value !== undefined) this.totalBytes -= value.byteLength;
    return super.delete(key);
  }

  override clear(): void {
    this.totalBytes = 0;
    super.clear();
  }

  private evict(): void {
    while (this.totalBytes > this.maxBytes && this.size > 0) {
      const oldest = this.keys().next().value;
      if (oldest === undefined) return;
      const value = super.get(oldest);
      super.delete(oldest);
      if (value !== undefined) this.totalBytes -= value.byteLength;
    }
  }
}

/** 全局运行期缓存（唯一实例；原 context.ts 的 Map 搬到这里以便单测/测试重置复用）。 */
export const assets = new BoundedAssetCache();
