import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * usheet「坏正文 = 只读」结构护栏（CORE-02）。
 *
 * 背景：usheet 的 parseUsheetBody 失败曾被当成空表打开（可编辑）⇒ 用户改一格就把原文覆盖。
 * 判据已收口到 core 的 checkDocBody；本测试只锁**宿主接线**：桌面不挂内核 + 恒 null capture +
 * 横幅；移动端把「编辑态」降级成只读。真 canvas 起不来（jsdom 无渲染），桌面层用源码断言
 * （与 usheetOpenReadOnly.test.ts 同一先例）；移动端另有行为测试 mobileUsheetViewer.test.ts。
 */
const DESKTOP = readFileSync(new URL("./UniverSheetEditor.tsx", import.meta.url), "utf8");
const MOBILE = readFileSync(new URL("../../mobile/usheet/MobileUsheetViewer.tsx", import.meta.url), "utf8");

describe("usheet 坏正文只读（CORE-02）", () => {
  it("两端都用 core 的单一判据，不自己 JSON.parse 判正文", () => {
    for (const source of [DESKTOP, MOBILE]) {
      expect(source).toContain('checkDocBody("usheet"');
      expect(source).toMatch(/status === "unreadable"/);
    }
  });

  it("桌面：readOnly 并入坏正文；横幅 + 不挂内核 + 恒 null capture", () => {
    expect(DESKTOP).toMatch(/const readOnly = readOnlyProp \|\| bodyUnreadable;/);
    expect(DESKTOP).toContain("data-usheet-parse-error");
    // 不挂内核（空白表会误导「本来就空」）⇒ 没有任何命令/保存路径能产生正文。
    expect(DESKTOP).toMatch(/if \(!ready \|\| bodyUnreadable \|\| instanceRef\.current\) return;/);
    // 仍注册一个恒 null 的按需捕获（避免外层沿用上一个文档的取正文函数）。
    expect(DESKTOP).toMatch(/if \(!bodyUnreadable\) return;[\s\S]{0,160}captureRef\.current\?\.\(\(\) => null\)/);
    // flush 侧双保险：只读（含坏正文）一律不落盘。
    expect(DESKTOP).toMatch(/if \(!state \|\| readOnlyRef\.current\) return;/);
  });

  it("移动端：编辑态降级为只读，capture 恒 null（行为见 mobileUsheetViewer.test.ts）", () => {
    expect(MOBILE).toMatch(/const editable = editing && !bodyUnreadable;/);
    expect(MOBILE).toContain("data-usheet-parse-error");
    expect(MOBILE).toMatch(/book\.setEditable\(editingRef\.current && !bodyUnreadableRef\.current\)/);
    expect(MOBILE).toMatch(/if \(bodyUnreadableRef\.current\) return null;/);
    // 编辑面按 editable 渲染（坏正文时 dock / 公式栏 / 双击都不出现）。
    expect(MOBILE).toMatch(/\{editable && ready && \(/);
    expect(MOBILE).toMatch(/\{!editable && ready && \(/);
  });
});
