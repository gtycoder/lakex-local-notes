import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * 画板自定义素材「文件夹存储」接线护栏（261114 用户点单）。
 * 桌面：素材 = <数据目录>/materials/*.board.json（可打开文件夹/手动放置）；移动端暂沿用 localStorage。
 */
describe("画板素材文件夹接线", () => {
  it("桌面 BoardEditor 注入文件夹存储端口（list/save/delete/open）", () => {
    const editor = read("./BoardEditor.tsx");
    expect(editor).toContain("const materialStorage = useMemo<MaterialLibraryStorage>");
    expect(editor).toContain("materialStorage={materialStorage}");
    expect(editor).toContain('native.boardMaterials<BoardMaterialsListResult>({ op: "list" })');
    expect(editor).toContain('op: "delete", file: id');
    expect(editor).toContain('op: "open"');
  });

  it("vendor 素材库优先走宿主端口，并提供「打开素材文件夹」入口；无端口时回落 localStorage", () => {
    const library = read("../../../vendor/lakex-doc-react/src/cards/DrawingBoard/LakexMaterialLibrary.tsx");
    expect(library).toContain("export interface MaterialLibraryStorage");
    expect(library).toContain("const storage = materialStorage ?? localStorageMaterialStorage");
    expect(library).toContain("await storage.save");
    expect(library).toContain("await storage.remove(id)");
    expect(library).toContain("storage.load()");
    expect(library).toContain("lakex-material-library__folder-row");
    expect(library).toContain("storage.openFolder?.()");
    const core = read("../../../vendor/lakex-doc-react/src/cards/DrawingBoard/DrawnixBoardCore.tsx");
    expect(core).toContain("materialStorage={materialStorage}");
  });

  it("移动端暂不接文件夹（仍用 localStorage 兜底，避免 Android 无「打开文件夹」语义）", () => {
    const mobile = read("../../mobile/board/MobileBoardViewer.tsx");
    expect(mobile).not.toContain("materialStorage");
  });

  it("IPC 三方：通道 board_materials 在注册侧/preload/Web 方法表都存在", () => {
    expect(read("../../../electron/ipc/registerBoardMaterials.ts")).toContain('ipc.handle("board_materials"');
    expect(read("../../../electron/preload.cjs")).toContain('boardMaterials: (request) => invoke("board_materials"');
    expect(read("../../../electron/webApiServer.ts")).toContain('boardMaterials: "board_materials"');
    expect(read("../../lib/native.ts")).toContain("boardMaterials: <T = unknown>");
  });
});
