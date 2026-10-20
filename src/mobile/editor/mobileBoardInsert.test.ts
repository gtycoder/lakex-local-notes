import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const DOCK = read("./EditorDock.tsx");
const BOARD_CORE = read("../../../vendor/lakex-doc-react/src/cards/DrawingBoard/DrawnixBoardCore.tsx");
const BOARD_CSS = read("../../../vendor/lakex-doc-react/src/cards/DrawingBoard/DrawnixBoardCore.css");

describe("移动端文档内画板族插入（261019 P0）", () => {
  it("4 类 Drawnix 卡片有插入动作；文本绘图不在本批解禁", () => {
    expect(DOCK).toContain('insertBoardCard("drawing-board", "drawing")');
    expect(DOCK).toContain('insertBoardCard("flowchart-board", "flowchart")');
    expect(DOCK).toContain('insertBoardCard("uml-board", "uml")');
    expect(DOCK).toContain('insertBoardCard("drawing-mindmap-board", "mindmap")');
    expect(DOCK).toMatch(/\{ label: "文本绘图", disabled: true \}/);
  });

  it("插入走内核 insertCard + focusCard；面板 hide 档收起，不拉起输入法", () => {
    expect(DOCK).toContain('cardValueFromBoardDoc(createBoardDoc(preset))');
    expect(DOCK).toContain('exec("insertCard", "customBlock", value, true)');
    expect(DOCK).toContain("$name: cardName");
    expect(DOCK).toContain('exec("focusCard", cardId)');
    expect(DOCK).toContain('closePanel("hide")');
    expect(DOCK).toContain("cardHeight: 560");
  });

  it("画板根节点标记内容接管横滑；编辑态画布阻止浏览器把拖拽判成滚动", () => {
    expect(BOARD_CORE).toContain("data-prevent-swipe");
    expect(BOARD_CSS).toMatch(
      /\.lakex-drawnix-core:not\(\.lakex-drawnix-core--readonly\) \.viewport-container \{\s*touch-action: none;/,
    );
  });

  it("移动端创建栏只保留一个纵向定位，不再 top+bottom 拉满画布", () => {
    expect(BOARD_CSS).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.lakex-drawnix-core \.draw-toolbar \{[^}]*left: 50%;[^}]*max-width: calc\(100% - 28px\);[^}]*transform: translateX\(-50%\);/,
    );
    expect(BOARD_CSS).not.toContain("top: auto;\n    bottom: 14px;\n    left: 50%;");
  });
});
