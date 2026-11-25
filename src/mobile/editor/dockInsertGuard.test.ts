/**
 * 261123 两个用户现场 bug 的静态契约（行为在设备上验收，这里钉接线不许回退）：
 *  ① 插表情把「加密文本」整卡顶掉（数据破坏级）——表情必须字段优先插入 + 卡片保护区；
 *  ② 工具栏「更多」后的撤销/重做被挤出可视区——按钮宽改为可收缩（49 是上限），键盘尾键不收缩。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
// M-04 拆分后 dock 命令面横跨三个文件（判据 hook / 编排 / 面板 JSX）⇒ 按功能聚合读，断言语义不变。
const DOCK = ["src/mobile/editor/dockCommandState.ts", "src/mobile/editor/EditorDock.tsx", "src/mobile/editor/DockPanels.tsx"].map(read).join("\n");
const SURFACE = read("src/mobile/editor/useEditSurface.ts");
const CSS = read("src/mobile/editor/editor-dock.css");
const QN_WIDGETS = read("src/features/quickNotes/quickNoteToolbarWidgets.ts");
const MOBILE_MAIN = read("src/mobile/main.tsx");

describe("插入卡片保护区（261123）", () => {
  it("表情 = 输入面优先（卡内 textarea 光标处插入，一个内核命令都不发）", () => {
    expect(DOCK).toContain('from "../../features/editor/fieldInsert"');
    expect(DOCK).toContain("activeTextEntryField()");
    expect(DOCK).toContain("insertTextIntoField(field, emoji)");
    // 字段分支必须在内核插入之前 return（顺序即语义）
    const fieldIdx = DOCK.indexOf("const field = activeTextEntryField()");
    const kernelIdx = DOCK.indexOf('runPanel("insertAtSelection"');
    expect(fieldIdx).toBeGreaterThan(-1);
    expect(kernelIdx).toBeGreaterThan(fieldIdx);
  });

  it("插入类命令过卡片保护区（insertAtSelection / insertCard 都拦，拦下给明提示）", () => {
    expect(DOCK).toContain('from "../../features/editor/insertGuard"');
    expect(DOCK).toContain("INSERT_BLOCKED_HINT");
    expect(DOCK).toMatch(/cmd === "insertAtSelection" \|\| cmd === "insertCard"/);
    expect(DOCK).toContain("selectionTouchesCard()");
  });

  it("小记写作卡的 表情/日期 入口同接共享判据（同病同修，261123 lead 点单）", () => {
    expect(QN_WIDGETS).toContain('from "../editor/fieldInsert"');
    expect(QN_WIDGETS).toContain('from "../editor/insertGuard"');
    expect(QN_WIDGETS).toContain("activeTextEntryField()");
    expect(QN_WIDGETS).toContain("insertTextIntoField(field, emoji)");
    // 表情与日期两条插入都过保护区
    expect(QN_WIDGETS.match(/selectionTouchesCard\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(QN_WIDGETS).toContain("notifyInsertBlocked()");
    // 内核插入通道保留（保护区只拦触卡选区，正常光标照常插）
    expect(QN_WIDGETS).toContain('execCommand("insertAtSelection", "text/lake", "<span>" + emoji + "</span>")');
    // 移动端入口装提示通道（toast）
    expect(MOBILE_MAIN).toContain("setInsertBlockedNotifier");
    expect(MOBILE_MAIN).toContain("showToast");
  });

  it("P1-B：媒体五项 / 表格 / 小记附件同过卡片保护区（insertFiles/table 实测同样吞卡）", () => {
    const HOST = read("src/mobile/editor/EditorDockHost.tsx");
    expect(HOST).toContain('from "../../features/editor/insertGuard"');
    expect(HOST).toContain("selectionTouchesCard()");
    expect(HOST).toContain("notifyInsertBlocked()");
    // 守卫至少两处：insertFile（媒体五项共用通道）+ onInsertTable
    expect(HOST.match(/blockedByCardGuard\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    // insertFile 必须先过守卫再 exec（顺序即语义）
    const guardIdx = HOST.indexOf("if (blockedByCardGuard()) return;");
    const execIdx = HOST.indexOf('execEditorCommandResult(ed, "insertFiles"');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(execIdx).toBeGreaterThan(guardIdx);
    // 小记附件 insertFiles 同守卫（共享判据第三处）
    expect(QN_WIDGETS).toContain('execCommand("insertFiles", files, { from: "ui", category: "file" })');
    expect(QN_WIDGETS.match(/selectionTouchesCard\(\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("焦点交还正文时放行输入面（插完表情能就地继续输入）", () => {
    expect(DOCK).toContain("isTextEntryField(document.activeElement)");
  });

  it("IME 抑制：聚焦在输入面时只动输入面自己（不回焦内核宿主）", () => {
    expect(SURFACE).toContain('from "../../features/editor/fieldInsert"');
    expect(SURFACE).toContain("isTextEntryField(document.activeElement)");
    expect(SURFACE).toContain("focusedField.setSelectionRange");
  });
});

describe("工具栏撤销/重做回到首屏（261123）", () => {
  it(".med-btn 49px 是上限不是定宽（flex 0 1 + min-width），窄屏收缩到 36", () => {
    expect(CSS).toMatch(/\.med-btn \{[^}]*flex:\s*0 1 49px/);
    expect(CSS).toMatch(/\.med-btn \{[^}]*min-width:\s*36px/);
    // 收缩后视觉 <44 ⇒ 命中区纵向补足（tapAreaContract 口径）
    expect(CSS).toMatch(/\.med-btn::after \{[^}]*inset:\s*-2px 0/);
  });

  it("键盘尾键不收缩，且规则排在 .med-btn 之后（同特异性后者胜）", () => {
    const btnIdx = CSS.indexOf(".med-btn {");
    const kbIdx = CSS.indexOf(".med-btn--kb {");
    expect(btnIdx).toBeGreaterThan(-1);
    expect(kbIdx).toBeGreaterThan(btnIdx);
    expect(CSS).toMatch(/\.med-btn--kb \{[^}]*flex:\s*0 0 49px/);
  });

  it("横滑兜底保留（极端窄屏/大字体仍可左右滑动看到撤销/重做）", () => {
    expect(CSS).toMatch(/\.med-toolbar-scroll \{[^}]*overflow-x:\s*auto/);
  });
});
