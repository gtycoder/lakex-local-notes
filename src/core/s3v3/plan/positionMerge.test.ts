import { describe, expect, it } from "vitest";
import {
  lockStateOf,
  mergeNoteLock,
  mergeNotePosition,
  positionOf,
  samePosition,
  type NoteLockState,
  type NotePosition,
} from "./positionMerge.js";

/**
 * 位置 / 锁字段的独立三方合并（纯函数，零 IO）。
 *
 * 为什么单测：这两个函数的边界此前只由 wire 场景间接覆盖 —— 而它们的语义又很容易被误读成
 * 「单轮必有同一个赢家」。**已知语义（261112 task-71 明确写死，不要按另一个方向改）**：
 *
 *   内容里 base×local×remote 三套独立判定：位置三件套（parentId / trashedAt / deletedFromParentId）
 *   与锁（locked / lockedAt）各判各的，与正文 hash 无关。
 *   **同毫秒双改**（两边都动了位置/锁，且 updatedAt/lockedAt 相等）⇒ 本轮**两端各自保留自己的本地版本**
 *   （判据「相等取本地」对每一端都成立），**不是**单轮里两端选出同一个赢家；下一轮基线各自前移后自然收敛。
 *   收敛依据不在本函数：P0-d 已用真实桶场景验证（同毫秒双改下一轮收敛），本文件只钉单轮行为与确定性。
 */

const pos = (parentId: string | null, trashedAt: string | null = null, deletedFromParentId: string | null = null): NotePosition => ({ parentId, trashedAt, deletedFromParentId });
const lock = (locked: boolean, lockedAt: string | null): NoteLockState => ({ locked, lockedAt });

describe("positionOf / samePosition（wire 位置投影）", () => {
  it("undefined / null / 空字段一律投影成「没有」", () => {
    expect(positionOf(null)).toBeNull();
    expect(positionOf(undefined)).toBeNull();
    const empty = positionOf({} as unknown as Parameters<typeof positionOf>[0]);
    expect(empty).toEqual(pos(null));
    expect(positionOf({ parentId: null } as unknown as Parameters<typeof positionOf>[0])).toEqual(pos(null));
    // undefined 与 null 等价：同一份「没有」不得判成位置变化
    expect(samePosition(positionOf({} as unknown as Parameters<typeof positionOf>[0])!, pos(null))).toBe(true);
  });

  it("trashed 条目的 parentId 投影为 null（本地回收站容器 id 不进 wire 比较）", () => {
    const trashedDesktop = positionOf({ parentId: "notebook-trash", trashedAt: "2026-01-02T00:00:00.000Z", deletedFromParentId: "nb-1" });
    const trashedMobile = positionOf({ parentId: "nb-1", trashedAt: "2026-01-02T00:00:00.000Z", deletedFromParentId: "nb-1" });
    expect(trashedDesktop).toEqual(pos(null, "2026-01-02T00:00:00.000Z", "nb-1"));
    // 两端「trashed + 同一删除前父」= 同一位置，不因本地容器 id 不同误判
    expect(samePosition(trashedDesktop!, trashedMobile!)).toBe(true);
  });
});

interface PositionCase {
  name: string;
  input: Parameters<typeof mergeNotePosition>[0];
  expect: ReturnType<typeof mergeNotePosition>;
}

const BASE = pos("nb-1");
const MOVED = pos("nb-2");
const OTHER = pos("nb-3");

