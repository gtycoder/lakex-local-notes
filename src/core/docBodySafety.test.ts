import { describe, expect, it } from "vitest";
import { checkDocBody, type DocBodyKind } from "./docBodySafety.js";
import { emptyBoardBody, parseBoardBodyChecked } from "./boardDoc.js";
import { emptyInkBody } from "./inkDoc.js";
import { emptyUsheetBody } from "./usheetDoc.js";

/** 合法「空文档」正文：三族各一份。 */
const EMPTY_BODIES: Record<DocBodyKind, string> = {
  usheet: emptyUsheetBody(),
  board: emptyBoardBody(),
  ink: emptyInkBody(),
};

/**
 * 坏结构（JSON 合法、但不是本 kind 的正文）。
 * 注意不能只看 `{}`：usheet 的 `workbook` 缺失才是坏结构；board 缺 elements/plaitValue；
 * ink 是有 pages 但 pages 为空（parseInkBody 明确要求至少一页）。
 */
const WRONG_SHAPES: Record<DocBodyKind, string> = {
  usheet: JSON.stringify({ kind: "usheet", version: 1, workbook: null }),
  board: JSON.stringify({ kind: "board", version: 1, preset: "drawing" }),
  ink: JSON.stringify({ kind: "ink", version: 1, pages: [] }),
};

/** 异 kind 正文（把别的文档塞进本编辑器）。 */
const WRONG_KINDS: Record<DocBodyKind, string> = {
  usheet: JSON.stringify({ kind: "bitable", version: 1, tables: [] }),
  board: JSON.stringify({ kind: "usheet", version: 1, workbook: {} }),
  ink: JSON.stringify({ kind: "board", version: 1, elements: [] }),
};

describe("坏正文单一判据（CORE-02）", () => {
  it("空正文 = ok + 空文档（仍可编辑）：null / undefined / 空串 / 纯空白", () => {
    for (const kind of Object.keys(EMPTY_BODIES) as DocBodyKind[]) {
      for (const raw of [null, undefined, "", "   \n\t "]) {
        const check = checkDocBody(kind, raw);
        expect(check.status, `${kind} / ${String(raw)}`).toBe("ok");
        if (check.status !== "ok") continue;
        expect(check.kind).toBe(kind);
        expect(check.empty).toBe(true);
        // 空文档必须是「可编辑的合法空」：编辑器拿它当默认文档即可，不是坏正文。
        if (check.kind === "usheet") expect(Object.keys(check.doc.workbook.sheets ?? {})).toEqual(["s1"]);
        if (check.kind === "board") expect(check.doc.elements).toEqual([]);
        if (check.kind === "ink") expect(check.doc.pages).toHaveLength(1);
      }
    }
  });

  it("合法空正文（三族各一份序列化结果）= ok，且不是 empty", () => {
    for (const kind of Object.keys(EMPTY_BODIES) as DocBodyKind[]) {
      const check = checkDocBody(kind, EMPTY_BODIES[kind]);
      expect(check.status).toBe("ok");
      if (check.status !== "ok") continue;
      expect(check.kind).toBe(kind);
      expect(check.empty).toBe(false);
    }
  });

  it("坏 JSON = unreadable / invalid-json（三族同口径）", () => {
    for (const kind of Object.keys(EMPTY_BODIES) as DocBodyKind[]) {
      const check = checkDocBody(kind, "{ 不是 json");
      expect(check.status).toBe("unreadable");
      if (check.status !== "unreadable") continue;
      expect(check.kind).toBe(kind);
      expect(check.reason).toBe("invalid-json");
    }
  });

  it("坏结构 = unreadable / wrong-shape（三族同口径）", () => {
    for (const kind of Object.keys(EMPTY_BODIES) as DocBodyKind[]) {
      const check = checkDocBody(kind, WRONG_SHAPES[kind]);
      expect(check.status, kind).toBe("unreadable");
      if (check.status !== "unreadable") continue;
      expect(check.reason).toBe("wrong-shape");
    }
  });

  it("异 kind / Lake 正文一律 unreadable，绝不按空文档打开", () => {
    for (const kind of Object.keys(EMPTY_BODIES) as DocBodyKind[]) {
      expect(checkDocBody(kind, WRONG_KINDS[kind]).status).toBe("unreadable");
      expect(checkDocBody(kind, "<p>这是一篇 Lake 文档</p>").status).toBe("unreadable");
    }
  });

  it("board 的宽容解析与可读性分开：坏正文仍可打开（空白画板），但 readable=false", () => {
    const bad = parseBoardBodyChecked("{ 不是 json");
    expect(bad.readable).toBe(false);
    expect(bad.doc.elements).toEqual([]);
    expect(bad.doc.preset).toBe("drawing");
    // 空正文是可读的空画板（新建/清空），与坏正文区分开
    const blank = parseBoardBodyChecked("");
    expect(blank.readable).toBe(true);
    expect(blank.doc.elements).toEqual([]);
    // 旧卡片形态（plaitValue、无 kind）仍算可读，避免老正文被误判成损坏
    const legacy = parseBoardBodyChecked(JSON.stringify({ version: 2, plaitValue: [{ id: "n1" }] }));
    expect(legacy.readable).toBe(true);
    expect(legacy.doc.elements).toEqual([{ id: "n1" }]);
  });

  it("合法正文带内容时 doc 原样可用（不是空文档）", () => {
    const board = checkDocBody("board", JSON.stringify({
      kind: "board", version: 1, engine: "drawnix", preset: "flowchart",
      elements: [{ id: "n1", type: "geometry" }],
    }));
    expect(board.status).toBe("ok");
    if (board.status === "ok" && board.kind === "board") {
      expect(board.doc.preset).toBe("flowchart");
      expect(board.doc.elements).toEqual([{ id: "n1", type: "geometry" }]);
    }
    const usheet = checkDocBody("usheet", JSON.stringify({
      kind: "usheet", version: 1,
      workbook: { id: "wb", sheetOrder: ["s1"], sheets: { s1: { id: "s1", cellData: { 0: { 0: { v: "1" } } } } } },
    }));
    expect(usheet.status).toBe("ok");
    if (usheet.status === "ok" && usheet.kind === "usheet") {
      expect(usheet.doc.workbook.sheets?.s1.cellData).toEqual({ 0: { 0: { v: "1" } } });
    }
  });
});
