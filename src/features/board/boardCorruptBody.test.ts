import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * board「坏正文 = 只读」结构护栏（CORE-02）。
 *
 * 背景：parseBoardBody 是**宽容退化**（坏数据 → 空白画板，保证文档打得开），旧版没有失败态，
 * 用户画一笔就把「空白 + 新元素」覆盖回原文。可读性判定已收口到 core 的
 * parseBoardBodyChecked / checkDocBody；本测试锁宿主接线：
 * - 桌面：readOnly 并入坏正文、横幅、不挂画布、flush 落盘前双保险、capture 恒 null；
 * - 移动：canEdit=false（画布 readOnly）+ 横幅 + 不挂画布 + capture 恒 null。
 * 真画布起不来（jsdom 无 canvas），桌面用源码断言；移动端另有行为测试 mobileBoardViewer.test.ts。
 */
const DESKTOP = readFileSync(new URL("./BoardEditor.tsx", import.meta.url), "utf8");
const MOBILE = readFileSync(new URL("../../mobile/board/MobileBoardViewer.tsx", import.meta.url), "utf8");

describe("画板坏正文只读（CORE-02）", () => {
  it("两端都用 core 的单一判据（不是自己 JSON.parse 猜画板）", () => {
    for (const source of [DESKTOP, MOBILE]) {
      expect(source).toContain('checkDocBody("board"');
      expect(source).toMatch(/status === "unreadable"/);
    }
  });

  it("桌面：readOnly 并入坏正文、横幅、不挂画布、flush 不落盘、capture 恒 null", () => {
    expect(DESKTOP).toMatch(/const readOnly = readOnlyProp \|\| bodyUnreadable;/);
    expect(DESKTOP).toContain("data-board-parse-error");
    // 空白画布会让人以为「本来就没内容」⇒ 坏正文时不挂画布。
    expect(DESKTOP).toMatch(/\{!bodyUnreadable && everVisible && \(/);
    // 落盘前再挡一次（scheduleSave / handleCoreChange / capture 之外的最后一道）。
    expect(DESKTOP).toMatch(/const flush = useCallback\(\(\) => \{\n\s*\/\/[^\n]*\n\s*if \(readOnlyRef\.current\) return;/);
    expect(DESKTOP).toMatch(/const captureContent = useCallback\(\(\): string \| null => \{\n\s*if \(readOnlyRef\.current\) return null;/);
  });

  it("移动端：编辑态降级为只读 + 横幅 + 不挂画布 + capture 恒 null", () => {
    expect(MOBILE).toMatch(/const canEdit = editing && !bodyUnreadable;/);
    expect(MOBILE).toContain("data-board-parse-error");
    expect(MOBILE).toMatch(/readOnly=\{!canEdit\}/);
    expect(MOBILE).toMatch(/if \(bodyUnreadable\) \{\n\s*return \(/);
    expect(MOBILE).toMatch(/if \(bodyUnreadableRef\.current\) return null;/);
  });
});
