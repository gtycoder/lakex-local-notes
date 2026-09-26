/**
 * 多维表编辑器挂载/路由护栏（260920）。
 *
 * vitest 是 node 环境，起不了真实 DOM 网格；用源码级断言锁死三条易回归的集成约束
 * （与 sheetEditorMount.test.ts / blockMenuNative.test.ts 同套路）：
 * - MultiTabEditor 必须按 kind 路由到 BitableEditor（否则多维表会被 Lake 编辑器打开 = 毁正文）；
 * - BitableEditor 不引用 Lake 内核编辑器/运行时；
 * - 只读态禁用编辑 + 不自动保存；自动保存有防抖 + 与上次序列化比较。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const EDITOR = readFileSync(new URL("./BitableEditor.tsx", import.meta.url), "utf8");
const TABS = readFileSync(new URL("../editor/MultiTabEditor.tsx", import.meta.url), "utf8");
const DOC = readFileSync(new URL("../../core/bitableDoc.ts", import.meta.url), "utf8");
const CARDS = readFileSync(new URL("./bitableCells.tsx", import.meta.url), "utf8");
const ATTACH = readFileSync(new URL("../attachment/openAssetEntry.ts", import.meta.url), "utf8");
const CSS = readFileSync(new URL("./bitableEditor.css", import.meta.url), "utf8");

describe("多维表编辑器护栏", () => {
  it("附件格的缩略图：格子取 ?w= 档位，放大预览仍走原图", () => {
    // 格子显示 26px 却会解码整张原图（手机照片 4000×3000 = 48MB 位图）
    expect(CARDS).toContain("assetThumbWidthForCss(ATTACHMENT_CHIP_PX)");
    expect(CARDS).toContain('const ATTACHMENT_CHIP_PX = 26');
    expect(CARDS).toContain("withAssetWidth(");
    // 关键不变量：onOpen（ImageLightbox）那一路不能被带上档位，否则放大预览是糊的
    expect(CARDS).toMatch(/<img src=\{chipUrlOf\(file\)\}[^>]*onClick=\{\(\) => onOpen\(\{ file, name \}\)\}/);
    expect(EDITOR).not.toContain("?w=");
  });

  it("行单元格：行高绝对控制（不许换行）、行内无删除叉号、点一下即选中出加号", () => {
    // 行高由 --bt-row-h 决定；行内任何类型换行都会把整行撑高 ⇒ 一律单行 + 裁切
    expect(CSS).toMatch(/\.bt-td \{[^}]*overflow: hidden/);
    expect(CSS).toMatch(/\.bt-td \.bt-option-label,[\s\S]*?flex-wrap: nowrap/);
    expect(CSS).toMatch(/\.bt-td \.bt-attachment-cell,[\s\S]*?overflow: hidden/);
    // 行内不再有逐条删除（删除只在展开面板的卡片右上角）
    expect(CARDS).not.toContain("bt-attachment-remove");
    expect(CSS).not.toContain(".bt-attachment-remove");
    // 两者必须区分：点图片(chip) 只预览、不选中；点「⤢ 展开」= 选中单元格（加号出来）
    expect(CARDS).toMatch(/closest\("\.bt-attachment-chip"\)\)\s*return/);
    expect(CARDS).toMatch(/bt-expand-btn[\s\S]{0,600}?setActive\(true\)/);
  });
  it("MultiTabEditor 按 kind=bitable 懒加载 BitableEditor", () => {
    expect(TABS).toMatch(/tab\.kind === "bitable"/);
    expect(TABS).toMatch(/import\("\.\.\/bitable\/BitableEditor"\)/);
    expect(TABS).toMatch(/<BitableEditor/);
  });

  it("BitableEditor 不引用 Lake 内核（正文不是 Lake HTML）", () => {
    expect(EDITOR).not.toMatch(/from "\.\.\/editor\/EditorTab"/);
    expect(EDITOR).not.toMatch(/lakeRuntime|createLakeDocument|EditorTab/);
  });

  it("一个文档多张数据表：渲染 doc.tables 列表", () => {
    expect(EDITOR).toMatch(/doc\.tables\.map/);
    expect(DOC).toMatch(/tables: BitableTable\[\]/);
  });

  it("只读态：不自动保存，编辑入口禁用", () => {
    expect(EDITOR).toMatch(/if \(readOnly\) return;/);
    expect(EDITOR).toMatch(/disabled=\{readOnly\}/);
  });

  it("自动保存：防抖 + 与上次序列化比较（避免打开即标脏）", () => {
    expect(EDITOR).toMatch(/AUTOSAVE_DEBOUNCE_MS/);
    expect(EDITOR).toMatch(/lastSerializedRef/);
    expect(EDITOR).toMatch(/bitablesToBody/);
  });

  it("字段默认值：新建记录 / 表单用 defaultRecordValues 预填", () => {
    expect(EDITOR).toMatch(/defaultRecordValues/);
    expect(DOC).toMatch(/export function defaultRecordValues/);
  });

  it("列顺序是视图级配置（拖拽列改 fieldOrder，不动全局字段顺序）", () => {
    expect(EDITOR).toMatch(/reorderVisibleFields/);
    expect(EDITOR).not.toMatch(/reorderFields\(/);
  });

  it("文本单元格：「扩大」按钮 + 贴单元格可拖动/缩放浮窗", () => {
    expect(CARDS).toMatch(/bt-expand-btn/);
    expect(CARDS).toMatch(/TextExpandPopover/);
    expect(CARDS).toMatch(/startDrag/);
    expect(CARDS).toMatch(/startResize/);
  });

  it("云端对齐：行手柄拖拽 + 数据表列表可调可收 + 无批量浮条 + 右键删除", () => {
    expect(EDITOR).toMatch(/bt-row-grip/);
    expect(EDITOR).toMatch(/startRowDrag/);
    expect(EDITOR).toMatch(/bt-tables-resize/);
    expect(EDITOR).toMatch(/tablesCollapsed/);
    expect(EDITOR).not.toMatch(/bt-batch-bar/);
    expect(EDITOR).toMatch(/setRowCtx/);
  });

  it("云端对齐二：列选择/列宽拖拽/范围复制粘贴/日期选择器/视图拖拽/全收起切换/去非 doc 面包屑", () => {
    expect(EDITOR).toMatch(/bt-col-resize/);
    expect(EDITOR).toMatch(/startColumnResize/);
    expect(EDITOR).toMatch(/cell-selected/);
    expect(EDITOR).toMatch(/copySelection/);
    expect(EDITOR).toMatch(/reorderViews/);
    expect(EDITOR).toMatch(/bt-tables-switch/);
    expect(CARDS).toMatch(/DatePicker/);
    expect(TABS).toMatch(/tabs\.find\(\(t\) => t\.noteId === activeNoteId\)\?\.kind \?\? "doc"\) === "doc" && breadcrumb/);
  });

  it("云端对齐三：自定义下拉/选项颜色/视图图标/行高去自定义", () => {
    expect(EDITOR).toMatch(/SelectMenu/);
    expect(EDITOR).toMatch(/BITABLE_OPTION_COLORS/);
    expect(EDITOR).toMatch(/bt-view-icon/);
    expect(EDITOR).not.toMatch(/bt-menu-custom/);
    expect(CARDS).toMatch(/SelectMenu/);
    expect(DOC).toMatch(/BITABLE_OPTION_COLORS/);
  });

  it("云端对齐四：选项色卡/拖拽/自研下拉/默认值日期", () => {
    expect(EDITOR).toMatch(/ColorPalette/);
    expect(EDITOR).toMatch(/bt-color-square/);
    expect(EDITOR).toMatch(/optionDragId/);
    expect(EDITOR).toMatch(/DatePicker/);
    expect(CARDS).toMatch(/ColorPalette/);
    expect(DOC).toMatch(/BITABLE_OPTION_PALETTE/);
  });

  it("附件打开走公共入口（图片 Lightbox / 音视频内嵌 / 其它系统）", () => {
    expect(EDITOR).toMatch(/openAssetEntry/);
    expect(EDITOR).toMatch(/AttachmentPreview/);
    expect(EDITOR).toMatch(/ImageLightbox/);
    expect(ATTACH).toMatch(/openImagePreview/);
    expect(ATTACH).toMatch(/openAttachmentPreview/);
    expect(ATTACH).toMatch(/isMediaFilename/);
  });

  it("v1 视图只暴露 表格 + 表单 两种", () => {
    expect(EDITOR).toMatch(/addView\("grid"\)/);
    expect(EDITOR).toMatch(/addView\("form"\)/);
    expect(EDITOR).not.toMatch(/看板|kanban|gallery|日历/);
  });
});
