/**
 * macOS 应用菜单模板单测（参考思源 appMenu.test.js 的「纯函数 + 结构断言」做法）。
 *
 * 只测 template（不启动 Electron、不 mock 运行时）：首组必须是 appMenu、每个 role 项都有 label、
 * 设置项绑定 ⌘, 且点击只走回调、开发者工具只在开发版出现。
 */
import { describe, expect, it, vi } from "vitest";
import { buildAppMenuTemplate, type AppMenuActions } from "./appMenu.js";

/** template 项的结构投影（MenuConstructorOptions 的运行时是普通对象，测试里只取用得到的字段）。 */
interface Item {
  role?: string;
  label?: string;
  accelerator?: string;
  type?: string;
  click?: () => void;
  submenu?: Item[];
}

function actions(over: Partial<AppMenuActions> = {}): AppMenuActions {
  return {
    appName: "LakexLocalNotes",
    isDev: false,
    onOpenSettings: vi.fn(),
    onOpenDocs: vi.fn(),
    onFeedback: vi.fn(),
    ...over,
  };
}

const group = (template: Item[], role: string): Item => {
  const found = template.find((item) => item.role === role);
  expect(found, "缺少菜单组: " + role).toBeTruthy();
  return found as Item;
};

describe("buildAppMenuTemplate（macOS 菜单）", () => {
  it("首组是 appMenu（macOS 约定），标题用产品名，含关于/设置/退出", () => {
    const template = buildAppMenuTemplate(actions()) as unknown as Item[];
    expect(template[0].role).toBe("appMenu");
    expect(template[0].label).toBe("LakexLocalNotes");
    const roles = (template[0].submenu ?? []).map((item) => item.role).filter(Boolean);
    expect(roles).toEqual(expect.arrayContaining(["about", "services", "hide", "hideOthers", "unhide", "quit"]));
  });

  it("设置… = ⌘, 且点击只调回调（不自己造窗口/状态）", () => {
    const onOpenSettings = vi.fn();
    const template = buildAppMenuTemplate(actions({ onOpenSettings })) as unknown as Item[];
    const item = (template[0].submenu ?? []).find((x) => x.label === "设置…") as Item;
    expect(item.accelerator).toBe("CmdOrCtrl+,");
    item.click?.();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("编辑/窗口全用 role（语义 + 系统加速键），帮助项回调到文档/反馈", () => {
    const onOpenDocs = vi.fn();
    const onFeedback = vi.fn();
    const template = buildAppMenuTemplate(actions({ onOpenDocs, onFeedback })) as unknown as Item[];
    const editRoles = (group(template, "editMenu").submenu ?? []).map((x) => x.role).filter(Boolean);
    expect(editRoles).toEqual(expect.arrayContaining(["undo", "redo", "cut", "copy", "paste", "selectAll"]));
    const windowRoles = (group(template, "windowMenu").submenu ?? []).map((x) => x.role).filter(Boolean);
    expect(windowRoles).toEqual(expect.arrayContaining(["minimize", "zoom", "togglefullscreen", "front"]));
    const help = (group(template, "help").submenu ?? []) as Item[];
    help.find((x) => x.label === "使用文档")?.click?.();
    help.find((x) => x.label === "反馈问题")?.click?.();
    expect(onOpenDocs).toHaveBeenCalledTimes(1);
    expect(onFeedback).toHaveBeenCalledTimes(1);
  });

  it("开发者工具只在开发版出现", () => {
    const dev = buildAppMenuTemplate(actions({ isDev: true })) as unknown as Item[];
    const prod = buildAppMenuTemplate(actions({ isDev: false })) as unknown as Item[];
    const hasDevTools = (template: Item[]) => (group(template, "help").submenu ?? []).some((x) => x.role === "toggleDevTools");
    expect(hasDevTools(dev)).toBe(true);
    expect(hasDevTools(prod)).toBe(false);
  });

  it("不变量：每组都有 label，每个 role 项都有 label（思源 appMenu.test 同款）", () => {
    const template = buildAppMenuTemplate(actions({ isDev: true })) as unknown as Item[];
    for (const groupItem of template) {
      expect(groupItem.label, "菜单组缺 label: " + groupItem.role).toBeTruthy();
      for (const item of groupItem.submenu ?? []) {
        if (item.role) expect(item.label, "role 项缺 label: " + item.role).toBeTruthy();
      }
    }
  });
});
