import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boardToBody, createBoardDoc } from "../../core/boardDoc.js";
import { docBaselineSettled } from "../../core/docBaseline.js";

/**
 * 画板「打开 = 只读」结构护栏（CORE-03，261028）。
 *
 * 背景（docs/audit-261027/09-core-data-models.md §CORE-03）：BoardEditor 的基线由
 * `boardToBody(initialDoc)` 播种、flush 逐字比对，但这些都只挡「与基线规范化后相同」；
 * capture 曾**无条件返回规范化正文** ⇒ 外层按字节比较时，非规范正文（键序不同 / 带未知键 /
 * 老 `plaitValue` 方言）会被当成一次编辑写回盘，多产生一次 contentHash 与同步上传。
 *
 * 现在 capture / flush 都走 core 的单一判据 `docBaselineSettled("board", 磁盘原文, 当前正文)`：
 * - 等价（打开后没动 / 改过又改回原样）⇒ capture 返回**磁盘原文**，flush 不回调 onChange；
 * - 不等价（真的加/删/改了元素）⇒ 照旧返回并落盘当前正文，绝不吞改动。
 *
 * 真画布起不来（jsdom 无 canvas），沿用 usheetOpenReadOnly.test.ts 的源码断言先例；
 * 判据本身的行为另有 core/docBaseline.test.ts 覆盖。
 */
const EDITOR = readFileSync(new URL("./BoardEditor.tsx", import.meta.url), "utf8");
const HISTORY_PREVIEW = readFileSync(new URL("../../core/historyPreview.ts", import.meta.url), "utf8");

describe("画板打开只读（CORE-03）", () => {
  it("capture / flush 用 core 的单一判据，基线是打开时的磁盘原文", () => {
    expect(EDITOR).toContain('import { docBaselineSettled } from "../../core/docBaseline.js";');
    expect(EDITOR).toMatch(/const diskBodyRef = useRef<string>\(content\);/);
    // capture：等价 ⇒ 磁盘原文（外层按字节比较即「没改」）；否则当前正文。
    expect(EDITOR).toMatch(
      /return docBaselineSettled\("board", diskBodyRef\.current, json\) \? diskBodyRef\.current : json;/,
    );
    // flush：等价分支必须在 changeRef.current 之前 return（不得把「改回原样」当编辑写盘）。
    const settledAt = EDITOR.indexOf('if (docBaselineSettled("board", diskBodyRef.current, json)) {');
    expect(settledAt).toBeGreaterThan(-1);
    const changeAt = EDITOR.indexOf("changeRef.current(json)", settledAt);
    expect(changeAt).toBeGreaterThan(settledAt);
    expect(EDITOR.slice(settledAt, changeAt)).toContain("return;");
  });

  it("真实改动不会被基线吞掉（判据行为 + 宿主仍回调 onChange）", () => {
    const opened = createBoardDoc("drawing");
    opened.elements = [{ id: "a", type: "geometry" }];
    const disk = boardToBody(opened);
    // 同一内容的规范化形态 / 带未知键 / 老 plaitValue 方言 ⇒ 等价（不写盘）
    expect(docBaselineSettled("board", disk, disk)).toBe(true);
    expect(docBaselineSettled("board", disk, JSON.stringify({ ...JSON.parse(disk), misc: 1 }))).toBe(true);
    // 真的改了元素 ⇒ 不等价（必须继续写盘）
    const edited = boardToBody({ ...opened, elements: [...opened.elements, { id: "b", type: "geometry" }] });
    expect(docBaselineSettled("board", disk, edited)).toBe(false);
    // 宿主里非等价仍走 changeRef（上面断言的三元式/return 分支之外没有别的出口）。
    expect(EDITOR).toMatch(/lastSerializedRef\.current = json;\n\s*changeRef\.current\(json\);/);
  });

  it("历史快照的画板可读性也走 core 的单一判据（CORE-02 统一）", () => {
    expect(HISTORY_PREVIEW).toContain('import { boardToSearchText, parseBoardBodyChecked } from "./boardDoc.js";');
    expect(HISTORY_PREVIEW).toMatch(/const parsed = parseBoardBodyChecked\(body\);/);
    expect(HISTORY_PREVIEW).toMatch(/if \(!parsed\.readable\)/);
    // 不再自己 JSON.parse 猜画板 JSON（两套口径会漂移）
    expect(HISTORY_PREVIEW).not.toContain("parseBoardBody(");
  });
});
