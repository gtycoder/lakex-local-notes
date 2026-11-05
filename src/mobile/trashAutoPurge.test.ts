/**
 * 移动端回收站自动过期清理（桌面同口径）护栏。
 *
 * 覆盖判据：
 * - 过期项被彻底删除（物理删行 + 写 purge 墓碑）、未过期保留；
 * - 阈值 <=0 = 关闭（与桌面 trashAutoPurgeDays / core/trashPolicy 同口径）；
 * - 重复调用幂等；只清顶级条目（子项随根删，不重复计数）；
 * - **不越过用户恢复**：列表与删除之间用户点了恢复 ⇒ 事务内守卫跳过、一行未动；
 * - 分批 + 批间让出主线程；单条失败不中断其余；并发重入单飞。
 * 阈值来源：移动端无「回收站自动过期」设置项 ⇒ 取桌面默认 90 天（理由见 trashAutoPurge.ts 文件头）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { SqlJsAsyncDb, SqlJsDb } from "./data/sqliteDb.js";
import { applyMobileSchema } from "./data/schema.js";
import {
  listTrashTree,
  purgeTreeItem,
  restoreTreeItem,
  type MobileTrashTreeItem,
} from "./data/trashRepository.js";
import {
  runScheduledTrashPurge,
  selectExpiredTrashRoots,
  trashRootsOf,
  TRASH_AUTO_PURGE_DAYS,
  TRASH_PURGE_BATCH_SIZE,
  type ScheduledTrashPurgeDeps,
  type TrashRootCandidate,
} from "./sync/trashAutoPurge.js";

const assetFsMocks = vi.hoisted(() => ({
  removeNoteAssetsDirFs: vi.fn(async (_noteId: string) => {}),
}));

vi.mock("./native/assetFs", () => ({
  saveAssetBytesFs: vi.fn(async () => {}),
  loadAssetBytesFs: vi.fn(async () => null),
  listAssetKeysFs: vi.fn(async () => []),
  listNoteAssetKeysFs: vi.fn(async () => []),
  removeAssetBytesFs: vi.fn(async () => {}),
  removeNoteAssetsDirFs: assetFsMocks.removeNoteAssetsDirFs,
  removeQuickNoteAssetsDirFs: vi.fn(async () => {}),
}));

import { removeNoteAssetsDirFs } from "./native/assetFs";

const DAY_MS = 24 * 3600 * 1000;
const NOW = Date.parse("2026-11-05T00:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();
const daysAgo = (days: number): string => iso(NOW - days * DAY_MS);

// ---- DB 夹具（纯 SQL 播种，不依赖正文文件/原生插件）----

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

async function insertFolder(
  db: SqlJsAsyncDb,
  args: { id: string; parentId?: string | null; nodeType?: string; trashedAt?: string | null },
): Promise<void> {
  await db.prepare(
    "INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,is_dirty) VALUES (?,?,?,0,?,NULL,?,?,?)"
  ).run(args.id, "标题-" + args.id, args.parentId ?? null, args.nodeType ?? "folder", iso(NOW), args.trashedAt ?? null, args.trashedAt ? 1 : 0);
}

async function insertNote(
  db: SqlJsAsyncDb,
  args: { id: string; parentId?: string | null; trashedAt?: string | null; cloudDeleted?: boolean },
): Promise<void> {
  await db.prepare(
    "INSERT INTO notes (id,title,parent_id,sort_order,updated_at,content_hash,is_dirty,trashed_at,cloud_deleted) VALUES (?,?,?,0,?,?,?,?,?)"
  ).run(args.id, "标题-" + args.id, args.parentId ?? null, iso(NOW), "hash-" + args.id, args.trashedAt ? 1 : 0, args.trashedAt ?? null, args.cloudDeleted ? 1 : 0);
}

async function rowsOf(db: SqlJsAsyncDb, sql: string, ...values: unknown[]): Promise<Array<Record<string, unknown>>> {
  return await db.prepare(sql).all(...values) as Array<Record<string, unknown>>;
}

/** 生产同一条接线：bridge.listTrashTree + 带守卫的 bridge.purgeTreeItem。 */
function runPurge(db: SqlJsAsyncDb, overrides: Partial<ScheduledTrashPurgeDeps<MobileTrashTreeItem>> = {}) {
  return runScheduledTrashPurge({
    listTrash: () => listTrashTree(db),
    purge: (root, expiredBefore) => purgeTreeItem(db, root.id, root.kind, { expiredBefore }),
    now: () => NOW,
    yieldToUi: async () => {},
    ...overrides,
  });
}

