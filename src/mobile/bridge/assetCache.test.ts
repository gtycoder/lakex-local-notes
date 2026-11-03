import { describe, expect, it } from "vitest";

import { ASSET_CACHE_MAX_BYTES, BoundedAssetCache, assets } from "./assetCache";

const bytes = (size: number, fill = 1): Uint8Array => new Uint8Array(size).fill(fill);

describe("BoundedAssetCache（P8 资产 LRU）", () => {
  it("默认上界 = 32MiB（目标量级 20 万附件 / 单张上限 25MiB）", () => {
    expect(ASSET_CACHE_MAX_BYTES).toBe(32 * 1024 * 1024);
    expect(assets.totalCachedBytes).toBe(0);
  });

  it("按字节淘汰最旧条目（不是按条数）", () => {
    const cache = new BoundedAssetCache(10);
    cache.set("a", bytes(4));
    cache.set("b", bytes(4));
    cache.set("c", bytes(4)); // 12 > 10 ⇒ 淘汰 a
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
    expect(cache.totalCachedBytes).toBe(8);
  });

  it("get 刷新 recency：读过的条目不会被先淘汰", () => {
    const cache = new BoundedAssetCache(10);
    cache.set("a", bytes(4));
    cache.set("b", bytes(4));
    cache.get("a"); // a 变成最近使用
    cache.set("c", bytes(4)); // 12 > 10 ⇒ 淘汰 b
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  it("重复 set 同一 key 只算一份字节，并刷新 recency", () => {
    const cache = new BoundedAssetCache(10);
    cache.set("a", bytes(4));
    cache.set("b", bytes(4));
    cache.set("a", bytes(6, 2)); // 覆盖：total = 6 + 4 = 10，a 最近
    expect(cache.totalCachedBytes).toBe(10);
    cache.set("c", bytes(1)); // 11 > 10 ⇒ 淘汰 b
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.get("a")![0]).toBe(2);
  });

  it("delete / clear 正确回退字节账（上传失败删除路径依赖它）", () => {
    const cache = new BoundedAssetCache(100);
    cache.set("a", bytes(10));
    cache.set("b", bytes(20));
    expect(cache.totalCachedBytes).toBe(30);
    expect(cache.delete("a")).toBe(true);
    expect(cache.totalCachedBytes).toBe(20);
    expect(cache.delete("missing")).toBe(false);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.totalCachedBytes).toBe(0);
  });

  it("单条超过上界时自我淘汰（调用方回落文件，正确性不变）", () => {
    const cache = new BoundedAssetCache(4);
    cache.set("big", bytes(8));
    expect(cache.size).toBe(0);
    expect(cache.totalCachedBytes).toBe(0);
  });

  it("保持 Map 语义：has 不触碰 recency、可迭代", () => {
    const cache = new BoundedAssetCache(100);
    cache.set("a", bytes(1));
    cache.set("b", bytes(2));
    expect(cache.has("a")).toBe(true); // 不刷新
    expect([...cache.keys()]).toEqual(["a", "b"]);
    expect([...cache].map(([key]) => key)).toEqual(["a", "b"]);
    expect(cache.size).toBe(2);
  });
});