const POSITION_CASES: PositionCase[] = [
  {
    name: "四情形·都不动 ⇒ same（位置取本地）",
    input: { base: BASE, local: BASE, remote: BASE },
    expect: { winner: "same", position: BASE, localChanged: false, remoteChanged: false },
  },
  {
    name: "四情形·只有本地动 ⇒ local（移动必须发布）",
    input: { base: BASE, local: MOVED, remote: BASE },
    expect: { winner: "local", position: MOVED, localChanged: true, remoteChanged: false },
  },
  {
    name: "四情形·只有远端动 ⇒ remote（应用远端位置）",
    input: { base: BASE, local: BASE, remote: MOVED },
    expect: { winner: "remote", position: MOVED, localChanged: false, remoteChanged: true },
  },
  {
    name: "四情形·两边都动 ⇒ updatedAt LWW（本地较新）",
    input: { base: BASE, local: MOVED, remote: OTHER, localUpdatedAt: "2026-01-02T00:00:00.000Z", remoteUpdatedAt: "2026-01-01T00:00:00.000Z" },
    expect: { winner: "local", position: MOVED, localChanged: true, remoteChanged: true },
  },
  {
    name: "四情形·两边都动 ⇒ updatedAt LWW（远端较新）",
    input: { base: BASE, local: MOVED, remote: OTHER, localUpdatedAt: "2026-01-01T00:00:00.000Z", remoteUpdatedAt: "2026-01-02T00:00:00.000Z" },
    expect: { winner: "remote", position: OTHER, localChanged: true, remoteChanged: true },
  },
  {
    name: "两边都动且 updatedAt 相等 ⇒ 取本地（确定性；同毫秒双改=各留本地，下一轮收敛）",
    input: { base: BASE, local: MOVED, remote: OTHER, localUpdatedAt: "2026-01-02T00:00:00.000Z", remoteUpdatedAt: "2026-01-02T00:00:00.000Z" },
    expect: { winner: "local", position: MOVED, localChanged: true, remoteChanged: true },
  },
  {
    name: "两边都动且缺省时间戳（undefined ≡ 空串）⇒ 仍取本地",
    input: { base: BASE, local: MOVED, remote: OTHER },
    expect: { winner: "local", position: MOVED, localChanged: true, remoteChanged: true },
  },
  {
    name: "base 缺席（新增/首拉）⇒ same，不判位置",
    input: { base: null, local: MOVED, remote: BASE },
    expect: { winner: "same", position: MOVED, localChanged: false, remoteChanged: false },
  },
  {
    name: "local 缺席 ⇒ same，position 为 local（null）",
    input: { base: BASE, local: null, remote: MOVED },
    expect: { winner: "same", position: null, localChanged: false, remoteChanged: false },
  },
  {
    name: "remote 缺席 ⇒ same，位置取本地",
    input: { base: BASE, local: MOVED, remote: null },
    expect: { winner: "same", position: MOVED, localChanged: false, remoteChanged: false },
  },
  {
    name: "trashed 组合：本地移入回收站（deletedFromParentId=原父）⇒ local",
    input: {
      base: BASE,
      local: positionOf({ parentId: "notebook-trash", trashedAt: "2026-01-02T00:00:00.000Z", deletedFromParentId: "nb-1" })!,
      remote: BASE,
    },
    expect: { winner: "local", position: pos(null, "2026-01-02T00:00:00.000Z", "nb-1"), localChanged: true, remoteChanged: false },
  },
  {
    name: "trashed 组合：本地从回收站恢复回原父 ⇒ local（恢复也是位置动作）",
    input: {
      base: pos(null, "2026-01-02T00:00:00.000Z", "nb-1"),
      local: pos("nb-1"),
      remote: pos(null, "2026-01-02T00:00:00.000Z", "nb-1"),
    },
    expect: { winner: "local", position: pos("nb-1"), localChanged: true, remoteChanged: false },
  },
];

describe("mergeNotePosition（位置独立三方合并）", () => {
  for (const testCase of POSITION_CASES) {
    it(testCase.name, () => {
      expect(mergeNotePosition(testCase.input)).toEqual(testCase.expect);
    });
  }

  it("同毫秒双改：两端各自调用都判「本地赢」（因此本轮各留本地版本，靠下一轮收敛）", () => {
    const at = "2026-01-02T00:00:00.000Z";
    // A 端视角：自己的 MOVED@T，远端 OTHER@T
    expect(mergeNotePosition({ base: BASE, local: MOVED, remote: OTHER, localUpdatedAt: at, remoteUpdatedAt: at }).winner).toBe("local");
    // B 端视角：自己的 OTHER@T，远端 MOVED@T
    expect(mergeNotePosition({ base: BASE, local: OTHER, remote: MOVED, localUpdatedAt: at, remoteUpdatedAt: at }).winner).toBe("local");
    // ⇒ 单轮没有「双方共同赢家」；不要改成 single-round 同赢家断言
  });
});

interface LockCase {
  name: string;
  input: Parameters<typeof mergeNoteLock>[0];
  expect: ReturnType<typeof mergeNoteLock>;
}

const LB = lock(true, "2026-01-01T00:00:00.000Z");
const LB_OPEN = lock(false, null);
const L_OPEN_LATER = lock(false, "2026-01-03T00:00:00.000Z");
const L_LOCK_LATER = lock(true, "2026-01-03T00:00:00.000Z");