describe("回收站自动过期：顶级条目与到期判定（纯函数）", () => {
  const item = (id: string, parentId: string | null, deletedAt: string | null, kind: "folder" | "note" = "note"): TrashRootCandidate =>
    ({ id, parentId, deletedAt, kind });

  it("阈值固定 90 天（与桌面设置默认值同口径）", () => {
    expect(TRASH_AUTO_PURGE_DAYS).toBe(90);
  });

  it("阈值 <=0 / 非法 = 关闭，不选出任何条目（与 core/trashPolicy 同口径）", () => {
    const items = [item("n1", null, daysAgo(400))];
    for (const days of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(selectExpiredTrashRoots(items, { now: NOW, days })).toEqual([]);
    }
  });

  it("只选顶级：子项父在回收站 ⇒ 随根一起 purge，不单独处理", () => {
    const items = [
      item("nb", null, daysAgo(100), "folder"),
      item("g", "nb", daysAgo(100), "folder"),
      item("n1", "g", daysAgo(100)),
      item("n2", "active-notebook", daysAgo(100)),
    ];
    expect(trashRootsOf(items).map((it) => it.id)).toEqual(["nb", "n2"]);
    expect(selectExpiredTrashRoots(items, { now: NOW }).map((it) => it.root.id)).toEqual(["nb", "n2"]);
  });

  it("严格早于截止时刻才到期（正好 90 天仍保留）；时间缺失/非法宁可留着", () => {
    const items = [
      item("expired", null, daysAgo(91)),
      item("boundary", null, daysAgo(90)),
      item("fresh", null, daysAgo(1)),
      item("no-time", null, null),
      item("bad-time", null, "not-a-time"),
    ];
    expect(selectExpiredTrashRoots(items, { now: NOW }).map((it) => it.root.id)).toEqual(["expired"]);
    // 截止时刻原样交给 repository 做事务内兜底复核
    expect(selectExpiredTrashRoots(items, { now: NOW })[0]?.expiredBefore).toBe(daysAgo(90));
  });
});

describe("回收站自动过期：调度（分批 / 失败隔离 / 并发重入）", () => {
  const expiredItems = (count: number): TrashRootCandidate[] =>
    Array.from({ length: count }, (_, index) => ({ id: "n" + index, parentId: null, deletedAt: daysAgo(100), kind: "note" as const }));

  it("按批处理、批间让出主线程；最后一批不再让出", async () => {
    const yieldSpy = vi.fn(async () => {});
    const purge = vi.fn(async () => true);
    const result = await runScheduledTrashPurge({
      listTrash: async () => expiredItems(TRASH_PURGE_BATCH_SIZE + 1),
      purge,
      now: () => NOW,
      yieldToUi: yieldSpy,
    });
    expect(result).toEqual({ purged: TRASH_PURGE_BATCH_SIZE + 1, failed: 0, skipped: false });
    expect(purge).toHaveBeenCalledTimes(TRASH_PURGE_BATCH_SIZE + 1);
    expect(yieldSpy).toHaveBeenCalledTimes(1); // 两批 ⇒ 只在批间让出一次
  });

  it("阈值 <=0：连回收站都不读（一次桥往返都不花）", async () => {
    const listTrash = vi.fn(async () => expiredItems(2));
    const purge = vi.fn(async () => true);
    const result = await runScheduledTrashPurge({ listTrash, purge, days: 0, now: () => NOW });
    expect(result).toEqual({ purged: 0, failed: 0, skipped: false });
    expect(listTrash).not.toHaveBeenCalled();
    expect(purge).not.toHaveBeenCalled();
  });

  it("单条失败不中断整轮（失败静默交给调用方写日志，下次时机再试）", async () => {
    const purge = vi.fn(async (root: TrashRootCandidate) => {
      if (root.id === "n0") throw new Error("DB busy");
      return true;
    });
    const result = await runScheduledTrashPurge({
      listTrash: async () => expiredItems(2),
      purge,
      now: () => NOW,
    });
    expect(result).toEqual({ purged: 1, failed: 1, skipped: false });
  });

  it("并发重入：上一轮没跑完，本轮直接跳过（不叠两轮）", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const listTrash = vi.fn(async () => { await gate; return expiredItems(1); });
    const purge = vi.fn(async () => true);
    const deps = { listTrash, purge, now: () => NOW };
    const first = runScheduledTrashPurge(deps);
    // 第一轮已置位单飞标记（async 函数体同步跑到首个 await 之前）
    await expect(runScheduledTrashPurge(deps)).resolves.toEqual({ purged: 0, failed: 0, skipped: true });
    release();
    await expect(first).resolves.toEqual({ purged: 1, failed: 0, skipped: false });
    expect(listTrash).toHaveBeenCalledTimes(1);
    expect(purge).toHaveBeenCalledTimes(1);
  });
});

