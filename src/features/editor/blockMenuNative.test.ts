/**
 * 「块操作菜单只用内核原生命令」的护栏（260917）。
 *
 * 背景：菜单动作曾走 vendor `utils/blockDoc` 的整篇 JSON 读改写（`getDocument('json')` →
 * 改树 → `setDocument('json')`）。本仓库实测该路径会重写自定义卡（思维导图卡载荷
 * 634B→8859B）并抹掉内核未注册的卡（board-card），因此全面改用内核原生命令。
 *
 * vitest 跑在 node 环境、起不了内核，所以这里做**源码级**断言（与 cssLayers/settingsSearch
 * 的围栏同一套路）：一旦有人把 JSON 路径或非白名单动作加回菜单，测试直接失败。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const HANDLE_SRC = read("../../../vendor/lakex-doc-react/src/components/BlockHoverHandle/BlockHoverHandle.tsx");
const HELPERS_SRC = read("../../../vendor/lakex-doc-react/src/components/BlockHoverHandle/blockMenuHelpers.ts");
const MENU_SRC = read("../../../vendor/lakex-doc-react/src/components/BlockContextMenu/BlockContextMenu.tsx");
const HANDLE_CSS = read("../../../vendor/lakex-doc-react/src/components/BlockHoverHandle/BlockHoverHandle.css");

/** blockDoc 的「整篇 JSON 读改写」函数：任何一处被调用都会毁自定义卡。 */
const JSON_PATH_FNS = ["moveBlock", "deleteBlock", "duplicateBlock", "convertBlock", "insertBlock"];

