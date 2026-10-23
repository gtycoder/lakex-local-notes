/**
 * 多维表编辑器挂载/路由护栏（260920）。
 *
 * vitest 是 node 环境，起不了真实 DOM 网格；用源码级断言锁死三条易回归的集成约束
 * （与 sheetEditorMount.test.ts / blockMenuNative.test.ts 同套路）：
 * - MultiTabEditor 必须按 kind 路由到 BitableEditor（否则多维表会被 Lake 编辑器打开 = 毁正文）；
 * - BitableEditor 不引用 Lake 内核编辑器/运行时；
 * - 只读态禁用编辑 + 不自动保存；自动保存有防抖 + 与上次序列化比较。
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const EDITOR = readFileSync(new URL("./BitableEditor.tsx", import.meta.url), "utf8");
const VIEWPORT_CELL = readFileSync(new URL("./BitableViewportCell.tsx", import.meta.url), "utf8");
const SESSION = readFileSync(new URL("./useBitableSession.ts", import.meta.url), "utf8");
const APP = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const MOBILE_APP = readFileSync(new URL("../../mobile/MobileApp.tsx", import.meta.url), "utf8");
const TABS = readFileSync(new URL("../editor/MultiTabEditor.tsx", import.meta.url), "utf8");
const EDITOR_TAB = readFileSync(new URL("../editor/LakeEditor.tsx", import.meta.url), "utf8");
const DOC = readFileSync(new URL("../../core/bitableDoc.ts", import.meta.url), "utf8");
const MUTATIONS = readFileSync(new URL("../../core/bitableMutations.ts", import.meta.url), "utf8");
const CARDS = readFileSync(new URL("./bitableCells.tsx", import.meta.url), "utf8");
// 261008：统一选色盘（组件 + 样式）移到了共用位置，逐条断言跟着改指向
const SHARED_PALETTE = readFileSync(new URL("../../components/ui/ColorPalette.tsx", import.meta.url), "utf8");
const PALETTE_CSS = readFileSync(new URL("../../components/ui/colorPalette.css", import.meta.url), "utf8");
const PICKER = readFileSync(new URL("./BitableRelationPicker.tsx", import.meta.url), "utf8");
const FILTER_EDITOR = readFileSync(new URL("./BitableFilterEditor.tsx", import.meta.url), "utf8");
const FILTER_CSS = readFileSync(new URL("./bitableFilterEditor.css", import.meta.url), "utf8");
const FILL_EDITOR = readFileSync(new URL("./BitableFillEditor.tsx", import.meta.url), "utf8");
const FILL_CSS = readFileSync(new URL("./bitableFillRules.css", import.meta.url), "utf8");
const PICKER_CSS = readFileSync(new URL("./bitableRelationPicker.css", import.meta.url), "utf8");
const ASSET_URL = readFileSync(new URL("./bitableAssetUrl.ts", import.meta.url), "utf8");
const FILE_ICON = readFileSync(new URL("./FileKindIcon.tsx", import.meta.url), "utf8");
const FILE_ICON_CSS = readFileSync(new URL("./bitableFileIcon.css", import.meta.url), "utf8");
const AI_HOOK = readFileSync(new URL("./useAiFieldGeneration.ts", import.meta.url), "utf8");
const AI_DIALOG = readFileSync(new URL("./BitableAiGenerateDialog.tsx", import.meta.url), "utf8");
const AI_CSS = readFileSync(new URL("./bitableAiField.css", import.meta.url), "utf8");
const CSV = readFileSync(new URL("../../core/bitableCsv.ts", import.meta.url), "utf8");
const DRAWER = readFileSync(new URL("./BitableRecordDrawer.tsx", import.meta.url), "utf8");
const BAR = readFileSync(new URL("./BitableViewBar.tsx", import.meta.url), "utf8");
const VIEWS = readFileSync(new URL("./bitableViews.tsx", import.meta.url), "utf8");
const VIEWCSS = readFileSync(new URL("./bitableViews.css", import.meta.url), "utf8");
const VIEWPORT_CSS = readFileSync(new URL("./bitableViewport.css", import.meta.url), "utf8");
const KANBAN = readFileSync(new URL("./BitableKanbanView.tsx", import.meta.url), "utf8");
const GALLERY = readFileSync(new URL("./BitableGalleryView.tsx", import.meta.url), "utf8");
const CALENDAR = readFileSync(new URL("./BitableCalendarView.tsx", import.meta.url), "utf8");
const PANELS = readFileSync(new URL("./BitableViewConfigPanels.tsx", import.meta.url), "utf8");
const FORM = readFileSync(new URL("./BitableFormView.tsx", import.meta.url), "utf8");
const MOBILE = readFileSync(new URL("../../mobile/bitable/MobileBitableViewer.tsx", import.meta.url), "utf8");
const PREVIEW = readFileSync(new URL("../editor/imagePreview.ts", import.meta.url), "utf8");
const KANBAN_CSS = readFileSync(new URL("./bitableKanbanView.css", import.meta.url), "utf8");
const ATTACH_CTRL = readFileSync(new URL("../attachment/attachmentPreviewController.ts", import.meta.url), "utf8");
const ATTACH = readFileSync(new URL("../attachment/openAssetEntry.ts", import.meta.url), "utf8");
const CSS = readFileSync(new URL("./bitableEditor.css", import.meta.url), "utf8");
const FIELD_CSS = readFileSync(new URL("./bitableFieldCells.css", import.meta.url), "utf8");
const POS = readFileSync(new URL("../../hooks/topMenuPosition.ts", import.meta.url), "utf8");
const HOOK = readFileSync(new URL("../../hooks/usePopoverPosition.ts", import.meta.url), "utf8");
const CHROME = readFileSync(new URL("../../../src/styles/chrome.css", import.meta.url), "utf8");

describe("多维表编辑器护栏", () => {
  it("附件格的缩略图：格子取 ?w= 档位，放大预览仍走原图", () => {
    // 格子显示 26px 却会解码整张原图（手机照片 4000×3000 = 48MB 位图）
    expect(CARDS).toContain("bitableAssetUrl(noteId, file, ATTACHMENT_CHIP_PX)");
    expect(CARDS).toContain('const ATTACHMENT_CHIP_PX = 26');
    // 资产 URL 只有一处实现（bitableAssetUrl）：单元格 / 看板 / 画册 / 关联选择器共用
    expect(ASSET_URL).toContain("assetThumbWidthForCss(cssPx)");
    expect(CARDS).toContain("bitableAssetUrl");
    // 关键不变量：onOpen（ImageLightbox）那一路不能被带上档位，否则放大预览是糊的
    // 点 chip = 预览「本单元格」的图片（openByFile 里再按单元格图片集合开 Lightbox），格子取 ?w= 档位
    expect(CARDS).toMatch(/<img src=\{chipUrlOf\(file\)\}[^>]*onClick=\{\(\) => openByFile\(file\)\}/);
    expect(EDITOR).not.toContain("?w=");
  });

  it("附件预览使用 Lake 卡片同口径的 size，不回退 0 B", () => {
    expect(DOC).toContain("size: number");
    // 260930：打开附件收敛到 openBitableAttachment（表格/选择器/看板共用那句），size 在那一处传
    expect(EDITOR).toMatch(/openBitableAttachment\(noteId, attachment\)/);
    expect(ASSET_URL).toMatch(/openAssetEntry\(bitableAssetUrl\(noteId, attachment\.file\), attachment\.name, attachment\.size, \{ kindFrom: attachment\.file \}\)/);
    expect(ASSET_URL).not.toMatch(/,\s*0,\s*\{\s*kindFrom/);
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

  it("附件格铺满整个单元格：有效区域 = 整格，光标一律手型（260928 用户报）", () => {
    // 行内附件格必须占满单元格（点击/粘贴/拖拽的命中区 = 整格），否则高行高下只剩中间一条可用
    expect(CSS).toMatch(/\.bt-td \.bt-attachment-cell \{[^}]*height: 100%/);
    expect(CSS).toMatch(/\.bt-td \.bt-attachment-editor \{[^}]*height: 100%/);
    // 编辑框**不自画边框/白底**（否则格子中间又浮出一个白盒子，四周空档就是用户说的「灰边框」）
    const editorBase = /^\.bt-attachment-editor \{([^}]*)\}$/m.exec(CSS)?.[1] ?? "";
    expect(editorBase).not.toMatch(/border|background/);
    // 光标统一：图片 chip 曾用 zoom-in（放大镜），与其他附件的手型不一致
    expect(CSS).toMatch(/\.bt-attachment-chip img \{[^}]*cursor: pointer/);
    expect(CSS).not.toContain("cursor: zoom-in");
  });

  it("展开面板改名：只改主名、扩展名固定（260928 用户：编辑名称不能改格式）", () => {
    expect(CARDS).toMatch(/bt-attach-card-rename-ext/);
    expect(CARDS).toMatch(/splitAttachmentName/);
    // 提交时把「输入框里的主名」+「原扩展名」拼回：输入框里永远改不到 `.xxx`
    expect(CARDS).toMatch(/onRename\(file, \(event\.currentTarget\.value\.trim\(\) \|\| base\) \+ ext\)/);
    expect(CSS).toMatch(/\.bt-attach-card-rename-input \{[^}]*field-sizing: content/);
  });

  it("选中单元格：不铺灰底，只画选区外缘的高亮边框（260928 用户）", () => {
    // 原来 .cell-selected 是 --lake-accent-tint 的整块底色 —— 用户明确不要
    expect(CSS).not.toMatch(/\.cell-selected \{[^}]*background:/);
    // 四边各一个自定义属性，靠 .cell-selected 那一条 box-shadow 合成（边框只画在选区外缘）
    expect(CSS).toMatch(/\.bt-grid \.bt-td\.cell-selected \{ box-shadow: var\(--bt-sel-t/);
    for (const edge of ["sel-top", "sel-bottom", "sel-left", "sel-right"]) {
      expect(CSS).toContain(`.bt-grid .bt-td.${edge}`);
    }
    expect(EDITOR).toMatch(/selectionEdgeClass/);
  });

  it("列菜单：列头右键也能开、四条快捷项彻底删除、文本颜色作为右侧子菜单（260930 用户）", () => {
    // 1) 列头右键 = 列菜单（坐标定位）
    expect(EDITOR).toMatch(/onContextMenu=\{\(event\) => \{[\s\S]{0,240}?openColumnMenu\(field\.id, event\.clientX, event\.clientY, event\.currentTarget\)/);
    expect(EDITOR).toMatch(/openColumnMenu\(/);
    // 2) 「按本列分组/按本列筛选/升序/降序」四条快捷项删除（工具栏已有分组/筛选/排序）
    for (const label of ["按本列分组", "按本列筛选", "升序</button>", "降序</button>"]) expect(EDITOR).not.toContain(label);
    // 3) 文本颜色是列菜单子项：锚到菜单行本身，右侧展开；选色后保持打开用于预览，直到点空白。
    expect(EDITOR).toMatch(/setTextColorFor\(\(current\) => current\?\.fieldId === fieldId \? null : \{ fieldId, anchor: event\.currentTarget \}\)/);
    expect(EDITOR).toMatch(/aria-haspopup="dialog"/);
    expect(EDITOR).toMatch(/side="right" closeOnPick=\{false\}/);
    expect(EDITOR).toMatch(/隐藏列<\/button>|隐藏列/);
    expect(EDITOR).toMatch(/toggleFieldHidden\(columnMenu\.fieldId\)/);
  });

  it("日期字段默认值三态：无 / 指定时间 / 添加记录时间（260928 用户）", () => {
    expect(EDITOR).toMatch(/dateMode/);
    expect(EDITOR).toMatch(/指定时间（选择日期）/);
    expect(EDITOR).toMatch(/添加记录时间（自动填创建日）/);
    expect(EDITOR).toMatch(/dateAutoFill/);
    expect(CSS).toMatch(/^\.bt-date-default \{/m);
    // 嵌套在「编辑字段」对话框里的日期面板要抬层（否则日历掉到弹窗下面）
    expect(readFileSync(new URL("../../styles/overlay.css", import.meta.url), "utf8"))
      .toMatch(/\.ln-overlay-surface\.ln-overlay-surface--raised \{ z-index: var\(--lake-z-overlay-menu-raised\)/);
  });

  it("序号列与其它单元格同底：白底而非灰块（260928 用户）", () => {
    expect(CSS).toMatch(/\.bt-th-index, \.bt-td-index \{ width: 80px; background: var\(--lake-bg-panel\)/);
    expect(CSS).not.toMatch(/\.bt-td-index \{[^}]*background: var\(--lake-bg-block\)/);
  });

  it("整行 hover 用更浅一档的面（260928 用户：行灰太深，浅一点）", () => {
    expect(CSS).toMatch(/\.bt-row:hover td \{ background: var\(--lake-bg-block\)/);
    // 按钮/菜单那种 hover 灰铺满整行太重，别退回 --lake-bg-hover
    expect(CSS).not.toMatch(/\.bt-row:hover td \{[^}]*--lake-bg-hover/);
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
    expect(EDITOR).toMatch(/useBitableSession/);
    expect(SESSION).toMatch(/AUTOSAVE_DEBOUNCE_MS/);
    expect(SESSION).toMatch(/lastSerializedRef/);
    expect(SESSION).toMatch(/bitablesToBody/);
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
    // 261008：面包屑下沉进**文档宿主**（EditorTab 是 doc-only）⇒ 天然只出现在 doc 栏；
    // MultiTabEditor 不再有全局面包屑，分屏时右端「更多」也不渲染（AI 只走浮窗）。
    const HOST = readFileSync(new URL("../editor/EditorTab.tsx", import.meta.url), "utf8");
    expect(HOST).toMatch(/className="protyle-breadcrumb"/);
    expect(HOST).toMatch(/protyle-breadcrumb__more/);
    expect(HOST).toMatch(/!split && \(focused \?\? visible\)/);
    expect(TABS).not.toMatch(/&& breadcrumb/);
    expect(TABS).not.toMatch(/breadcrumb\?: ReactNode/);
  });

  it("云端对齐三：自定义下拉/选项颜色/视图图标/行高去自定义", () => {
    expect(EDITOR).toMatch(/SelectMenu/);
    expect(EDITOR).toMatch(/BITABLE_OPTION_COLORS/);
    expect(BAR).toMatch(/bt-view-icon/);   // 视图页签已按职责拆到 BitableViewBar（V01）
    expect(EDITOR).not.toMatch(/bt-menu-custom/);
    expect(CARDS).toMatch(/SelectMenu/);
    expect(DOC).toMatch(/BITABLE_OPTION_COLORS/);
  });

  it("云端对齐四：选项色卡/拖拽/自研下拉/默认值日期", () => {
    expect(EDITOR).toMatch(/ColorPalette/);
    expect(EDITOR).toMatch(/bt-color-square/);
    expect(EDITOR).toMatch(/optionDragId/);
    expect(EDITOR).toMatch(/DatePicker/);
    expect(CARDS).toMatch(/export \{ ColorPalette, Popover \}/);
    expect(SHARED_PALETTE).toMatch(/export function ColorPalette/);
    expect(DOC).toMatch(/BITABLE_OPTION_PALETTE/);
    expect(SHARED_PALETTE).toMatch(/COLOR_BOARD_GROUPS/);
    expect(EDITOR).toMatch(/<ColorPalette anchor=\{textColorFor\.anchor\}[^>]*side="right" closeOnPick=\{false\}/);
    expect(EDITOR).toMatch(/recentKey="bitable-column-text"/);
    expect(EDITOR).toMatch(/recentKey="bitable-option"/);
    expect(EDITOR).toMatch(/recentKey="bitable-progress"/);
    expect(EDITOR).toMatch(/defaultLabel="默认色" defaultKind="text"/);
    expect(EDITOR).toMatch(/defaultLabel="无背景色" defaultKind="background"/);
    expect(SHARED_PALETTE).toMatch(/最近使用自定义颜色/);
    expect(SHARED_PALETTE).toMatch(/type="color"/);
    expect(SHARED_PALETTE).toMatch(/localStorage/);
    expect(PALETTE_CSS).toMatch(/\.bt-color-swatch \{[^}]*height: 22px/);
    expect(PALETTE_CSS).toMatch(/\.bt-color-recent \.bt-color-swatch \{[^}]*width: 22px/);
  });

  it("字段编辑弹窗：进度字段的颜色面板不被「选项编辑器」块吞掉（260929-OPT 修）", () => {
    // 真 bug：进度字段 supportsOptions=false，而颜色面板曾被写在 {supportsOptions && ...} 块内
    // ⇒ 点色块永远打不开面板。这里用源码顺序锁死：面板必须在「添加选项」按钮之后（bug 时在其前）。
    const optionsBtnIdx = EDITOR.indexOf("添加选项</button>");
    const progressPaletteIdx = EDITOR.indexOf("onPick={(color) => setProgressColor(color)}");
    expect(optionsBtnIdx).toBeGreaterThan(-1);
    expect(progressPaletteIdx).toBeGreaterThan(optionsBtnIdx);
    expect(EDITOR).toMatch(/进度字段的颜色面板/);
    // 进度颜色不再是一颗易被忽略的小方块，而是与输入框同高的整行触发器。
    expect(EDITOR).toMatch(/className="bt-select-trigger"[\s\S]{0,160}选择进度条颜色/);
    expect(EDITOR).toMatch(/进度条颜色<\/span>/);
  });

  it("颜色选择器点其它浮层或面板空白即关闭（不沿用悬停子菜单的父层豁免）", () => {
    expect(SHARED_PALETTE).toMatch(/closeOnNestedOverlay/);
    expect(SHARED_PALETTE).toMatch(/<Popover open anchor=\{anchor\} at=\{at\} onClose=\{onClose\} width=\{296\} align="start" side=\{side\} closeOnNestedOverlay=\{closeOnNestedOverlay\}>/);
    // 填色 = 普通浮层，点击填色面板其它位置即关；列文字 = 子菜单，不继承该行为。
    expect(FILL_EDITOR).toMatch(/closeOnNestedOverlay\s+defaultLabel="无背景色"/);
    const textPalette = EDITOR.match(/<ColorPalette anchor=\{textColorFor\.anchor\}[\s\S]{0,240}?\/>/)?.[0] ?? "";
    expect(textPalette).not.toContain("closeOnNestedOverlay");
  });

  it("阶段优化批（260929-OPT）：表单题序 / 系统时间复制·查重 / 搜索口径 / 删字段清理 / 令牌", () => {
    // A1 表单题目顺序 = formFieldIds 顺序（不是表字段顺序）
    expect(FORM).toMatch(/includedIds[\s\S]{0,24}?\.map\(\(id\) => formableFields\.find/);
    // A2 查重走记录级取值（系统时间字段的值不在 record.values 里）
    expect(EDITOR).toMatch(/bitableDisplayValue\(field, bitableFieldValue\(record, field\), displayCtx\)/);
    // A3 复制所见：系统时间复制到分钟，不是空串
    expect(EDITOR).toMatch(/cells\.push\(bitableFieldText\(record, visibleFields\[ci\], displayCtx\)\)/);
    // A4 搜索走统一展示口径
    expect(EDITOR).toMatch(/bitableFieldText\(record, field, displayCtx\)\.toLowerCase\(\)\.includes\(q\)/);
    // A6 删字段清理所有视图里指向它的配置（AR02：收敛到 core 纯函数单一来源）
    expect(MUTATIONS).toMatch(/stripId\(view\[key\], fieldId\)/);
    expect(MUTATIONS).toMatch(/stripKey\(view\[key\], fieldId\)/);
    expect(EDITOR).toMatch(/deleteBitableField\(prev, tableId, fieldId\)/);
    // A5 statForField 不走原型链
    expect(DOC).toMatch(/Object\.prototype\.hasOwnProperty\.call\(BITABLE_STAT_LABEL, stat\)/);
    // 单一来源：移动端附件判定复用 isAttachmentLikeField
    expect(MOBILE).toMatch(/isAttachmentLikeField\(field\.type\)/);
    // 令牌唯一来源：桌面组件 CSS 不再有颜色字面量（抽屉阴影除外，无对应令牌）
    expect(CSS).not.toMatch(/#fff|#1f1f1f/);
  });

  it("AR02 业务写入收敛：字段删除/单元格写入/附件回填走 core 纯函数", () => {
    expect(MUTATIONS).toMatch(/export function deleteBitableField/);
    expect(MUTATIONS).toMatch(/export function setBitableCellValue/);
    expect(MUTATIONS).toMatch(/export function setBitableRecordValues/);
    expect(MUTATIONS).toMatch(/export function appendBitableAttachments/);
    expect(MUTATIONS).toMatch(/export function addBitableRecord/);
    // 附件回填必须捕获**发起上传时**的表，切表后不再写到「那时的当前表」。
    expect(VIEWPORT_CELL).toMatch(/appendAttachments\(tableId, recordId, field\.id, entries\)/);
    expect(EDITOR).toMatch(/appendAttachments\(activeTable\.id, recordId, fieldId, entries\)/);
    // 组件不再自己做整套视图配置清理（单一来源在 core）。
    expect(EDITOR).not.toMatch(/next\.highlightDuplicateFieldIds = strip\(/);
  });

  it("T02B.1 关联基础模型：core 统一解析 + 字段配置 + 各视图透传 ctx", () => {
    expect(DOC).toMatch(/export interface BitableDisplayContext/);
    expect(DOC).toMatch(/export function relationTargetTable/);
    expect(DOC).toMatch(/export function relationTargetRecords/);
    expect(DOC).toMatch(/export function relationRecordIds/);
    expect(CARDS).toMatch(/export function RelationCell/);
    expect(CARDS).toMatch(/relationTargetRecords\(ctx, field, value\)/);
    expect(EDITOR).toMatch(/const displayCtx = useMemo/);
    expect(EDITOR).toMatch(/ctx=\{displayCtx\}/);
    expect(EDITOR).toMatch(/关联数据表/);
    expect(EDITOR).toMatch(/允许添加多个记录/);
    for (const view of [KANBAN, GALLERY, CALENDAR, FORM, MOBILE]) {
      expect(view).toMatch(/BitableDisplayContext/);
    }
  });

  it("T02B.2/T02B.4 关联选择器：全局大弹窗（两个 tab + 搜索 + 筛选排序 + 整表），不是单元格小气泡", () => {
    // 用户 260929：不用小气泡，用「正常的全局弹窗」；单元格只留触发器
    expect(CARDS).toMatch(/className=\{"bt-option-trigger"/);
    expect(CARDS).toMatch(/disabled=\{readOnly\} aria-haspopup="dialog"/);
    expect(CARDS).toMatch(/<BitableRelationPicker field=\{field\} value=\{value\} ctx=\{ctx\}/);
    // 旧气泡的搜索/页脚/跳转/新建记录入口全部撤销（用户 260929：不做添加记录）
    expect(CARDS).not.toMatch(/bt-relation-foot|placeholder="搜索目标记录"/);
    expect(CARDS).not.toMatch(/onJumpToRecord|onCreateTargetRecord/);
    expect(EDITOR).not.toMatch(/jumpToRelationRecord|createTargetRecord/);
    expect(DRAWER).not.toMatch(/onJumpToRecord|onCreateTargetRecord/);
  });

  it("T02B.4 关联选择器内容：两个 tab / 全局搜索 / 筛选排序 / 目标表整表 / 草稿确认", () => {
    // 全局弹窗（Overlay Dialog），不是气泡
    expect(PICKER).toMatch(/from "\.\.\/\.\.\/components\/ui\/Overlay\.js"/);
    expect(PICKER).toMatch(/<Dialog open onDismiss=\{onCancel\} label="选择关联记录"/);
    // 两个 tab：所有可关联记录 + 数量 / 已选 + 数量（kit 层原语：260929 选定的「墨线 + 计数徽标」）
    expect(PICKER).toMatch(/<div className="ln-tabs">/);
    expect(PICKER).toMatch(/className=\{"ln-tabs__item" \+ \(tab === "all" \? " is-active" : ""\)\}/);
    expect(PICKER).toMatch(/所有可关联记录<span className="ln-tabs__count">\{candidates\.length\}<\/span>/);
    expect(PICKER).toMatch(/已选<span className="ln-tabs__count">\{draft\.length\}<\/span>/);
    expect(PICKER).not.toMatch(/seg__item/);
    // 全局搜索 + 右侧筛选/排序（选择器本机状态，复用视图求值引擎，不另造规则实现）
    expect(PICKER).toMatch(/placeholder="搜索相关记录"/);
    expect(PICKER).toMatch(/title="筛选"/);
    expect(PICKER).toMatch(/title="排序"/);
    expect(PICKER).toMatch(/import \{ BitableFilterEditor \} from "\.\/BitableFilterEditor\.js"/);
    expect(PICKER).toMatch(/<BitableFilterEditor fields=\{ruleFields\}/);
    expect(PICKER).toMatch(/<BitableFilterEditor fields=\{ruleFields\} filters=\{viewFilters\}/);
    expect(PICKER).toMatch(/sortModesForField\(/);
    // 主区域 = 目标表整表（每个字段一列），值统一走 bitableFieldText
    expect(PICKER).toMatch(/fields\.map\(\(item\) => <th key=\{item\.id\}/);
    expect(PICKER).toMatch(/bitableFieldText\(record, item, ctx\)/);
    // 只读值统一复用主表格 CellEditor：单选/多选/评分/进度/布尔等与正式行视图同一套渲染
    expect(PICKER).toMatch(/<CellEditor\s+field=\{field\}\s+value=\{record\.values\[field\.id\]\}\s+readOnly/);
    // 可关联范围走 core 单一口径；草稿经 toggleRelationDraft；确认才写正文
    expect(PICKER).toMatch(/relationCandidateRecords\(ctx, field\)/);
    expect(PICKER).toMatch(/toggleRelationDraft\(prev, recordId, allowMultiple\)/);
    expect(PICKER).toMatch(/onClick=\{\(\) => onConfirm\(\[\.\.\.draft\]\)\}/);
    // 不做「添加记录」（用户 260929 明确）—— 页脚只有「已选 N 条记录 / 取消 / 确认」三件
    expect(PICKER).not.toMatch(/添加记录<\/button>|新建记录<\/button>/);
    expect(PICKER).toMatch(/className="bt-rel-foot"/);
  });

  it("筛选重做：远端字段操作符矩阵 + 递归条件组 + 共享编辑器", () => {
    // core 单一来源：字段类型 → 操作符；日期动态值；规则数与递归求值。
    expect(DOC).toMatch(/export type BitableFilterJoin = "and" \| "or"/);
    expect(DOC).toMatch(/export function filterOperatorsFor/);
    expect(DOC).toMatch(/export function dateFilterModesFor/);
    expect(DOC).toMatch(/export function evaluateFilterNode/);
    expect(DOC).toMatch(/export function bitableFilterRuleCount/);
    expect(DOC).toMatch(/BITABLE_FILTER_MAX_GROUP_DEPTH = 2/);
    // 视图保存根连接符；旧 filters 数组升级为可递归节点。
    expect(DOC).toMatch(/filterOperator\?: BitableFilterJoin/);
    expect(DOC).toMatch(/filters\?: BitableFilterNode\[\]/);
    // 主编辑器与关联选择器共用同一个编辑器，不各自维护一套规则 UI。
    expect(EDITOR).toMatch(/import \{ BitableFilterEditor \} from "\.\/BitableFilterEditor\.js"/);
    expect(EDITOR).toMatch(/<BitableFilterEditor\s+fields=\{activeTable\.fields\}/);
    // 打开筛选面板不得偷偷写入一条空规则；空态由编辑器自己提供“添加筛选规则”。
    expect(EDITOR).not.toMatch(/setFilters\(\[createBitableFilterRule\(/);
    expect(PICKER).toMatch(/<BitableFilterEditor fields=\{ruleFields\}/);
    expect(FILTER_EDITOR).toMatch(/function FilterGroupView/);
    expect(FILTER_EDITOR).toMatch(/function pruneEmptyGroups/);
    expect(FILTER_EDITOR).toMatch(/onReplace\(childPath, \{ \.\.\.createBitableFilterGroup/);
    expect(FILTER_EDITOR).toMatch(/BITABLE_DATE_FILTER_MODE_LABEL/);
    expect(FILTER_EDITOR).toMatch(/FilterMultiSelect/);
    expect(FILTER_CSS).toMatch(/\.bt-filter-group-surface/);
    expect(FILTER_CSS).toMatch(/\.bt-filter-rule \{ display: grid;/);
    expect(FILTER_CSS).toMatch(/\.bt-filter-panel \{ width: 100%; max-width: 100%;/);
    expect(FILTER_CSS).toMatch(/\.bt-filter-delete/);
    expect(FILTER_EDITOR).toMatch(/onClear && filters\.length > 0/);
    expect(EDITOR).toMatch(/anchor=\{menuAnchor\} onClose=\{\(\) => setPanel\(null\)\} width=\{filters\.length > 0 \? 820 : 320\}/);
  });

  it("条件填色：视图级规则 + 钉钉混色候选 + 复用筛选单规则编辑器", () => {
    expect(DOC).toMatch(/export type BitableFillMode = "cell" \| "row" \| "rowSide" \| "column"/);
    expect(DOC).toMatch(/BITABLE_FILL_MAX_RULES = 40/);
    expect(DOC).toMatch(/BITABLE_FILL_NO_COLOR = "transparent"/);
    expect(DOC).toMatch(/fillRules\?: BitableFillRule\[\]/);
    expect(DOC).toMatch(/export function buildBitableFillProjection/);
    expect(DOC).toMatch(/export function bitableFillBackgroundTokens/);
    expect(DOC).toMatch(/matches\.sort\(\(a, b\) => b\.ruleIndex - a\.ruleIndex\)/);
    expect(DOC).toMatch(/return matches\.reverse\(\)\.map\(\(match\) => match\.color\)/);
    expect(DOC).toMatch(/export function stripFillRulesForField/);
    // 填色编辑器必须复用筛选的单规则编辑器；操作符/值类型不能出现第二套实现。
    expect(FILL_EDITOR).toMatch(/BitableFilterRuleEditor/);
    expect(FILL_EDITOR).not.toMatch(/BITABLE_FILTER_OPERATOR_LABEL|filterOperatorsFor\(field\).*map/);
    expect(FILL_EDITOR).toMatch(/DEFAULT_LIGHT_COLORS/);
    expect(FILL_EDITOR).toMatch(/recentKey=\{rules\[colorEditor\.index\]\?\.mode === "rowSide" \? "bitable-fill:rowSide" : "bitable-fill:background"\}/);
    expect(FILL_EDITOR).toMatch(/defaultLabel="无背景色" defaultKind="background"/);
    expect(FILL_EDITOR).toMatch(/BITABLE_FILL_NO_COLOR/);
    expect(FILL_EDITOR).toMatch(/BITABLE_FILL_MAX_RULES/);
    // 模式切换保留条件与值（260930 现场实测抓到的交互回归）。
    expect(FILL_EDITOR).toMatch(/mode !== "column" && rule\.mode !== "column"[\s\S]{0,100}?\{ \.\.\.rule, mode, condition: rule\.condition \}/);
    // 通用下拉同一时刻只允许一个打开；点击其它触发器或面板空白都自动收起旧下拉。
    expect(CARDS).toMatch(/bt-select-menu-open/);
    expect(CARDS).toMatch(/data-select-menu-id/);
    expect(FILTER_EDITOR).toMatch(/export function BitableFilterRuleEditor/);
    // 主编辑器接工具栏入口、投影与字段删除清理。
    expect(EDITOR).toMatch(/<PaintBucket size=\{14\} \/>填色/);
    expect(EDITOR).toMatch(/panel === "fill"/);
    expect(EDITOR).toMatch(/buildBitableFillProjection\(activeTable, activeView, shownRecords\)/);
    expect(MUTATIONS).toMatch(/export function stripFieldFromView/);
    expect(MUTATIONS).toMatch(/stripFillRulesForField\(view\.fillRules, fieldId\)/);
    expect(EDITOR).toMatch(/deleteBitableField\(prev, tableId, fieldId\)/);
    expect(FILL_CSS).toMatch(/\.bt-fill-row/);
    expect(FILL_CSS).toMatch(/\.bt-row\[data-fill-side\] \.bt-td-index::before/);
  });

  it("T02B.4 关联数据范围：不勾选=全部记录，勾选=绑定目标表的一个视图", () => {
    expect(DOC).toMatch(/viewId\?: string/);
    expect(DOC).toMatch(/export function relationTargetView/);
    expect(DOC).toMatch(/export function relationCandidateRecords/);
    // 视图绑定只约束「能选到什么」：候选集走视图的筛选+排序，缺省回落全部记录
    expect(DOC).toMatch(/return view \? applyViewToRecords\(target, view\) : \[\.\.\.target\.records\]/);
    // 字段配置 UI：勾选框 + 视图下拉；换目标表清空视图（视图 id 属于目标表）
    expect(EDITOR).toMatch(/从视图筛选记录/);
    expect(EDITOR).toMatch(/关联视图/);
    expect(EDITOR).toMatch(/setRelationTableId\(value\); setRelationViewId\(""\)/);
    expect(EDITOR).toMatch(/\.\.\.\(relationTableId && relationViewId \? \{ viewId: relationViewId \} : \{\}\)/);
    // 排序方式映射收敛到 core 单一来源（选择器与编辑器共用）
    expect(DOC).toMatch(/export function sortModeOf/);
    expect(DOC).toMatch(/export function applySortMode/);
    expect(DOC).toMatch(/export function changeSortField/);
    expect(EDITOR).not.toMatch(/const applySortMode = /);
  });

  it("关联选择器视图投影（260930）：绑定视图跟随顺序+隐藏，默认视图只给全部记录排序", () => {
    expect(DOC).toMatch(/export function defaultGridView/);
    expect(DOC).toMatch(/export function relationPickerFields/);
    expect(DOC).toMatch(/orderedAllTableFields\(target, defaultGridView\(target\)\)/);
    expect(DOC).toMatch(/if \(boundView\) return orderedTableFields\(target, boundView\)/);
    expect(PICKER).toMatch(/relationPickerFields\(ctx, field\)/);
    expect(PICKER).toMatch(/scopeView\?\.filters \?\? \[\]/);
    expect(PICKER).toMatch(/scopeView\?\.sorts \?\? \[\]/);
    expect(PICKER).toMatch(/scopeView\?\.groups\?\.\[0\]/);
    expect(PICKER).toMatch(/groupRecords\(target, rows, rule\)/);
    expect(PICKER).toMatch(/className="bt-rule-row is-view"/);
    expect(PICKER).toMatch(/<Lock size=\{12\} \/>视图/);
    expect(PICKER_CSS).toMatch(/\.bt-rel-group-row/);
  });

  it("关联选择器只读值与历史/回收站共用 CellEditor（同一主表格渲染）", () => {
    expect(PICKER).toMatch(/import \{ AttachmentChipList, CellEditor, SelectMenu \} from "\.\/bitableCells\.js"/);
    expect(PICKER).toMatch(/<CellEditor\s+field=\{field\}\s+value=\{record\.values\[field\.id\]\}\s+readOnly\s+onChange=\{\(\) => undefined\}\s+onAddOption=\{\(\) => undefined\}/);
    expect(EDITOR).toMatch(/<BitableViewportCell[\s\S]*?value=\{record\.values\[field\.id\]\}[\s\S]*?readOnly=\{readOnly\}/);
    const viewportCell = readFileSync(new URL("./BitableViewportCell.tsx", import.meta.url), "utf8");
    expect(viewportCell).toMatch(/<CellEditor[\s\S]*?value=\{p.value\}[\s\S]*?readOnly=\{p.readOnly\}/);
    const HISTORY = readFileSync(new URL("../../components/app/HistorySnapshotPreview.tsx", import.meta.url), "utf8");
    const TABS = readFileSync(new URL("../editor/MultiTabEditor.tsx", import.meta.url), "utf8");
    expect(HISTORY).toMatch(/<BitableEditor noteId=\{noteId\} content=\{body\} visible readOnly onChange=\{noop\} chrome=\{false\} \/>/);
    expect(TABS).toMatch(/tab\.kind === "bitable"[\s\S]*?readOnly=\{\(lockedNoteIds\?\.has\(tab\.noteId\) \?\? false\) \|\| tab\.deleted === true\}/);
  });

  it("T02B.3 双向关联：反向字段 / 双向镜像唯一写入口 / 删一侧解除配对", () => {
    expect(DOC).toMatch(/export function relationReverseFieldName/);
    expect(DOC).toMatch(/export function createRelationPair/);
    expect(DOC).toMatch(/export function applyRelationMirror/);
    expect(DOC).toMatch(/export function unpairRelationFields/);
    expect(DOC).toMatch(/relationOneWay/);
    expect(DOC).toMatch(/relationTwoWay/);
    expect(CARDS).toMatch(/case "relationOneWay": return <Link2/);
    expect(CARDS).toMatch(/case "relationTwoWay": return <ArrowLeftRight/);
    expect(EDITOR).toMatch(/patch\.type === "relationTwoWay"/);
    expect(EDITOR).toMatch(/createRelationPair\(prev\.tables/);
    expect(EDITOR).toMatch(/unpairRelationFields\(prev\.tables/);
    // 关联字段的写值必须走镜像入口（否则双向会不同步）
    expect(MUTATIONS).toMatch(/applyRelationMirror\(doc\.tables, tableId, fieldId, recordId, next\)/);
    expect(EDITOR).toMatch(/setBitableCellValue\(prev, tableId, recordId, fieldId, value\)/);
    expect(EDITOR).not.toMatch(/双向关联（在目标表生成反向字段）/);
  });

  it("编辑字段：字段类型是**弹出选择**（不再内联一大块占位）", () => {
    expect(CARDS).toMatch(/export function FieldTypeSelect/);
    // 触发器只显示当前类型；网格收进 Popover（两种入口共用同一个 FieldTypeGrid）
    const block = CARDS.slice(CARDS.indexOf("export function FieldTypeSelect"), CARDS.indexOf("/** 锚点是否位于"));
    expect(block).toMatch(/className="bt-select-trigger"/);
    expect(block).toMatch(/<Popover /);
    expect(block).toMatch(/<FieldTypeGrid /);
    expect(EDITOR).toMatch(/<FieldTypeSelect value=\{type\}/);
    // 工具栏快捷「新增字段」仍是弹出网格
    expect(EDITOR).toMatch(/<FieldTypeGrid onPick=\{addField\} \/>/);
  });

  it("编辑字段：类型名左对齐 + 选项输入框回车即新建", () => {
    // button 默认 text-align:center 会把类型名居中，必须显式左对齐
    expect(CSS).toMatch(/\.bt-select-trigger \{[^}]*text-align: left/);
    // 选项：输入框回车 = 新建（与「添加选项」按钮共用 addOptionRow）
    expect(EDITOR).toMatch(/const addOptionRow = \(\) => \{/);
    // 回车 = 当前选项完成 → 切下一个；没有下一个才新建（不是每次都新建）
    expect(EDITOR).toMatch(/const next = options\[index \+ 1\];/);
    expect(EDITOR).toMatch(/if \(next\) focusOptionInput\(next\.id\);/);
    expect(EDITOR).toMatch(/else addOptionRow\(\);/);
    expect(EDITOR).toMatch(/className="bt-panel-add" disabled=\{readOnly\} onClick=\{addOptionRow\}/);
  });

  it("选项编辑：新加的行不再自动全选（用户 260930 报的「添加时那块蓝色底色」）", () => {
    // 根因：聚焦新行时 `el.select()` 把选项名整块选中，屏幕上就是一块系统蓝（实测 selectionStart=0/End=4）。
    // 改为只聚焦 + 光标落末尾 —— 与「用鼠标点进这个输入框」完全一致，可预期且不抢输入。
    expect(EDITOR).toMatch(/if \(el\) \{ el\.focus\(\); el\.setSelectionRange\(el\.value\.length, el\.value\.length\); \}/);
    expect(EDITOR).not.toMatch(/el\.focus\(\); el\.select\(\)/);
    // 新选项留空（默认名交给 placeholder）⇒ 没有任何「被全选的既存文本」可涂蓝
    expect(EDITOR).toMatch(/\{ id, name: "", color: BITABLE_OPTION_COLORS\[prev\.length % BITABLE_OPTION_COLORS\.length\] \}/);
    expect(EDITOR).toMatch(/placeholder=\{"选项 " \+ \(index \+ 1\)\}/);
    // 保存时空名按位置兜底成「选项 N」，不会把空名写进字段（其余行原样返回）
    expect(EDITOR).toMatch(/name: option\.name\.trim\(\) \|\| "选项 " \+ \(index \+ 1\)/);
    // 占位色走令牌（浏览器默认灰不是令牌；与 kit/overlay 的 placeholder 同一口径）
    expect(CSS).toMatch(/\.bt-input::placeholder \{ color: var\(--lake-text-4\); \}/);
  });

  it("列宽可自由设置（宽度看字段数据、不看内容）+ 行高不被内容撑高（用户 260930）", () => {
    // 根因：`table-layout: auto` 下 `<col style="width">` 只是「至少这么宽」——附件 chip 实测把 180 撑到 413。
    // 真正卡住列的是每个格子的 max-width（按列写行内：宽度来自正文数据，CSS 没法按列取值）。
    expect(EDITOR).toMatch(/const columnWidth = \(field: BitableField\) => \(field\.width \?\? DEFAULT_COL_WIDTH\) \+ "px";/);
    expect(EDITOR).toMatch(/<th key=\{field\.id\}[\s\S]{0,400}?style=\{\{ maxWidth: columnWidth\(field\) \}\}/);
    expect(EDITOR).toMatch(/maxWidth=\{columnWidth\(field\)\}/);
    expect(VIEWPORT_CELL).toContain("maxWidth: p.maxWidth");
    expect(VIEWPORT_CELL).toContain("backgroundImage: p.background");
    expect(VIEWPORT_CELL).toContain("color: p.color");
    expect(EDITOR).toMatch(/className="bt-group-stat" style=\{\{ maxWidth: columnWidth\(field\) \}\}/);
    expect(EDITOR).toMatch(/className="bt-stat-cell" style=\{\{ maxWidth: columnWidth\(field\) \}\}/);
    // 261017：fixed 布局下**表宽必须 max(100%, 内容宽)、末列必须 auto**，否则多余宽度会被等比摊给所有列
    // （新建单字段表时复选框列/新建行被拉宽、末列吃不掉剩余）。详见 bitableViewport.css 注释。
    expect(EDITOR).toContain('max(100%, ${80 + gridTrailingWidth');
    expect(EDITOR).toContain('<col className="bt-col-empty" />');
    expect(VIEWPORT_CSS).not.toMatch(/\.bt-col-empty\s*\{[^}]*width:/);
    // 行高**绝对**不被内容撑高：单元格永不换行（实测日期列 80px 时折行 ⇒ 行高 36 → 48），日期/时间单行省略
    expect(CSS).toMatch(/\.bt-grid th, \.bt-grid td \{[^}]*white-space: nowrap/);
    // 260930 大统一：日期/时间文案的截断走 kit 的 .ln-ellipsis（JSX 挂在那个 <span> 上），
    // 原 `> span` 子选择器规则已删 —— 截断只有一处实现。
    expect(CARDS).toMatch(/<span className="ln-ellipsis">\{text \|\| "请选择日期"\}<\/span>/);
    expect(CSS).not.toMatch(/\.bt-date-trigger > span \{/);
    // 文本格同样「截断省略」而不是硬裁（input 支持 text-overflow: ellipsis）
    expect(CSS).toMatch(/\.bt-cell-input \{[^}]*text-overflow: ellipsis/);
    // 下限 80 → 40（用户：「可以设定一个比较小的下限值」），上限仍是 640
    expect(EDITOR).toMatch(/Math\.max\(40, Math\.min\(640, startW \+ \(ev\.clientX - startX\)\)\)/);
    expect(EDITOR).not.toMatch(/Math\.max\(80, Math\.min\(640,/);
  });

  it("附件展示文档类型图标（用户 260930）：单元格小图标 + hover 名称气泡、展开面板大图标", () => {
    // 单元格：附件字段 → 类型图标（不再是文件名 chip / 缩略图）；图片字段（imageOnly）保持缩略图
    expect(CARDS).toMatch(/className=\{"bt-attachment-chip" \+ \(imageOnly \? "" : " is-icon"\)\}/);
    expect(CARDS).toMatch(/<FileKindIcon name=\{name\} \/>/);
    expect(CARDS).toMatch(/imageOnly\s*\n?\s*\? <img src=\{chipUrlOf\(file\)\} alt=\{name\} loading="lazy"/);
    // 缩略图**不再带原生 title**（否则和下面的自定义气泡同时冒出来）
    expect(CARDS).not.toMatch(/<img src=\{chipUrlOf\(file\)\} alt=\{name\} loading="lazy" title=\{name\}/);
    // hover 名称气泡：**一处实现**（useNameTip），单元格 chip 与展开面板文件名共用
    expect(CARDS).toMatch(/function useNameTip\(\) \{/);
    expect(CARDS).toMatch(/<span ref=\{surfaceRef\} className="ln-tip bt-file-tip" style=\{style \?\? undefined\} role="tooltip">\{tip\.name\}<\/span>/);
    expect(CARDS).toMatch(/const tip = useNameTip\(\);/);
    // 单元格：两种字段共用（用户 260930：图片也要 hover 出名称），无条件挂 mouseenter
    expect(CARDS).toMatch(/onMouseEnter=\{\(event\) => tip\.show\(name, event\.currentTarget\)\}/);
    expect(CARDS).not.toMatch(/onMouseEnter=\{imageOnly \? undefined/);
    // 展开面板的文件名：有文字 ⇒ 只在**真被省略**时才弹（用户 260930 追加），且不再用原生 title
    expect(CARDS).toMatch(/tip\.show\(name, event\.currentTarget, true\)/);
    expect(CARDS).toMatch(/whenTruncated && anchor\.scrollWidth <= anchor\.clientWidth/);
    expect(CARDS).not.toMatch(/className="bt-attach-card-name" title=\{name\}/);
    // 表面用 kit 的 .ln-tip、定位用 usePopoverPosition（fixed ⇒ 不被滚动容器裁切）
    expect(CARDS).toMatch(/usePopoverPosition\(\{ open: Boolean\(tip\), anchor: tip\?\.anchor \?\? null, gap: 6 \}\)/);
    expect(CARDS).toMatch(/className="ln-tip bt-file-tip"/);
    expect(FILE_ICON_CSS).toMatch(/\.bt-file-tip \{ position: fixed; pointer-events: none; \}/);
    // 展开面板：附件字段出**大类型图标**（原来非图片是「扩展名文字」）；图片字段仍是缩略图
    expect(CARDS).toMatch(/<span className="bt-attach-card-kind"><FileKindIcon name=\{name\} size=\{46\} \/><\/span>/);
    // 类型判定收敛到 core 的单一事实源（图标组件不自己养一份扩展名表）
    expect(FILE_ICON).toMatch(/import \{ fileKindOf, type AssetFileKind \} from "\.\.\/\.\.\/core\/assetNaming\.js"/);
    expect(FILE_ICON).toMatch(/const kind = fileKindOf\(name\)/);
    expect(DOC).not.toMatch(/fileKindOf|ASSET_FILE_KIND_EXTS/);
    // 颜色只允许出现在主题文件里（ui-metrics 的硬指标），图标色一律 --lake-file-*
    expect(FILE_ICON_CSS).toMatch(/\.bt-file-icon--pdf \{ color: var\(--lake-file-pdf\); \}/);
    expect(FILE_ICON_CSS).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("关联选择器整表复用同一套附件渲染（用户 260930：「这两处不是同一套代码吗？能做成一套吗？」）", () => {
    // 选择器不再自养「📎 文件名」chip / 自己的缩略图，改用表格那套 AttachmentChipList
    expect(PICKER).toMatch(/import \{ AttachmentChipList, CellEditor, SelectMenu \} from "\.\/bitableCells\.js"/);
    expect(PICKER).toMatch(/<AttachmentChipList noteId=\{noteId\} attachments=\{files\} imageOnly=\{field\.type === "image"\}/);
    expect(PICKER).not.toMatch(/bt-rel-thumb/);
    expect(PICKER).not.toMatch(/Paperclip/);
    expect(PICKER_CSS).not.toMatch(/\.bt-rel-thumb/);
    // 点图标 = 打开/预览（与表格同一交互）⇒ 截断冒泡，别顺带勾选整行；`.bt-rel-files` 只包住图标本身
    expect(PICKER).toMatch(/<span className="bt-rel-files" onClick=\{\(event\) => event\.stopPropagation\(\)\}>/);
    expect(PICKER_CSS).toMatch(/\.bt-rel-files \{ display: inline-flex; align-items: center; gap: var\(--lake-space-xs\); max-width: 100%; overflow: hidden; \}/);
    // 极端入口没有 noteId 时不拼资产 URL
    expect(PICKER).toMatch(/if \(!noteId\) \{/);
  });

  it("看板/画册卡片复用同一套附件渲染（用户 260930 选 A；后又要求卡片不显示名称）", () => {
    // 卡片不再自己养缩略图：附件字段出类型图标（PDF/Word 也看得见，之前整块不上卡）、图片字段出缩略图
    expect(KANBAN).toMatch(/<AttachmentChipList noteId=\{noteId\} attachments=\{files\} imageOnly=\{field\.type === "image"\}/);
    // 卡片**不显示文件名**（用户：「看板视图不展示名称了，直接图标或者缩略图吧」）⇒ 没有 showNames 变体
    expect(KANBAN).not.toMatch(/<AttachmentChipList[^>]*showNames/);   // 注意别误伤看板自己的 kanbanShowFieldNames
    expect(CARDS).not.toMatch(/showNames|bt-attachment-chip-name/);
    expect(KANBAN).toMatch(/if \(isAttachmentLikeField\(field\.type\)\) \{[\s\S]{0,200}?const files = bitableAttachments/);
    expect(KANBAN).not.toMatch(/bt-kanban-thumb/);
    expect(KANBAN).not.toMatch(/KANBAN_THUMB_PX/);
    expect(KANBAN_CSS).not.toMatch(/\.bt-kanban-thumb/);
    // 卡片附件行容器是**共用**的 .bt-card-files（定义在 bitableFileIcon.css，看板/画册同一份）
    expect(FILE_ICON_CSS).toMatch(/\.bt-card-files \{ display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; \}/);
    expect(KANBAN_CSS).not.toMatch(/\.bt-card-files|\.bt-kanban-files/);
    // 卡片能换行（不像表格格子必须一行裁切）、点图标不冒泡（卡片空白处仍开记录详情）
    expect(KANBAN).toMatch(/<span className="bt-card-files" onClick=\{\(event\) => event\.stopPropagation\(\)\}>/);
    // 画册卡片同样走同一套（用户：「画册视图的附件也要改」；之前是 bitableFieldText 出的一串文件名）
    expect(GALLERY).toMatch(/<AttachmentChipList noteId=\{noteId\} attachments=\{files\} imageOnly=\{field\.type === "image"\}/);
    expect(GALLERY).toMatch(/isAttachmentLikeField\(field\.type\)/);
    expect(GALLERY).toMatch(/<span className="bt-card-files" onClick=\{\(event\) => event\.stopPropagation\(\)\}>/);
  });

  it("打开附件只有一处实现（openBitableAttachment），表格/选择器/看板都走它", () => {
    expect(ASSET_URL).toMatch(/export function openBitableAttachment\(noteId: string, attachment: BitableAttachment\): void \{/);
    expect(ASSET_URL).toMatch(/openAssetEntry\(bitableAssetUrl\(noteId, attachment\.file\), attachment\.name, attachment\.size, \{ kindFrom: attachment\.file \}\)/);
    for (const src of [EDITOR, PICKER, KANBAN]) expect(src).toMatch(/openBitableAttachment\(noteId, attachment\)/);
    // 三处都不再各自拼一遍
    for (const src of [EDITOR, PICKER, KANBAN]) expect(src).not.toMatch(/openAssetEntry\(bitableAssetUrl/);
  });

  it("附件打开走公共入口（图片 Lightbox / 音视频内嵌 / 其它系统）", () => {
    expect(EDITOR).toMatch(/openAssetEntry/);
    // 控制器是单例：宿主只归应用根，不归每个 keep-alive 文档。
    for (const app of [APP, MOBILE_APP]) {
      expect((app.match(/<ImageLightbox\s*\/>/g) ?? []).length).toBe(1);
      expect((app.match(/<AttachmentPreview\s*\/>/g) ?? []).length).toBe(1);
    }
    for (const child of [EDITOR, EDITOR_TAB, TABS]) {
      expect(child).not.toMatch(/<ImageLightbox|<AttachmentPreview/);
    }
    expect(ATTACH).toMatch(/openImagePreview/);
    expect(ATTACH).toMatch(/openAttachmentPreview/);
    expect(ATTACH).toMatch(/isMediaFilename/);
  });

  it("视图工作台：五种类型可选、视图壳按职责拆分、未知类型原样保留并安全回退", () => {
    // 视图类型是**开放集合**（以后加类型不 bump 格式版本）：新建菜单与页签图标同源
    expect(DOC).toMatch(/BITABLE_VIEW_TYPES[^=]*=\s*\["grid", "form", "kanban", "gallery", "calendar"\]/);
    expect(BAR).toMatch(/BITABLE_VIEW_TYPES\.map/);
    expect(BAR).toMatch(/ViewTypeIcon/);
    expect(EDITOR).toMatch(/BitableViewBar/);
    expect(EDITOR).toMatch(/BitableViewFallback/);
    expect(VIEWS).toMatch(/bt-view-fallback/);
    expect(VIEWCSS).toMatch(/\.bt-view-fallback/);
    // 未知视图只回退显示：normalizeView 必须原样保留 type，绝不能改写成 grid
    expect(DOC).toMatch(/typeof view\.type === "string" && view\.type \? view\.type : "grid"/);
    expect(DOC).not.toMatch(/"form" : "grid"/);
    // 看板视图 ≠ 画板文档：board 是 kind 路由，不得混进视图类型
    expect(DOC).not.toMatch(/"kanban" \| "board"/);
  });

  it("V02 看板视图：单选字段分栏、拖拽只写分组字段值、未实现视图才回退", () => {
    expect(DOC).toMatch(/BITABLE_IMPLEMENTED_VIEW_TYPES[^=]*=\s*\[\s*"grid", "form", "kanban"/);
    expect(EDITOR).toMatch(/BitableKanbanView/);
    expect(EDITOR).toMatch(/isImplementedViewType/);
    expect(KANBAN).toMatch(/kanbanColumns/);
    expect(KANBAN).toMatch(/kanbanCardFields/);
    expect(KANBAN).toMatch(/onSetValue\(draggingId, groupField\.id/);
    // 分栏求值必须是纯函数（core），组件不得自己分组
    expect(DOC).toMatch(/export function kanbanColumns/);
    // 只读铁律：改视图配置的入口（分组字段下拉在配置面板里 / 重命名视图在编辑器里）必须被 readOnly 封住
    expect(PANELS).toMatch(/选择分组字段" disabled=\{readOnly\}/);
    expect(EDITOR).toMatch(/disabled=\{readOnly\}[^\n]*重命名视图/);
  });

  it("V03/V04 画册与日历：接入分派、配置面板按类型选、日期全程本地语义", () => {
    expect(DOC).toMatch(/BITABLE_IMPLEMENTED_VIEW_TYPES[^=]*=\s*\["grid", "form", "kanban", "gallery", "calendar"\]/);
    expect(EDITOR).toMatch(/BitableGalleryView/);
    expect(EDITOR).toMatch(/BitableCalendarView/);
    expect(EDITOR).toMatch(/GalleryConfigPanel/);
    expect(EDITOR).toMatch(/CalendarConfigPanel/);
    expect(EDITOR).toMatch(/setRecordValues/);
    expect(DOC).toMatch(/export function galleryCoverImage/);
    expect(DOC).toMatch(/export function calendarMonthDays/);
    expect(DOC).toMatch(/export function calendarMovePatch/);
    // 日期必须走本地语义：日历相关代码不得出现 UTC 取值 / toISOString
    expect(CALENDAR).not.toMatch(/getUTC|toISOString/);
    expect(GALLERY).toMatch(/galleryCoverImage/);
    expect(GALLERY).toMatch(/bitableAssetUrl\(noteId, file, GALLERY_COVER_PX\)/);
  });

  it("用户追加需求：图片字段（复用附件、只收图片）/ 画册点封面预览 / 表单编辑·预览双模", () => {
    // ① 图片字段：与附件同一渲染分支，但上传三条路都过滤图片
    expect(DOC).toMatch(/"attachment" \| "image"/);
    expect(DOC).toMatch(/image: "图片"/);
    expect(DOC).toMatch(/export function isAttachmentLikeField/);
    expect(CARDS).toMatch(/case "image": return <ImageIcon/);
    expect(CARDS).toMatch(/function splitImageFiles/);
    expect(CARDS).toMatch(/accept=\{imageOnly \? "image\/\*" : undefined\}/);
    expect(CARDS).toMatch(/case "attachment":\s*\n\s*case "image":/);
    expect(VIEWPORT_CELL).toMatch(/imageOnly=\{imageOnly\}/);
    // 展示名必须是用户原始文件名（uploadResource 只回生成的磁盘名，不能拿它当 name）
    expect(EDITOR).toMatch(/name: file\.name/);

    // ② 画册：封面是可点按钮，点它只把**封面字段这一格**的图片交给共享 Lightbox（绝不跨列合并）
    expect(GALLERY).toMatch(/onOpenImages\(cellImages,/);
    expect(GALLERY).toMatch(/const cellImagesOf = /);
    expect(GALLERY).toMatch(/button\.bt-gallery-cover|className=\{\"bt-gallery-cover"/);
    expect(EDITOR).toMatch(/openImagePreview\(images\.map/);

    // ③ 表单：编辑/预览分段控件 + 默认规则 + 未配置不预选字段
    expect(FORM).toMatch(/编辑表单/);
    expect(FORM).toMatch(/预览表单/);
    expect(FORM).toMatch(/configured \? "preview" : "edit"/);
    // 表单双模页签也已切到 kit 层原语（260929：全部 tab 位置统一）
    expect(FORM).toMatch(/<div className="ln-tabs">/);
    expect(FORM).toMatch(/className=\{"ln-tabs__item" \+ \(mode === "edit" \? " is-active" : ""\)\}/);
    expect(FORM).not.toMatch(/seg__item/);
    // 编辑表单 = v1 原形态（表单题目 / 可选题目 / 填写表单），只是加了预览 tab
    expect(FORM).toMatch(/表单题目/);
    expect(FORM).toMatch(/可选题目/);
    // 「填写表单」= 跳到预览 tab，不再有独立录入弹层（用户 260928）
    expect(FORM).toMatch(/填写表单<\/button>/);
    expect(FORM).not.toMatch(/bt-form-entry/);
    expect(EDITOR).not.toMatch(/if \(type === "form"\) view\.formFieldIds/);
  });

  it("T01 列级统计：底部统计行 + 列菜单选口径（筛选后现算、不写记录）", () => {
    expect(DOC).toMatch(/export function computeColumnStat/);
    expect(DOC).toMatch(/export function statsForField/);
    expect(DOC).toMatch(/export function statForField/);
    expect(EDITOR).toMatch(/bt-stat-row/);
    // 统计格是**共用组件**（分组头与底部汇总行同一实现，禁止各写一套）
    expect(CARDS).toMatch(/export function StatCell/);
    expect(EDITOR).toMatch(/<StatCell /);
    expect(EDITOR.match(/<StatCell /g)?.length ?? 0).toBe(3);   // 分组头首列 + 分组头其余列 + 底部汇总行
    expect(EDITOR).not.toMatch(/"—"/);   // 未配置不再显示横杠
    expect(EDITOR).toMatch(/const setColumnStat = /);
    expect(EDITOR).toMatch(/setStatFor\(\{ fieldId, anchor \}\)/);
    expect(VIEWCSS).toMatch(/\.bt-stat-row td \{/);
    // 260929 用户定稿：底部汇总栏**常驻**（不再按有无配置条件渲染），首格缺省给总记录数
    expect(EDITOR).toMatch(/<tfoot>/);
    expect(EDITOR).not.toMatch(/visibleFields\.some\(\(field\) => statForField\(activeView, field\.id\)\)/);
    expect(EDITOR).toMatch(/bt-stat-index/);
    // 底部那条要**薄**（固定 24px，不随行高变）
    expect(VIEWCSS).toMatch(/\.bt-stat-row td \{[^}]*height: 24px/);
  });

  it("260929 定稿：分组汇总行固定 36px（不随行高变）+ 每列都有汇总位 + 状态栏上移让位", () => {
    // 分组汇总行固定「低」档 36px，不看 --bt-row-h
    expect(VIEWCSS).toMatch(/\.bt-group-cell \{[^}]*height: 36px/);
    expect(VIEWCSS).toMatch(/\.bt-group-stat \{[^}]*height: 36px/);
    // 每列都有汇总位：展示什么**完全由汇总方式决定**（用户 260929：选「无统计」就什么都不展示，
    // 不许兜底成「记录总数」）；未配置时留给 hover 才显形的「统计」占位。
    expect(EDITOR).toMatch(/stat=\{statForField\(activeView, headField\.id\)\}/);
    expect(EDITOR).not.toMatch(/statForField\(activeView, headField\.id\) \?\? "count"/);
    expect(VIEWCSS).toMatch(/\.bt-stat:not\(\.has-stat\)[^{]*\{[^}]*opacity: 0/);
    expect(VIEWCSS).toMatch(/\.bt-stat:not\(\.has-stat\):hover[^{]*\{[^}]*opacity: 1/);
    // 分组头随卡片白底；底部汇总栏改用**与表格区同一块底衬灰**（260929 用户：优化底栏与灰色背景融合）
    expect(VIEWCSS).toMatch(/\.bt-group-row \.bt-group-stat \{[^}]*background: var\(--lake-bg-panel\)/);
    expect(VIEWCSS).toMatch(/\.bt-stat-row td \{[^}]*background: var\(--lake-bg-subtle\)/);
    expect(VIEWCSS).toMatch(/\.bt-stat \{[^}]*justify-content: flex-end/);
    // 状态栏上移让位（多维表文档专属变体）
    expect(CHROME).toMatch(/\.document-statusbar\[data-doc-kind="bitable"\] \{/);
    // 列选中：点列外任意处即清（否则高亮残留）
    expect(EDITOR).toMatch(/onMouseDownCapture/);
    expect(EDITOR).toMatch(/dataset\.fieldId !== selectedColumnId/);
    // 已分组时**不再出表底那个 +**（每个分组各有自己的 +）；判定统一走 hasGroupRows（单一来源）
    expect(EDITOR).toMatch(/const hasGroupRows = useMemo\(\(\) => rowItems\.some\(\(item\) => item\.kind === "group"\)/);
    expect(EDITOR).toMatch(/trailing=\{!hasGroupRows \?/);
    // 分组 + 自己有空间（独立行高）但**不画行线**，也不骑在分组边线上
    expect(VIEWCSS).toMatch(/\.bt-group-add-row td \{[^}]*height: 32px/);
    expect(VIEWCSS).not.toMatch(/translateY\(-50%\)/);
    expect(VIEWCSS).not.toMatch(/\.bt-group-add-row td \{[^}]*position: absolute/);
    // 260929 修正：分组只支持一级；用单张白卡 + 连续边框/圆角表达，不再有多级规则或层级样式。
    expect(VIEWCSS).toMatch(/\.bt-group-start > td, \.bt-group-body > td, \.bt-group-end > td \{ background: var\(--lake-bg-panel\)/);
    expect(VIEWCSS).toMatch(/\.bt-group-start > td:first-child \{[^}]*border-top-left-radius/);
    expect(VIEWCSS).toMatch(/\.bt-grid \.bt-group-gap > td \{[^}]*border: 0/);
    expect(VIEWCSS).not.toMatch(/bt-in-level|bt-depth-|bt-region-start|bt-group-inner-gap/);
    expect(EDITOR).toMatch(/const groupRule = activeView\.groups\?\.\[0\]/);
    expect(EDITOR).toMatch(/const setGroup = /);
    expect(EDITOR).toMatch(/groupRecords\(activeTable, shownRecords, groupRule\)/);
    expect(EDITOR).not.toMatch(/BITABLE_MAX_GROUPS|groupRecordsTree|groupDragIndex|moveGroupRule|innerGap|setGroups/);
    // 260929 用户定稿：表底那条「已选择 N 个单元格」横条**删掉**——最底下只允许是汇总底栏
    expect(EDITOR).not.toMatch(/bt-grid-foot/);
    expect(CSS).not.toMatch(/\.bt-grid-foot/);
    expect(EDITOR).not.toMatch(/:\s*"共 " \+ activeTable\.records\.length \+ " 条记录"/);
  });

  it("260929 定稿：分组底衬（浅灰通道）+ 表头下间隙 + 「共 N 条」+ 底栏就是最底下那条", () => {
    // ① 分组底衬：卡片之外的分组通道走同一个浅灰面（表头下 20px / 加进本组 / 组间 / 末尾空白）
    expect(VIEWCSS).toMatch(/\.bt-group-head-gap > td \{[^}]*height: 20px/);
    expect(VIEWCSS).toMatch(/\.bt-group-head-gap > td \{[^}]*background: var\(--lake-bg-subtle\)/);
    expect(VIEWCSS).toMatch(/\.bt-group-add-row td \{[^}]*background: var\(--lake-bg-subtle\)/);
    expect(VIEWCSS).toMatch(/\.bt-grid \.bt-group-gap > td \{[^}]*background: var\(--lake-bg-subtle\)/);
    // 不分组时表格下方的空白是同一块面（用户 260929：表格区就是浅灰画布）⇒ 占位行不按分组条件分叉
    expect(VIEWCSS).toMatch(/\.bt-grid-filler td \{[^}]*background: var\(--lake-bg-subtle\)/);
    expect(VIEWCSS).not.toMatch(/is-grouped/);
    // 卡片本身仍是白底（灰只出现在卡外）
    expect(VIEWCSS).toMatch(/\.bt-group-start > td, \.bt-group-body > td, \.bt-group-end > td \{ background: var\(--lake-bg-panel\)/);
    // 令牌只允许定义在主题里（其它 CSS 里出现颜色字面量算缺陷）
    const THEME = readFileSync(new URL("../../styles/themes/light.css", import.meta.url), "utf8");
    // 261006 Phase 2（canon）：令牌值随主题刷新为 #fafbfc（仍是「比 panel 深一档、比 block 浅一档」的同一语义）。
    expect(THEME).toMatch(/--lake-bg-subtle: #fafbfc/);
    // 数据表选择区（.bt-tables）与表格区共用同一个底衬灰（用户 260929：风格要统一）
    expect(CSS).toMatch(/\.bt-tables \{[^}]*background: var\(--lake-bg-subtle\)/);
    expect(CSS).not.toMatch(/\.bt-tables \{[^}]*background: var\(--lake-bg-block\)/);
    // 表头与第一个分组之间的间隙只在**真的渲染出分组**时出现（配了分组但字段已删 → 不回落到未分组）
    expect(EDITOR).toMatch(/leading=\{hasGroupRows \? <tr className="bt-group-head-gap"/);
    // ② 卡片收口落在该组最后一条记录上（「加进本组」那一行在卡外，不属于卡片）
    expect(EDITOR).toMatch(/rowItems\[itemIndex \+ 1\]\?\.kind === "groupAdd"/);
    expect(EDITOR).not.toMatch(/className="bt-group-add-row bt-group-end"/);
    // ③ 选「记录总数」展示「共 N 条」（选择器里的选项文案仍是云端原文「记录总数」）
    expect(DOC).toMatch(/export function statDisplayText/);
    expect(CARDS).toMatch(/statDisplayText\(stat, computeColumnStat\(field, records, stat\)\)/);
    // 左下角 = **当前视图正在展示的记录数**（用户 260929：独立逻辑、不参与汇总计算、只随筛选/搜索变）
    expect(EDITOR).toMatch(/statDisplayText\("count", String\(shownRecords\.length\)\)/);
    expect(EDITOR).not.toMatch(/statDisplayText\("count", String\(activeTable\.records\.length\)\)/);
    // ④ 底栏是最底下那条：状态栏实测它的上沿、贴着它上沿停靠（不许压住底栏）
    expect(EDITOR).toMatch(/--lake-bitable-status-bottom/);
    expect(CHROME).toMatch(/bottom: var\(--lake-bitable-status-bottom/);
    // 必须量粘性 td（<tr> 是 static，内容溢出时会得到负值把状态栏顶出屏幕）
    expect(EDITOR).toMatch(/querySelector<HTMLElement>\("\.bt-stat-row td"\)/);
    // ⑤ 底栏最左格：**多选**才改显示选择量（用户 260929：例「选择 x 行」）；单选/未选仍是「共 N 条」
    expect(EDITOR).toMatch(/const selectionSummary = useMemo/);
    expect(EDITOR).toMatch(/selectedRecordIds\.size >= 2\) return "选择 " \+ selectedRecordIds\.size \+ " 行"/);
    expect(EDITOR).toMatch(/if \(count >= 2\) return "选择 " \+ count \+ " 个单元格"/);
    expect(EDITOR).toMatch(/selectionSummary \?\? statDisplayText\("count"/);
    expect(VIEWCSS).toMatch(/\.bt-stat-index\.is-selection \{[^}]*color: var\(--lake-accent-text\)/);
    // ⑥ 汇总行「整行处理」：行内不画单元格竖线；光标落在哪一格就把那一格加重一档
    expect(VIEWCSS).toMatch(/\.bt-group-row > td:not\(:last-child\), \.bt-stat-row > td:not\(:last-child\) \{ border-right-width: 0; \}/);
    expect(VIEWCSS).toMatch(/\.bt-stat-row > td:not\(:empty\):hover \{ background: var\(--lake-bg-block\)/);
    expect(VIEWCSS).toMatch(/\.bt-group-row \.bt-group-stat:not\(:empty\):hover \{ background: var\(--lake-bg-block\)/);
    // 统计格不再有竖线（分组头首列统计与其余列统计都不画）
    expect(VIEWCSS).not.toMatch(/\.bt-group-head-stat \{[^}]*border-left/);
    expect(VIEWCSS).not.toMatch(/\.bt-stat-row \.bt-stat-cell \{/);
    // ⑦ 表格线走**更浅一档**的 --lake-border-2（用户 260929：「和远端一样，线的颜色变浅一点」；
    //    云端实测格线 rgb(244,245,245)）。只换线色，不动线宽/线位 —— 去边框会动列宽，色值不会。
    expect(CSS).toMatch(/\.bt-grid th, \.bt-grid td \{ border-right: 1px solid var\(--lake-border-2\); border-bottom: 1px solid var\(--lake-border-2\)/);
    expect(CSS).toMatch(/\.bt-grid thead th \{[^}]*border-bottom: 1px solid var\(--lake-border-2\)/);
    expect(VIEWCSS).toMatch(/\.bt-group-start > td:first-child[^}]*border-left: 1px solid var\(--lake-border-2\)/);
    expect(VIEWCSS).toMatch(/\.bt-group-end > td \{ border-bottom: 1px solid var\(--lake-border-2\)/);
    // ⑧ ＋号居中放在**编号列正下方**（用户 260929）：两处添加入口都用 .bt-add-index 独占编号列那一格
    expect(EDITOR.match(/<td className="bt-add-index">/g)?.length ?? 0).toBe(2);   // 加进本组 + 表底添加记录
    expect(VIEWCSS).toMatch(/\.bt-add-index \{ text-align: center; \}/);
    expect(VIEWCSS).not.toMatch(/\.bt-group-add-row \.bt-add-round \{ margin-left/);
    // ⑨ 三个规则面板（筛选 / 排序 / 分组）的删除按钮**同一套**：行尾的 .bt-icon-btn + Trash2（用户 260929：
    //    「说了多少次了，样式保持一致」）——分组原先用的是行首的 ✕ + 「取消分组」，已改齐。
    //    三个规则面板的删除按钮都长这样（选项面板里那条「删除选项」是第四处，同款，一并计入）
    expect(EDITOR.match(/className="bt-icon-btn" title="删除/g)?.length ?? 0).toBe(3);
    for (const label of ["删除排序", "删除分组"]) {
      expect(EDITOR).toMatch(new RegExp(`className="bt-icon-btn" title="${label}" aria-label="${label}"`));
    }
    expect(FILTER_EDITOR).toMatch(/删除规则/);
    expect(EDITOR).toMatch(/title="删除分组" aria-label="删除分组"/);
    expect(EDITOR).not.toMatch(/title="取消分组"/);
    // ⑩ 链接格（260929 对齐云端）：**展示文本 + 右端 🔗 图标**（点它用本地浏览器打开），**不再常驻输入框**
    //    —— 常驻输入框会在选中时和单元格自己的 2px 选中环叠成「两层边框」（用户报的就是这个）；
    //    编辑改为双击进入（Enter/失焦提交、Esc 取消）。
    expect(CARDS).toMatch(/className="bt-link-text ln-ellipsis"/);
    expect(CARDS).toMatch(/className="bt-link-open"/);
    expect(CARDS).toMatch(/window\.open\(text\.trim\(\), "_blank", "noopener"\)/);
    expect(CARDS).toMatch(/onDoubleClick=\{\(\) => \{ if \(!readOnly\)/);
    expect(FIELD_CSS).toMatch(/\.bt-link-text \{[^}]*flex: 1 1 auto/);   // 布局留在业务规则；截断走 kit 的 .ln-ellipsis
    //    展示态**没有常驻输入框**（编辑态才有；旧实现是常驻 input + readOnly）
    const linkCellSource = CARDS.slice(CARDS.indexOf("function LinkCell"), CARDS.indexOf("function StatCell"));
    expect(linkCellSource).toContain("bt-link-text");
    expect(linkCellSource).not.toContain("readOnly={readOnly}");
    //    两层边框的根因修复：单元格自己已有 2px 选中环（单格四条边）时，格内输入框不再叠一层焦点环
    expect(CSS).toMatch(/\.bt-td\.cell-selected\.sel-top\.sel-bottom\.sel-left\.sel-right \.bt-cell-input:focus \{ outline: 0; \}/);
  });

  it("筛选条件输入只留一条主色边（不再「1px 边 + 2px 内描边」两条，用户 261022 点单统一）", () => {
    expect(FILTER_CSS).toMatch(/\.bt-filter-input:focus, \.bt-filter-value-trigger:focus \{[^}]*border-color: var\(--lake-accent\)/);
    expect(FILTER_CSS).toMatch(/\.bt-filter-input:focus, \.bt-filter-value-trigger:focus \{[^}]*outline: 0/);
    // 旧的 2px 内描边不许回流（那会和 1px 边叠成两个边框）
    expect(FILTER_CSS).not.toMatch(/outline: 2px/);
  });

  it("数据表行内重命名复用 .bt-input 字段原语（不再自带主色边 ⇒ 无「两个边框」，用户 261022）", () => {
    // 旧实现：.bt-inline-input 自己写 border: 1px solid accent，又叠上全局 :focus-visible 的 2px 描边 = 两个边框。
    // 根因修法：外观交给 .bt-input（:focus = 主色边 + 2px 柔光环 + outline: 0），行内只留布局。
    expect(EDITOR).toMatch(/className="bt-input bt-inline-input"/);
    expect(CSS).toMatch(/\.bt-inline-input \{[^}]*flex: 1/);
    expect(CSS).not.toMatch(/\.bt-inline-input \{[^}]*border: 1px solid var\(--lake-accent\)/);
    // 复用前提：.bt-input 的 focus 口径本身就是「主色边 + 柔光环 + outline: 0」，没有硬描边
    expect(CSS).toMatch(/\.bt-input:focus \{ border-color: var\(--lake-accent\); box-shadow: 0 0 0 2px var\(--lake-focus-halo\); outline: 0; \}/);
    // 行内重命名**只留这一条主色边**：它在选中行（accent-tint 底）里，柔光环会再围一圈浅色边框（用户 261022 复报）
    expect(CSS).toMatch(/\.bt-inline-input:focus \{ box-shadow: none; \}/);
  });

  it("追加修复：文档图片预览取正文全量、看板图片字段出缩略图", () => {
    // ① 文档：虚拟渲染下 DOM 只有视口内的图 ⇒ 列表必须来自正文（内核 image 卡片 + 裸 img）
    expect(PREVIEW).toMatch(/export function extractImagesFromContent/);
    // 图片预览永远只看**本单元格**：chip 与展开面板都按单元格内图片过滤（两列图片绝不混）
    expect(CARDS).toMatch(/onOpenImages\?: \(images: BitableAttachment\[\], index: number\)/);
    expect(CARDS).toMatch(/attachments\.filter\(\(a\) => isImageExtension\(extOf\(a\.file\)\)\)/);
    // 展示名守卫：落盘名（磁盘名）绝不外显、也不可编辑（展示名才可编辑）
    expect(DOC).toMatch(/function bitableDisplayName/);
    expect(ATTACH_CTRL).toMatch(/isAssetFilename\(name\)/);
    expect(CARDS).toMatch(/renameBitableAttachment|onRename\(file/);
    expect(PREVIEW).toMatch(/previewImageKey/);
    expect(EDITOR_TAB).toMatch(/extractImagesFromContent/);
    expect(PREVIEW).toMatch(/attachImagePreviewClick\(host: HTMLElement, resolveImages\?/);
    // ② 看板：附件类字段上卡**复用同一套 AttachmentChipList**（260930 收敛，见「看板卡片复用同一套」那条护栏），
    //    图片字段仍是缩略图（imageOnly），不再拿文件名占位
    expect(KANBAN).toMatch(/<AttachmentChipList noteId=\{noteId\} attachments=\{files\} imageOnly=\{field\.type === "image"\}/);
    expect(KANBAN).toMatch(/isAttachmentLikeField\(field\.type\)/);
    // 点缩略图 = 预览该单元格内的图片（不跨字段，onOpenImages 由 AttachmentChipList 透传）；卡片点击仍开记录详情
    expect(KANBAN).toMatch(/onOpenImages=\{onOpenImages\}/);
    expect(KANBAN).toMatch(/className="bt-card-files" onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
    expect(FILE_ICON_CSS).toMatch(/\.bt-card-files \{/);
  });

  it("浮层定位：统一「先量真实尺寸 → 贴底翻上方」，禁止再用估算高度夹视口", () => {
    // 老坑：靠猜的高度去夹 innerHeight - N。多维表日期选择器曾用 48 ⇒ 贴底被裁且不翻转（用户报过多次）。
    expect(CARDS).toContain("usePopoverPosition(");
    expect(CARDS).not.toMatch(/window\.innerHeight - 48/);
    expect(CARDS).not.toMatch(/window\.innerHeight - 260/);
    expect(EDITOR).toContain("usePopoverPosition(");
    expect(EDITOR).not.toMatch(/window\.innerHeight - 90/);
    expect(EDITOR).not.toMatch(/window\.innerHeight - 300/);
    // 共用实现：垂直方向唯一口径 = 下方优先 → 翻上方 → 夹视口
    expect(POS).toMatch(/export function placeVertical/);
    expect(POS).toMatch(/export function placePopoverPosition/);
    expect(POS).toMatch(/export function placePopoverAtPoint/);
    expect(HOOK).toContain("placePopoverPosition");
    expect(HOOK).toContain("ResizeObserver");
  });

  it("评分/进度对齐云端：空星实心可辨、进度条可按压拖动", () => {
    // ① 评分：未选中星不能是「浅色空心」（用户 260928 报「看不见」）——一律实心，颜色交给 CSS 令牌
    expect(CARDS).toMatch(/<Star size=\{14\} fill="currentColor" \/>/);
    expect(CARDS).not.toContain('fill={index < current ? "currentColor" : "none"}');
    expect(FIELD_CSS).not.toContain("--lake-border-2");
    expect(FIELD_CSS).toMatch(/\.bt-star \{[^}]*color: var\(--lake-border-strong\)/);
    expect(FIELD_CSS).toMatch(/\.bt-star\.is-on \{[^}]*color: var\(--lake-rating-star\)/);
    // ② 进度：轨道按压即跟手（pointerdown 起、document 上 pointermove/up 收），只读态不接指针
    expect(CARDS).toMatch(/startDrag = \(event: ReactPointerEvent<HTMLSpanElement>\) => \{[\s\S]{0,80}?if \(readOnly\) return;/);
    expect(CARDS).toMatch(/className=\{"bt-progress" \+ \(readOnly \? " is-readonly" : ""\)\}/);
    expect(CARDS).toMatch(/onPointerDown=\{startDrag\}/);
    expect(CARDS).toMatch(/document\.addEventListener\("pointermove", onMove\)/);
    // 圆形把手是「可拖动」的可见证据；轨道不能 overflow:hidden（会裁掉把手）
    expect(CARDS).toMatch(/bt-progress-thumb/);
    expect(FIELD_CSS).toMatch(/\.bt-progress-thumb \{/);
    expect(FIELD_CSS).toMatch(/\.bt-progress \{ position: relative/);
    // 数值输入框已整体删除：进度只由「条 + 百分比」表达（用户 260929）
    expect(CARDS).not.toMatch(/bt-progress-input/);
    expect(FIELD_CSS).not.toMatch(/bt-progress-input/);
    // 但键盘可达不能丢：轨道即 role=slider（方向键步进 / PageUpDown ±10 / Delete 清空）
    expect(CARDS).toMatch(/role="slider"/);
    expect(CARDS).toMatch(/onKeyDown=\{onKeyDown\}/);
    expect(CARDS).toMatch(/event\.key === "PageUp" \? 10/);
    expect(FIELD_CSS).not.toMatch(/\.bt-progress \{[^}]*overflow: hidden/);
  });

  it("关联字段的「关联数据表」：「选择数据表」只是触发器的占位，不是下拉选项", () => {
    // 用户 260929（附图）：占位文案被当成一条可选项，还被打上勾 ⇒ options 只列同一文档内的其它数据表
    expect(EDITOR).toMatch(/placeholder="选择数据表"/);
    expect(EDITOR).not.toMatch(/label: "选择数据表"/);
    // 目标表选择器仍只排除本表（关联不跨表文件、不做数据范围筛选）
    expect(EDITOR).toMatch(/tables\.filter\(\(table\) => table\.id !== tableId\)/);
  });

  it("默认数据表（260929 用户口径）：只有 1 列文本 + 3 行空白记录", () => {
    // 产品默认表 = 1 列文本 + 3 行空白；编辑器的「新建数据表」与空正文兜底都走同一函数（单一来源）
    expect(DOC).toMatch(/const records = \[createBitableRecord\(\), createBitableRecord\(\), createBitableRecord\(\)\]/);
    expect(DOC).toMatch(/return \{ id, name, fields: \[primary\], records, views: \[grid\], activeViewId: grid\.id \}/);
    // 原先预置的「单选（待开始/进行中/已完成）」「日期」不再出现在默认表里
    expect(DOC).not.toMatch(/createBitableFieldOptions\(\["待开始", "进行中", "已完成"\]/);
    expect(EDITOR).toMatch(/createDefaultBitableTable\("数据表 " \+ \(prev\.tables\.length \+ 1\)\)/);
    expect(EDITOR).toMatch(/const table = createDefaultBitableTable\(\);/);
  });

  it("关联选择器：图片/附件格真渲染（用户 260929 要求「不能只给一个名称」）", () => {
    // 260930 起渲染**统一到表格那套** AttachmentChipList（见下一条护栏），这里只锁「真的渲染出来」+ 资产 URL 来源
    expect(PICKER).toMatch(/<AttachmentChipList noteId=\{noteId\} attachments=\{files\}/);
    expect(CARDS).toMatch(/<FileKindIcon name=\{name\} \/>/);
    expect(CARDS).toMatch(/imageOnly\s*\n?\s*\? <img src=\{chipUrlOf\(file\)\} alt=\{name\}/);
    // 资产 URL 单一来源：单元格 / 看板 / 画册 / 选择器都走 bitableAssetUrl
    expect(ASSET_URL).toMatch(/export function bitableAssetUrl/);
    expect(CARDS).toMatch(/bitableAssetUrl\(noteId, file, ATTACHMENT_CHIP_PX\)/);
    expect(CARDS).toMatch(/bitableAssetUrl\(noteId, file, ATTACHMENT_CARD_PX\)/);
    // 260930：看板卡片也改用 AttachmentChipList（内部走 bitableAssetUrl），不再自拼缩略图 URL
    expect(KANBAN).not.toMatch(/bitableAssetUrl\(/);
    expect(KANBAN).toMatch(/<AttachmentChipList noteId=\{noteId\}/);
    expect(GALLERY).toMatch(/bitableAssetUrl\(noteId, file, GALLERY_COVER_PX\)/);
    // noteId / onOpenImages 从三个入口（表格、记录详情、表单）透传到选择器
    expect(EDITOR).toContain("openImages={openImages}");
    expect(VIEWPORT_CELL).toContain("onOpenImages={p.openImages}");
    expect(DRAWER).toMatch(/noteId=\{props\.noteId\}\n\s*onOpenImages=\{props\.onOpenImages\}/);
    expect(FORM).toMatch(/noteId=\{props\.noteId\}\n\s*onOpenImages=\{props\.onOpenImages\}/);
  });

  it("表头「新增字段」的 + 贴着左侧最后一列（不是被 th 默认居中甩到空白区中央）", () => {
    // 用户 260930（附图）：那一格是表尾自动宽度的单元格（吸收剩余宽度），th 浏览器默认 text-align:center
    // ⇒ 加号落在空白区正中、离最后一列很远。只把内容左对齐，列宽语义不变。
    expect(EDITOR).toMatch(/<th className="bt-th-add">[\s\S]{0,220}?className="bt-add-round" title="新增字段"/);
    // 必须带 `.bt-grid th.` 前缀：`.bt-grid th { padding: 0 }` 是 (0,1,1)，裸 `.bt-th-add` 是 (0,1,0) 压不过
    expect(VIEWCSS).toMatch(/\.bt-grid th\.bt-th-add \{ text-align: left; padding-left: 8px; \}/);
    // 不能把这一格变成固定宽度（那会把剩余宽度摊给数据列 ⇒ 列宽被撑开）；也不许居中
    expect(VIEWCSS).not.toMatch(/\.bt-th-add \{[^}]*text-align: center/);
  });
});

describe("AI 字段护栏（261003 · 单一类型 / 命令在字段里 / 手动生成）", () => {
  it("单一字段类型：core 注册 ai + 工厂给空配置；单元格图标与分派就位", () => {
    expect(DOC).toContain('| "relationOneWay" | "relationTwoWay" | "ai"');
    expect(DOC).toContain('ai: "AI 字段"');
    expect(DOC).toMatch(/if \(type === "ai"\) field\.ai = \{ prompt: "" \};/);
    expect(DOC).toContain("export function buildAiFieldMessages");
    expect(DOC).toContain("export function aiPromptFieldNames");
    expect(CARDS).toContain('case "ai": return <Sparkles size={size} />;');
    expect(CARDS).toMatch(/case "ai":\s*\n\s*return <AiFieldCell/);
  });

  it("单元格：未配置 / 生成中 / 失败重试 / 重新生成 状态齐全；生成只能手动触发（只读与无回调都不出按钮）", () => {
    expect(CARDS).toContain("export function AiFieldCell");
    expect(CARDS).toMatch(/aria-label="生成中"/);
    expect(CARDS).toContain("生成失败，重试");
    expect(CARDS).toContain("重新生成");
    expect(CARDS).toContain("未配置");
    expect(CARDS).toMatch(/const canGenerate = !readOnly && Boolean\(onGenerate\) && configured/);
    expect(CARDS).toContain('aiPromptFieldNames(field.ai?.prompt ?? "")');
  });

  it("字号一律走令牌：多维表 CSS 不允许出现任何 font-size 字面量（261008 收敛批）", () => {
    const dir = new URL("./", import.meta.url);
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".css"))) {
      const text = readFileSync(new URL(file, dir), "utf8");
      for (const hit of text.match(/font-size:\s*[0-9.]+px/g) ?? []) offenders.push(file + ": " + hit);
    }
    expect(offenders).toEqual([]);
  });

  it("表正文一律 body；表头与内容**同级**、展开面板正文大半档（261008 用户口径）", () => {
    const ED = readFileSync(new URL("./bitableEditor.css", import.meta.url), "utf8");
    const FIELD_CELLS = readFileSync(new URL("./bitableFieldCells.css", import.meta.url), "utf8");
    const MARKDOWN = readFileSync(new URL("../../components/ui/markdown/markdown.css", import.meta.url), "utf8");
    const EXPAND = readFileSync(new URL("./bitableExpandPreview.css", import.meta.url), "utf8");
    // 单元格内容：文本 / 选项 chip / 附件名 / 关联回退 / 系统时间 全部同号
    expect(ED).toMatch(/\.bt-cell-input \{[^}]*font-size: var\(--lake-font-size-body\)/);
    expect(ED).toMatch(/\.bt-option-chip \{[^}]*font-size: var\(--lake-font-size-body\)/);
    expect(ED).toMatch(/\.bt-attachment-name \{[^}]*font-size: var\(--lake-font-size-body\)/);
    expect(ED).toMatch(/\.bt-cell-unknown, \.bt-cell-relation, \.bt-cell-muted \{[^}]*font-size: var\(--lake-font-size-body\)/);
    expect(FIELD_CELLS).toMatch(/\.bt-link-text \{[^}]*font-size: var\(--lake-font-size-body\)/);
    // 表头与内容**同级**（用户 261008：表头缩小到和内容一致）
    expect(ED).toMatch(/\.bt-th-inner \{[^}]*font-size: var\(--lake-font-size-body\)/);
    expect(ED).not.toMatch(/\.bt-th-inner \{[^}]*font-size: var\(--lake-font-size-bodyLg\)/);
    // 展开面板：容器（文本展开 textarea / MD·AI 展开编辑）与 MD 预览都大半档（+0.5px）
    expect(ED).toMatch(/\.bt-text-expand-body \{[^}]*font-size: var\(--lake-font-size-bodyMd\)/);
    expect(EXPAND).toMatch(/\.bt-md-expand-preview \.md-preview \{\s*font-size: var\(--lake-font-size-bodyMd\)/);
    // 共用 .md-preview（AI 助手面板正文）仍是 body，不被多维表拉大
    expect(MARKDOWN).toMatch(/\.md-preview \{[^}]*font-size: var\(--lake-font-size-body\)/);
  });

  it("AI 单元格「生成中」带停止（只停本格，用户 261008）；视觉复用既有原语、不新增 CSS", () => {
    expect(CARDS).toMatch(/aria-label="生成中"[\s\S]{0,400}?停止<\/button>/);
    expect(CARDS).toContain("onStop?: () => void");
    expect(CARDS).toContain('className="bt-cell-ai-action" title="停止本次生成"');
    // 网格把「停止」接到 hook 的**按格**取消
    expect(VIEWPORT_CELL).toContain("onAiStop={field.type === \"ai\"");
    expect(EDITOR).toContain("cancelCell={aiGen.cancelCell}");
    expect(VIEWPORT_CELL).toContain("p.cancelCell(recordId, field.id)");
    // 按格取消只中止该格这次的 requestId（与整列的 cancelledRef 分开）
    expect(AI_HOOK).toContain("const cancelCell = useCallback((recordId: string, fieldId: string)");
    expect(AI_HOOK).toContain("cellRequestRef");
    expect(AI_HOOK).toContain("cancelledCellsRef");
  });

  it("编辑器：整列生成走 hook（整批一次撤销）+ 列菜单入口（只读禁用）+ 对话框；值走 mutations 单一闸口", () => {
    expect(EDITOR).toContain("useAiFieldGeneration({");
    expect(EDITOR).toMatch(/aiGen\.cellStates\[aiCellKey\(field\.id, record\.id\)\]/);
    expect(EDITOR).toContain("AI 生成整列");
    expect(EDITOR).toMatch(/disabled=\{readOnly\}\s*\n\s*onClick=\{\(\) => \{ setAiGenerateFieldId/);
    expect(EDITOR).toContain("BitableAiGenerateDialog");
    expect(EDITOR).toMatch(/void aiGen\.runBatch\(activeTable\.id, field\.id, ids\)/);
    expect(VIEWPORT_CELL).toContain("onAiGenerate={field.type === \"ai\"");
    expect(EDITOR).toContain("renameAiFieldToken(f, oldName, nextName)");
  });

  it("hook：并发自限 3 / 可取消 / begin-endGesture 包裹 / core 组装请求 / 不自动重跑", () => {
    expect(AI_HOOK).toContain("export const AI_GENERATE_CONCURRENCY = 3");
    expect(AI_HOOK).toContain("buildAiFieldMessages(latest.current.docRef.current");
    expect(AI_HOOK).toContain("setBitableCellValue(prev, tableId, recordId, fieldId, text)");
    expect(AI_HOOK).toContain("latest.current.beginGesture()");
    expect(AI_HOOK).toContain("latest.current.endGesture()");
    expect(AI_HOOK).toContain("void cancelAiChat(requestId)");
    expect(AI_HOOK).toContain("if (latest.current.isReadOnly()) return;");
    // 生成前显式确认（对话框里有费用/发送说明），不是后台自动跑
    expect(AI_DIALOG).toContain("将逐条调用你配置的 AI 服务");
    expect(AI_HOOK).not.toMatch(/useEffect\([^)]*runBatch/);
  });

  it("字段编辑器：命令 + 上下文字段（候选不含自己）；表单与 CSV 不吃 AI 字段", () => {
    expect(EDITOR).toContain("命令（AI 按它生成内容；字段变量插在命令里）");
    expect(EDITOR).toContain("插入字段");
    expect(EDITOR).toContain("insertAiToken");
    expect(EDITOR).toMatch(/filter\(\(candidate\) => candidate\.id !== field\?\.id\)/);
    expect(FORM).toContain("!isAiFieldType(f.type)");
    expect(CSV).toContain("AI 字段由生成产生，不能从 CSV 导入");
    // 样式走新文件且由使用方 import（AGENTS §3 #14：新 CSS 必须登记 + 被 import）
    expect(AI_CSS).toContain(".bt-cell-ai");
    expect(CARDS).toContain('import "./bitableAiField.css";');
  });
});

describe("Markdown 字段与展开浮窗护栏（261004）", () => {
  const MD = readFileSync(new URL("../../components/ui/markdown/MarkdownView.tsx", import.meta.url), "utf8");
  const MD_CSS = readFileSync(new URL("../../components/ui/markdown/markdown.css", import.meta.url), "utf8");

  it("字段类型注册 + 单元格分派 + 图标", () => {
    expect(DOC).toContain('| "ai" | "markdown"');
    expect(DOC).toContain('markdown: "Markdown"');
    expect(CARDS).toContain('case "markdown": return <TextQuote size={size} />;');
    expect(CARDS).toMatch(/case "markdown":\s*\n\s*return <MarkdownCell/);
    // 文本口径：筛选操作符/值类型都按文本（markdown 与 ai 同组）
    expect(DOC).toMatch(/field\.type === "markdown"\) \{/);
  });

  it("展开浮窗：共用壳（单一来源）+ 编辑·预览走 ln-segment 原语 + AI 头部重新生成（261004-b 样式归位）", () => {
    expect(CARDS).toContain("function ExpandPanel(");
    expect(CARDS.match(/<ExpandPanel anchor=\{anchor\}/g)).toHaveLength(2);
    expect(CARDS).toContain('aria-label="编辑或预览"');
    expect(CARDS).toContain('className={"ln-segment__item" + (mode === "edit" ? " is-active" : "")}');
    expect(CARDS).toContain('onClick={() => setMode("preview")}');
    expect(CARDS).toMatch(/onRegenerate=\{canGenerate \? onGenerate : undefined\}/);
    expect(CARDS).toContain("重新生成");
    expect(CARDS).toContain('className="bt-secondary"');
    expect(CARDS).toContain('remember="text"');
    expect(CARDS).toContain('remember="md"');
    expect(CARDS).toContain("local-lakex-notes-v3.bitable-expand-size");
    // 不再用 legacy 分段（.seg / b3-button--outline），也不再自写繁写头 / 小按钮规则
    expect(CARDS).not.toMatch(/seg__item/);
    expect(CARDS).not.toContain("bt-md-expand-head");
    expect(CARDS).not.toContain("bt-md-expand-regen");
  });

  it("样式归位：字号 / 间距 / 圆角全走令牌（无字面量、无颜色字面量）；说明文字走既有 .bt-field-label-text", () => {
    const AI_FIELD_CSS = readFileSync(new URL("./bitableAiField.css", import.meta.url), "utf8");
    for (const css of [MD_CSS, AI_FIELD_CSS]) {
      expect(css).not.toMatch(/(font-size|gap|margin[a-z-]*|padding[a-z-]*):\s*[^;]*\d+px/);
      expect(css).not.toMatch(/border-radius:\s*\d+px/);
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    }
    expect(EDITOR).toContain("bt-field-label-text");
    expect(EDITOR).toContain("ln-tag ln-tag--error");
    expect(EDITOR).not.toMatch(/bt-ai-dialog-note|bt-ai-dialog-summary|bt-ai-warn|bt-ai-prompt-wrap/);
  });

  it("Markdown 渲染器：子集渲染 + 单行纯文本预览 + 不用 innerHTML + 链接只认 http(s)", () => {
    expect(MD).toContain("export function MarkdownView");
    expect(MD).toContain("export function markdownToPlainText");
    expect(MD).toContain("export function parseMarkdownBlocks");
    expect(MD).not.toContain("dangerouslySetInnerHTML");
    expect(MD).toContain("^https?:");
    expect(MD_CSS).toContain(".md-preview");
    expect(CARDS).toContain('import "./bitableMarkdown.css";');
  });

  it("AI 字段复用 Markdown 单元格（值按 MD 预览/展开；手动编辑走同一 onChange 写回）", () => {
    expect(CARDS).toMatch(/return <MarkdownCell field=\{field\} value=\{value\} readOnly=\{readOnly\} onChange=\{onChange\} onRegenerate=/);
  });
});

/**
 * 多模态护栏（261006）：AI 字段可把被引用的图片 / PDF 作为内容块一并发送。
 * 锁死三件事：字段配置开关、构建器只对 image/attachment 且只对 PDF 出 document 块、渲染层传 noteId。
 */
describe("AI 字段多模态护栏（261006 · 图片 / PDF）", () => {
  it("core：配置带 includeAttachments；图片 / PDF 出内容块，其它附件不进", () => {
    expect(DOC).toContain("includeAttachments?: boolean");
    expect(DOC).toContain("AI_FIELD_MAX_IMAGES");
    expect(DOC).toContain("AI_FIELD_MAX_DOCUMENTS");
    expect(DOC).toContain('parts.push({ type: "image", asset })');
    expect(DOC).toContain('parts.push({ type: "document", asset })');
    expect(DOC).toMatch(/extOf\(attachment\.file\)[\s\S]*"pdf"/);
  });

  it("渲染层：hook 传 noteId；编辑器有「图片 / PDF 一起发送」开关并保存该配置", () => {
    expect(AI_HOOK).toContain("{ noteId: latest.current.noteId }");
    expect(EDITOR).toContain("includeAttachments: true");
    expect(EDITOR).toContain("把引用的图片 / PDF 一起发送给 AI");
  });
});
