import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalDocBody } from "../../core/docBaseline.js";
import { createInkDoc, inkToBody } from "../../core/inkDoc.js";

/**
 * 手写板「打开 = 只读」结构护栏（CORE-03，261028）。
 *
 * 背景（docs/audit-261027/09-core-data-models.md §CORE-03）：InkPad 原来**没有基线** ——
 * `capture` 直接返回 `inkToBody(doc)`，保存也会无条件 onChange。于是「打开后直接关闭」或
 * 「撤销回原样」都会把 parse 的 clamp / 补字段（activePageId 等）写回盘，多产生一次 contentHash。
 *
 * 现在保存与 capture 都先过 core 的等价判据（磁盘原文的规范形态 vs 当前正文）：
 * - 等价 ⇒ 不标脏 / 不排保存；capture 返回**磁盘原文**；
 * - 不等价 ⇒ 照旧 onChange，绝不吞笔迹（ink 每画一笔都改正文，所以判据必须是整篇逐字节比较）。
 *
 * 源码断言沿用 usheetOpenReadOnly.test.ts 的先例；判据本身的行为由 core/docBaseline.test.ts 覆盖。
 */
const INK_PAD = readFileSync(new URL("./InkPad.tsx", import.meta.url), "utf8");

describe("手写板打开只读（CORE-03）", () => {
  it("保存前判等价：等价则不标脏、不排保存；flush 落盘前再判一次", () => {
    expect(INK_PAD).toContain('canonicalDocBody("ink"');
    expect(INK_PAD).toMatch(/if \(sameAsDisk\(body\)\) \{\n\s*pendingSaveBodyRef\.current = null;/);
    expect(INK_PAD).toContain("onDirtyRef.current?.();");
    expect(INK_PAD).toMatch(/if \(hadPending && pending !== null && !sameAsDisk\(pending\)\) onChangeRef\.current\?\.\(pending\);/);
  });

  it("capture：等价返回磁盘原文（不为格式差异写盘），不等价返回当前正文（笔迹不丢）", () => {
    expect(INK_PAD).toMatch(/const diskBodyRef = useRef\(content\);/);
    expect(INK_PAD).toMatch(/return sameAsDisk\(body\) \? diskBodyRef\.current : body;/);
    // 判据必须限定在「整篇正文」上，而不是笔画计数之类的近似量
    expect(INK_PAD).toMatch(/const sameAsDisk = useCallback\(\(body: string\): boolean => \{/);
  });

  it("真实改动（新增笔迹）与磁盘不等价 ⇒ 仍会落盘", () => {
    const opened = createInkDoc("page-1");
    const disk = inkToBody(opened);
    expect(canonicalDocBody("ink", disk)).toBe(disk);
    const edited = {
      ...opened,
      pages: [{
        ...opened.pages[0],
        strokes: [{ id: "stroke-1", tool: "pen" as const, color: "#000000", width: 2, points: [{ x: 1, y: 2, pressure: 0.5 }] }],
      }],
    };
    const editedBody = inkToBody(edited);
    expect(canonicalDocBody("ink", editedBody)).toBe(editedBody);
    expect(editedBody).not.toBe(disk);
  });

  it("空正文按空文档等价（新建/清空后的正常形态）", () => {
    expect(canonicalDocBody("ink", "")).toBe(inkToBody(createInkDoc()));
  });
});
