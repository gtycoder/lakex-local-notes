import { describe, expect, it } from "vitest";
import {
  createInkDoc,
  createInkPage,
  inkToBody,
  type InkDoc,
  type InkPage,
  type InkPoint,
  type InkStroke,
} from "../../core/inkDoc.js";
import {
  INK_UNDO_LIMIT,
  applyInkPatch,
  inkOrderDelta,
  inkPagePatch,
  inkPatchChars,
  pushBoundedHistory,
  type InkHistoryEntry,
  type InkPatch,
} from "./history.js";

function makeStroke(id: string, x = 8, points = 1): InkStroke {
  return {
    id,
    tool: "pen",
    color: "#112233",
    width: 2,
    points: Array.from({ length: points }, (_, index) => ({ x: x + index, y: 12, pressure: 0.5 })),
  };
}

function pageWithStroke(id: string, stroke: InkStroke): InkPage {
  return { ...createInkPage(id), strokes: [stroke] };
}

function withPages(pages: InkPage[], activePageId = pages[0].id): InkDoc {
  return { kind: "ink", version: 1, pages, activePageId };
}

function structuralPatch(beforePages: InkPage[], afterPages: InkPage[], page: InkPage | null, before: InkPage | null): InkPatch {
  const patch = inkPagePatch(before, page);
  const order = inkOrderDelta(beforePages, afterPages);
  if (order) patch.order = order;
  return patch;
}

describe("手写板页级补丁 undo/redo", () => {
  it("落笔只改受影响页：undo 回到落笔前，redo 再回到落笔后", () => {
    const base = createInkDoc("p1");
    const before = base.pages[0];
    const nextPage = { ...before, strokes: [makeStroke("s1")] };
    const patch = inkPagePatch(before, nextPage);
    const after = { ...base, pages: [nextPage] };

    const undone = applyInkPatch(after, patch, "undo");
    expect(undone.pages[0].strokes).toEqual([]);
    const redone = applyInkPatch(undone, patch, "redo");
    expect(redone.pages[0].strokes.map((stroke) => stroke.id)).toEqual(["s1"]);
  });

  it("跨页全局撤销：不同页上的两步按顺序回放", () => {
    const page1 = pageWithStroke("p1", makeStroke("s1"));
    const page2 = createInkPage("p2");
    const doc0 = withPages([page1, page2], "p1");

    const page1After = { ...page1, strokes: [...page1.strokes, makeStroke("s2")] };
    const patch1 = inkPagePatch(page1, page1After);
    const doc1 = { ...doc0, pages: [page1After, page2] };

    const page2After = { ...page2, background: "grid" as const };
    const patch2 = inkPagePatch(page2, page2After);
    const doc2 = { ...doc1, pages: [page1After, page2After] };

    const undo2 = applyInkPatch(doc2, patch2, "undo");
    expect(undo2.pages[1].background).toBe("blank");
    const undo1 = applyInkPatch(undo2, patch1, "undo");
    expect(undo1.pages[0].strokes.map((stroke) => stroke.id)).toEqual(["s1"]);

    const redo1 = applyInkPatch(undo1, patch1, "redo");
    expect(redo1.pages[0].strokes.map((stroke) => stroke.id)).toEqual(["s1", "s2"]);
    const redo2 = applyInkPatch(redo1, patch2, "redo");
    expect(redo2.pages[1].background).toBe("grid");
  });

  it("新增页：undo 删除该页并把 activePageId 收回到存在的页，redo 恢复原顺序", () => {
    const base = createInkDoc("p1");
    const added = createInkPage("p2", "lined");
    const after = { ...base, pages: [...base.pages, added], activePageId: "p2" };
    const patch = structuralPatch(base.pages, after.pages, added, null);

    const undone = applyInkPatch(after, patch, "undo");
    expect(undone.pages.map((page) => page.id)).toEqual(["p1"]);
    expect(undone.activePageId).toBe("p1");

    const redone = applyInkPatch(undone, patch, "redo");
    expect(redone.pages.map((page) => page.id)).toEqual(["p1", "p2"]);
    expect(redone.pages[1].background).toBe("lined");
  });

  it("删除中间页：undo 恢复到原来的位置，redo 再次移除", () => {
    const pages = [createInkPage("p1"), createInkPage("p2"), createInkPage("p3")];
    const before = withPages(pages, "p1");
    const removed = pages[1];
    const remaining = [pages[0], pages[2]];
    const after = { ...before, pages: remaining };
    const patch = structuralPatch(before.pages, after.pages, null, removed);

    const undone = applyInkPatch(after, patch, "undo");
    expect(undone.pages.map((page) => page.id)).toEqual(["p1", "p2", "p3"]);

    const redone = applyInkPatch(undone, patch, "redo");
    expect(redone.pages.map((page) => page.id)).toEqual(["p1", "p3"]);
  });

  it("页重排：只有 order 补丁也能 undo/redo", () => {
    const pages = [createInkPage("p1"), createInkPage("p2"), createInkPage("p3")];
    const before = withPages(pages);
    const reordered = [pages[2], pages[0], pages[1]];
    const after = { ...before, pages: reordered };
    const order = inkOrderDelta(before.pages, after.pages);
    expect(order).not.toBeNull();
    const patch: InkPatch = { pages: [], order: order! };

    const undone = applyInkPatch(after, patch, "undo");
    expect(undone.pages.map((page) => page.id)).toEqual(["p1", "p2", "p3"]);
    const redone = applyInkPatch(undone, patch, "redo");
    expect(redone.pages.map((page) => page.id)).toEqual(["p3", "p1", "p2"]);
  });

  it("页序没变时 order 补丁为 null，避免无意义历史", () => {
    const pages = [createInkPage("p1"), createInkPage("p2")];
    expect(inkOrderDelta(pages, pages)).toBeNull();
  });

  it("历史快照与实时文档无别名：事后改原文、改应用结果都污染不了补丁", () => {
    const base = createInkDoc("p1");
    const before = base.pages[0];
    const nextPage = { ...before, strokes: [makeStroke("s1")] };
    const patch = inkPagePatch(before, nextPage);

    before.strokes.push(makeStroke("mutated-after-patch"));
    const undone = applyInkPatch(base, patch, "undo");
    expect(undone.pages[0].strokes).toEqual([]);

    undone.pages[0].strokes.push(makeStroke("local-only"));
    const redone = applyInkPatch(base, patch, "redo");
    expect(redone.pages[0].strokes.map((stroke) => stroke.id)).toEqual(["s1"]);
    expect(redone.pages[0]).not.toBe(nextPage);
  });
});

