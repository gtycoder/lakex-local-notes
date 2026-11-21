
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WORKSPACE = readFileSync(new URL("./NotebookWorkspace.tsx", import.meta.url), "utf8");

describe("移动端目录行激活语义（261121 用户点单）", () => {
  it("文档行永远先打开（含子文档）；只有非文档行才按子级展开/折叠", () => {
    // 261121 前的实现是「有子节点先展开/折叠」在前 ⇒ 有子文档的文档永远打不开（现场图 4）。
    const body = WORKSPACE.slice(WORKSPACE.indexOf("onActivate={(item) => {"));
    const noteBranch = body.indexOf('if (item.kind === "note")');
    expect(noteBranch).toBeGreaterThanOrEqual(0);
    // 注意用 fromIndex：文件里更早的「选择态」分支也有同一句 childrenOf 判断。
    const childAfter = body.indexOf("if (childrenOf(item.id).length > 0) toggleGroup(item.id);", noteBranch);
    expect(childAfter).toBeGreaterThan(noteBranch);
    expect(body.slice(noteBranch, childAfter)).toContain("void openTab(item.id)");
  });

  it("三角独立接线：onToggleExpand → toggleGroup（不与行激活混用）", () => {
    expect(WORKSPACE).toContain("onToggleExpand={(id) => toggleGroup(id)}");
  });
});
