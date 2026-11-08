import { describe, expect, it, vi } from "vitest";
import { installTestDialogHooks, type DialogLike } from "./testDialogHooks.js";

function fakeDialog(): DialogLike {
  return {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
  };
}

describe("测试用文件对话框替身", () => {
  it("生产打包版永不安装", () => {
    const dialog = fakeDialog();
    const original = dialog.showOpenDialog;
    expect(installTestDialogHooks({ dialog, isPackaged: true, env: { LAKE_TEST_PICK_FILE: "/tmp/a.md" } })).toBe(false);
    expect(dialog.showOpenDialog).toBe(original);
  });

  it("未设置任何环境变量不安装", () => {
    const dialog = fakeDialog();
    expect(installTestDialogHooks({ dialog, isPackaged: false, env: {} })).toBe(false);
  });

  it("打开文件返回预设文件；打开目录返回预设目录", async () => {
    const dialog = fakeDialog();
    expect(installTestDialogHooks({
      dialog,
      isPackaged: false,
      env: { LAKE_TEST_PICK_FILE: "/tmp/a.md", LAKE_TEST_PICK_DIR: "/tmp/export" },
    })).toBe(true);
    await expect(dialog.showOpenDialog(undefined, { properties: ["openFile"] })).resolves.toEqual({ canceled: false, filePaths: ["/tmp/a.md"] });
    await expect(dialog.showOpenDialog(undefined, { properties: ["openDirectory", "createDirectory"] })).resolves.toEqual({ canceled: false, filePaths: ["/tmp/export"] });
  });

  it("保存对话框返回预设文件；未设置则取消", async () => {
    const dialog = fakeDialog();
    installTestDialogHooks({ dialog, isPackaged: false, env: { LAKE_TEST_SAVE_FILE: "/tmp/out.md" } });
    await expect(dialog.showSaveDialog()).resolves.toEqual({ canceled: false, filePath: "/tmp/out.md" });

    const dialog2 = fakeDialog();
    installTestDialogHooks({ dialog: dialog2, isPackaged: false, env: { LAKE_TEST_PICK_FILE: "/tmp/a.md" } });
    await expect(dialog2.showSaveDialog()).resolves.toEqual({ canceled: true });
  });
});
