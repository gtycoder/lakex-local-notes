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

  it("移动端阅读态让开底部胶囊（分页/纸张入口不再被 fixed 胶囊压住）", () => {
    // 261030 设备实测：胶囊 top=754.29、文档 pane bottom=842.29 ⇒ pane 底部 88px 被胶囊盖住，
    // ink footer 正是 pane 的最后一格；胶囊只在阅读态可见，所以只给阅读态让位。
    expect(MOBILE_INK_CSS).toContain('.ink-pad--mobile[data-readonly="true"]');
    expect(MOBILE_INK_CSS).toContain("--mobile-bottom-bar-height");
    expect(MOBILE_INK_CSS).toContain("--mobile-bar-gap");
    expect(MOBILE_INK_CSS).toContain("--mobile-bottom-safe-area");
    expect(MOBILE_INK_CSS).toContain("--mobile-status-height");
  });

  it("阅读态给出可见解释；纸张/新建页仍禁用（正文数据不得在阅读态写）", () => {
    expect(INK_PAD).toContain("阅读态：点右上角「编辑」后可修改纸张与页面");
    expect(INK_PAD).toContain('readOnly && variant === "mobile"');
    expect(INK_PAD).toContain('<button onClick={addPage} disabled={readOnly} aria-label="新建页">');
    expect(INK_PAD).toContain('onClick={() => setBackground(item.value)} disabled={readOnly}');
  });

  it("切页是纯视图：阅读态也可上一页/下一页，且不触发保存", () => {
    expect(INK_PAD).toContain('disabled={pageIndex <= 0} aria-label="上一页"');
    expect(INK_PAD).toContain('disabled={pageIndex >= doc.pages.length - 1} aria-label="下一页"');
    // 切页只在编辑态写正文（阅读态只改本地视图）
    expect(INK_PAD).toContain("const updated = { ...current, activePageId: id };");
    expect(INK_PAD).toMatch(/if \(!readOnly\) \{\n\s+const body = serializeDoc\(updated\);/);
  });

  it("页面管理的编辑项（新建/前移/后移/删除）在阅读态禁用，缩略图切页仍可用", () => {
    expect(INK_PAD).toContain("readOnly={readOnly}");
    expect(PAGE_STRIP).toContain("readOnly?: boolean");
    expect(PAGE_STRIP).toContain("disabled={readOnly || index === 0}");
    expect(PAGE_STRIP).toContain("disabled={readOnly || index === pages.length - 1}");
    expect(PAGE_STRIP).toContain("disabled={readOnly || pages.length <= 1}");
    expect(PAGE_STRIP).toContain('className="ink-page-strip__add" onClick={onAdd} disabled={readOnly}');
    // 缩略图按钮不接 readOnly ⇒ 阅读态仍能切页查看
    expect(PAGE_STRIP).toContain("onClick={() => onSelect(page.id)}");
  });

  it("只读态 capture 交父层最新正文（桌面锁定文档不会被只读翻页写盘）", () => {
    expect(INK_PAD).toContain("if (readOnlyRef.current) return latestContentRef.current;");
  });

  it("移动端完成编辑前现取手写板正文（与 board/usheet 同一条写边界，绕过 500ms 防抖）", () => {
    expect(MOBILE).toContain("onEditorCapture={(capture) => {");
    expect(MOBILE).toMatch(/active\.kind === "usheet" \|\| active\.kind === "board" \|\| active\.kind === "ink"/);
  });

  it("移动端 footer 与页面管理操作钮达到 --mb-tap-min（44）", () => {
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-pages button");
    expect(MOBILE_INK_CSS).toContain(".ink-pad--mobile .ink-backgrounds button");
    expect(MOBILE_INK_CSS).toContain("min-width: var(--mb-tap-min); height: var(--mb-tap-min);");
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
