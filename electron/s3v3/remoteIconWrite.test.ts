/**
 * 261112 G3（写守卫越界，与 F04 同类）回归：同步 apply 的新行图标不得撞用户写边界守卫。
 *
 * 背景（docs/audit-261112/13-write-guard-sweep.md §0.1/§2 G3）：
 * `noteMetadataRepository.setNodeIcon` 是**用户入口**，带 `assertNodeWritable`（回收站/purged 拒写）；
 * 而同步 apply 在首次见到远端行时会调端口 `setNodeIcon`（deviceStore 新行分支）⇒
 * 新设备首拉「回收站 + 图标」条目时整轮 syncNow 抛错（设备永久卡死）。
 * 修法 = 端口/Store 走**同步专用** `applyRemoteNodeIcon`（允许回收站行、purged 仍拒、不标 dirty）。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { createDesktopPlatformPort } from "./desktopPlatformPort.js";
import type { DeviceState } from "./deviceStore.js";

const BODY = "<p>回收站里带图标的远端正文</p>";
const ICON = "📄";

function deviceState(icon: string | null): DeviceState {
  const now = new Date().toISOString();
  const hash = sha256Hex(new TextEncoder().encode(BODY));
  return {
    lake: {
      v: 3,
      space: "lake",
      folders: [{ id: "notebook-trash", title: "回收站", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: now }],
      notes: [{
        id: "n1", title: "回收站条目", parentId: "notebook-trash", sortOrder: 0, updatedAt: now,
        contentHash: hash, kind: "doc", icon, isLocked: false, lockedAt: null, isConflict: false,
        trashedAt: now, deletedFromParentId: null,
      }],
    },
    quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] },
    folders: [],
    intents: [],
    pending: [],
    remotePurged: [],
    restorePending: [],
  };
}

type RawDb = { prepare(sql: string): { get(...args: unknown[]): unknown; run(...args: unknown[]): unknown } };
/** Store 的 db 是私有字段；测试只读断言用（不引入生产访问器）。 */
const dbOf = (store: Store): RawDb => (store as unknown as { db: RawDb }).db;

async function freshStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-icon-"));
  const store = new Store(root);
  store.bootstrap();
  return { root, store };
}

describe("同步 apply 新行图标（G3：镜像写不得撞用户守卫）", () => {
  it("新设备首拉「回收站 + 图标」条目不抛错：icon 落库、仍在回收站、不标 dirty", async () => {
    const { root, store } = await freshStore();
    const device = new DesktopStoreDevice(store, root);
    await device.init();
    await device.writeBody("n1", new TextEncoder().encode(BODY));

    // 整轮 apply：不得抛错（修复前此处抛「节点已在回收站或已被删除，不能修改」）
    await expect(device.saveState(deviceState(ICON))).resolves.toBeUndefined();

    const db = dbOf(store);
    const row = db.prepare("SELECT icon FROM tree_nodes WHERE id=?").get("n1") as { icon: string | null };
    expect(row.icon).toBe(ICON);
    const note = db.prepare("SELECT parent_id, trashed_at, is_dirty FROM notes WHERE id=?").get("n1") as
      { parent_id: string | null; trashed_at: string | null; is_dirty: number };
    expect(note.parent_id).toBe("notebook-trash");
    expect(note.trashed_at).toBeTruthy();
    expect(note.is_dirty).toBe(0);
  }, 60_000);

  it("端口 setNodeIcon 走同步专用写：回收站行可写、不抛错", async () => {
    const { root, store } = await freshStore();
    const device = new DesktopStoreDevice(store, root);
    await device.init();
    await device.writeBody("n1", new TextEncoder().encode(BODY));
    await device.saveState(deviceState(null));

    const port = createDesktopPlatformPort(store);
    await expect(port.setNodeIcon("n1", ICON)).resolves.toBeUndefined();
    const row = dbOf(store).prepare("SELECT icon FROM tree_nodes WHERE id=?").get("n1") as { icon: string | null };
    expect(row.icon).toBe(ICON);
  }, 60_000);

  it("用户入口仍拒写回收站行（守卫不放宽）", async () => {
    const { root, store } = await freshStore();
    const device = new DesktopStoreDevice(store, root);
    await device.init();
    await device.writeBody("n1", new TextEncoder().encode(BODY));
    await device.saveState(deviceState(null));

    expect(() => store.setNodeIcon("n1", ICON)).toThrow(/回收站|已删除/);
    const row = dbOf(store).prepare("SELECT icon FROM tree_nodes WHERE id=?").get("n1") as { icon: string | null };
    expect(row.icon).toBeNull();
  }, 60_000);

  it("purged 行仍拒绝（同步专用写也不可复活）", async () => {
    const { root, store } = await freshStore();
    const device = new DesktopStoreDevice(store, root);
    await device.init();
    await device.writeBody("n1", new TextEncoder().encode(BODY));
    await device.saveState(deviceState(null));

    const db = dbOf(store);
    db.prepare("UPDATE tree_nodes SET is_purged=1 WHERE id=?").run("n1");
    db.prepare("UPDATE notes SET is_purged=1 WHERE id=?").run("n1");
    expect(() => store.applyRemoteNodeIcon("n1", ICON)).toThrow(/彻底删除/);
    const row = db.prepare("SELECT icon FROM tree_nodes WHERE id=?").get("n1") as { icon: string | null };
    expect(row.icon).toBeNull();
  }, 60_000);
});