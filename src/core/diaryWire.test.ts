/**
 * 日记 wire 集成测试（261109，片D 独立复核）。
 *
 * 覆盖 docs/DIARY.md 硬规则 1/2 的**集成**形态（单测已散在 diary.test / s3v3Index.space / planFolderSpace）：
 *  - `folders[].space` 三种往返（有值 / 缺字段 / null）+ 未知值读取容错；
 *  - **发布显式写**：非日记是 own property `space: null`，不是省略字段；
 *  - **取消标记可见**：base/remote 都是 diary、本地改回 null 且 bump updatedAt ⇒ 发布 null；
 *  - 零变更轮短路：本地丢 space 但无其它变更时 publish=null（不会把 null 反推上云端）；
 *  - 整库备份/便携包所搬运的**线格式**（索引 JSON）往返后 space 不丢。
 *
 * 数据库文件级快照（VACUUM INTO，便携包/整库备份的真实路径）由 electron/diaryStore.test.ts
 * 的「便携包/整库备份（VACUUM INTO 快照）保留 tree_nodes.space」覆盖；本文件不重复造库。
 */
import { describe, expect, it } from "vitest";
import { DIARY_FOLDER_SPACE, folderSpaceForWire, normalizeFolderSpace } from "./diary.js";
import { serializeLakeIndex, validateLakeIndex } from "./s3v3/protocol/index.js";
import type { LakeFolderEntry, LakeIndex, QuickNotesIndex } from "./s3v3/protocol/index.js";
import { planSync } from "./s3v3/plan/plan.js";
import type { PlanWorld } from "./s3v3/plan/plan.js";

const T = "2026-11-09T00:00:00.000Z";

const folder = (id: string, over: Partial<LakeFolderEntry> = {}): LakeFolderEntry => ({
  id, title: id, parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: T, ...over,
});

/** 最小世界：桌面端 sync 端口投影的形状（folders 同时给 lake 与 PlanWorld.folders）。 */
function world(folders: LakeFolderEntry[] = []): PlanWorld {
  const lake: LakeIndex = { v: 3, space: "lake", notes: [], folders };
  const quickNotes: QuickNotesIndex = { v: 3, space: "quickNotes", items: [], tags: [] };
  return { lake, quickNotes, folders };
}

/** planSync 的 state 端口（三个集合都可用数组表达，与 planFolderSpace.test.ts 同形）。 */
const state = () => ({ restorePending: [], purgeIntents: [], folderPurgeIntents: [] });

/** 原始 wire 目录行（故意绕过类型：模拟旧端/坏索引写出来的未知值）。 */
const rawFolder = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, title: id, parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: T, ...over,
});

describe("folders[].space 三种往返（有值 / 缺字段 / null）", () => {
  it("validateLakeIndex：diary 保留、缺字段与显式 null 归一成 null、未知值读成非日记", () => {
    const parsed = validateLakeIndex({
      v: 3, space: "lake", notes: [],
      folders: [
        rawFolder("f-diary", { space: "diary" }),
        rawFolder("f-missing"),              // 旧端：没有该字段
        rawFolder("f-null", { space: null }), // 显式非日记
        rawFolder("f-unknown", { space: "album" }), // 未知值 ⇒ 当非日记
      ],
    });
    expect(parsed.folders.map((f) => f.id)).toEqual(["f-diary", "f-missing", "f-null", "f-unknown"]);
    expect(parsed.folders.map((f) => f.space)).toEqual([DIARY_FOLDER_SPACE, null, null, null]);
  });

  it("serializeLakeIndex：三种行都**写实** space（日记是 \"diary\"，其余是 null 而不是省略）", () => {
    const text = serializeLakeIndex(validateLakeIndex({
      v: 3, space: "lake", notes: [],
      folders: [rawFolder("f-diary", { space: "diary" }), rawFolder("f-missing"), rawFolder("f-null", { space: null })],
    }));
    expect(text).toContain('"space":"diary"');
    expect(text).toContain('"space":null');
    // 两条非日记行 ⇒ 两个 null（缺字段那条也被补实）
    expect(text.match(/"space":null/g) ?? []).toHaveLength(2);
    // 不能说成"日记行之外一个 space 都没有"
    expect(text.match(/"space":"diary"/g) ?? []).toHaveLength(1);
  });

  it("线格式往返稳定：serialize → validate → serialize 字节不变（备份/便携包搬的就是这份文本）", () => {
    const parsed = validateLakeIndex({
      v: 3, space: "lake", notes: [],
      folders: [rawFolder("f-diary", { space: "diary" }), rawFolder("f-missing"), rawFolder("f-null", { space: null })],
    });
    const once = serializeLakeIndex(parsed);
    const twice = serializeLakeIndex(validateLakeIndex(JSON.parse(once)));
    expect(twice).toBe(once);
  });
});

