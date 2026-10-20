/**
 * UI 原语门禁（260926，Phase 1）。
 *
 * 背景：全仓曾有 21 处手写 createPortal 浮层，各自处理遮罩/外点/Esc/层序，漏一处就出
 * 「透明面板 / 遮罩盖不住外壳」这类结构 bug（Phase 0 实测）。这里把三条不变量钉死：
 *   1. createPortal 只允许出现在 Overlay 原语（+ 显式白名单）；
 *   2. 三支表面类 .ln-dialog/.ln-menu/.ln-popover 各只定义一次（防止表面漂移回多处）；
 *   3. overlay 层序令牌唯一、且整体高于外壳 topbar（防止浮层掉到外壳之下）。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** 允许 createPortal 的非原语文件（有意保留，见 docs/UI-PRIMITIVES-PHASE1-260926.md）：
 *  - ImageLightbox / AttachmentPreview：全屏媒体预览（自带背景点击关闭 + fixed 铺满）
 *  - kernelUiAtoms：非交互 tooltip tip（§3.7 决定不建 Tooltip 原语） */
const PORTAL_ALLOWLIST = [
  "components/ui/Overlay.tsx",
  "features/editor/ImageLightbox.tsx",
  "features/attachment/AttachmentPreview.tsx",
  "features/editor/selectionToolbar/kernelUiAtoms.tsx",
];

describe("UI 原语门禁", () => {
  it("createPortal 只允许出现在 Overlay 原语与显式白名单", () => {
    const offenders: string[] = [];
    for (const abs of walk(SRC)) {
      if (!abs.endsWith(".tsx")) continue;
      const rel = path.relative(SRC, abs).split(path.sep).join("/");
      if (readFileSync(abs, "utf8").includes("createPortal(") && !PORTAL_ALLOWLIST.includes(rel)) offenders.push(rel);
    }
    expect(offenders, "浮层必须走 <Dialog>/<Menu>/<Popover>（src/components/ui/Overlay.tsx）").toEqual([]);
  });

  it("三支表面类 .ln-dialog/.ln-menu/.ln-popover 都只在 overlay.css 定义", () => {
    const files: Record<string, Set<string>> = { "ln-dialog": new Set(), "ln-menu": new Set(), "ln-popover": new Set() };
    for (const abs of walk(SRC)) {
      if (!abs.endsWith(".css")) continue;
      const rel = path.relative(SRC, abs).split(path.sep).join("/");
      const text = readFileSync(abs, "utf8");
      for (const name of Object.keys(files)) {
        if (new RegExp("(^|\\n)\\." + name + "\\s*[,{]").test(text)) files[name].add(rel);
      }
    }
    for (const name of Object.keys(files)) expect([...files[name]], name).toEqual(["styles/overlay.css"]);
  });

  it("overlay 层序令牌唯一、依次递增、且都高于外壳 topbar", () => {
    const css = readFileSync(path.join(SRC, "styles/themes/base.css"), "utf8");
    const val = (name: string): number => {
      const m = [...css.matchAll(new RegExp("--" + name + "(?![\\w-])\\s*:\\s*(-?\\d+)", "g"))];
      expect(m.length, "--" + name + " 应唯一定义").toBe(1);
      return Number(m[0][1]);
    };
    const topbar = val("lake-z-topbar");
    const band = ["lake-z-overlay-menu", "lake-z-overlay-scrim", "lake-z-overlay-dialog", "lake-z-overlay-menu-raised", "lake-z-overlay-lightbox"];
    for (const t of band) expect(val(t), t + " 须高于 topbar").toBeGreaterThan(topbar);
    for (let i = 1; i < band.length; i++) expect(val(band[i]), band[i]).toBeGreaterThan(val(band[i - 1]));
  });

  it("按钮语义色与标签输入原语不被内核未分层 button/input 重置吃掉", () => {
    const kernel = readFileSync(path.join(SRC, "styles/kernel-theme.css"), "utf8");
    expect(kernel).toContain(".ln-btn--primary { color: var(--lake-text-on-accent); }");
    expect(kernel).toContain(".b3-button:not(.quick-note-publish):not(.quick-note-discard) { color: var(--lake-text-on-accent); }");
    const tagPicker = readFileSync(path.join(SRC, "features/quickNotes/QuickNoteTagPicker.tsx"), "utf8");
    expect(tagPicker).toContain('className="ln-input quick-note-tag-picker__input"');
    expect(tagPicker).toContain('className="ln-input__field"');
  });
});

