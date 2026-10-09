import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { imageFilesFromClipboard, isPureImageClipboard, pasteImageTarget, type ClipboardLike } from "./usheetImagePaste";

const file = (name: string, type = "image/png") => new File([new Uint8Array([1, 2, 3])], name, { type });
const EDITOR = readFileSync(new URL("./UniverSheetEditor.tsx", import.meta.url), "utf8");
/** 内核触点集中在契约文件：菜单路径/命令 id 的断言指到那里（单一来源搬家后测试也要跟着搬）。 */
const CONTRACT = readFileSync(new URL("./usheetKernelContract.ts", import.meta.url), "utf8");

describe("pasteImageTarget（粘贴图片落点，用户 261010 定稿）", () => {
  it("单图 + 有活动单元格 → 单元格图片", () => {
    expect(pasteImageTarget([{}], true)).toBe("cell");
  });

  it("单图但没有选中单元格 → 回退内核默认（浮动图）", () => {
    expect(pasteImageTarget([{}], false)).toBe("float");
  });

  it("多图 → 回退内核默认（单元格只能放一张，硬塞会静默丢图）", () => {
    expect(pasteImageTarget([{}, {}], true)).toBe("float");
    expect(pasteImageTarget([{}, {}, {}], true)).toBe("float");
  });

  it("没有文件 / 空数组 → 内核默认（不接管）", () => {
    expect(pasteImageTarget([], true)).toBe("float");
    expect(pasteImageTarget(undefined, true)).toBe("float");
    expect(pasteImageTarget(null, false)).toBe("float");
  });
});

describe("imageFilesFromClipboard", () => {
  it("优先取 items 里的图片文件", () => {
    const png = file("a.png");
    const data: ClipboardLike = {
      items: [
        { kind: "string", type: "text/plain" },
        { kind: "file", type: "image/png", getAsFile: () => png },
      ] as unknown as ClipboardLike["items"],
      files: [] as unknown as File[],
    };
    expect(imageFilesFromClipboard(data)).toEqual([png]);
  });

  it("items 里没有图片文件时回退 files，并过滤掉非图片", () => {
    const jpg = file("b.jpg", "image/jpeg");
    const txt = file("c.txt", "text/plain");
    expect(imageFilesFromClipboard({ files: [txt, jpg] as unknown as File[] })).toEqual([jpg]);
  });

  it("空剪贴板 → 空数组", () => {
    expect(imageFilesFromClipboard(null)).toEqual([]);
    expect(imageFilesFromClipboard({})).toEqual([]);
  });
});

describe("isPureImageClipboard", () => {
  it("只有图片 → 纯图片（我们接管）", () => {
    expect(isPureImageClipboard(() => "")).toBe(true);
  });

  it("带文本或 HTML → 不是纯图片（交回内核）", () => {
    expect(isPureImageClipboard((t) => (t === "text/plain" ? "hello" : ""))).toBe(false);
    expect(isPureImageClipboard((t) => (t === "text/html" ? "<img src=x>" : ""))).toBe(false);
  });

  it("读文本抛错 → 按纯图片处理", () => {
    expect(isPureImageClipboard(() => { throw new Error("nope"); })).toBe(true);
  });
});

describe("单元格右键「插入单元格图片」入口（用户 261010）", () => {
  it("挂在「插入」子菜单下（位置 → 分组 → sheet.menu.cell-insert 三段路径）", () => {
    // 路径元素必须是**单个 key**（facade 的 appendTo 逐段 merge）；写成点号整串会挂到错误层级
    expect(CONTRACT).toContain('"contextMenu.mainArea", "contextMenu.layout", "sheet.menu.cell-insert"');
    expect(EDITOR).toMatch(/appendTo\(UNIVER_CONTEXT_MENU_INSERT_PATH\)/);
  });

  it("复用已有命令（action 传命令 id）；createMenu 必须作为方法调用", () => {
    expect(CONTRACT).toContain('ourInsertCellImage: "usheet.insert-cell-image"');
    expect(EDITOR).toContain("action: UNIVER_COMMAND_IDS.ourInsertCellImage");
    expect(EDITOR).toContain('id: "usheet.menu.insert-cell-image"');
    // ⚠️ 解构 createMenu 会丢 this → 报 _injector undefined（实测踩过）
    expect(EDITOR).toContain("menuApi.createMenu({");
  });
});
