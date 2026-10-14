/**
 * 工作区「更多」菜单护栏（261014 用户点单）。
 *
 * 用户明确：**去掉工作区「更多」里的「设置」** —— 首页左上齿轮已经是设置的统一入口，
 * 这里再放一个只是重复；连同 `onOpenSettings` prop 一起删（留着就是死 prop）。
 * 本护栏钉住两件事：菜单里不再有 settings 项；设置入口在首页仍然存在（功能没丢）。
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

  it("搜索入口仍在工作区菜单里（同一份全局搜索 Sheet）", () => {
    expect(WORKSPACE).toContain('id: "search"');
    expect(WORKSPACE).toContain("onOpenSearch()");
  });

  it("设置入口仍在首页顶栏（功能没有丢）", () => {
    expect(HOME).toContain('aria-label="设置"');
  });
});
