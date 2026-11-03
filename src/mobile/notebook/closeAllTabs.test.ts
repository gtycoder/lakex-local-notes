import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** 261019：标签页抽屉加「关闭全部」。 */
/** 261103 P10-①：保存屏障 / tab 生命周期拆到 useWorkspaceSession.ts。 */
const WORKSPACE_SESSION = readFileSync(new URL("./useWorkspaceSession.ts", import.meta.url), "utf8");
/** 261103 P9-5b：全屏标签列表（.model）拆到 WorkspaceOverlayHost.tsx。 */
const OVERLAY = readFileSync(new URL("./WorkspaceOverlayHost.tsx", import.meta.url), "utf8");
const SESSION = readFileSync(new URL("./useNotebookTabs.ts", import.meta.url), "utf8");
const APP = readFileSync(new URL("../MobileApp.tsx", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../mobile.css", import.meta.url), "utf8");

describe("标签页「关闭全部」（261019）", () => {
  it("保存屏障通过后清空标签会话，并关闭抽屉", () => {
    expect(WORKSPACE_SESSION).toContain("const closeAllTabs = useCallback");
    expect(WORKSPACE_SESSION).toMatch(/await flushAllTabs\(\);\s*\n\s*clearTabs\(\);\s*\n\s*closeOverlay\("tabs"\);/);
    expect(SESSION).toMatch(/setTabs\(\[\]\);\s*\n\s*activeIdRef\.current = null;\s*\n\s*setActiveId\(null\);/);
  });

  it("在途 readNote 用代际丢弃，防止关了又被异步加回来", () => {
    expect(SESSION).toContain("tabEpochRef");
    expect(SESSION).toMatch(/tabEpochRef\.current \+= 1/);
    expect(SESSION).toMatch(/epoch !== tabEpochRef\.current\) return/);
  });

  it("表头渲染「关闭全部」按钮（有标签时）", () => {
    expect(OVERLAY).toMatch(/tabs\.length > 0 && \(\s*\n\s*<button className="mobile-model-closeall"/);
    expect(CSS).toMatch(/\.mobile-model-closeall\s*\{[^}]*margin-left:\s*auto/);
  });

  it("硬件返回键转交给工作区的可等待保存屏障，不直接卸载", () => {
    expect(WORKSPACE_SESSION).toMatch(/onRegisterBackHandler\?\.\(handleBack\)/);
    expect(WORKSPACE_SESSION).toMatch(/await flushAllTabs\(\);\s*\n\s*onBack\(\);/);
    expect(APP).toMatch(/onBackFromNotebook: requestWorkspaceBack/);
    expect(APP).toMatch(/onRegisterBackHandler=\{registerWorkspaceBack\}/);
  });
});
