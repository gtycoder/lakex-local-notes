import { describe, expect, it } from "vitest";
import { PAD_PANEL_PREFS_KEY, parsePadPanelPrefs } from "./padPanelPrefs";

describe("平板目录/大纲固定偏好（261102 十四批）", () => {
  it("key 走移动端前缀（设备本地，不进正文/同步）", () => {
    expect(PAD_PANEL_PREFS_KEY.startsWith("lakex-local-notes-mobile.")).toBe(true);
  });

  it("缺省 / 空串 = 都不固定", () => {
    expect(parsePadPanelPrefs(null)).toEqual({ tree: false, outline: false });
    expect(parsePadPanelPrefs("")).toEqual({ tree: false, outline: false });
  });

  it("坏 JSON / 非对象 / 非布尔一律回落 false（不让脏偏好把面板停靠错）", () => {
    expect(parsePadPanelPrefs("{oops")).toEqual({ tree: false, outline: false });
    expect(parsePadPanelPrefs("null")).toEqual({ tree: false, outline: false });
    expect(parsePadPanelPrefs('"tree"')).toEqual({ tree: false, outline: false });
    expect(parsePadPanelPrefs('{"tree":1,"outline":"yes"}')).toEqual({ tree: false, outline: false });
  });

  it("只认 === true（部分字段缺省为 false）", () => {
    expect(parsePadPanelPrefs('{"tree":true}')).toEqual({ tree: true, outline: false });
    expect(parsePadPanelPrefs('{"outline":true,"tree":false}')).toEqual({ tree: false, outline: true });
    expect(parsePadPanelPrefs('{"tree":true,"outline":true}')).toEqual({ tree: true, outline: true });
  });
});
