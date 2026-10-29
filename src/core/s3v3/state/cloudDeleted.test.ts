/**
 * 「云端已删除 · 仅本地」标记失效判据单测（settleCloudDeleted；E3-1 phase2b 残项，261029）。
 *
 * 判据单点：引擎 `finalizeRemotePurged` 与适配器 loadState 的 DB 投影兜底都调本函数，
 * 端到端行为由 electron/cloudDeleted.test.ts（桌面）与 conformance（两端）另锁，这里钉判据本身。
 */
import { describe, expect, it } from "vitest";
import { settleCloudDeleted } from "./cloudDeleted.js";

describe("settleCloudDeleted（唯一失效判据）", () => {
  it("没有失效上下文 ⇒ 原样返回（顺序与重复都保留，不偷偷去重）", () => {
    expect(settleCloudDeleted(["b", "a", "b"], {})).toEqual(["b", "a", "b"]);
  });

  it("空输入/缺省字段 ⇒ 空数组（不抛错）", () => {
    expect(settleCloudDeleted(undefined, {})).toEqual([]);
    expect(settleCloudDeleted([], { restorePending: ["x"] })).toEqual([]);
  });

  it("显式恢复 ⇒ 标记失效（副本让位给正常上传，恢复后要能重新上传）", () => {
    expect(settleCloudDeleted(["a", "b"], { restorePending: ["a"] })).toEqual(["b"]);
  });

  it("远端重新出现同 id ⇒ 标记失效（副本跟随远端）", () => {
    expect(settleCloudDeleted(["a", "b"], { remotelyPresent: ["b"] })).toEqual(["a"]);
  });

  it("本地已彻底删除 ⇒ 标记失效（没有对象可指，否则徽标永久挂死 + 每轮空转）", () => {
    expect(settleCloudDeleted(["a", "b"], { locallyPurged: ["b"] })).toEqual(["a"]);
  });

  it("三种原因并存：失效集合取并集，其余 id 顺序不变", () => {
    const purged = ["a", "b", "c", "d", "e"];
    expect(settleCloudDeleted(purged, {
      restorePending: ["a"],
      remotelyPresent: ["c"],
      locallyPurged: ["e", "zz"],
    })).toEqual(["b", "d"]);
  });

  it("有值但不命中 ⇒ 与缺省等价（避免调用方为了「空集合」多写分支）", () => {
    expect(settleCloudDeleted(["a"], { restorePending: new Set<string>(), remotelyPresent: [], locallyPurged: [] })).toEqual(["a"]);
  });
});
