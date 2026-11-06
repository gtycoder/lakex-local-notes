/**
 * 261106 用户验收：桌面「从备份恢复」的文件选择框**默认打开自动备份目录**（<userData>/backups/）。
 *
 * 覆盖：
 * - 设置入口（registerNotes 的 pick_backup_database）与启动恢复页入口共用 pickBackupDatabaseDialog；
 * - defaultPath 单一来源 = autoBackup.backupsDir(userData)（不手拼字符串）；
 * - 目录不存在也照样给 defaultPath（不 stat、不抛，Electron 自行回落）；
 * - 取消返回 null、选中返回路径、恢复页按钮文案可覆写。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  getFocusedWindow: vi.fn(() => null),
  getAllWindows: vi.fn(() => [] as unknown[]),
}));

vi.mock("electron", () => ({
  dialog: { showOpenDialog: mocks.showOpenDialog },
  BrowserWindow: { getFocusedWindow: mocks.getFocusedWindow, getAllWindows: mocks.getAllWindows },
  app: { getPath: () => "/nonexistent-userdata", isPackaged: false, getVersion: () => "0.0.0", on: vi.fn(), whenReady: vi.fn(), relaunch: vi.fn(), exit: vi.fn(), quit: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (value: string) => Buffer.from(value), decryptString: (buf: Buffer) => buf.toString() },
  net: { fetch: vi.fn() },
  shell: { openPath: vi.fn(), openExternal: vi.fn(), showItemInFolder: vi.fn() },
  clipboard: { writeText: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
  crashReporter: { start: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(() => []), setApplicationMenu: vi.fn() },
  session: {},
  screen: {},
  nativeTheme: { shouldUseDarkColors: false },
  powerMonitor: { getSystemIdleTime: () => 0 },
  ClipboardItem: class {},
}));

import { backupsDir } from "./autoBackup.js";
import { pickBackupDatabaseDialog } from "./ipc/registerNotes.js";

const userDataDir = path.join(os.tmpdir(), "lake-backup-dialog-test");

beforeEach(() => {
  mocks.showOpenDialog.mockReset();
  mocks.getFocusedWindow.mockReturnValue(null);
  mocks.getAllWindows.mockReturnValue([]);
});

describe("从备份恢复文件选择框（defaultPath = backups）", () => {
  it("设置入口：defaultPath 指向 <userData>/backups；取消返回 null；目录不存在也不抛", async () => {
    // 刻意不创建 backups 目录：选择框仍拿到 defaultPath（不依赖真实文件系统）
    expect(fs.existsSync(backupsDir(userDataDir))).toBe(false);
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await expect(pickBackupDatabaseDialog(userDataDir)).resolves.toBeNull();
    expect(mocks.showOpenDialog).toHaveBeenCalledTimes(1);
    const options = mocks.showOpenDialog.mock.calls[0][1] as { defaultPath?: string; properties?: string[]; buttonLabel?: string };
    expect(options.defaultPath).toBe(backupsDir(userDataDir));
    expect(options.defaultPath).toBe(path.join(userDataDir, "backups"));
    expect(options.properties).toEqual(["openFile"]);
    expect(options.buttonLabel).toBe("选择备份");
  });

  it("选中文件返回路径；恢复页入口可覆写按钮文案（defaultPath 不变）", async () => {
    const chosen = path.join(backupsDir(userDataDir), "metadata-2026-11-06T00-00-00.sqlite3");
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [chosen] });
    await expect(pickBackupDatabaseDialog(userDataDir, { buttonLabel: "用此备份恢复" })).resolves.toBe(chosen);
    const options = mocks.showOpenDialog.mock.calls[0][1] as { defaultPath?: string; buttonLabel?: string };
    expect(options.defaultPath).toBe(backupsDir(userDataDir));
    expect(options.buttonLabel).toBe("用此备份恢复");
  });

  it("路径来源单一：两个入口都经 pickBackupDatabaseDialog（不再各自手拼 dialog 选项）", () => {
    const main = fs.readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const registerNotes = fs.readFileSync(new URL("./ipc/registerNotes.ts", import.meta.url), "utf8");
    // 恢复页入口：走共用选择框并带自己的按钮文案
    expect(main).toContain("pickBackupDatabaseDialog(userDataDir, { buttonLabel: \"用此备份恢复\" })");
    expect(main).not.toContain("dialog.showOpenDialog"); // main 不再有裸 dialog 调用
    // 设置入口：handler 走共用选择框；实现里 defaultPath = backupsDir(...)
    expect(registerNotes).toContain('ipc.handle("pick_backup_database"');
    expect(registerNotes).toContain("pickBackupDatabaseDialog(app.getPath(\"userData\"))");
    expect(registerNotes).toContain("export async function pickBackupDatabaseDialog(");
    expect(registerNotes).toContain("defaultPath = backupsDir(userDataDir)");
  });
});
