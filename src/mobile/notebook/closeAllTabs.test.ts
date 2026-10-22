import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** 261019：标签页抽屉加「关闭全部」。 */
const WS = readFileSync(new URL("./NotebookWorkspace.tsx", import.meta.url), "utf8");
const APP = readFileSync(new URL("../MobileApp.tsx", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../mobile.css", import.meta.url), "utf8");

describe("标签页「关闭全部」（261019）", () => {
  it("有 closeAllTabs：清空 tabs/编辑器句柄/活动页，并关闭抽屉", () => {
    expect(WS).toContain("const closeAllTabs = useCallback");
    expect(WS).toMatch(/editorsRef\.current\.clear\(\);[\s\S]{0,160}setTabs\(\[\]\);\s*\n\s*setActiveId\(null\);\s*\n\s*setTabsOpen\(false\);/);
  });

  it("在途 readNote 用代际丢弃，防止关了又被异步加回来", () => {
    expect(WS).toContain("tabEpochRef");
    expect(WS).toMatch(/tabEpochRef\.current \+= 1/);
    expect(WS).toMatch(/epoch !== tabEpochRef\.current\) return/);
  });

  it("表头渲染「关闭全部」按钮（有标签时）", () => {
    expect(WS).toMatch(/tabs\.length > 0 && \(\s*\n\s*<button className="mobile-model-closeall"/);
    expect(CSS).toMatch(/\.mobile-model-closeall\s*\{[^}]*margin-left:\s*auto/);
  });

  it("硬件返回键转交给工作区的可等待保存屏障，不直接卸载", () => {
    expect(WS).toMatch(/onRegisterBackHandler\?\.\(handleBack\)/);
    expect(WS).toMatch(/await flushAllTabs\(\);\s*\n\s*onBack\(\);/);
    expect(APP).toMatch(/onBackFromNotebook: requestWorkspaceBack/);
    expect(APP).toMatch(/onRegisterBackHandler=\{registerWorkspaceBack\}/);
  });
});
