import { describe, expect, it } from "vitest";
import { shouldSkipZeroChange, isRemoteDescendant, createSupersededTracker } from "./syncPerf.js";

describe("syncPerf 纯函数（桌面难逻辑下沉）", () => {
  describe("shouldSkipZeroChange（零变更早退）", () => {
    it("commitId 相同 + 无待上传 + 墓碑签名一致 → 跳过", () => {
      expect(shouldSkipZeroChange({
        remoteCommitId: "c1", lastSeenCommitId: "c1",
        hasPending: false, tombstoneSig: "3:2026-01-01", lastTombstoneSig: "3:2026-01-01",
      })).toBe(true);
    });
    it("commitId 不同（远端有新提交）→ 不跳过", () => {
      expect(shouldSkipZeroChange({
        remoteCommitId: "c2", lastSeenCommitId: "c1",
        hasPending: false, tombstoneSig: "3:x", lastTombstoneSig: "3:x",
      })).toBe(false);
    });
    it("本地有待上传（hasPending）→ 不跳过", () => {
      expect(shouldSkipZeroChange({
        remoteCommitId: "c1", lastSeenCommitId: "c1",
        hasPending: true, tombstoneSig: "3:x", lastTombstoneSig: "3:x",
      })).toBe(false);
    });
    it("墓碑签名变化（新增 purge）→ 不跳过", () => {
      expect(shouldSkipZeroChange({
        remoteCommitId: "c1", lastSeenCommitId: "c1",
        hasPending: false, tombstoneSig: "4:y", lastTombstoneSig: "3:x",
      })).toBe(false);
    });
    it("无远端 manifest（首次）→ 不跳过", () => {
      expect(shouldSkipZeroChange({
        remoteCommitId: null, lastSeenCommitId: null,
        hasPending: true, tombstoneSig: "", lastTombstoneSig: "",
      })).toBe(false);
    });
  });

  describe("isRemoteDescendant（环检测）", () => {
    it("nodeId 是 ancestorId 的直系子孙 → true", () => {
      const m = new Map<string, string | null>([["b", "a"], ["c", "b"]]);
      expect(isRemoteDescendant("c", "a", m)).toBe(true);
    });
    it("nodeId 自身等于 ancestorId → true（含自身）", () => {
      const m = new Map<string, string | null>([["a", null]]);
      expect(isRemoteDescendant("a", "a", m)).toBe(true);
    });
    it("无关联 → false", () => {
      const m = new Map<string, string | null>([["b", "a"]]);
      expect(isRemoteDescendant("d", "a", m)).toBe(false);
    });
    it("环清单（异常）→ 防死循环返回 false", () => {
      const m = new Map<string, string | null>([["a", "b"], ["b", "a"]]);
      expect(isRemoteDescendant("a", "c", m)).toBe(false);
    });
  });

  describe("createSupersededTracker（去重）", () => {
    it("重复 push 同一 id 只记一次", () => {
      const t = createSupersededTracker();
      t.push("n1", "标题1");
      t.push("n1", "标题1");
      t.push("n2", "标题2");
      expect(t.list()).toEqual([{ id: "n1", title: "标题1" }, { id: "n2", title: "标题2" }]);
    });
  });
});
