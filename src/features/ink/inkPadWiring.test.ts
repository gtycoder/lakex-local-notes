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

  it("移动端顶部固定条：翻页 / 缩放 / 全局预览（阅读态与编辑态同一条）", () => {
    expect(INK_PAD).toContain('aria-label="手写板导航"');
    expect(INK_PAD).toContain('aria-label="全局预览"');
    expect(INK_PAD).toContain("aria-expanded={pagesOpen}");
    // 顶部条在 variant 分支的 else 里（不在 !readOnly 下面）⇒ 阅读态也在（渲染行为见 MobileInkPad.render.test）
    expect(INK_PAD).toContain('aria-label="手写板导航"');
    expect(MOBILE_INK_CSS).toContain("var(--mb-tap-min)");
  });

  it("移动端底部工具坞只在编辑态出现；纸张/说明行已从阅读态移除（正文数据）", () => {
    expect(INK_PAD).toContain(") : !readOnly ? (");
    expect(INK_PAD).toContain('role="toolbar" aria-label="手写工具"');
    expect(INK_PAD).toContain('aria-label="纸张"');
    // 阅读态整行说明删除（不再有「阅读态：点右上角…」）
    expect(INK_PAD).not.toContain("阅读态：点右上角");
    expect(MOBILE_INK_CSS).not.toContain(".ink-footer .ink-readonly-hint");
    // 纸张只在编辑态工具坞里可点（阅读态没有 background 按钮渲染路径）
    expect(INK_PAD).toContain("onClick={() => setBackground(item.value)}");
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
    // 编辑态（胶囊隐藏）不再给 pad 预留；安全区只由底部工具坞的纸张行接一次
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-footer .ink-backgrounds");
    expect(MOBILE_INK_CSS).toContain("calc(4px + var(--mobile-bottom-safe-area))");
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

  it("全局预览的编辑项（新建/前移/后移/删除）在阅读态禁用，缩略图选页仍可用", () => {
    expect(INK_PAD).toContain("readOnly={readOnly}");
    expect(PAGE_STRIP).toContain("readOnly?: boolean");
    expect(PAGE_STRIP).toContain("disabled={readOnly || index === 0}");
    expect(PAGE_STRIP).toContain("disabled={readOnly || index === pages.length - 1}");
    expect(PAGE_STRIP).toContain("disabled={readOnly || pages.length <= 1}");
    expect(PAGE_STRIP).toContain('className="ink-page-strip__add" onClick={onAdd} disabled={readOnly}');
    // 缩略图按钮不接 readOnly ⇒ 阅读态仍能切页查看
    expect(PAGE_STRIP).toContain("onClick={() => onSelect(page.id)}");
  });

  it("桌面结构零变化：顶部工具条 + 底部页码/纸张/缩放原样，且不含移动端新入口", () => {
    const branch = desktopBranch();
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
  });

  it("只读态 capture 交父层最新正文（桌面锁定文档不会被只读翻页写盘）", () => {
    expect(INK_PAD).toContain("if (readOnlyRef.current) return latestContentRef.current;");
  });

  it("移动端完成编辑前现取手写板正文（与 board/usheet 同一条写边界，绕过 500ms 防抖）", () => {
    expect(MOBILE).toContain("onEditorCapture={(capture) => {");
    expect(MOBILE).toMatch(/active\.kind === "usheet" \|\| active\.kind === "board" \|\| active\.kind === "ink"/);
  });

  it("移动端顶部条与底部工具坞的可点项达到 --mb-tap-min（44）", () => {
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-pages button");
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-backgrounds button");
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-tool");
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-zoom button");
    expect(MOBILE_INK_CSS).toContain("min-width: var(--mb-tap-min); height: var(--mb-tap-min);");
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-color { width: var(--mb-tap-min); height: var(--mb-tap-min);");
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-page-thumb__actions button");
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-page-strip__add");
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
