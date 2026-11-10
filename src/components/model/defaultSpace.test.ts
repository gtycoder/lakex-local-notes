// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SPACE, DEFAULT_SPACE_KEY, DEFAULT_SPACE_OPTIONS, isDefaultSpace, loadDefaultSpace, saveDefaultSpace } from "./defaultSpace";
import { SETTING_ITEMS } from "./settingsSearch";

/**
 * 桌面「默认空间」（261110 用户点单）护栏：
 * ① 默认 = 文档；存储不可用/值非法都回落它（不阻塞启动）；
 * ② 五个可选空间 = ⌘1–5 那五个一级空间（选项顺序与标签固定）；
 * ③ 只存本机 `lakex-local-notes-v3.*`：不进 AppSettings、不进 S3/wire；
 * ④ 接线：设置页常规页有这一行（Field/Select 原语）、settingsSearch 注册表同步、启动读它。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const SHELL = read("../../desktop/useDesktopShell.ts");
const PANEL = read("../app/SettingsPanel.tsx");
const SETTINGS_LIB = read("../../lib/settings.ts");

describe("默认空间（设备本地偏好）", () => {
  beforeEach(() => { window.localStorage.clear(); });

  it("没有存过 ⇒ 默认「文档」（与加这个开关之前的启动行为一致）", () => {
    expect(DEFAULT_SPACE).toBe("library");
    expect(loadDefaultSpace()).toBe("library");
  });

  it("选项 = 文档 / 小记 / 日记 / AI 写作 / 标签（顺序与 ⌘1–5 对应）", () => {
    expect(DEFAULT_SPACE_OPTIONS).toEqual([
      { value: "library", label: "知识库" },
      { value: "quick-notes", label: "小记" },
      { value: "diary", label: "日记" },
      { value: "ai-writing", label: "AI 写作" },
      { value: "tags", label: "标签" },
    ]);
  });

  it("存过就按存的走（五个空间都能往返）", () => {
    for (const option of DEFAULT_SPACE_OPTIONS) {
      saveDefaultSpace(option.value);
      expect(window.localStorage.getItem(DEFAULT_SPACE_KEY)).toBe(option.value);
      expect(loadDefaultSpace()).toBe(option.value);
    }
  });

  it("值非法（旧版本/手改/工具页）⇒ 回落文档，不当成有效默认", () => {
    window.localStorage.setItem(DEFAULT_SPACE_KEY, "trash");
    expect(loadDefaultSpace()).toBe("library");
    window.localStorage.setItem(DEFAULT_SPACE_KEY, "");
    expect(loadDefaultSpace()).toBe("library");
    expect(isDefaultSpace("resources")).toBe(false);
    expect(isDefaultSpace("diary")).toBe(true);
  });

  it("localStorage 不可用 ⇒ 读回落文档、写不抛", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    expect(loadDefaultSpace()).toBe("library");
    saveDefaultSpace("diary"); // 不抛
    if (original) Object.defineProperty(window, "localStorage", original);
  });

  it("只存本机：键在 lakex-local-notes-v3. 前缀，且不进 AppSettings（S3/wire 面）", () => {
    expect(DEFAULT_SPACE_KEY.startsWith("lakex-local-notes-v3.")).toBe(true);
    expect(SETTINGS_LIB).not.toContain("default-space");
    expect(SETTINGS_LIB).not.toContain("defaultSpace");
  });

  it("接线①：设置页常规页用既有 Field/Select 原语渲染这一行", () => {
    expect(PANEL).toContain('itemId="editor-default-space"');
    expect(PANEL).toContain('name="默认空间"');
    expect(PANEL).toContain("options={DEFAULT_SPACE_OPTIONS}");
    expect(PANEL).toContain("saveDefaultSpace(v)");
  });

  it("接线②：settingsSearch 注册表有这一行（护栏 settingsSearch.test 同口径）", () => {
    const entry = SETTING_ITEMS.find((item) => item.id === "editor-default-space");
    expect(entry).toBeTruthy();
    expect(entry!.category).toBe("editor");
    expect(entry!.label).toBe("默认空间");
  });

  it("接线③：桌面壳的启动空间初值取自本偏好（不是写死 library）", () => {
    expect(SHELL).toContain('from "../components/model/defaultSpace"');
    expect(SHELL).toContain("useState<DesktopWorkspace>(() => loadDefaultSpace())");
  });
});
