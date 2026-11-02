import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const KIND = read("../../core/noteKind.ts");
const PATHS = read("../../core/noteBodyPaths.ts");
const STORE = read("../../../electron/store.ts");
const IPC = read("../../../electron/ipc/registerNotes.ts");
const DESKTOP = read("../editor/MultiTabEditor.tsx");
const MOBILE = read("../../mobile/notebook/NotebookWorkspace.tsx");
const MOBILE_BRIDGE = read("../../mobile/bridge/notes.ts");
const INK_PAD = read("./InkPad.tsx");
const DESKTOP_INK = read("./DesktopInkPad.tsx");
const INK_PAPER = read("./InkPaper.tsx");
const DESKTOP_INK_CSS = read("./inkPad.desktop.css");
const PAGE_STRIP = read("./InkPageStrip.tsx");
const TABS_CSS = read("../../styles/app/tabs.css");
const MOBILE_INK_CSS = read("../../mobile/ink/inkPad.mobile.css");
const MOBILE_INK_PAD = read("../../mobile/ink/MobileInkPad.tsx");
const INK_DOC = read("../../core/inkDoc.ts");
const PDF_IMPORT = read("./pdfImport.ts");
const PDF_RASTER = read("./pdfRasterDesktop.ts");
const MOBILE_PDF_IMPORT = read("../../mobile/ink/mobilePdfImport.ts");
const MOBILE_PDF_RENDER = read("../../mobile/native/pdfRender.ts");

