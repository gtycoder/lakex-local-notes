/**
 * 日记空间标记（261109）在移动端同步端口上的往返：
 *  · 发布方向：`listFoldersForSync` 必须把本机 `folders.space` 带出去，**非日记显式 null**
 *    （否则非日记（space=null）在 wire 上不可见，两端互刷 —— docs/DIARY.md 硬规则 1）；
 *  · 应用方向：`importRemoteFolder` / `applyRemoteFolderMeta` 必须把远端 `space` 落库（含 null 覆盖）。
 * 判据本身在 core/diary（normalizeFolderSpace），本文件只卡端口的落库/投影形状。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async () => {},
  loadAssetBytesFs: async () => null,
  removeAssetBytesFs: async () => {},
  listNoteAssetKeysFs: async () => [],
  listQuickNoteAssetKeysFs: async () => [],
  listAssetKeysFs: async () => [],
  removeNoteAssetsDirFs: async () => {},
  removeQuickNoteAssetsDirFs: async () => {},
}));

import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createMobilePlatformPort } from "./mobilePlatformPort.js";
import type { SyncFolderRow } from "../../core/s3v3/state/platformPort.js";

const T = "2026-11-09T00:00:00.000Z";

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

async function insertFolder(db: SqlJsAsyncDb, id: string, nodeType: "notebook" | "group", space: string | null, parentId: string | null = null): Promise<void> {
  await db.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,is_dirty,space) VALUES (?,?,?,?,?,NULL,?,1,?)")
    .run(id, id, parentId, 0, nodeType, T, space);
}

describe("日记 space 随目录行同步（移动端端口）", () => {
  it("发布：日记本带 space=diary，普通笔记本/分组**显式 null**", async () => {
    const db = await freshDb();
    await insertFolder(db, "nb-diary", "notebook", "diary");
    await insertFolder(db, "nb-normal", "notebook", null);
    await insertFolder(db, "g-year", "group", null, "nb-diary");
    const port = createMobilePlatformPort(db);
    const rows = await port.listFoldersForSync() as Array<SyncFolderRow & { space?: string | null }>;
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get("nb-diary")?.space).toBe("diary");
    // 显式 null（不是缺字段）：wire 上非日记（space=null）必须可见。
    expect(byId.get("nb-normal")).toHaveProperty("space", null);
    expect(byId.get("g-year")).toHaveProperty("space", null);
    await db.close();
  });

  it("应用远端：importRemoteFolder 落 space，缺字段 = 非日记（null）", async () => {
    const db = await freshDb();
    const port = createMobilePlatformPort(db);
    const remoteDiary: SyncFolderRow & { space?: "diary" | null } = {
      id: "remote-diary", title: "日记", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: T,
      space: "diary",
    };
    await port.importRemoteFolder(remoteDiary);
    const row = await db.prepare("SELECT space FROM folders WHERE id=?").get("remote-diary") as { space: string | null };
    expect(row.space).toBe("diary");
    // 缺字段（旧端/未知值）= 非日记：写入 NULL，不保留脏值。
    const remotePlain: SyncFolderRow = { id: "remote-plain", title: "普通", parentId: null, sortOrder: 1, nodeType: "notebook", icon: null, updatedAt: T };
    await port.importRemoteFolder(remotePlain);
    const plain = await db.prepare("SELECT space FROM folders WHERE id=?").get("remote-plain") as { space: string | null };
    expect(plain.space).toBeNull();
    await db.close();
  });

  it("应用远端元数据：space 只允许 null → diary；远端写回 null 绝不降级（261113 用户裁决）", async () => {
    const db = await freshDb();
    await insertFolder(db, "nb-1", "notebook", null);
    const port = createMobilePlatformPort(db);
    const base: SyncFolderRow = { id: "nb-1", title: "笔记本", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: T };
    await port.applyRemoteFolderMeta({ ...base, space: "diary" } as SyncFolderRow & { space: "diary" });
    expect((await db.prepare("SELECT space FROM folders WHERE id=?").get("nb-1") as { space: string | null }).space).toBe("diary");
    // 落库侧单调闸（与桌面 diarySafeFolderSpace 同口径）：脏计划/旧包/直接恢复写 null 也不降级。
    await port.applyRemoteFolderMeta({ ...base, space: null } as SyncFolderRow & { space: null });
    expect((await db.prepare("SELECT space FROM folders WHERE id=?").get("nb-1") as { space: string | null }).space).toBe("diary");
    // 未知值同样按「非日记」但不得覆盖已有 diary
    await port.applyRemoteFolderMeta({ ...base, space: "unknown" } as unknown as SyncFolderRow);
    expect((await db.prepare("SELECT space FROM folders WHERE id=?").get("nb-1") as { space: string | null }).space).toBe("diary");
    // 但普通笔记本（space=null）不受影响：别的字段照常应用
    await insertFolder(db, "nb-2", "notebook", null);
    await port.applyRemoteFolderMeta({ ...base, id: "nb-2", title: "改名了" });
    const row2 = await db.prepare("SELECT title, space FROM folders WHERE id=?").get("nb-2") as { title: string; space: string | null };
    expect(row2.title).toBe("改名了");
    expect(row2.space).toBeNull();
    await db.close();
  });
});