describe("回收站自动过期：与 DB 集成（桌面同口径）", () => {
  it("过期项被彻底删除（物理删行 + purge 墓碑），未过期保留", async () => {
    const db = await freshDb();
    try {
      await insertNote(db, { id: "n-old", trashedAt: daysAgo(91) });
      await insertNote(db, { id: "n-new", trashedAt: daysAgo(10) });

      await expect(runPurge(db)).resolves.toEqual({ purged: 1, failed: 0, skipped: false });

      expect((await rowsOf(db, "SELECT id FROM notes WHERE id='n-old'")).length).toBe(0);
      expect((await rowsOf(db, "SELECT id FROM notes WHERE id='n-new'")).length).toBe(1);
      // 墓碑 = 删除传播载体（两端共用 deleted_notes；node_type/purged_at 不可缺）
      const tombstone = (await rowsOf(db, "SELECT node_type, purged_at FROM deleted_notes WHERE id='n-old'"))[0];
      expect(tombstone?.node_type).toBe("note");
      expect(tombstone?.purged_at).toBeTruthy();
      // 彻底删除连附件目录一起清（MOB-06 同一套语义）
      expect(removeNoteAssetsDirFs).toHaveBeenCalledWith("n-old");
    } finally { await db.close(); }
  });

  it("folder 子树作为顶级一次清掉：子项随根删、只计 1 条、各自写墓碑", async () => {
    const db = await freshDb();
    try {
      // 活跃笔记本是父（不在回收站）⇒ nb 是回收站顶级
      await insertFolder(db, { id: "active-nb", nodeType: "notebook" });
      await insertFolder(db, { id: "nb", parentId: "active-nb", nodeType: "notebook", trashedAt: daysAgo(100) });
      await insertFolder(db, { id: "g", parentId: "nb", trashedAt: daysAgo(100) });
      await insertNote(db, { id: "n1", parentId: "g", trashedAt: daysAgo(100) });

      await expect(runPurge(db)).resolves.toEqual({ purged: 1, failed: 0, skipped: false });

      expect((await rowsOf(db, "SELECT id FROM folders WHERE id IN ('nb','g')")).length).toBe(0);
      expect((await rowsOf(db, "SELECT id FROM notes WHERE id='n1'")).length).toBe(0);
      const tombstones = await rowsOf(db, "SELECT id, node_type FROM deleted_notes");
      expect(tombstones.map((row) => row.id).sort()).toEqual(["g", "n1", "nb"]);
      expect(tombstones.find((row) => row.id === "nb")?.node_type).toBe("folder");
    } finally { await db.close(); }
  });

  it("阈值 <=0 = 关闭：一条都不清（桌面 trashAutoPurgeDays<=0 同口径）", async () => {
    const db = await freshDb();
    try {
      await insertNote(db, { id: "n-old", trashedAt: daysAgo(365) });
      await expect(runPurge(db, { days: 0 })).resolves.toEqual({ purged: 0, failed: 0, skipped: false });
      expect((await rowsOf(db, "SELECT id FROM notes WHERE id='n-old'")).length).toBe(1);
      expect((await rowsOf(db, "SELECT id FROM deleted_notes")).length).toBe(0);
    } finally { await db.close(); }
  });

  it("重复调用幂等：第二次 0 条，不重复写墓碑", async () => {
    const db = await freshDb();
    try {
      await insertNote(db, { id: "n-old", trashedAt: daysAgo(100) });
      await expect(runPurge(db)).resolves.toEqual({ purged: 1, failed: 0, skipped: false });
      await expect(runPurge(db)).resolves.toEqual({ purged: 0, failed: 0, skipped: false });
      expect((await rowsOf(db, "SELECT id FROM deleted_notes")).length).toBe(1);
    } finally { await db.close(); }
  });

  it("cloud_deleted（云端已删除·仅本地）副本不豁免，到点照样 purge（AGENTS §3#5）", async () => {
    const db = await freshDb();
    try {
      await insertNote(db, { id: "n-cloud-deleted", trashedAt: daysAgo(100), cloudDeleted: true });
      await expect(runPurge(db)).resolves.toEqual({ purged: 1, failed: 0, skipped: false });
      expect((await rowsOf(db, "SELECT id FROM notes WHERE id='n-cloud-deleted'")).length).toBe(0);
    } finally { await db.close(); }
  });

  it("不越过用户恢复：候选列表读到之后用户点了恢复 ⇒ 守卫跳过、一行未动、不删文件", async () => {
    const db = await freshDb();
    try {
      await insertNote(db, { id: "n1", trashedAt: daysAgo(100) });
      const staleList = await listTrashTree(db); // 后台已读到的候选（事务外快照）
      expect(staleList.map((it) => it.id)).toEqual(["n1"]);

      // 用户在这两件事之间点了「恢复」
      await restoreTreeItem(db, "n1", "note", async () => undefined);
      assetFsMocks.removeNoteAssetsDirFs.mockClear();

      const result = await runPurge(db, { listTrash: async () => staleList });
      expect(result).toEqual({ purged: 0, failed: 0, skipped: false });
      expect((await rowsOf(db, "SELECT id, trashed_at FROM notes WHERE id='n1'")).length).toBe(1);
      expect((await rowsOf(db, "SELECT id FROM deleted_notes")).length).toBe(0);
      expect(removeNoteAssetsDirFs).not.toHaveBeenCalled();
    } finally { await db.close(); }
  });

  it("恢复后又重新删除到近期 ⇒ 未到期，守卫同样跳过（按最新 trashed_at 判）", async () => {
    const db = await freshDb();
    try {
      await insertNote(db, { id: "n1", trashedAt: daysAgo(100) });
      const staleList = await listTrashTree(db);
      await restoreTreeItem(db, "n1", "note", async () => undefined);
      await db.prepare("UPDATE notes SET trashed_at=?, is_dirty=1 WHERE id=?").run(daysAgo(3), "n1");

      await expect(runPurge(db, { listTrash: async () => staleList })).resolves.toEqual({ purged: 0, failed: 0, skipped: false });
      expect((await rowsOf(db, "SELECT id FROM notes WHERE id='n1'")).length).toBe(1);
    } finally { await db.close(); }
  });
});

describe("回收站自动过期：接线（就绪 / 回前台各一次，不设常驻定时器）", () => {
  const AUTO = readFileSync(new URL("./hooks/useAutoSync.ts", import.meta.url), "utf8");

  it("复用既有的 openHandler/foreground handler（就绪那一次也走它）", () => {
    expect(AUTO).toContain("runTrashPurgeOnce();");
    expect(AUTO).toContain("bridge.listTrashTree()");
    expect(AUTO).toContain("bridge.purgeTreeItem(root.id, root.kind, { expiredBefore })");
    // 放在「续传提前返回」之前：上次同步没跑完不该把回收站清理无限期跳过
    expect(AUTO.indexOf("runTrashPurgeOnce();")).toBeLessThan(AUTO.indexOf("hasInterruptedSync("));
  });

  it("不设常驻 setInterval（移动端后台定时器不可靠，靠时机钩子）", () => {
    expect(AUTO).not.toMatch(/trash[A-Za-z]*Timer/);
  });
});
