import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 「打开表格 = 只读」结构护栏（261023）。
 *
 * 背景：Univer 的 save() 不幂等（plugin resource 空壳 / 字族引号随构建变），
 * 曾导致「一打开表格就待保存 → 自动保存 → contentHash 变 → 同步上传」。
 * 修复分两层：
 *   ① 正文规范化（core/usheetDoc.ts 的 normalizeUsheetWorkbook，写盘/比较的统一形式）；
 *   ② **结构性保证**：打开后的第一次 flush 只对齐基线（不写盘、不标脏），只有用户真的产生
 *      内容输入（键盘/粘贴/剪切/拖放/工具栏点击）时才允许把差异当编辑；capture 在无真实改动 /
 *      改回原样时返回磁盘原文——后者由 core/docBaseline 的单一判据回答（CORE-03）。
 *
 * 本测试**锁住第 ② 层的代码形态**：删掉任何一处，都会退回到「打开即脏」。
 */
const SOURCE = readFileSync(new URL("./UniverSheetEditor.tsx", import.meta.url), "utf8");

describe("usheet 打开只读（结构护栏）", () => {
  it("首次 flush 只对齐基线：需要 baselineSettled + contentInput 两个判据", () => {
    expect(SOURCE).toContain("baselineSettledRef");
    expect(SOURCE).toContain("contentInputRef");
    expect(SOURCE).toMatch(/if \(!baselineSettledRef\.current\)[\s\S]{0,400}if \(!contentInputRef\.current\)/);
    // 对齐分支必须在 changeRef 之前 return（不得调用 onChange）
    const adopt = SOURCE.indexOf("if (!baselineSettledRef.current)");
    const change = SOURCE.indexOf("changeRef.current(body)", adopt);
    expect(adopt).toBeGreaterThan(-1);
    expect(SOURCE.slice(adopt, change)).toContain("return;");
  });

  it("内容输入判据覆盖键盘/粘贴/剪切/拖放 + 非网格指针点击", () => {
    const block = SOURCE.slice(SOURCE.indexOf("markContentInput"), SOURCE.indexOf("dispose: () => {", SOURCE.indexOf("markContentInput")));
    for (const type of ["keydown", "beforeinput", "paste", "cut", "drop"]) expect(block).toContain(type);
    expect(block).toContain("render-canvas");
    expect(block).toContain("pointerdown");
  });

  it("capture：无真实改动 / 改过又改回原样 都返回磁盘原文（避免为规范化写盘）", () => {
    // 无改动 → persistedBodyRef；改动后再回到基线（撤销/改回原值）→ 走 core 单一判据（CORE-03）。
    expect(SOURCE).toMatch(/if \(!changedSinceOpenRef\.current\) return persistedBodyRef\.current;/);
    expect(SOURCE).toContain('docBaselineSettled("usheet", persistedBodyRef.current, state.last)');
    expect(SOURCE).toContain("return persistedBodyRef.current;");
  });

  it("写入/比较统一走规范化（打开基线与每次 flush 都调用）", () => {
    expect(SOURCE.match(/normalizeUsheetWorkbook\(/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("字体族走 core 的 canonical 常量，不读运行时 CSS 变量（CORE-04）", () => {
    expect(SOURCE).not.toContain("lakeFontFamily");
    expect(SOURCE).not.toContain("applyFontPolicy");
  });

  it("自动行高缓存（ah）差异走「无声收编」，不得当编辑（261123）", () => {
    // doFlush：只差 ah 缓存 ⇒ 只收进基线（state.last / lastBodyRef），随后 return，不标脏。
    expect(SOURCE).toMatch(/usheetAutoHeightOnlyDiff\(state\.last, body\)[\s\S]{0,240}return;/);
    const fold = SOURCE.indexOf("usheetAutoHeightOnlyDiff(state.last, body)");
    const dirty = SOURCE.indexOf("changedSinceOpenRef.current = true");
    expect(fold).toBeGreaterThan(-1);
    expect(dirty).toBeGreaterThan(fold); // 收编分支必须挡在标脏之前
  });

  it("打开期行高自愈接线（261123）：共用 helper + 与 normalize 同限的行数 + onlyLocal", () => {
    expect(SOURCE).toContain("scheduleUsheetAutoHeightHeal");
    const heal = readFileSync(new URL("./usheetAutoHeightHeal.ts", import.meta.url), "utf8");
    expect(heal).toContain("sheet.operation.mark-dirty-row-auto-height");
    expect(heal).toContain("USHEET_AUTO_ROW_HEIGHT_MAX_ROWS");
    expect(heal).toContain("onlyLocal");
  });
});
