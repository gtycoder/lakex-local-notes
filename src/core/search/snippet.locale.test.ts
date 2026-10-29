/**
 * CORE-10：搜索链路的折叠必须 **locale-independent**（Unicode 默认大小写映射）。
 *
 * 事故形态：`toLocaleLowerCase()` 无参数 = 折叠结果由宿主机 locale 决定（土耳其语 I→ı、İ→i），
 * 与 FTS5 unicode61 的折叠不一致 ⇒ 摘要 <mark> 的位置/命中词随机器变形，快照式断言也不稳定。
 * 这里锁两件事：① 折叠按 Unicode 默认映射（I/İ 定点断言，tr 宿主上旧实现必红）；
 * ② 搜索链路的 core 文件不得再出现 toLocaleLowerCase。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSnippet } from "./snippet.js";
import { normalizeQuickNoteQuery, quickNoteMatchesQuery } from "../quickNoteSearch.js";
import { buildTreeIndex } from "../treeIndex.js";

function readCore(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

describe("CORE-10 搜索折叠与宿主 locale 无关", () => {
  it("İ/I 按 Unicode 默认映射折叠（tr locale 下是 I→ı、İ→i）", () => {
    // 默认映射：I→i，İ→i+U+0307（组合点，长度 2）；tr 映射长度/字符都不同 ⇒ 必然可区分。
    expect("Iİ".toLowerCase()).toBe("ii\u0307");
    expect(normalizeQuickNoteQuery("Iİ")).toBe("ii\u0307");
    // 摘要按同一折叠标命中：İ 的折叠以 i 开头 ⇒ 两个字符都在 <mark> 内。
    // 旧实现（tr 宿主）会输出 "I<mark>İ</mark>"（起点错位），非 tr 宿主也不会是别的结果。
    expect(buildSnippet("Iİ", "i")).toBe("<mark>Iİ</mark>");
  });

  it("常规大小写无关命中不受影响", () => {
    expect(buildSnippet("HELLO world", "hello")).toBe("<mark>HELLO</mark> world");
    expect(quickNoteMatchesQuery({ previewText: "HELLO 世界" }, "hello")).toBe(true);
    expect(quickNoteMatchesQuery({ previewText: "hello 世界" }, "HELLO")).toBe(true);
    // tr 折叠才会把 Istanbul 变成 ıstanbul；默认折叠下不命中（与索引侧同口径）
    expect(quickNoteMatchesQuery({ previewText: "Istanbul" }, "ıstanbul")).toBe(false);
  });

  it("目录树搜索与同一折叠（标题折叠、查询也折叠）", () => {
    const nodes = [
      { id: "b", parentId: null, nodeType: "notebook" as const, title: "HELLO 笔记本", sortOrder: 0, updatedAt: "", workspaceId: "ws", noteFileId: null, createdAt: "", isConflict: false },
    ];
    expect([...buildTreeIndex(nodes, "hello").visibleIds]).toEqual(["b"]);
    expect([...buildTreeIndex(nodes, "hello".toUpperCase()).visibleIds]).toEqual(["b"]);
    expect([...buildTreeIndex(nodes, "ıstanbul").visibleIds]).toEqual([]);
  });

  it("搜索链路的 core 文件不得再用 toLocaleLowerCase（防写回）", () => {
    for (const rel of ["./snippet.ts", "../quickNoteSearch.ts", "../treeIndex.ts"]) {
      const src = readCore(rel);
      expect(src, rel).not.toContain("toLocaleLowerCase(");
      expect(src, rel).toContain("toLowerCase(");
    }
  });
});
