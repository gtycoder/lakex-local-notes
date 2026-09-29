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
const EDITOR_TAB = readFileSync(new URL("../editor/LakeEditor.tsx", import.meta.url), "utf8");
const DOC = readFileSync(new URL("../../core/bitableDoc.ts", import.meta.url), "utf8");
const CARDS = readFileSync(new URL("./bitableCells.tsx", import.meta.url), "utf8");
const PICKER = readFileSync(new URL("./BitableRelationPicker.tsx", import.meta.url), "utf8");
const ASSET_URL = readFileSync(new URL("./bitableAssetUrl.ts", import.meta.url), "utf8");
const DRAWER = readFileSync(new URL("./BitableRecordDrawer.tsx", import.meta.url), "utf8");
const BAR = readFileSync(new URL("./BitableViewBar.tsx", import.meta.url), "utf8");
const VIEWS = readFileSync(new URL("./bitableViews.tsx", import.meta.url), "utf8");
const VIEWCSS = readFileSync(new URL("./bitableViews.css", import.meta.url), "utf8");
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
    expect(EDITOR).toMatch(/openAssetEntry\([\s\S]{0,240}?attachment\.size/);
    expect(EDITOR).not.toMatch(/openAssetEntry\([\s\S]{0,240}?,\s*0,\s*\{\s*kindFrom/);
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

  it("列菜单：列头右键也能开、四条快捷项彻底删除、文本颜色锚到列头（260928 用户）", () => {
    // 1) 列头右键 = 列菜单（坐标定位）
    expect(EDITOR).toMatch(/onContextMenu=\{\(event\) => \{[\s\S]{0,240}?openColumnMenu\(field\.id, event\.clientX, event\.clientY, event\.currentTarget\)/);
    expect(EDITOR).toMatch(/openColumnMenu\(/);
    // 2) 「按本列分组/按本列筛选/升序/降序」四条快捷项删除（工具栏已有分组/筛选/排序）
    for (const label of ["按本列分组", "按本列筛选", "升序</button>", "降序</button>"]) expect(EDITOR).not.toContain(label);
    // 3) 调色板锚到列头：⋯ 按钮 hover 才 display，菜单一关量到的 rect 是 0×0 → 浮层跑左上角
    expect(EDITOR).toMatch(/const anchor = columnMenu\.header;/);
    expect(EDITOR).toMatch(/if \(anchor\) setTextColorFor\(\{ fieldId, anchor \}\)/);
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
    expect(CARDS).toMatch(/ColorPalette/);
    expect(DOC).toMatch(/BITABLE_OPTION_PALETTE/);
  });

  it("字段编辑弹窗：进度字段的颜色面板不被「选项编辑器」块吞掉（260929-OPT 修）", () => {
    // 真 bug：进度字段 supportsOptions=false，而颜色面板曾被写在 {supportsOptions && ...} 块内
    // ⇒ 点色块永远打不开面板。这里用源码顺序锁死：面板必须在「添加选项」按钮之后（bug 时在其前）。
    const optionsBtnIdx = EDITOR.indexOf("添加选项</button>");
    const progressPaletteIdx = EDITOR.indexOf("onPick={(color) => setProgressColor(color)}");
    expect(optionsBtnIdx).toBeGreaterThan(-1);
    expect(progressPaletteIdx).toBeGreaterThan(optionsBtnIdx);
    expect(EDITOR).toMatch(/进度字段的颜色面板/);
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
    // A6 删字段清理所有视图里指向它的配置
    expect(EDITOR).toMatch(/next\.highlightDuplicateFieldIds = strip\(next\.highlightDuplicateFieldIds\)/);
    expect(EDITOR).toMatch(/next\.columnStats\?\.\[fieldId\]/);
    // A5 statForField 不走原型链
    expect(DOC).toMatch(/Object\.prototype\.hasOwnProperty\.call\(BITABLE_STAT_LABEL, stat\)/);
    // 单一来源：移动端附件判定复用 isAttachmentLikeField
    expect(MOBILE).toMatch(/isAttachmentLikeField\(field\.type\)/);
    // 令牌唯一来源：桌面组件 CSS 不再有颜色字面量（抽屉阴影除外，无对应令牌）
    expect(CSS).not.toMatch(/#fff|#1f1f1f/);
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
    expect(PICKER).toMatch(/filterOperatorsFor\(/);
    expect(PICKER).toMatch(/sortModesForField\(/);
    // 主区域 = 目标表整表（每个字段一列），值统一走 bitableFieldText
    expect(PICKER).toMatch(/fields\.map\(\(item\) => <th key=\{item\.id\}/);
    expect(PICKER).toMatch(/bitableFieldText\(record, item, ctx\)/);
    // 可关联范围走 core 单一口径；草稿经 toggleRelationDraft；确认才写正文
    expect(PICKER).toMatch(/relationCandidateRecords\(ctx, field\)/);
    expect(PICKER).toMatch(/toggleRelationDraft\(prev, recordId, allowMultiple\)/);
    expect(PICKER).toMatch(/onClick=\{\(\) => onConfirm\(\[\.\.\.draft\]\)\}/);
    // 不做「添加记录」（用户 260929 明确）—— 页脚只有「已选 N 条记录 / 取消 / 确认」三件
    expect(PICKER).not.toMatch(/添加记录<\/button>|新建记录<\/button>/);
    expect(PICKER).toMatch(/className="bt-rel-foot"/);
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

  it("T02B.3 双向关联：反向字段 / 双向镜像唯一写入口 / 删一侧解除配对", () => {
    expect(DOC).toMatch(/export function relationReverseFieldName/);
    expect(DOC).toMatch(/export function createRelationPair/);
    expect(DOC).toMatch(/export function applyRelationMirror/);
    expect(DOC).toMatch(/export function unpairRelationFields/);
    expect(EDITOR).toMatch(/双向关联（在目标表生成反向字段）/);
    expect(EDITOR).toMatch(/createRelationPair\(prev\.tables/);
    expect(EDITOR).toMatch(/unpairRelationFields\(prev\.tables/);
    // 关联字段的写值必须走镜像入口（否则双向会不同步）
    expect(EDITOR).toMatch(/applyRelationMirror\(prev\.tables, tableId, fieldId, recordId, relationRecordIds\(value\)\)/);
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

  it("附件打开走公共入口（图片 Lightbox / 音视频内嵌 / 其它系统）", () => {
    expect(EDITOR).toMatch(/openAssetEntry/);
    expect(EDITOR).toMatch(/AttachmentPreview/);
    expect(EDITOR).toMatch(/ImageLightbox/);
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
    expect(EDITOR).toMatch(/imageOnly=\{imageOnly\}/);
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
    expect(EDITOR).toMatch(/!hasGroupRows &&/);
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
    expect(THEME).toMatch(/--lake-bg-subtle: #fafafa/);
    // 数据表选择区（.bt-tables）与表格区共用同一个底衬灰（用户 260929：风格要统一）
    expect(CSS).toMatch(/\.bt-tables \{[^}]*background: var\(--lake-bg-subtle\)/);
    expect(CSS).not.toMatch(/\.bt-tables \{[^}]*background: var\(--lake-bg-block\)/);
    // 表头与第一个分组之间的间隙只在**真的渲染出分组**时出现（配了分组但字段已删 → 不回落到未分组）
    expect(EDITOR).toMatch(/hasGroupRows && <tr className="bt-group-head-gap"/);
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
    expect(EDITOR.match(/className="bt-icon-btn" title="删除/g)?.length ?? 0).toBe(4);
    for (const label of ["删除规则", "删除排序", "删除分组"]) {
      expect(EDITOR).toMatch(new RegExp(`className="bt-icon-btn" title="${label}" aria-label="${label}"`));
    }
    expect(EDITOR).toMatch(/title="删除分组" aria-label="删除分组"/);
    expect(EDITOR).not.toMatch(/title="取消分组"/);
    // ⑩ 链接格（260929 对齐云端）：**展示文本 + 右端 🔗 图标**（点它用本地浏览器打开），**不再常驻输入框**
    //    —— 常驻输入框会在选中时和单元格自己的 2px 选中环叠成「两层边框」（用户报的就是这个）；
    //    编辑改为双击进入（Enter/失焦提交、Esc 取消）。
    expect(CARDS).toMatch(/className="bt-link-text"/);
    expect(CARDS).toMatch(/className="bt-link-open"/);
    expect(CARDS).toMatch(/window\.open\(text\.trim\(\), "_blank", "noopener"\)/);
    expect(CARDS).toMatch(/onDoubleClick=\{\(\) => \{ if \(!readOnly\)/);
    expect(FIELD_CSS).toMatch(/\.bt-link-text \{[^}]*text-overflow: ellipsis/);
    //    展示态**没有常驻输入框**（编辑态才有；旧实现是常驻 input + readOnly）
    const linkCellSource = CARDS.slice(CARDS.indexOf("function LinkCell"), CARDS.indexOf("function StatCell"));
    expect(linkCellSource).toContain("bt-link-text");
    expect(linkCellSource).not.toContain("readOnly={readOnly}");
    //    两层边框的根因修复：单元格自己已有 2px 选中环（单格四条边）时，格内输入框不再叠一层焦点环
    expect(CSS).toMatch(/\.bt-td\.cell-selected\.sel-top\.sel-bottom\.sel-left\.sel-right \.bt-cell-input:focus \{ outline: 0; \}/);
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
    // ② 看板：附件类字段上卡走缩略图，不再拿文件名占位
    expect(KANBAN).toMatch(/bt-kanban-thumb/);
    expect(KANBAN).toMatch(/isAttachmentLikeField\(field\.type\)/);
    // 点缩略图 = 预览该单元格内的图片（不跨字段）；卡片点击仍开记录详情
    expect(KANBAN).toMatch(/onOpenImages\(images, index\)/);
    expect(KANBAN).toMatch(/event\.stopPropagation\(\); onOpenImages/);
    expect(KANBAN_CSS).toMatch(/\.bt-kanban-thumb \{/);
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

  it("关联选择器：图片/附件格真渲染（缩略图 + 附件 chip），不是只给名称", () => {
    // 用户 260929：选择器里的附件和图片要加载出来
    expect(PICKER).toMatch(/<img key=\{image\.file\} className="bt-rel-thumb" src=\{bitableAssetUrl\(noteId, image\.file, PICKER_THUMB_PX\)\}/);
    expect(PICKER).toMatch(/onClick=\{\(event\) => \{ event\.stopPropagation\(\); onOpenImages\?\.\(images, index\); \}\}/);
    expect(PICKER).toMatch(/className="bt-rel-file"/);
    // 资产 URL 单一来源：单元格 / 看板 / 画册 / 选择器都走 bitableAssetUrl
    expect(ASSET_URL).toMatch(/export function bitableAssetUrl/);
    expect(CARDS).toMatch(/bitableAssetUrl\(noteId, file, ATTACHMENT_CHIP_PX\)/);
    expect(CARDS).toMatch(/bitableAssetUrl\(noteId, file, ATTACHMENT_CARD_PX\)/);
    expect(KANBAN).toMatch(/bitableAssetUrl\(noteId, file, KANBAN_THUMB_PX\)/);
    expect(GALLERY).toMatch(/bitableAssetUrl\(noteId, file, GALLERY_COVER_PX\)/);
    // noteId / onOpenImages 从三个入口（表格、记录详情、表单）透传到选择器
    expect(EDITOR).toMatch(/noteId=\{noteId\}\n\s*onOpenImages=\{openImages\}/);
    expect(DRAWER).toMatch(/noteId=\{props\.noteId\}\n\s*onOpenImages=\{props\.onOpenImages\}/);
    expect(FORM).toMatch(/noteId=\{props\.noteId\}\n\s*onOpenImages=\{props\.onOpenImages\}/);
  });
});
