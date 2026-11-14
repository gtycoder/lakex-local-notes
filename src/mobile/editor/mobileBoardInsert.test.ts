import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const DOCK = read("./EditorDock.tsx");
const BOARD_CORE = read("../../../vendor/lakex-doc-react/src/cards/DrawingBoard/DrawnixBoardCore.tsx");
const BOARD_CSS = read("../../../vendor/lakex-doc-react/src/cards/DrawingBoard/DrawnixBoardCore.css");
const EDIT_SURFACE_KERNEL_CSS = read("./edit-surface-kernel.css");
const DESKTOP_FEATURE_CSS = read("../../styles/feature.css");

describe("移动端文档内画板族插入（261019 P0）", () => {
  it("4 类 Drawnix 卡片有插入动作；文本绘图不在本批解禁", () => {
    expect(DOCK).toContain('insertBoardCard("drawing-board", "drawing")');
    expect(DOCK).toContain('insertBoardCard("flowchart-board", "flowchart")');
    expect(DOCK).toContain('insertBoardCard("uml-board", "uml")');
    expect(DOCK).toContain('insertBoardCard("drawing-mindmap-board", "mindmap")');
    // 261114：文本绘图解禁（同一个 customBlock 入口；卡注册名 = text-to-diagram）。
    expect(DOCK).toMatch(/\{ label: "文本绘图", run: \(\) => runPanel\("insertCard", "customBlock", \{ \$name: "text-to-diagram"/);
    expect(DOCK).toContain("MERMAID_DEFAULT_VALUE");
    // 文本绘图卡在移动端必须上下分栏（桌面左右分栏在 370px 卡里会撑破右边缘）。
    expect(EDIT_SURFACE_KERNEL_CSS).toMatch(/\.text-to-diagram-panels \{ flex-direction: column; \}/);
    expect(EDIT_SURFACE_KERNEL_CSS).toMatch(/\.text-to-diagram-toolbar \{ flex-wrap: wrap;/);
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

  it("文档内嵌画板卡：工具条固定为卡内左侧竖向轨，不再被裁成卡顶横轨（261114 用户图1）", () => {
    // 成因：移动端无 @layer ⇒ 依赖包 `.drawnix .draw-toolbar{top:36px;left:50%;transform:translate(-50%)}`
    // 与内核同特异性且后加载（内核样式在 DocumentEditor chunk、drawnix 在画板懒 chunk）⇒ 卡内创建栏
    // 被切成横轨、11 项撑到 ~590px 被卡边裁掉。两端都必须显式钉回竖向轨。
    for (const css of [EDIT_SURFACE_KERNEL_CSS, DESKTOP_FEATURE_CSS]) {
      expect(css).toMatch(/ne-card\[data-card-name\] \.lakex-drawnix-core \.draw-toolbar \{[^}]*top: 50%;[^}]*left: 18px;[^}]*transform: translateY\(-50%\);[^}]*overflow-y: auto;/);
      expect(css).toMatch(/ne-card\[data-card-name\] \.lakex-drawnix-core \.draw-toolbar \.stack_horizontal \{[^}]*grid-auto-flow: row;/);
      expect(css).toMatch(/ne-card\[data-card-name\] \.lakex-drawnix-core \.draw-toolbar \.tool-icon > input \{[^}]*position: absolute;/);
    }
    // 卡片是自定义元素（没有 .ne-card 类）：选择器写错会静默不生效。
    expect(EDIT_SURFACE_KERNEL_CSS).not.toMatch(/body\.lake-mobile \.ne-card /);
  });
