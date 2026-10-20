import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const KIND = read("../../core/noteKind.ts");
const PATHS = read("../../core/noteBodyPaths.ts");
const SYNC = read("../../core/syncUtils.ts");
const STORE = read("../../../electron/store.ts");
const IPC = read("../../../electron/ipc/registerNotes.ts");
const DESKTOP = read("../editor/MultiTabEditor.tsx");
const MOBILE = read("../../mobile/notebook/NotebookWorkspace.tsx");
const MOBILE_BRIDGE = read("../../mobile/bridge/notes.ts");
const INK_PAD = read("./InkPad.tsx");
const DESKTOP_INK = read("./DesktopInkPad.tsx");
const DESKTOP_INK_CSS = read("./inkPad.desktop.css");
const PAGE_STRIP = read("./InkPageStrip.tsx");
const TABS_CSS = read("../../styles/app/tabs.css");

describe("手写板 POC 端到端接线", () => {
  it("kind=ink 已进入 NoteKind / 正文路径", () => {
    expect(KIND).toContain('"ink"');
    expect(PATHS).toContain('ink: "inks"');
    expect(PATHS).toContain('ink: ".ink.json"');
  });

  it("Manifest 升级到 V2，并保留 V1 读取升级路径", () => {
    expect(SYNC).toContain("MANIFEST_VERSION = 2");
    expect(SYNC).toContain("new Set([1, 2])");
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
