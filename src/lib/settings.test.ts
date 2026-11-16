// @vitest-environment jsdom
/**
 * 设置归一（261110 用户定稿）：标签上限最大 16，撤掉「不限」与 24 档；
 * 旧存档里的 0（不限）/24 一律夹到硬上限，手改超限值同样夹住。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSettings, MAX_OPEN_TAB_OPTIONS, MAX_OPEN_TABS_CAP, MAX_OPEN_TABS_DESKTOP_DEFAULT, MAX_OPEN_TABS_MOBILE_DEFAULT, normalizeMaxOpenTabs, saveSettings } from "./settings";

const SETTINGS_KEY = "lakex-local-notes-v1.settings";

describe("最大同时打开标签数（上限 16）", () => {
  beforeEach(() => {
    localStorage.clear();
    // 清模块级缓存：重新读取
    // loadSettings 用内存缓存，这里通过 saveSettings 写默认值后再读
    saveSettings({ maxOpenTabs: 8 });
  });

  it("档位只到 16，且不含「不限」", () => {
    expect(MAX_OPEN_TABS_CAP).toBe(16);
    expect([...MAX_OPEN_TAB_OPTIONS]).toEqual([4, 6, 8, 12, 16]);
    expect(MAX_OPEN_TAB_OPTIONS).not.toContain(0);
    expect(MAX_OPEN_TAB_OPTIONS).not.toContain(24);
  });

  it("归一：旧「不限」(0/−1) 与超限（24/999）夹到 16，非法回落默认", () => {
    expect(normalizeMaxOpenTabs(0)).toBe(16);
    expect(normalizeMaxOpenTabs(-1)).toBe(16);
    expect(normalizeMaxOpenTabs(24)).toBe(16);
    expect(normalizeMaxOpenTabs(999)).toBe(16);
    expect(normalizeMaxOpenTabs(8)).toBe(8);
    expect(normalizeMaxOpenTabs("8")).toBe(8);
    expect(normalizeMaxOpenTabs(Number.NaN)).toBe(8);
  });

  it("平台默认：桌面 8 / 移动 6（无存档时按 body.lake-mobile 判据取，261116 用户点单）", async () => {
    expect(MAX_OPEN_TABS_DESKTOP_DEFAULT).toBe(8);
    expect(MAX_OPEN_TABS_MOBILE_DEFAULT).toBe(6);
    // 桌面（无标记）：新装库默认 8
    document.body.classList.remove("lake-mobile");
    localStorage.clear();
    vi.resetModules();
    const desktop = await import("./settings");
    expect(desktop.loadSettings().maxOpenTabs).toBe(8);
    // 移动端（入口加了 lake-mobile）：新装库默认 6
    document.body.classList.add("lake-mobile");
    localStorage.clear();
    vi.resetModules();
    const mobile = await import("./settings");
    try {
      expect(mobile.loadSettings().maxOpenTabs).toBe(6);
      // 可调档位仍到 16；用户存过值就按用户值（默认只影响「没存过」）
      expect([...mobile.MAX_OPEN_TAB_OPTIONS]).toEqual([4, 6, 8, 12, 16]);
      expect(mobile.MAX_OPEN_TABS_CAP).toBe(16);
    } finally {
      document.body.classList.remove("lake-mobile");
    }
  });

  it("保存时夹上限：即使调用点传 24 也只存 16", () => {
    const next = saveSettings({ maxOpenTabs: 24 });
    expect(next.maxOpenTabs).toBe(16);
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).maxOpenTabs).toBe(16);
    expect(loadSettings().maxOpenTabs).toBe(16);
  });
});

describe("新建文档位置（261117 用户点单）", () => {
  it("默认末尾追加；旧存档缺字段/非法值归一为 bottom", async () => {
    localStorage.clear();
    vi.resetModules();
    const fresh = await import("./settings");
    expect(fresh.DEFAULT_SETTINGS.newNotePosition).toBe("bottom");
    expect(fresh.loadSettings().newNotePosition).toBe("bottom");

    // 旧存档：没有该字段（升级前的 localStorage）
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ fontSize: 16, theme: "light", maxOpenTabs: 8 }));
    vi.resetModules();
    const old = await import("./settings");
    expect(old.loadSettings().newNotePosition).toBe("bottom");

    // 非法值（手改存档）也回落 bottom，不让 UI 拿到未定义值
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ newNotePosition: "middle" }));
    vi.resetModules();
    const bad = await import("./settings");
    expect(bad.loadSettings().newNotePosition).toBe("bottom");

    // 合法值保留
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ newNotePosition: "top" }));
    vi.resetModules();
    const top = await import("./settings");
    expect(top.loadSettings().newNotePosition).toBe("top");
  });

  it("保存入口同样归一：任何调用点写非法值都落 bottom", async () => {
    const mod = await import("./settings");
    const next = mod.saveSettings({ newNotePosition: "weird" as unknown as "top" });
    expect(next.newNotePosition).toBe("bottom");
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).newNotePosition).toBe("bottom");
  });
});
