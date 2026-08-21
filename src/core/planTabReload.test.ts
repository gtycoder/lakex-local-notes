import { describe, expect, it } from "vitest";
import { planTabReload } from "./planTabReload.js";

/** 表驱动：与 App.tsx 同步刷新循环的判定一一对应（V5 Phase 4）。 */
const cases: Array<{ name: string; input: Parameters<typeof planTabReload>[0]; expect: ReturnType<typeof planTabReload> }> = [
  { name: "远端无摘要（已删除）→ deleted", input: { digest: null, lastDigest: null, tabDirty: false, superseded: false }, expect: { action: "deleted" } },
  { name: "远端摘要 deleted 标记 → deleted", input: { digest: { updatedAt: "t", title: "x", deleted: true }, lastDigest: null, tabDirty: false, superseded: false }, expect: { action: "deleted" } },
  { name: "本地 dirty 且未被覆盖 → skip(dirty-pending)", input: { digest: { updatedAt: "t2", title: "x", deleted: false }, lastDigest: { updatedAt: "t1", title: "x" }, tabDirty: true, superseded: false }, expect: { action: "skip", reason: "dirty-pending" } },
  { name: "被覆盖（superseded）时即便 dirty 也重载", input: { digest: { updatedAt: "t2", title: "x", deleted: false }, lastDigest: { updatedAt: "t1", title: "x" }, tabDirty: true, superseded: true }, expect: { action: "reload", superseded: true } },
  { name: "摘要未变化 → skip(unchanged)", input: { digest: { updatedAt: "t1", title: "x", deleted: false }, lastDigest: { updatedAt: "t1", title: "x" }, tabDirty: false, superseded: false }, expect: { action: "skip", reason: "unchanged" } },
  { name: "标题变化 → reload", input: { digest: { updatedAt: "t1", title: "y", deleted: false }, lastDigest: { updatedAt: "t1", title: "x" }, tabDirty: false, superseded: false }, expect: { action: "reload", superseded: false } },
  { name: "updatedAt 变化 → reload", input: { digest: { updatedAt: "t2", title: "x", deleted: false }, lastDigest: { updatedAt: "t1", title: "x" }, tabDirty: false, superseded: false }, expect: { action: "reload", superseded: false } },
  { name: "无 lastDigest（新打开/未同步过）→ reload", input: { digest: { updatedAt: "t2", title: "x", deleted: false }, lastDigest: null, tabDirty: false, superseded: false }, expect: { action: "reload", superseded: false } },
];

describe("planTabReload（表驱动）", () => {
  it.each(cases.map((c) => [c.name, c.input, c.expect] as const))("%s", (_name, input, expected) => {
    expect(planTabReload(input)).toEqual(expected);
  });
});