/**
 * 文档状态栏的落位门禁（260926）。
 *
 * 状态栏浮在正文右下，但**表格/画板正文自带底部控件**，浮上去就压住它们（用户各报过一次）：
 * - 表格：状态栏上移到 Univer 自有底栏正上方；
 * - 画板：满幅画布 + 画板自己的浮岛占着右上/右下/左中 ⇒ 状态栏改钉左下角。
 * 两侧必须成对存在（状态栏按 kind 定位 + 正文侧让位/让角），所以在这里一起卡住。
 */
describe("文档状态栏落位（按文档类型）", () => {
  const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

  it("状态栏暴露 data-doc-kind（按类型定位的唯一钩子）", () => {
    expect(read("components/app/DesktopStatusBar.tsx")).toContain("data-doc-kind={docKind}");
  });

  it("表格：状态栏停在 Univer 计算条正上方（底距 = 实测变量，默认 37px）", () => {
    const chrome = read("styles/chrome.css");
    expect(chrome).toContain('.document-statusbar[data-doc-kind="usheet"] {');
    const rule = chrome.slice(chrome.indexOf('.document-statusbar[data-doc-kind="usheet"] {'));
    const body = rule.slice(0, rule.indexOf("}"));
    // 261010 用户：底栏压到 30px ⇒ 底距不再写死 41px，改实测变量（默认 35 = 1px 贴底 + 30px 底栏 + 4px 缝）
    expect(body).toContain("bottom: var(--usheet-status-bottom, 35px);");
    expect(body).toContain("height: 22px;");
    // 变量必须由 usheet 编辑器自己实测写入（与 BitableEditor 的 --lake-bitable-status-bottom 同姿势）
    const editor = read("features/usheet/UniverSheetEditor.tsx");
    expect(editor).toContain("--usheet-status-bottom");
    expect(editor).toContain("slide-tab-bar");
    // 压缩规则落在 usheet 自己的样式文件（内核例外，理由写在规则处）
    expect(read("features/usheet/usheetEditor.css")).toContain('section:has([data-u-comp="slide-tab-bar"])');
  });

  it("画板：内核「主题选择」岛抬到状态栏上方（右下共存），且底距按状态栏几何派生", () => {
    // 状态栏留在右下（用户 260926 口径）⇒ 让内核那座岛让位，覆盖写在画板自己的 boardEditor.css
    // （岛的位置在 vendor 镜像 vendor-board.css，那份标注勿手改）
    const board = read("features/board/boardEditor.css");
    expect(board).toContain(".board-editor .lakex-drawnix-core .theme-toolbar {");
    expect(board).toContain("bottom: calc(8px + 26px + 8px);");
    // 右缘对齐：与画板浮岛同一列（20px 右栅格），堆叠起来不参差
    const status = read("styles/document-status.css");
    expect(status).toContain('.document-statusbar[data-doc-kind="board"] {');
    expect(status).toContain("right: calc(20px + var(--lake-outline-inset, 0px));");
    // 派生式依赖的状态栏几何：底距 8px（document-status.css）+ 高度 26px（chrome.css 生效）
    expect(status).toMatch(/\.document-statusbar \{[^}]*bottom: 8px;/);
    expect(read("styles/chrome.css")).toMatch(/\.document-statusbar \{\s*height: 26px;/);
  });
});
