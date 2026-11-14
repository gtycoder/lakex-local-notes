import { describe, expect, it } from "vitest";
import {
  BOARD_MATERIAL_FILE_SUFFIX,
  isBoardMaterialFileName,
  materialNameFromFile,
  parseBoardMaterialFile,
  safeMaterialFileStem,
  serializeBoardMaterialFile,
  type BoardMaterialEntry,
} from "./boardMaterialFile";

const entry: BoardMaterialEntry = {
  id: "x",
  name: "流程",
  createdAt: 1000,
  elements: [{ id: "e1", type: "geometry" }],
  width: 320,
  height: 180,
};

describe("画板自定义素材文件（261114：文件夹存储）", () => {
  it("自家素材文件可往返；文件名即 id", () => {
    const file = "流程" + BOARD_MATERIAL_FILE_SUFFIX;
    const parsed = parseBoardMaterialFile(serializeBoardMaterialFile(entry), file);
    expect(parsed).toMatchObject({ id: file, name: "流程", createdAt: 1000, width: 320, height: 180 });
    expect(parsed?.elements).toEqual(entry.elements);
  });

  it("手动拷进来的画板文档也能当素材：name 取文件名，无宽高", () => {
    const boardDoc = JSON.stringify({ kind: "board", version: 1, engine: "drawnix", preset: "drawing", elements: [{ id: "a" }], viewport: { x: 1, y: 2, zoom: 1 } });
    const parsed = parseBoardMaterialFile(boardDoc, "我的画板.board.json", 42);
    expect(parsed).toEqual({ id: "我的画板.board.json", name: "我的画板", createdAt: 42, elements: [{ id: "a" }] });
    // 卡片值的 plaitValue 形态也认
    const card = JSON.stringify({ version: 2, engine: "drawnix", plaitValue: [{ id: "b" }] });
    expect(parseBoardMaterialFile(card, "卡片.json")?.elements).toEqual([{ id: "b" }]);
  });

  it("坏文件/路径穿越/非 JSON 一律拒绝（列表只跳过，不影响其它素材）", () => {
    expect(parseBoardMaterialFile("not json", "a.json")).toBeNull();
    expect(parseBoardMaterialFile(JSON.stringify({ elements: "nope" }), "a.json")).toBeNull();
    expect(parseBoardMaterialFile(JSON.stringify({ elements: [] }), "../a.json")).toBeNull();
    expect(parseBoardMaterialFile(JSON.stringify({ elements: [] }), "a.txt")).toBeNull();
    expect(isBoardMaterialFileName("a.board.json")).toBe(true);
    expect(isBoardMaterialFileName("a.json")).toBe(true);
    expect(isBoardMaterialFileName(".hidden.json")).toBe(false);
    expect(isBoardMaterialFileName("sub/a.json")).toBe(false);
  });

  it("文件名清洗：路径分隔/控制字符/首点去掉，空名回落「素材」", () => {
    const stem = safeMaterialFileStem("a/b:c*?\"<>|d");
    expect(stem).toMatch(/^a-b-c-+d$/);
    expect(stem).not.toMatch(/[\\/:*?"<>|]/);
    expect(safeMaterialFileStem("  ")).toBe("素材");
    expect(safeMaterialFileStem("..hidden")).toBe("hidden");
    expect(materialNameFromFile("素材1.board.json")).toBe("素材1");
  });
});
