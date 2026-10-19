/**
 * 移动端「文档属性」适配护栏（261019 用户点单：属性页面要适配手机）。
 *
 * 用户报的现象是"内容像被裁掉"。设备实测（emulator-5554 / 412×842）根因 =
 * 内容区 `.minfo` 没有横向内距：dt.left=0 / dd.right=412 / 操作按钮贴右边缘 ⇒ 整块贴着屏幕边。
 * 本护栏钉住两条：
 *   ① 内容区必须用移动端页面内距 `--mb-page-pad`（贴边就是回归）；
 *   ② 属性清单仍来自 `core/noteInfo`（与桌面同一份，不许移动端另抄）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(new URL("../mobile.css", import.meta.url), "utf8");
const SHEET = readFileSync(new URL("./NoteInfoSheet.tsx", import.meta.url), "utf8");

describe("移动端文档属性（261019）", () => {
  it("内容区有移动端页面内距（不能贴屏幕边）", () => {
    expect(CSS).toMatch(/\.minfo\s*\{[^}]*padding:\s*0 var\(--mb-page-pad\)/);
  });

  it("属性清单来自 core（与桌面同一份），不是移动端另抄一份", () => {
    expect(SHEET).toContain("noteInfoRows");
    expect(SHEET).toMatch(/from "\.\.\/\.\.\/core\/noteInfo\.js"/);
  });
});