describe("发布侧硬规则：space 显式写 + 取消标记可见", () => {
  it("非日记目录发布 space=null（own property，不是省略字段）；日记本发布 \"diary\"", () => {
    const plan = planSync({
      local: world([folder("nb-diary", { space: "diary" }), folder("nb-null", { space: null }), folder("nb-missing")]),
      base: world(), remote: world(), state: state(),
    });
    expect(plan.publish).not.toBeNull();
    const byId = new Map(plan.publish!.lake.folders.map((f) => [f.id, f]));
    expect(byId.get("nb-diary")!.space).toBe("diary");
    for (const id of ["nb-null", "nb-missing"]) {
      expect(Object.prototype.hasOwnProperty.call(byId.get(id), "space"), id + " 必须显式写 space").toBe(true);
      expect(byId.get(id)!.space).toBeNull();
    }
    // 序列化后也必须是写实的 null（wire 文本级证据）
    const text = serializeLakeIndex(plan.publish!.lake);
    expect(text).toContain('"space":null');
    expect(text).toContain('"space":"diary"');
  });

  it("取消日记标记：base/remote=diary，本地改回 null 且 bump updatedAt ⇒ 发布的是 null（不是沿用旧值）", () => {
    const base = world([folder("nb1", { space: "diary" })]);
    const local = world([folder("nb1", { space: null, updatedAt: "2026-11-10T00:00:00.000Z" })]);
    const plan = planSync({ local, base, remote: base, state: state() });
    expect(plan.publish).not.toBeNull();
    const entry = plan.publish!.lake.folders.find((f) => f.id === "nb1")!;
    expect(Object.prototype.hasOwnProperty.call(entry, "space")).toBe(true);
    expect(entry.space).toBeNull();
  });

  it("本地丢 space 但无其它变更 ⇒ 零变更轮 publish=null（不会把 space:null 反推上云端）", () => {
    // 场景：updatedAt 三端一致、只有本地行的 space 丢了（如移动端便携包导入丢列）。
    // 判据：plan 只在本轮会改变索引时构建发布（plan.ts:283-285，indexChanged 仅由 uploadLocal/
    // 本地删除/purge/标签变更等置位）⇒ 这种纯本地元数据丢失**不会**把 null 写进 wire。
    const base = world([folder("nb-diary", { space: "diary" })]);
    const local = world([folder("nb-diary", { space: null })]);   // 本地丢标记
    const plan = planSync({ local, base, remote: base, state: state() });
    expect(plan.publish).toBeNull();
  });
});

describe("folderSpaceForWire / normalizeFolderSpace 对拍（wire 两侧同一判据）", () => {
  it("写侧永不省略：任何输入都返回 \"diary\" 或 null；读侧只认 \"diary\"", () => {
    for (const input of ["diary", null, undefined, "", "album", "DIARY"] as const) {
      const wire = folderSpaceForWire(input);
      expect(wire === "diary" || wire === null).toBe(true);
      expect(normalizeFolderSpace(wire)).toBe(wire);
    }
  });
});