describe("手写板正式端到端接线", () => {
  it("kind=ink 已进入 NoteKind / 正文路径", () => {
    expect(KIND).toContain('"ink"');
    expect(PATHS).toContain('ink: "inks"');
    expect(PATHS).toContain('ink: ".ink.json"');
  });

  it("桌面手写板与其它标签占用同一格，并遵守 data-active 隐藏契约", () => {
    expect(INK_PAD).toContain('data-active={active ? "true" : undefined}');
    expect(INK_PAD).toContain('data-pane-visible={paneVisible ? "true" : undefined}');
    expect(DESKTOP_INK).toContain("paneVisible={visible}");
    expect(DESKTOP_INK_CSS).toContain("grid-area: 1 / 1");
    expect(TABS_CSS).toContain(".ink-pad--desktop");
  });

  it("桌面缩放保持页面比例，并提供放大/缩小/恢复适配控件", () => {
    expect(INK_PAD).toContain('aria-label="放大"');
    expect(INK_PAD).toContain('aria-label="缩小"');
    expect(INK_PAD).toContain('aria-label="恢复为适应页面"');
    expect(INK_PAD).toContain("fitSize.width * zoom");
    expect(INK_PAD).toContain("fitSize.height * zoom");
  });

  it("页面管理：缩略图、前移/后移、删除页二次确认", () => {
    expect(INK_PAD).toContain("InkPageStrip");
    expect(PAGE_STRIP).toContain("aria-label=\"页面管理\"");
    expect(PAGE_STRIP).toContain("页前移");
    expect(PAGE_STRIP).toContain("页后移");
    expect(PAGE_STRIP).toContain("确认删除");
    expect(PAGE_STRIP).toContain("onConfirmDelete");
  });

  it("静态笔迹层 memo 化，避免正在书写时重渲染全部历史路径", () => {
    expect(INK_PAD).toContain("const StaticStrokeLayer = memo(");
    expect(INK_PAD).toContain("<StaticStrokeLayer strokes={renderedStrokes} />");
  });

  it("撤销栈只存页级补丁，不再把整篇正文压栈", () => {
    expect(INK_PAD).toContain('applyInkPatch(docRef.current, entry.patch, "undo")');
    expect(INK_PAD).toContain('applyInkPatch(docRef.current, entry.patch, "redo")');
    expect(INK_PAD).toContain("inkPagePatch(");
    expect(INK_PAD).not.toContain("pushBoundedHistory(undoRef.current, inkToBody");
    expect(INK_PAD).not.toContain("pushBoundedHistory(redoRef.current, inkToBody");
  });

  it("纸张底纹使用 SVG 逻辑坐标，缩放页面时密度不漂移", () => {
    expect(INK_PAD).toContain("InkPaper");
    expect(INK_PAPER).toContain("patternUnits=\"userSpaceOnUse\"");
    expect(INK_PAPER).toContain("width={width}");
  });

  /** 桌面分支的 JSX 片段（顶部工具条 + 底部 footer）：用来钉「桌面结构零变化」。 */
  const desktopBranch = (): string => {
    const toolbarStart = INK_PAD.indexOf('{variant === "desktop" ? (');
    const toolbarEnd = INK_PAD.indexOf(') : (', toolbarStart);
    const footerStart = INK_PAD.indexOf('{variant === "desktop" ? (', toolbarEnd);
    const footerEnd = INK_PAD.indexOf(') : !readOnly ? (', footerStart);
    return INK_PAD.slice(toolbarStart, toolbarEnd) + INK_PAD.slice(footerStart, footerEnd);
  };

  /** 移动端底部工具坞的 JSX 片段（到 `) : null}` 为止；里面含色板/笔宽两个悬浮面板）。 */
  const mobileDock = (): string => {
    const start = INK_PAD.indexOf('data-overlay="dock"');
    const end = INK_PAD.indexOf(") : null}", start);
    return INK_PAD.slice(start, end);
  };
  /** 工具行片段（toolbar group 内部；不含两个悬浮面板）。 */
  const mobileToolRow = (): string => {
    const dock = mobileDock();
    const start = dock.indexOf('aria-label="画笔工具"');
    const end = dock.indexOf("</div>", start);
    return dock.slice(start, end);
  };

  it("移动端顶部导航是悬浮面（overlay 不占布局）：翻页 / 缩放 / 全局预览，两态同一条", () => {
    expect(INK_PAD).toContain('aria-label="手写板导航"');
    expect(INK_PAD).toContain('aria-label="全局预览"');
    expect(INK_PAD).toContain('data-overlay="nav"');
    expect(INK_PAD).toContain("aria-expanded={pagesOpen}");
    // 悬浮：absolute + 面板底 + 0.5px 边 + popover 阴影；不在布局流里 ⇒ 画布拿到这段高度
    expect(MOBILE_INK_CSS).toContain('.ink-pad--mobile > [data-overlay="nav"]');
    expect(MOBILE_INK_CSS).toMatch(/\[data-overlay="nav"\],[\s\S]{0,200}?position: absolute;/);
    expect(MOBILE_INK_CSS).toContain("border-radius: var(--lake-radius-pill)");
    expect(MOBILE_INK_CSS).toContain("background: var(--lake-bg-panel); box-shadow: var(--lake-shadow-popover);");
    // 禁止毛玻璃
    expect(MOBILE_INK_CSS).not.toContain("backdrop-filter");
  });

  it("移动端底部工具坞是悬浮面且只在编辑态出现；颜色/笔宽收成「当前值按钮 + 悬浮面板」", () => {
    expect(INK_PAD).toContain(") : !readOnly ? (");
    expect(INK_PAD).toContain('role="toolbar" aria-label="手写工具"');
    expect(INK_PAD).toContain('data-overlay="dock"');
    expect(INK_PAD).toContain('aria-label="纸张"');
    // 阅读态整行说明删除（不再有「阅读态：点右上角…」）
    expect(INK_PAD).not.toContain("阅读态：点右上角");
    expect(MOBILE_INK_CSS).not.toContain(".ink-footer .ink-readonly-hint");
    // 悬浮在画布上：absolute 贴底 + 安全区，不占布局高度
    expect(MOBILE_INK_CSS).toContain('.ink-pad--mobile > [data-overlay="dock"]');
    expect(MOBILE_INK_CSS).toMatch(/bottom: calc\(var\(--lake-space-md\) \+ var\(--mobile-bottom-safe-area\)\);/);
    expect(MOBILE_INK_CSS).toContain("border-radius: var(--lake-radius-card)");
    // 颜色/笔宽：工具行只有「当前值按钮」，7 色 / 4 档收进坞内悬浮面板
    expect(mobileToolRow()).toContain('data-popover-trigger="color"');
    expect(mobileToolRow()).toContain('data-popover-trigger="width"');
    expect(mobileToolRow()).toContain('aria-label="选择颜色"');
    expect(mobileToolRow()).toContain('aria-label="选择笔宽"');
    expect(mobileToolRow()).not.toContain("COLORS.map");
    expect(mobileToolRow()).not.toContain("WIDTHS.map");
    expect(mobileDock()).toContain('data-overlay="palette"');
    expect(mobileDock()).toContain('data-overlay="widths"');
    // 纸张只在编辑态工具坞里可点（阅读态没有 background 按钮渲染路径）
    expect(INK_PAD).toContain("onClick={() => setBackground(item.value)}");
  });

  it("工具行加密：＋在第一位；8×44 + 4 分隔 + 内距 4 = 360 ⇒ 412 不横滑（360 允许轻微横滑）", () => {
    // 无插入：7×44 + 3×1（分隔，margin 0）+ 内距 4 = 315 ≤ 360−16−2 = 342
    const baseRow = 7 * 44 + 3 * 1 + 4;
    expect(baseRow).toBe(315);
    expect(baseRow).toBeLessThanOrEqual(360 - 16 - 2);
    // 有插入（图片/PDF 入口注入时）：8×44 + 4×1 + 4 = 360 ≤ 412−16−2 = 394
    const withInsertRow = 8 * 44 + 4 * 1 + 4;
    expect(withInsertRow).toBe(360);
    expect(withInsertRow).toBeLessThanOrEqual(412 - 16 - 2);
    // 结构侧：工具行不内联颜色/笔宽列表；**＋（插入）必须排在第一位**，其后才是笔工具
    const toolRow = mobileToolRow();
    expect(toolRow).not.toContain("COLORS.map");
    expect(toolRow).not.toContain("WIDTHS.map");
    expect(toolRow.indexOf('aria-label="插入"')).toBeGreaterThan(-1);
    expect(toolRow.indexOf('aria-label="插入"')).toBeLessThan(toolRow.indexOf('aria-label="画笔"'));
    expect(toolRow).toContain('aria-label="撤销"');
    expect(toolRow).toContain('aria-label="重做"');
    expect(toolRow).toContain("setInsertOpen((open) => !open)");
    // 加密：工具行 gap 0 / 内距 2 / 分隔 margin 0（按钮盒仍 44）
    expect(MOBILE_INK_CSS).toMatch(/\.ink-pad--mobile > \[data-overlay="dock"\] \.ink-toolbar \{[^}]*gap: 0;/);
    expect(MOBILE_INK_CSS).toContain('.ink-pad--mobile > [data-overlay="dock"] .ink-toolbar__sep { margin: 0; }');
    expect(MOBILE_INK_CSS).toContain("min-width: var(--mb-tap-min); height: var(--mb-tap-min);");
  });

  it("插入菜单：坞上方 8 的悬浮卡（两项 44 高），复用 importImages/importPdf；阅读态无入口", () => {
    expect(INK_PAD).toContain('data-overlay="insert"');
    expect(INK_PAD).toContain('aria-label="插入"');
    expect(INK_PAD).toContain("data-popover-trigger=\"insert\"");
    // 菜单两项复用既有流程（不复制实现）
    expect(INK_PAD).toContain("setInsertOpen(false); void importImages();");
    expect(INK_PAD).toContain("setInsertOpen(false); void importPdf();");
    // 插入按钮只在编辑态工具坞里（阅读态无）
    expect(INK_PAD).toContain(") : !readOnly ? (");
    // 全局预览面板里的旧导入行已移除（两个入口不并存）
    expect(INK_PAD).not.toContain("data-ink-import");
    expect(MOBILE_INK_CSS).not.toContain("[data-ink-import]");
    // 面板样式：与色板/笔宽同套卡面，纵向两项
    expect(MOBILE_INK_CSS).toContain('.ink-pad--mobile > [data-overlay="dock"] [data-overlay="insert"]');
    expect(MOBILE_INK_CSS).toContain("flex-direction: column; align-items: stretch; justify-content: flex-start;");
    expect(MOBILE_INK_CSS).toContain("bottom: calc(100% + var(--lake-space-md));");
  });

  it("色板/笔宽面板：悬浮在工具坞上方 8、同套卡面；选值关闭、点外部也关闭", () => {
    // 面板卡面：absolute 在坞上方 8，面板底/边/阴影/圆角全走令牌
    expect(MOBILE_INK_CSS).toContain('.ink-pad--mobile > [data-overlay="dock"] [data-overlay="palette"],');
    expect(MOBILE_INK_CSS).toContain("bottom: calc(100% + var(--lake-space-md));");
    expect(MOBILE_INK_CSS).toContain("border-radius: var(--lake-radius-card)");
    expect(MOBILE_INK_CSS).toContain("box-shadow: var(--lake-shadow-popover)");
    expect(MOBILE_INK_CSS).not.toContain("backdrop-filter");
    // 色板复用 .ink-color（44 盒 + 28 内圆同一份 CSS）；笔宽复用 .ink-width（44 盒）
    expect(INK_PAD).toContain("aria-label=\"选择颜色\"");
    expect(INK_PAD).toContain("aria-label=\"选择笔宽\"");
    expect(INK_PAD).toContain("data-popover-trigger");
    // 选值关闭
    expect(INK_PAD).toContain("setPaletteOpen(false)");
    expect(INK_PAD).toContain("setWidthsOpen(false)");
    // 点「面板/触发按钮」之外关闭（pointerdown 捕获；插入菜单同一条规则）
    expect(INK_PAD).toContain('[data-overlay="palette"], [data-overlay="widths"], [data-overlay="insert"], [data-popover-trigger]');
  });

  it("移动端阅读态让开底部胶囊：胶囊 stack（状态栏+间隔+安全区+胶囊）+ 8", () => {
    // 阅读态没有 footer，让位必须一次算全（含安全区）；编辑态胶囊由工作区隐藏 ⇒ 不预留。
    expect(MOBILE_INK_CSS).toContain('.ink-pad--mobile[data-readonly="true"]');
    for (const token of [
      "var(--mobile-status-height)",
      "var(--mobile-bar-gap)",
      "var(--mobile-bottom-safe-area)",
      "var(--mobile-bottom-bar-height)",
      "var(--lake-space-md)",
    ]) expect(MOBILE_INK_CSS).toContain(token);
    // 悬浮导航条不占布局 ⇒ 阅读态的画布比 v1 多出导航那 44px，不需要额外的 padding-top
    expect(MOBILE_INK_CSS).not.toMatch(/\[data-overlay="nav"\][^{]*\{[^}]*margin-top/);
    // 编辑态（胶囊隐藏）不给 pad 预留；安全区由悬浮工具坞自己接
    expect(MOBILE_INK_CSS).toContain("bottom: calc(var(--lake-space-md) + var(--mobile-bottom-safe-area));");
  });

  it("切页与缩放是纯视图：阅读态也可用，且不触发保存", () => {
    // 顶部条里两组都在（翻页 + 缩放），且不受 readOnly 门控
    expect(INK_PAD).toContain('aria-label="上一页"');
    expect(INK_PAD).toContain('aria-label="下一页"');
    expect(INK_PAD).toContain('className="ink-zoom__value"');
    // 切页只在编辑态写正文（阅读态只改本地视图）
    expect(INK_PAD).toContain("const updated = { ...current, activePageId: id };");
    expect(INK_PAD).toMatch(/if \(!readOnly\) \{\n\s+const body = serializeDoc\(updated\);/);
  });

  it("全局预览：移动端悬浮覆盖（不推画布），桌面仍是流内面板；阅读态编辑项禁用、选页可用", () => {
    // 移动端 = 包装在 data-overlay="preview" 里；桌面 = 三元分支的 else 之外、直接流内节点
    expect(INK_PAD).toContain('<div data-overlay="preview">');
    expect(INK_PAD).toMatch(/\{pagesOpen && \(variant === "desktop" \? \(\s*<InkPageStrip/);
    expect(MOBILE_INK_CSS).toContain('.ink-pad--mobile > [data-overlay="preview"]');
    expect(MOBILE_INK_CSS).toContain("top: calc(var(--mb-tap-min) + var(--lake-space-xl));");
    expect(MOBILE_INK_CSS).toContain("max-height: 45dvh; overflow-y: auto;");
    expect(MOBILE_INK_CSS).toContain("z-index: 1;"); // 高于画布、低于导航/工具坞（z 2）
    // 不再用流内 margin-top 把画布往下推
    expect(MOBILE_INK_CSS).not.toContain(".ink-pad--mobile > .ink-page-strip { margin-top:");
    expect(INK_PAD).toContain("readOnly={readOnly}");
    expect(PAGE_STRIP).toContain("readOnly?: boolean");
    expect(PAGE_STRIP).toContain("disabled={readOnly || index === 0}");
    expect(PAGE_STRIP).toContain("disabled={readOnly || index === pages.length - 1}");
    expect(PAGE_STRIP).toContain("disabled={readOnly || pages.length <= 1}");
    expect(PAGE_STRIP).toContain('className="ink-page-strip__add" onClick={onAdd} disabled={readOnly}');
    // 缩略图按钮不接 readOnly ⇒ 阅读态仍能切页查看
    expect(PAGE_STRIP).toContain("onClick={() => onSelect(page.id)}");
  });

  it("桌面结构：只新增「导入图片 / 导入 PDF」入口，顶部工具条 + 底部页码/纸张/缩放逐字不变", () => {
    const branch = desktopBranch();
    // v2 图片/PDF 页入口（桌面新增）：工具条里、编辑态可用
    expect(branch).toContain('aria-label="导入图片"');
    expect(branch).toContain('aria-label="导入 PDF"');
    expect(branch).toContain("disabled={readOnly || importing || pdfImporting}");
    expect(branch).toContain("onClick={() => void importImages()}");
    expect(branch).toContain("onClick={() => void importPdf()}");
    expect(branch).toContain('role="toolbar" aria-label="手写工具"');
    expect(branch).toContain('aria-label="画笔"');
    expect(branch).toContain('aria-label="高亮笔"');
    expect(branch).toContain('aria-label="整笔橡皮"');
    expect(branch).toContain("aria-label={`颜色 ${value}`}");
    expect(branch).toContain("aria-label={`笔宽 ${value}`}");
    expect(branch).toContain('aria-label="撤销"');
    expect(branch).toContain('aria-label="重做"');
    // 桌面：缩放留在顶部工具条，底部是页码 + 新建页 + 页面管理 + 纸张
    expect(branch).toContain('aria-label="缩放"');
    expect(branch).toContain('aria-label="恢复为适应页面"');
    expect(branch).toContain('aria-label="新建页"');
    expect(branch).toContain('aria-label="页面管理"');
    expect(branch).toContain('className="ink-footer__right"');
    // 移动端新增入口不得混进桌面分支
    expect(branch).not.toContain("手写板导航");
    expect(branch).not.toContain("全局预览");
    expect(branch).not.toContain("选择颜色");
    expect(branch).not.toContain("选择笔宽");
    expect(branch).not.toContain("data-popover-trigger");
    expect(branch).not.toContain("data-overlay");
    // 桌面预览面板保持「流内、直接渲染 InkPageStrip」——不套悬浮包装
    expect(INK_PAD).toMatch(/\{pagesOpen && \(variant === "desktop" \? \(\s*<InkPageStrip/);
  });

  it("v2 正文模型：版本 2、每页可选 backgroundImage（严格校验，canonical 含新字段）", () => {
    expect(INK_DOC).toContain("INK_DOC_VERSION = 2 as const");
    expect(INK_DOC).toContain("INK_DOC_READ_VERSIONS");
    expect(INK_DOC).toContain("interface InkBackgroundImage");
    expect(INK_DOC).toContain("backgroundImage?: InkBackgroundImage");
    expect(INK_DOC).toContain("isNoteAssetUrl(record.url)");
    expect(INK_DOC).toContain("positiveInt(record.pixelWidth)");
    expect(INK_DOC).toContain("out.backgroundImage = serializeBackgroundImage(page.backgroundImage)");
  });

  it("图片页渲染：image 层在笔迹下、pointer-events:none、无图不渲染；缩略图走 ?w=256 低清档", () => {
    expect(INK_PAD).toContain("page.backgroundImage ?");
    expect(INK_PAD).toContain('pointerEvents="none"');
    expect(INK_PAD).toContain("backgroundImageAspect(page.backgroundImage)");
    expect(PAGE_STRIP).toContain("inkThumbUrl(page.backgroundImage.url)");
    expect(PAGE_STRIP).toContain('pointerEvents="none"');
  });

  it("导入入口：移动端在编辑态工具坞「插入」菜单、桌面在编辑态工具条；正文只在编辑态写", () => {
    // 移动端：坞内「插入」一个 44 按钮 + 坞上方悬浮菜单（不再藏在全局预览里）
    expect(INK_PAD).toContain('aria-label="插入"');
    expect(INK_PAD).toContain('data-overlay="insert"');
    expect(INK_PAD).not.toContain("data-ink-import");
    // 两端入口同一份 importImages / importPdf（图片与 PDF 共用 busy 守卫，仅编辑态可写）
    expect(INK_PAD).toMatch(/const importImages = useCallback\(async \(\) => \{\s*const importer = onImportImagesRef\.current;\s*if \(!importer \|\| readOnly \|\| importingRef\.current \|\| pdfImportingRef\.current\) return;/);
    expect(INK_PAD).toMatch(/const importPdf = useCallback\(async \(\) => \{\s*const importer = onImportPdfRef\.current;\s*if \(!importer \|\| readOnly \|\| importingRef\.current \|\| pdfImportingRef\.current\) return;/);
    expect(INK_PAD).toContain("inkPageDelta(null, page)");
    // host 注入：桌面走 native.uploadResource + noteId；移动端走 bridge.uploadResource + noteId
    expect(DESKTOP_INK).toContain("native.uploadResource(input, noteId)");
    expect(DESKTOP_INK).toContain("onImportImages={onImportImages}");
    expect(DESKTOP_INK).toContain("onImportPdf={onImportPdf}");
    expect(MOBILE_INK_PAD).toContain("bridge.uploadResource(input, noteId)");
    expect(MOBILE_INK_PAD).toContain("onImportPdf={noteId ? onImportPdf : undefined}");
    expect(MOBILE).toContain("noteId={t.id}");
    // 移动端导入 CSS：坞上方「插入」菜单（预览面板里的旧导入行已删除）
    expect(MOBILE_INK_CSS).toContain('[data-overlay="insert"]');
    expect(MOBILE_INK_CSS).not.toContain("[data-ink-import]");
  });

  it("PDF 导入编排：300 页上限、pdf-page 背景图、sourcePdf、替换空白首页、进度/取消", () => {
    expect(PDF_IMPORT).toContain("export const INK_PDF_MAX_PAGES = 300");
    expect(PDF_IMPORT).toContain("source: \"pdf-page\"");
    expect(PDF_IMPORT).toContain("pdf: { url: pdfUrl, page: item.page, pageCount }");
    expect(PDF_IMPORT).toContain("sourcePdf: { url: pdfUrl, pageCount }");
    expect(PDF_IMPORT).toContain("raster.pages.slice(0, maxPages)");
    expect(PDF_IMPORT).toContain("shouldReplaceEmptyFirstPage");
    expect(PDF_IMPORT).toContain("planPdfPageInsert");
    expect(PDF_IMPORT).toContain("signal?.aborted");
    expect(PDF_IMPORT).toContain("MAX_ATTACHMENT_BYTES");
    // 宿主只做注入：桌面 unpdf / 移动原生 PdfRender
    expect(DESKTOP_INK).toContain("renderPdfPagesDesktop(input.bytes, options)");
    // 261102 18b：移动端适配器抽到 mobilePdfImport（手动导入与分享导入共用），MobileInkPad 只委托
    expect(MOBILE_PDF_IMPORT).toContain("renderPdfPages(");
    expect(MOBILE_PDF_IMPORT).toContain("cancelPdfRender");
    expect(MOBILE_INK_PAD).toContain("importPdfPagesToAssets");
    expect(MOBILE_PDF_RENDER).toContain("Capacitor.convertFileSrc(file)");
    expect(MOBILE_PDF_RENDER).toContain("readRenderedPdfFileBytes");
  });

  it("PDF 导入进度/取消 UI + 桌面栅格化懒加载契约", () => {
    expect(INK_PAD).toContain('data-ink-pdf-progress');
    expect(INK_PAD).toContain('aria-label="取消 PDF 导入"');
    expect(INK_PAD).toContain("pdfAbortRef.current?.abort()");
    expect(INK_PAD).toContain("正在导入 PDF：第");
    expect(MOBILE_INK_CSS).toContain("[data-ink-pdf-progress]");
    // unpdf 动态 import、cMapUrl、WebP 见 pdfRasterDesktop 静态测试；这里钉住文件不被静态引进入口
    expect(PDF_RASTER).toContain('await import("unpdf")');
    expect(INK_PAD).not.toContain("unpdf");
  });

  it("只读态 capture 交父层最新正文（桌面锁定文档不会被只读翻页写盘）", () => {
    expect(INK_PAD).toContain("if (readOnlyRef.current) return latestContentRef.current;");
  });

  it("移动端完成编辑前现取手写板正文（与 board/usheet 同一条写边界，绕过 500ms 防抖）", () => {
    expect(MOBILE).toContain("onEditorCapture={(capture) => {");
    expect(MOBILE).toMatch(/active\.kind === "usheet" \|\| active\.kind === "board" \|\| active\.kind === "ink"/);
  });

  it("触达 ≥44：按钮盒走 --mb-tap-min；当前色/色板 44 盒 + 28 内圆；纸张视觉 36 + ::after 补 44", () => {
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-pages button");
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-backgrounds button");
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-tool");
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-zoom button");
    expect(MOBILE_INK_CSS).toContain("min-width: var(--mb-tap-min); height: var(--mb-tap-min);");
    // 颜色：按钮盒 44，内圆 = 44 - 16 = 28（内圆在 JSX 里是 <span style={{backgroundColor}}/>）
    expect(INK_PAD).toContain("<span style={{ backgroundColor: value }} />");
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-color > span");
    expect(MOBILE_INK_CSS).toContain("width: calc(var(--mb-tap-min) - var(--lake-space-xl));");
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-color.is-active > span");
    // 纸张：视觉 36（44 - 8），命中区靠 ::after 上下各补 4
    expect(MOBILE_INK_CSS).toContain("height: calc(var(--mb-tap-min) - var(--lake-space-md));");
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile > [data-overlay=\"dock\"] .ink-backgrounds button::after");
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-page-thumb__actions button");
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-page-strip__add");
  });

  it("纸面在「悬浮导航—悬浮工具坞」之间的可视区居中（stage 上下补出悬浮条高度）", () => {
    // 261102 用户报「100% 时上下空白不均」：页面按整屏居中时，底部工具坞悬浮在留白里 ⇒ 顶部空白被视觉放大。
    // 修法 = 画布上下补出与悬浮条等高的内距（尺寸用 --ink-mobile-* 变量，与悬浮条规则同源）。
    expect(MOBILE_INK_CSS).toContain("--ink-mobile-nav-h: calc(var(--mb-tap-min) + 1px);");
    expect(MOBILE_INK_CSS).toContain("--ink-mobile-dock-h: calc(var(--mb-tap-min) * 2 + var(--lake-space-xs) + 1px);");
    expect(MOBILE_INK_CSS).toMatch(/\.ink-pad--mobile \.ink-page-stage \{[\s\S]{0,160}?padding: calc\(var\(--lake-space-md\) \* 2 \+ var\(--ink-mobile-nav-h\)\) var\(--lake-space-md\) var\(--lake-space-md\);/);
    expect(MOBILE_INK_CSS).toMatch(/\.ink-pad--mobile:not\(\[data-readonly="true"\]\) \.ink-page-stage \{[\s\S]{0,120}?padding-bottom: calc\(var\(--lake-space-md\) \* 2 \+ var\(--ink-mobile-dock-h\)\);/);
  });

  it("桌面创建、IPC、路由与移动端创建/路由均已接通", () => {
    expect(STORE).toContain("createInkIn(");
    expect(IPC).toContain('ipc.handle("create_ink_in"');
    expect(DESKTOP).toContain('tab.kind === "ink"');
    expect(DESKTOP).toContain("DesktopInkPad");
    expect(MOBILE_BRIDGE).toContain("async createInk(");
    expect(MOBILE).toContain('t.kind === "ink"');
    expect(MOBILE).toContain("MobileInkPad");
  });
});
