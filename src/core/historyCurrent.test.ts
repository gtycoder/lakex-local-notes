import { describe, expect, it } from "vitest";
import { pickCurrentHistorySnapshotId } from "./historyCurrent.js";

const snap = (id: number, contentHash: string) => ({ id, contentHash });

describe("历史快照「当前」唯一（261106）", () => {
  it("同 hash 重复行：只标最新一条（列表新→旧）", () => {
    const list = [snap(9, "h1"), snap(7, "h1"), snap(5, "h2")];
    expect(pickCurrentHistorySnapshotId(list, "h1")).toBe(9);
    expect(pickCurrentHistorySnapshotId(list, "h2")).toBe(5);
  });

  it("当前正文 hash 无匹配 / 缺失 ⇒ 不标任何一条", () => {
    const list = [snap(1, "a"), snap(2, "b")];
    expect(pickCurrentHistorySnapshotId(list, "c")).toBeNull();
    expect(pickCurrentHistorySnapshotId(list, null)).toBeNull();
    expect(pickCurrentHistorySnapshotId(list, "")).toBeNull();
    expect(pickCurrentHistorySnapshotId([], "a")).toBeNull();
  });

  it("不同 hash 各自独立：返回匹配的第一条（即使后面还有同内容）", () => {
    const list = [snap(3, "b"), snap(2, "a"), snap(1, "b")];
    expect(pickCurrentHistorySnapshotId(list, "b")).toBe(3);
    expect(pickCurrentHistorySnapshotId(list, "a")).toBe(2);
  });
});
