import { describe, expect, it } from "vitest";
import { fieldChangedIdsOf } from "./engineBridge.js";
import type { LakeNoteEntry } from "../protocol/index.js";

/**
 * 261124 B5（审计③P2-3）：fieldChanged 拿 **wire 形态基线 vs 行形态**做裸 diff。
 * 基线 = 发布世界（trashed ⇒ parentId null，plan.ts wire 投影），行 = loadState（trashed 行
 * parent = notebook-trash）⇒ 每条已发布回收站条目每轮误判字段变更 ⇒ 零变更短路永久失效
 *（每轮全量序列化双索引，大库主 CPU）+ restoresIds 结算输入被污染。
 * 修法：parent 比较过 positionOf 投影（trashed ⇒ null 双侧归一）。
 */
describe("B5：fieldChanged 的 parent 比较按 wire 投影归一", () => {
  const T0 = "2026-11-20T00:00:00.000Z";
  const T1 = "2026-11-21T00:00:00.000Z";
  const H = "0000000000000000000000000000000000000000000000000000000000000000";
  const entry = (over: Partial<LakeNoteEntry> = {}): LakeNoteEntry => ({
    id: "n1", title: "T", parentId: null, sortOrder: 0, updatedAt: T0, contentHash: H,
    ...over,
  });

  it("回收站条目：wire 基线（parent=null）vs 行（parent=notebook-trash）⇒ 不算字段变更", () => {
    const base = new Map([["n1", entry({ parentId: null, trashedAt: T1, deletedFromParentId: "orig" })]]);
    const state = [entry({ parentId: "notebook-trash", trashedAt: T1, deletedFromParentId: "orig" })];
    expect(fieldChangedIdsOf(state, base)).toEqual([]);
  });

  it("对照：标题真变更 ⇒ 仍算字段变更；活跃条目 parent 真变更也算", () => {
    const base = new Map([["n1", entry()]]);
    expect(fieldChangedIdsOf([entry({ title: "改名", updatedAt: T1 })], base)).toEqual(["n1"]);
    expect(fieldChangedIdsOf([entry({ parentId: "nb2" })], base)).toEqual(["n1"]);
  });

  it("锁/图标/排序变更仍被识别（归一只作用于 parent 一维）", () => {
    const base = new Map([["n1", entry()]]);
    expect(fieldChangedIdsOf([entry({ isLocked: true, lockedAt: T1 })], base)).toEqual(["n1"]);
    expect(fieldChangedIdsOf([entry({ icon: "x" })], base)).toEqual(["n1"]);
    expect(fieldChangedIdsOf([entry({ sortOrder: 5 })], base)).toEqual(["n1"]);
  });
});
