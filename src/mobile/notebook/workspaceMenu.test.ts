/**
 * 工作区「更多」菜单护栏（261014 用户点单）。
 *
 * 用户明确：**去掉工作区「更多」里的「设置」和「搜索」** —— 设置入口 = 首页左上齿轮，搜索入口 = 首页底部胶囊，
 * 工作区里再放一份只是重复；两个 prop（`onOpenSettings` / `onOpenSearch`）随之删掉（没有消费者就不留死 prop）。
 * 本护栏钉住：菜单里不再有 settings / search 项与这两个 prop；而首页的设置、搜索入口都还在（功能没丢）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const WORKSPACE = read("./NotebookWorkspace.tsx");
const APP = read("../MobileApp.tsx");
const HOME = read("../home/HomePage.tsx");

describe("工作区「更多」菜单（261014）", () => {
  it("不再有「设置」项，也不再有 onOpenSettings 这个死 prop", () => {
    expect(WORKSPACE).not.toContain('id: "settings"');
    expect(WORKSPACE).not.toContain("onOpenSettings");
    expect(APP).not.toContain("onOpenSettings");
  });

  it("「搜索」也已移出工作区菜单（只留首页底部那一个入口）", () => {
    expect(WORKSPACE).not.toContain('id: "search"');
    expect(WORKSPACE).not.toContain("onOpenSearch");
    expect(APP).not.toMatch(/<NotebookWorkspace[\s\S]{0,600}onOpenSearch/);
    // 首页那条搜索入口必须还在（功能没丢）
    expect(HOME).toContain('aria-label="搜索"');
  });

  it("设置入口仍在首页顶栏（功能没有丢）", () => {
    expect(HOME).toContain('aria-label="设置"');
  });
});