describe("手写板撤销栈边界", () => {
  it("同时受条数上限约束", () => {
    const stack: InkHistoryEntry[] = [];
    for (let i = 0; i < 5; i += 1) {
      const page = createInkPage(`p${i}`);
      pushBoundedHistory(stack, inkPagePatch(page, { ...page, background: "grid" }), 3, 1024 * 1024);
    }
    expect(stack).toHaveLength(3);
    expect(stack.map((entry) => entry.patch.pages[0].id)).toEqual(["p2", "p3", "p4"]);
  });

  it("按补丁大小计总预算：超预算从最旧一条开始丢弃", () => {
    const stack: InkHistoryEntry[] = [];
    const page = createInkPage("p1");
    const patch = inkPagePatch(page, { ...page, background: "grid" });
    const patchChars = inkPatchChars(patch);

    pushBoundedHistory(stack, patch, 60, patchChars * 2);
    pushBoundedHistory(stack, patch, 60, patchChars * 2);
    pushBoundedHistory(stack, patch, 60, patchChars * 2);
    expect(stack).toHaveLength(2);
  });

  it("单条补丁超过预算时不会留下无法撤销的内存副本", () => {
    const stack: InkHistoryEntry[] = [];
    const page = createInkPage("p1");
    const patch = inkPagePatch(page, { ...page, background: "grid" });
    pushBoundedHistory(stack, patch, 60, inkPatchChars(patch) - 1);
    expect(stack).toEqual([]);
  });

  it("10 MiB 正文（100 页 × 3000 点）下仍可保留 ≥30 步", () => {
    const pages: InkPage[] = [];
    for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
      const points: InkPoint[] = Array.from({ length: 3000 }, (_, index) => ({
        x: index % 794,
        y: index % 1123,
        pressure: 0.5,
        t: index,
      }));
      pages.push({ ...createInkPage(`p${pageIndex}`), strokes: [{ ...makeStroke(`s${pageIndex}`, 0), points }] });
    }
    const doc = withPages(pages, "p0");
    expect(inkToBody(doc).length).toBeGreaterThan(10 * 1024 * 1024);

    const stack: InkHistoryEntry[] = [];
    for (let step = 0; step < INK_UNDO_LIMIT; step += 1) {
      const page = pages[0];
      const patch = inkPagePatch(page, { ...page, strokes: [...page.strokes, makeStroke(`extra-${step}`)] });
      pushBoundedHistory(stack, patch);
    }
    expect(stack.length).toBeGreaterThanOrEqual(30);
    expect(stack.length).toBeLessThanOrEqual(INK_UNDO_LIMIT);
  });
});
