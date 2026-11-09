import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import type { IpcRegistrar } from "../ipc/registrar.js";
import type { PortableExportAvailability, PortableExportProgress } from "../../src/core/portable/portableFormat.js";

vi.mock("electron", () => ({ dialog: { showOpenDialog: vi.fn() } }));

const { registerPortableIpc } = await import("../ipc/registerPortable.js");

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

type Handler = (...args: unknown[]) => unknown | Promise<unknown>;

function makeIpc(): { ipc: IpcRegistrar; call: (channel: string, ...args: unknown[]) => Promise<unknown> } {
  const handlers = new Map<string, Handler>();
  const ipc = {
    handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
    handleEvent: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
    registry: new Map<string, Handler>(),
  } as unknown as IpcRegistrar;
  return {
    ipc,
    call: async (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error("未注册通道：" + channel);
      return handler(...args);
    },
  };
}

function makeWorkspace(): string {
  const root = tempDir("lakex-portable-ipc-ws-");
  fs.mkdirSync(path.join(root, "notes"), { recursive: true });
  fs.writeFileSync(path.join(root, "notes", "n1.lake"), "note");
  fs.mkdirSync(path.join(root, "sync-v3"), { recursive: true });
  fs.writeFileSync(path.join(root, "sync-v3", "baseline.json.gz"), gzipSync(Buffer.from(JSON.stringify({
    epoch: "e", generation: 1, lakeCommit: "lc", quickNotesCommit: "qc", lake: {}, quickNotes: {},
  }))));
  return root;
}

function makeSnapshot(targetRoot: string): void {
  fs.mkdirSync(path.join(targetRoot, "quick-notes"), { recursive: true });
  fs.writeFileSync(path.join(targetRoot, "metadata.sqlite3"), "MAIN");
  fs.writeFileSync(path.join(targetRoot, "quick-notes", "metadata.sqlite3"), "QUICK");
}

const AVAILABLE: PortableExportAvailability = { available: true };
const OFFLINE_CLOUD = { active: false, lastSyncedAt: null };

describe("portable IPC（入口门禁 + 导出）", () => {
  it("status 返回离线可用状态；未选目录时 run 拒绝且不执行导出", async () => {
    const workspace = makeWorkspace();
    const target = tempDir("lakex-portable-ipc-out-");
    const { ipc, call } = makeIpc();
    let snapshots = 0;
    registerPortableIpc(ipc, {
      workspaceRoot: () => workspace,
      appVersion: () => "1.0.4",
      snapshotDatabases: (root) => { snapshots += 1; makeSnapshot(root); },
      availability: () => AVAILABLE,
      cloudState: () => OFFLINE_CLOUD,
      counts: () => ({ folders: 0, quickNotes: 0, tags: 0 }),
      pickDirectory: async () => target,
    });
    const status = await call("portable_export_status") as { availability: PortableExportAvailability; lastExport: unknown; cloudActive: boolean };
    expect(status.availability).toEqual(AVAILABLE);
    expect(status.cloudActive).toBe(false);
    expect(status.lastExport).toBeNull();

    await expect(call("portable_export_run")).rejects.toThrow("请先选择导出目录");
    expect(snapshots).toBe(0);
  });

  it("选择目录后成功导出：结果写入 status.lastExport，进度事件有广播", async () => {
    const workspace = makeWorkspace();
    const target = tempDir("lakex-portable-ipc-out-");
    const progress: PortableExportProgress[] = [];
    const { ipc, call } = makeIpc();
    registerPortableIpc(ipc, {
      workspaceRoot: () => workspace,
      appVersion: () => "1.0.4",
      snapshotDatabases: makeSnapshot,
      availability: () => AVAILABLE,
      cloudState: () => OFFLINE_CLOUD,
      counts: () => ({ folders: 1, quickNotes: 0, tags: 0 }),
      pickDirectory: async () => target,
      broadcastProgress: (event) => progress.push(event),
      now: () => new Date("2026-11-09T12:00:00Z"),
    });
    await expect(call("portable_export_pick_dir")).resolves.toBe(target);
    const result = await call("portable_export_run") as { path: string; bytes: number; entries: number };
    expect(fs.existsSync(result.path)).toBe(true);
    expect(result.entries).toBeGreaterThanOrEqual(4); // manifest + 2 DB + baseline + notes
    expect(progress.length).toBeGreaterThan(0);
    const status = await call("portable_export_status") as { lastExport: { path: string; bytes: number; exportedAt: string } | null };
    expect(status.lastExport?.path).toBe(result.path);
    expect(status.lastExport?.bytes).toBe(result.bytes);
    expect(status.lastExport?.exportedAt).toBe("2026-11-09T12:00:00.000Z");
  });

  it("云同步启用：run 前强制 beforeExport，失败则不导出", async () => {
    const workspace = makeWorkspace();
    const target = tempDir("lakex-portable-ipc-out-");
    const { ipc, call } = makeIpc();
    let syncAttempts = 0;
    let snapshots = 0;
    registerPortableIpc(ipc, {
      workspaceRoot: () => workspace,
      appVersion: () => "1.0.4",
      snapshotDatabases: (root) => { snapshots += 1; makeSnapshot(root); },
      availability: () => AVAILABLE,
      cloudState: () => ({ active: true, lastSyncedAt: "2026-11-09T00:00:00Z" }),
      beforeExport: async () => { syncAttempts += 1; throw new Error("网络不可用"); },
      counts: () => ({ folders: 1, quickNotes: 0, tags: 0 }),
      pickDirectory: async () => target,
    });
    await expect(call("portable_export_pick_dir")).resolves.toBe(target);
    await expect(call("portable_export_run")).rejects.toThrow("导出前同步失败：网络不可用");
    expect(syncAttempts).toBe(1);
    expect(snapshots).toBe(0);
    expect(fs.readdirSync(target)).toEqual([]);
  });

  it("取消选择目录 ⇒ null，不留下导出状态", async () => {
    const workspace = makeWorkspace();
    const { ipc, call } = makeIpc();
    registerPortableIpc(ipc, {
      workspaceRoot: () => workspace,
      appVersion: () => "1.0.4",
      snapshotDatabases: makeSnapshot,
      availability: () => AVAILABLE,
      cloudState: () => OFFLINE_CLOUD,
      counts: () => ({ folders: 0, quickNotes: 0, tags: 0 }),
      pickDirectory: async () => null,
    });
    await expect(call("portable_export_pick_dir")).resolves.toBeNull();
    await expect(call("portable_export_run")).rejects.toThrow("请先选择导出目录");
  });
});
