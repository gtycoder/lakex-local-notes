import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
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
  it("保存前判等价：等价则不标脏、不排保存；flush 落盘前再判一次（P5：序列化只在保存时）", () => {
    expect(INK_PAD).toContain('canonicalDocBody("ink"');
    // P5：标脏走 scheduleSave（500ms 防抖），落盘时才 serializeDoc 并判等价
    expect(INK_PAD).toContain("onDirtyRef.current?.();");
    expect(INK_PAD).toMatch(/const body = serializeDoc\(\);\n\s*if \(body === null\) return;\n\s*dirtyRef\.current = false;\n\s*if \(sameAsDisk\(body\)\) return;/);
    expect(INK_PAD).toMatch(/const flushSave = useCallback\(\(\) => \{[\s\S]*?savePending\(\);\n\s*\}, \[savePending\]\);/);
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

  it("v2 图片页：带背景图片打开同样「等价 ⇒ 不写盘」（canonical 含新字段）", () => {
    const imageUrl = localAssetHttpUrl("note-1", "1700000000000_abcdef12.png");
    const doc = createInkDoc("page-1");
    doc.pages[0] = {
      ...doc.pages[0],
      backgroundImage: { url: imageUrl, fit: "contain", pixelWidth: 1200, pixelHeight: 1600 },
    };
    const disk = inkToBody(doc);
    expect(canonicalDocBody("ink", disk)).toBe(disk); // 新字段进 canonical ⇒ 打开不会被误判为「有改动」
    // 背景图必须在渲染层出现（否则图片页打开是空白，用户会去动正文）
    expect(INK_PAD).toContain("page.backgroundImage ?");
    expect(INK_PAD).toContain('pointerEvents="none"');
  });

  it("v1 正文可读：规范形态 = 读入后写回的 v2 形态（不写迁移脚本，但仍不写盘）", () => {
    const v1Body = JSON.stringify({
      kind: "ink",
      version: 1,
      pages: [{ id: "p1", width: 794, height: 1123, background: "blank", strokes: [] }],
      activePageId: "p1",
    });
    const canonical = canonicalDocBody("ink", v1Body);
    expect(canonical).not.toBeNull();
    expect(canonicalDocBody("ink", canonical!)).toBe(canonical);
  });
