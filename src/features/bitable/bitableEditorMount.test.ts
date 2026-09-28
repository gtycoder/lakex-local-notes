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
const BAR = readFileSync(new URL("./BitableViewBar.tsx", import.meta.url), "utf8");
const VIEWS = readFileSync(new URL("./bitableViews.tsx", import.meta.url), "utf8");
const VIEWCSS = readFileSync(new URL("./bitableViews.css", import.meta.url), "utf8");
const KANBAN = readFileSync(new URL("./BitableKanbanView.tsx", import.meta.url), "utf8");
const GALLERY = readFileSync(new URL("./BitableGalleryView.tsx", import.meta.url), "utf8");
const CALENDAR = readFileSync(new URL("./BitableCalendarView.tsx", import.meta.url), "utf8");
const PANELS = readFileSync(new URL("./BitableViewConfigPanels.tsx", import.meta.url), "utf8");
const FORM = readFileSync(new URL("./BitableFormView.tsx", import.meta.url), "utf8");
const PREVIEW = readFileSync(new URL("../editor/imagePreview.ts", import.meta.url), "utf8");
const KANBAN_CSS = readFileSync(new URL("./bitableKanbanView.css", import.meta.url), "utf8");
const ATTACH_CTRL = readFileSync(new URL("../attachment/attachmentPreviewController.ts", import.meta.url), "utf8");
const ATTACH = readFileSync(new URL("../attachment/openAssetEntry.ts", import.meta.url), "utf8");
const CSS = readFileSync(new URL("./bitableEditor.css", import.meta.url), "utf8");

describe("多维表编辑器护栏", () => {
  it("附件格的缩略图：格子取 ?w= 档位，放大预览仍走原图", () => {
    // 格子显示 26px 却会解码整张原图（手机照片 4000×3000 = 48MB 位图）
    expect(CARDS).toContain("assetThumbWidthForCss(ATTACHMENT_CHIP_PX)");
    expect(CARDS).toContain('const ATTACHMENT_CHIP_PX = 26');
    expect(CARDS).toContain("withAssetWidth(");
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
    expect(GALLERY).toMatch(/assetThumbWidthForCss/);
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
    expect(FORM).toMatch(/seg__item/);
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
    expect(EDITOR).toMatch(/computeColumnStat\(field, shownRecords, stat\)/);
    expect(EDITOR).toMatch(/const setColumnStat = /);
    expect(EDITOR).toMatch(/setStatFor\(\{ fieldId, anchor \}\)/);
    expect(VIEWCSS).toMatch(/\.bt-stat-row td \{/);
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
});
