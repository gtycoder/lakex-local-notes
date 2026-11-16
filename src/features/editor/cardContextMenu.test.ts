import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 图片/卡片右键菜单：复制类动作平铺到一级（261116 用户裁决）。
 *
 * 用户原话：「文档图片的右键，这里只保留一级菜单，复制和复制路径就行，把第二级里的内容合并到第一级，
 * 然后不要复制名称这个选项了。」→ 护栏：不再有「复制 ▸」子菜单、不再有「复制文件名」，
 * 「复制」「复制路径」直接是一级项；两个宿主都不再注入 copyName。
 */
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

describe("卡片右键菜单 · 复制动作平铺（261116 定稿）", () => {
  const menu = read("./CardContextMenu.tsx");
  const editorTab = read("./EditorTab.tsx");
  const lakeEditor = read("./LakeEditor.tsx");

  it("一级菜单直接有「复制」与「复制路径」，不再用子菜单", () => {
    expect(menu).toContain('label: "复制"');
    expect(menu).toContain('label: "复制路径"');
    expect(menu).not.toContain("<Submenu");
    expect(menu).not.toContain("Submenu");
    // 平铺渲染：每个复制项都是 ln-menu__item
    expect(menu).toContain('{copyItems.map(({ label, icon, fn }) => (');
  });

  it("不再提供「复制文件名」，两个宿主都不注入 copyName", () => {
    expect(menu).not.toContain("复制文件名");
    expect(menu).not.toContain("copyName");
    expect(editorTab).not.toContain("copyName");
    expect(lakeEditor).not.toContain("copyName");
  });

  it("隐藏的文件名复制不残留（复制动作接口已收窄）", () => {
    expect(menu).toContain("复制图片到系统剪贴板（桌面，图片卡）");
    expect(menu).toContain("复制文件的绝对路径（桌面）");
  });
});