const LOCK_CASES: LockCase[] = [
  {
    name: "四情形·都不动 ⇒ same（取本地）",
    input: { base: LB, local: LB, remote: LB },
    expect: { winner: "same", state: LB },
  },
  {
    name: "四情形·只有本地加锁 ⇒ local",
    input: { base: L_OPEN_LATER, local: L_LOCK_LATER, remote: L_OPEN_LATER },
    expect: { winner: "local", state: L_LOCK_LATER },
  },
  {
    name: "四情形·只有远端加锁 ⇒ remote",
    input: { base: L_OPEN_LATER, local: L_OPEN_LATER, remote: L_LOCK_LATER },
    expect: { winner: "remote", state: L_LOCK_LATER },
  },
  {
    name: "四情形·两边都动 ⇒ lockedAt LWW（本地较新）",
    input: { base: LB, local: lock(false, "2026-01-04T00:00:00.000Z"), remote: lock(true, "2026-01-05T00:00:00.000Z") },
    expect: { winner: "remote", state: lock(true, "2026-01-05T00:00:00.000Z") },
  },
  {
    name: "解锁也算本地动（locked=false 且 lockedAt 为空）",
    input: { base: LB, local: LB_OPEN, remote: LB },
    expect: { winner: "local", state: LB_OPEN },
  },
  {
    name: "解锁但不改 lockedAt 也判本地动（靠 base 变更检测，不依赖时间戳）",
    input: { base: LB, local: lock(false, "2026-01-01T00:00:00.000Z"), remote: LB },
    expect: { winner: "local", state: lock(false, "2026-01-01T00:00:00.000Z") },
  },
  {
    name: "都动且 lockedAt 相等 ⇒ 加锁优先（本地开锁/远端加锁 ⇒ remote）",
    input: {
      base: lock(false, "2026-01-01T00:00:00.000Z"),
      local: lock(false, "2026-01-02T00:00:00.000Z"),
      remote: lock(true, "2026-01-02T00:00:00.000Z"),
    },
    expect: { winner: "remote", state: lock(true, "2026-01-02T00:00:00.000Z") },
  },
  {
    name: "都动且 lockedAt 相等 ⇒ 加锁优先（本地加锁/远端开锁 ⇒ local）",
    input: {
      base: lock(false, "2026-01-01T00:00:00.000Z"),
      local: lock(true, "2026-01-02T00:00:00.000Z"),
      remote: lock(false, "2026-01-02T00:00:00.000Z"),
    },
    expect: { winner: "local", state: lock(true, "2026-01-02T00:00:00.000Z") },
  },
  {
    name: "都动且 lockedAt 都空 ⇒ 加锁优先（本地加锁 ⇒ local）",
    input: { base: lock(false, null), local: lock(true, null), remote: lock(false, null) },
    expect: { winner: "local", state: lock(true, null) },
  },
  {
    name: "都动且 lockedAt 都空 ⇒ 加锁优先（远端加锁 ⇒ remote）",
    input: { base: lock(false, null), local: lock(false, null), remote: lock(true, null) },
    expect: { winner: "remote", state: lock(true, null) },
  },
  {
    name: "无基线 ⇒ lockedAt LWW 兜底（解锁较新 ⇒ local）",
    input: { base: null, local: lock(false, "2026-01-03T00:00:00.000Z"), remote: lock(true, "2026-01-02T00:00:00.000Z") },
    expect: { winner: "local", state: lock(false, "2026-01-03T00:00:00.000Z") },
  },
  {
    name: "无基线 ⇒ lockedAt LWW 兜底（加锁较新 ⇒ remote）",
    input: { base: null, local: lock(false, "2026-01-02T00:00:00.000Z"), remote: lock(true, "2026-01-03T00:00:00.000Z") },
    expect: { winner: "remote", state: lock(true, "2026-01-03T00:00:00.000Z") },
  },
  {
    name: "无基线 + lockedAt 相等且状态不同 ⇒ 加锁优先",
    input: { base: null, local: lock(false, "2026-01-02T00:00:00.000Z"), remote: lock(true, "2026-01-02T00:00:00.000Z") },
    expect: { winner: "remote", state: lock(true, "2026-01-02T00:00:00.000Z") },
  },
  {
    name: "local 缺席 ⇒ same，state 取 remote",
    input: { base: LB, local: null, remote: L_OPEN_LATER },
    expect: { winner: "same", state: L_OPEN_LATER },
  },
  {
    name: "remote 缺席 ⇒ same，state 取 local",
    input: { base: LB, local: L_OPEN_LATER, remote: null },
    expect: { winner: "same", state: L_OPEN_LATER },
  },
  {
    name: "两边都缺席 ⇒ same，state 为 null",
    input: { base: LB, local: null, remote: null },
    expect: { winner: "same", state: null },
  },
];

describe("mergeNoteLock（锁独立三方合并）", () => {
  for (const testCase of LOCK_CASES) {
    it(testCase.name, () => {
      expect(mergeNoteLock(testCase.input)).toEqual(testCase.expect);
    });
  }

  it("lockStateOf：缺 isLocked / lockedAt 视作「未锁 + 无时间」（undefined ≡ null）", () => {
    expect(lockStateOf(null)).toBeNull();
    expect(lockStateOf(undefined)).toBeNull();
    expect(lockStateOf({})).toEqual({ locked: false, lockedAt: null });
    expect(lockStateOf({ isLocked: true })).toEqual({ locked: true, lockedAt: null });
  });
});
