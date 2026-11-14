// @vitest-environment jsdom
/**
 * 设置项「默认空间」（261110 用户点单）：打开 App 落在哪个一级页。
 *  · 选项 = 首页四个 tab（判据取 home/tabPager 的 HOME_TABS，不另立一份）；
 *  · **默认小记**（261014 冷启动口径）；存档值非法/存储不可用 ⇒ 回落小记（fail-safe）；
 *  · **仅本机**：localStorage 前缀 lakex-local-notes-mobile.，不进 S3 / 不进 wire（本文件只看读回值）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { HOME_TABS } from "../home/tabPager";
import { DEFAULT_HOME_TAB, DEFAULT_SPACE_OPTIONS, clearDefaultHomeTabForTest, readDefaultHomeTab, writeDefaultHomeTab } from "./defaultSpace";

const KEY = "lakex-local-notes-mobile.default-space";

afterEach(() => { clearDefaultHomeTabForTest(); localStorage.clear(); });

describe("默认空间（设备本地偏好）", () => {
  it("未设置 = 小记；选项就是首页五个 tab（261110 含 AI），顺序与 tabPager 一致", () => {
    expect(DEFAULT_HOME_TAB).toBe("quick");
    expect(readDefaultHomeTab()).toBe("quick");
    expect(DEFAULT_SPACE_OPTIONS.map((o) => o.value)).toEqual([...HOME_TABS]);
    expect(DEFAULT_SPACE_OPTIONS.map((o) => o.label)).toEqual(["知识库", "小记", "标签", "AI", "日记"]);
  });

  it("写/读往返：四个 tab 都能存住；写回默认值 = 清掉键（不留无意义行）", () => {
    for (const tab of HOME_TABS) {
      writeDefaultHomeTab(tab);
      expect(readDefaultHomeTab()).toBe(tab);
    }
    expect(localStorage.getItem(KEY)).not.toBeNull();
    writeDefaultHomeTab("quick");
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(readDefaultHomeTab()).toBe("quick");
  });

  it("存档值非法（旧版本/被手改）⇒ 回落小记，不抛错", () => {
    localStorage.setItem(KEY, "nope");
    expect(readDefaultHomeTab()).toBe("quick");
    localStorage.setItem(KEY, "");
    expect(readDefaultHomeTab()).toBe("quick");
  });
});