describe("块操作菜单：禁走整篇 JSON 读改写", () => {
  it("手柄动作里不存在 blockDoc 的 JSON 函数调用", () => {
    for (const fn of JSON_PATH_FNS) {
      expect(HANDLE_SRC, `${fn}() 不得出现在手柄动作里`).not.toMatch(new RegExp(`\\b${fn}\\(`));
    }
  });

  it("手柄动作改用内核原生命令实现（删除/插入/转化/拖拽移动）", () => {
    expect(HANDLE_SRC).toMatch(/deleteBlockByRange\(/);
    expect(HANDLE_SRC).toMatch(/insertBlockNative\(/);
    expect(HANDLE_SRC).toMatch(/runNativeConvert\(/);
    expect(HANDLE_SRC).toMatch(/moveBlockNative\(/);
  });

  it("拖拽移动走内核原生路径（moveCard / 读-插-删），不走 blockDoc JSON", () => {
    expect(HELPERS_SRC).toMatch(/export function moveBlockNative\(/);
    expect(HELPERS_SRC).toMatch(/execCommand\("moveCard"/);
    for (const fn of JSON_PATH_FNS) {
      expect(HELPERS_SRC, `${fn}() 不得出现在块操作辅助函数里`).not.toMatch(new RegExp(`\\b${fn}\\(`));
    }
  });

  it("删除与插入经内核原生命令（且不触碰 blockDoc 的 JSON 函数）", () => {
    expect(HELPERS_SRC).toMatch(/execCommand\("deleteByRange"/);
    expect(HELPERS_SRC).toMatch(/execCommand\("breakLine"\)/);
    for (const fn of JSON_PATH_FNS) {
      expect(HELPERS_SRC, `${fn}() 不得出现在块操作辅助函数里`).not.toMatch(new RegExp(`\\b${fn}\\(`));
    }
  });
});

describe("块操作菜单：白名单收敛", () => {
  const whitelist = (() => {
    const matched = /SAFE_BLOCK_ACTIONS: readonly BlockMenuAction\[\] = \[([^\]]*)\]/.exec(MENU_SRC);
    return (matched?.[1] ?? "").match(/'[a-zA-Z]+'/g)?.map((token) => token.slice(1, -1)) ?? [];
  })();

  it("白名单就是「内核有原生命令」的那些动作", () => {
    expect(whitelist.sort()).toEqual(["addAfter", "convert", "copy", "cut", "delete", "indent", "outdent"]);
  });

  it("只有 JSON 实现的动作不上菜单", () => {
    for (const action of ["duplicate", "addBefore", "paste", "selectBlock", "copyLink"]) {
      expect(whitelist, `${action} 不在白名单`).not.toContain(action);
    }
    expect(HANDLE_SRC).not.toMatch(/case 'duplicate'/);
    expect(HANDLE_SRC).not.toMatch(/case 'copyLink'/);
  });

  it("菜单按白名单过滤，且「在下方添加」不再走插卡路径", () => {
    expect(MENU_SRC).toMatch(/SAFE_BLOCK_ACTION_SET\.has\(item\.action\)/);
    // 块卡菜单要按内部 data-card-name 区分（图表类不给「转化为」）
    expect(MENU_SRC).toMatch(/function getBlockMenuKey\(/);
    expect(MENU_SRC).toMatch(/alias\[name\] \|\| 'ne-card'/);
    // default 菜单不得含「转化为」
    const defBlock = /'default': \(\) => \[([\s\S]*?)\n  \],/.exec(MENU_SRC);
    expect(defBlock?.[1] ?? '').not.toMatch(/action: 'convert'/);
    expect(MENU_SRC).not.toMatch(/item\.action === 'addAfter' \? 'cardSelect'/);
  });

  it("容器/卡片类走「保留内容」的官方插入通道（getNodeContent + insertAtSelection）", () => {
    expect(HELPERS_SRC).toMatch(/convertBlockPreservingContent\(/);
    expect(HELPERS_SRC).toMatch(/execCommand\("getNodeContent", id, format\)/);
    expect(HELPERS_SRC).toMatch(/execCommand\("insertAtSelection", "text\/lake", data\)/);
    // 三种容器的 lake 外壳必须齐备（内核靠这些 class 识别节点）
    expect(HELPERS_SRC).toMatch(/lake-alert/);
    expect(HELPERS_SRC).toMatch(/lake-columns/);
    expect(HELPERS_SRC).toMatch(/lake-collapse/);
  });

  it("代码块按「完整展示」的卡片 value 生成（不带 hideToolbar，保留 mode 位）", () => {
    expect(MENU_SRC).toMatch(/value: 'codeblock'/);
    expect(HELPERS_SRC).toMatch(/function codeblockCardHtml\(/);
    expect(HELPERS_SRC).toMatch(/name="codeblock"/);
    // 不得再走 markdown 围栏：它会写 hideToolbar:true / mode:'plain'，隐藏工具栏与代码名称
    expect(HELPERS_SRC).not.toMatch(/text\/markdown/);
  });

  it("源块含卡片时抽取文本（避免把卡片嵌进容器被内核丢弃）", () => {
    expect(HELPERS_SRC).toMatch(/function readSourceBlock\(/);
    expect(HELPERS_SRC).toMatch(/function textToParagraphHtml\(/);
    expect(HELPERS_SRC).toMatch(/convertToTextBlock\(/);
    // 引用/列表对卡片源无效 ⇒ 也必须先抽取文本再执行内核命令
    expect(HELPERS_SRC).toMatch(/convertToNativeBlock\(/);
    // 容器源（高亮块/分栏/折叠块/引用）同样要抽取，避免「容器套容器」
    expect(HELPERS_SRC).toMatch(/CONTAINER_TAGS/);
  });
});

describe("块操作菜单：列表父项 = 一个整块（Issue 3）", () => {
  it("用 ne-level 计算「父项 + 子项」整段（不读整篇 JSON）", () => {
    expect(HELPERS_SRC).toMatch(/export function blockSpanElements\(/);
    // 列表层级由内核渲染在 ne-level 上；子项 = 紧随其后、层级更大的同族项
    expect(HELPERS_SRC).toMatch(/getAttribute\("ne-level"\)/);
    expect(HELPERS_SRC).toMatch(/listItemLevel\(sibling\) > baseLevel/);
  });

  it("整段选取走跨元素 outer range（setStartBefore/setEndAfter）", () => {
    expect(HELPERS_SRC).toMatch(/function spanDomRange\(/);
    expect(HELPERS_SRC).toMatch(/setStartBefore\(span\[0\]\)/);
    expect(HELPERS_SRC).toMatch(/setEndAfter\(span\[span\.length - 1\]\)/);
    expect(HELPERS_SRC).toMatch(/export function selectBlockSpanInEditor\(/);
  });

  it("读取/转化/删除/复制/移动都按整段处理", () => {
    // 列表父项的内容必须用整块选区 + getSelectionContent（getNodeContent(id) 只有父项那行）
    expect(HELPERS_SRC).toMatch(/blockSpanElements\(blockElement\)\.length > 1/);
    expect(HELPERS_SRC).toMatch(/execCommand\("getSelectionContent", format\)/);
    // 替换/改样式前的选中口径
    expect(HELPERS_SRC).toMatch(/function selectWholeBlockForEdit\(/);
    // 删除 / 复制 / 移动都引用整段
    expect(HELPERS_SRC).toMatch(/const span = blockSpanElements\(blockElement\)/);
    expect(HELPERS_SRC).toMatch(/const sourceSpan = blockSpanElements\(sourceEl\)/);
    expect(HELPERS_SRC).toMatch(/spanDomRange\(span\)/);
  });

  it("手柄高亮与拖拽预览覆盖整段", () => {
    expect(HANDLE_SRC).toMatch(/blockSpanElements,/);
    expect(HANDLE_SRC).toMatch(/blockSpanElements\(hoverStateRef\.current\.blockElement\)/);
    expect(HANDLE_SRC).toMatch(/const draggedSpan = blockSpanElements\(draggedEl\)/);
    expect(HANDLE_SRC).toMatch(/draggedSpan\.includes\(targetBlock\)/);
  });
});

describe("块操作菜单：多块选区 / 批量操作（Issue 4）", () => {
  it("用 DOM 选区识别多块选区（≥2 顶层块，且不属于同一列表父项整段）", () => {
    expect(HELPERS_SRC).toMatch(/export function selectedTopBlocks\(/);
    expect(HELPERS_SRC).toMatch(/export function hasMultiBlockSelection\(/);
    // 261004 改为按「选区端点 → 首/末块索引」的 O(选区跨度) 取块（不再逐块 intersectsNode）
    expect(HELPERS_SRC).toMatch(/const childIndex = \(node: Node \| null\): number =>/);
    expect(HELPERS_SRC).toMatch(/range\.startContainer === container \? range\.startOffset/);
    expect(HELPERS_SRC).toMatch(/TOP_BLOCK_TAGS/);
  });

  it("批量动作按「当前整段选区」走内核命令，不逐块搬运", () => {
    expect(HELPERS_SRC).toMatch(/function currentSelectionRange\(/);
    expect(HELPERS_SRC).toMatch(/function runMultiBlockConvert\(/);
    // 仍是内核命令，一次调用作用于整个选区
    expect(HELPERS_SRC).toMatch(/execCommand\("getSelectionContent", format\)/);
    expect(HELPERS_SRC).toMatch(/execCommand\("deleteByRange"/);
    expect(HELPERS_SRC).toMatch(/execCommand\("insertAtSelection"/);
  });

  it("手柄聚合到首块 + 选区还原（点手柄会让编辑区失焦、清掉选区）", () => {
    expect(HELPERS_SRC).toMatch(/export function selectBlocksInEditor\(/);
    expect(HANDLE_SRC).toMatch(/multiSelectionRef/);
    expect(HANDLE_SRC).toMatch(/selectedTopBlocks\(\)/);
    expect(HANDLE_SRC).toMatch(/selectBlocksInEditor\(editor, multi\)/);
    expect(HANDLE_SRC).toMatch(/multiSelectionRef\.current = blocks/);
  });
});

describe("块操作菜单：删除/拖拽不留空行 + 手柄不压项目符号（260918 用户实测）", () => {
  /** moveBlockNative 的函数体（截到下一个 export 前），用于「不得回退到旧写法」的断言。 */
  const moveBody = (() => {
    const i = HELPERS_SRC.indexOf("export function moveBlockNative(");
    const j = HELPERS_SRC.indexOf("\nexport function", i + 10);
    return HELPERS_SRC.slice(i, j < 0 ? undefined : j);
  })();

  it("整块删除走内核「模型事务」摘节点，而不是只删内容的 deleteByRange", () => {
    // deleteByRange 覆盖根级整块时内核会在原位补一个空段落（顶层块数不变、空段落 +1）——
    // 用户实测症状：菜单删除/剪切/拖拽每次都多留一条空行。
    expect(HELPERS_SRC).toMatch(/function removeBlockNodesNative\(/);
    // 命令上下文 = kernel._model.editing（与内核 deleteAlert/deleteCollapse/deleteCard 同款）
    expect(HELPERS_SRC).toMatch(/_model\?\.editing/);
    expect(HELPERS_SRC).toMatch(/job\.getNodeById/);
    expect(HELPERS_SRC).toMatch(/job\.removeChild\(/);
    expect(HELPERS_SRC).toMatch(/commitJob\(/);
    // 菜单「删除 / 剪切」优先走节点级删除
    expect(HELPERS_SRC).toMatch(/if \(removeBlockNodesNative\(editor, targets\)\) return true;/);
  });

  it("拖拽先摘源节点、再按「删除后」的目标位置插入（落点索引不漂移）", () => {
    expect(moveBody).toMatch(/removeBlockNodesNative\(editor, sourceSpan\)/);
    // 不得回退到「先插后删 + deleteByRange」的老路径
    expect(moveBody).not.toMatch(/deleteByRange/);
    expect(moveBody).not.toMatch(/sourceRange/);
    const removeAt = moveBody.indexOf("removeBlockNodesNative(editor, sourceSpan)");
    const dropAt = moveBody.indexOf("dropPositionOf(editor, targetNow, before)");
    expect(removeAt).toBeGreaterThan(-1);
    expect(dropAt).toBeGreaterThan(removeAt);
  });

  it("列表手柄锚在项目符号（marker）左侧，而不是内容左缘", () => {
    // 贴内容左缘会把手柄正好画在符号上（实测 icon 中心落在 marker 内 16px）；
    // 贴外层 ne-tli 的 left 又会让三级项手柄落到最左。
    expect(HANDLE_SRC).toMatch(/ne-uli-i, ne-oli-i, ne-tli-i/);
    expect(HANDLE_SRC).toMatch(/const anchorEl = marker \|\| content;/);
    expect(HANDLE_SRC).toMatch(/anchorLeft = anchorEl\.getBoundingClientRect\(\)\.left/);
  });
});

describe("块编辑：引用内块独立 / 引用内转化为裁剪 / 顶对齐 / 选中样式（261004 云端 Edge 实测）", () => {
  it("引用不是结构块：引用内非首块各自出柄（NE-QUOTE 移出 STRUCTURAL）", () => {
    const structural = /const STRUCTURAL_BLOCK_TAGS = \[([\s\S]*?)\] as const;/.exec(HANDLE_SRC)?.[1] ?? "";
    expect(structural).not.toMatch(/NE-QUOTE/);
  });

  it("引用首个子块 → 整个引用的合并手柄（父块上提保留）", () => {
    expect(HANDLE_SRC).toMatch(/parent\.firstElementChild\?\.id === el\.id/);
  });

  it("取消引用：目标为「引用」且当前是引用时走 unwrap（引用项回显 → 点一下取消）", () => {
    expect(HELPERS_SRC).toMatch(/function unwrapQuote\(/);
    expect(HELPERS_SRC).toMatch(/target === "quote" && \(blockElement\.tagName \|\| ""\)\.toUpperCase\(\) === "NE-QUOTE"/);
    expect(MENU_SRC).toMatch(/'ne-quote': 'quote'/);
    // 含列表的引用不能被误判成 ol/ul（261004 实测 bug）
    expect(MENU_SRC).toMatch(/const isListItem = tagName === 'NE-ULI' \|\| tagName === 'NE-OLI' \|\| tagName === 'NE-TLI';/);
    expect(MENU_SRC).toMatch(/if \(blockElement && isListItem\)/);
  });

  it("手柄顶对齐块首行（不再按块高垂直居中）", () => {
    expect(HANDLE_SRC).toMatch(/LOCAL-CHANGE\(261004\)：手柄\*\*顶对齐块首行\*\*/);
    expect(HANDLE_SRC).not.toMatch(/blockRect\.height - handleSize\) \/ 2/);
    expect(HANDLE_SRC).toMatch(/top: [^\n]*blockRect\.top\}px/);
  });

  it("块编辑只在触达块句柄时触发：selectionchange 不扫描/不高亮，多块判定在 mousemove", () => {
    const selBody = /const onSelectionChange = \(\) => \{([\s\S]*?)\n    \};/.exec(HANDLE_SRC)?.[1] ?? "";
    expect(selBody, "selectionchange 不得扫描块选区").not.toMatch(/selectedTopBlocks\(/);
    expect(selBody, "selectionchange 不得高亮").not.toMatch(/setBlockHighlight\(true\)/);
    // 多块判定挪到「松开按键的普通移动」；拖选中（buttons!==0）不扫描，避免拖垮跨行选择
    expect(HANDLE_SRC).toMatch(/if \(e\.buttons === 0\) \{[\s\S]*?selectedTopBlocks\(\)/);
  });

  it("「转化为」整体内联到第一级且沿用原样式（261004 用户要求）", () => {
    expect(MENU_SRC).toMatch(/ne-block-convert-submenu ne-block-convert-inline/);
    expect(MENU_SRC).toMatch(/ne-block-convert-item--/);
  });

  it("引用内「转化为」裁掉 代码块/引用/分栏/折叠（对齐云端图 2 的 11 项）", () => {
    expect(MENU_SRC).toMatch(/QUOTE_HIDDEN_CONVERT_VALUES = new Set\(\['codeblock', 'quote', 'columns', 'collapse'\]\)/);
    expect(MENU_SRC).toMatch(/function isInsideQuote\(/);
    expect(MENU_SRC).toMatch(/QUOTE_HIDDEN_CONVERT_VALUES\.has\(subItem\.value/);
  });

  it("多块选区识别到引用内部的 brick（块容器 = 同一引用）", () => {
    expect(HELPERS_SRC).toMatch(/function blockContainerOfRange\(/);
    expect(HELPERS_SRC).toMatch(/closest\("ne-quote"\)/);
  });

  it("选中样式覆盖所有行级块且补段间距（261004 用户口径：不留行间隙）", () => {
    expect(HANDLE_CSS).toMatch(/\.ne-engine \.ne-brick-highlight \{/);
    expect(HANDLE_CSS).toMatch(/box-shadow: 0 var\(--ln-brick-hl-extend, 0px\) 0 0 var\(--lakex-editor-background-focus\)/);
    expect(HANDLE_SRC).toMatch(/--ln-brick-hl-extend/);
    expect(HANDLE_CSS).toMatch(/--lakex-editor-background-focus/);
  });

  it("选中样式必须可清理：跨选区不残留（261004 用户实测 bug）", () => {
    // 用 highlightedRef 记录已高亮节点，每次 setBlockHighlight 先全清再重记。
    expect(HANDLE_SRC).toMatch(/highlightedRef/);
    expect(HANDLE_SRC).toMatch(/for \(const node of highlightedRef\.current\) \{/);
    expect(HANDLE_SRC).toMatch(/node\.classList\.remove\('ne-brick-highlight'\)/);
    expect(HANDLE_SRC).toMatch(/node\.style\.removeProperty\('--ln-brick-hl-extend'\)/);
  });
});