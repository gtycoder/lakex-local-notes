import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boardMaterialsDir, deleteBoardMaterial, listBoardMaterials, saveBoardMaterial } from "./boardMaterials.js";

let root = "";
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-board-materials-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe("画板素材文件夹（261114）", () => {
  it("list 会建目录；空目录 = 空列表", async () => {
    const result = await listBoardMaterials(root);
    expect(result.materials).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(fs.existsSync(boardMaterialsDir(root))).toBe(true);
  });

  it("save → 目录里出现可读的画板文档 JSON → list 能读回；重名不覆盖", async () => {
    const first = await saveBoardMaterial(root, { name: "流程", elements: [{ id: "e1" }], width: 200, height: 100 });
    expect(first.file).toBe("流程.board.json");
    expect(fs.existsSync(path.join(boardMaterialsDir(root), first.file))).toBe(true);
    const raw = JSON.parse(fs.readFileSync(path.join(boardMaterialsDir(root), first.file), "utf8"));
    expect(raw.kind).toBe("board");
    expect(raw.elements).toEqual([{ id: "e1" }]);
    expect(raw.material).toMatchObject({ name: "流程", width: 200, height: 100 });

    const second = await saveBoardMaterial(root, { name: "流程", elements: [{ id: "e2" }] });
    expect(second.file).not.toBe(first.file);
    const listed = await listBoardMaterials(root);
    expect(listed.materials.map((m) => m.name)).toEqual(["流程", "流程"]);
    expect(listed.materials.map((m) => m.elements)).toContainEqual([{ id: "e1" }]);
    expect(listed.materials.map((m) => m.elements)).toContainEqual([{ id: "e2" }]);
  });

  it("手动放入画板文档/坏文件：合法项可读、坏文件只进 skipped", async () => {
    const dir = boardMaterialsDir(root);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "手动画板.board.json"), JSON.stringify({ kind: "board", version: 1, elements: [{ id: "x" }] }));
    fs.writeFileSync(path.join(dir, "坏.board.json"), "{broken");
    fs.writeFileSync(path.join(dir, "忽略.txt"), "nope");
    const listed = await listBoardMaterials(root);
    expect(listed.materials.map((m) => m.name)).toEqual(["手动画板"]);
    expect(listed.skipped).toEqual(["坏.board.json"]);
  });

  it("delete 只删素材文件；路径穿越/不存在安全返回", async () => {
    const saved = await saveBoardMaterial(root, { name: "临时", elements: [] });
    expect((await deleteBoardMaterial(root, saved.file)).removed).toBe(true);
    expect(fs.existsSync(path.join(boardMaterialsDir(root), saved.file))).toBe(false);
    expect((await deleteBoardMaterial(root, saved.file)).removed).toBe(false);
    await expect(deleteBoardMaterial(root, "../x.json")).rejects.toThrow("无效的素材文件名");
  });
});
