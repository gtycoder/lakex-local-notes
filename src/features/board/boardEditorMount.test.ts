/**
 * 画板编辑器挂载/路由护栏（260920）。
 *
 * vitest 是 node 环境，起不了 Canvas/DOM 画布；用源码级断言锁死四条易回归的集成约束
 * （与 sheetEditorMount.test.ts / bitableEditorMount.test.ts 同套路）：
 * - MultiTabEditor 必须按 kind 路由到 BoardEditor（否则画板 JSON 会被 Lake 编辑器打开 = 毁正文）；
 * - BoardEditor 不引用 Lake 内核（零内核实例是这个 kind 的存在理由）；
 * - previewImage / cardHeight 绝不写进正文（那是卡片专用字段，实测占带画板文档 90%+ 体积）；
 * - 只读态不自动保存；自动保存有防抖 + 与上次序列化比较。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const EDITOR = readFileSync(new URL("./BoardEditor.tsx", import.meta.url), "utf8");
const TABS = readFileSync(new URL("../editor/MultiTabEditor.tsx", import.meta.url), "utf8");
const DOC = readFileSync(new URL("../../core/boardDoc.ts", import.meta.url), "utf8");
const STORE = readFileSync(new URL("../../../electron/store.ts", import.meta.url), "utf8");
const KINDS = readFileSync(new URL("../../core/noteKind.ts", import.meta.url), "utf8");
const MOBILE_VIEWER = readFileSync(new URL("../../mobile/board/MobileBoardViewer.tsx", import.meta.url), "utf8");
const MOBILE_WORKSPACE = readFileSync(new URL("../../mobile/notebook/NotebookWorkspace.tsx", import.meta.url), "utf8");

describe("画板编辑器护栏", () => {
  it("MultiTabEditor 按 kind=board 懒加载 BoardEditor", () => {
    expect(TABS).toMatch(/tab\.kind === "board"/);
    expect(TABS).toMatch(/import\("\.\.\/board\/BoardEditor"\)/);
    expect(TABS).toMatch(/<BoardEditor/);
  });

  it("BoardEditor 不引用 Lake 内核（独立画板 = 零内核实例）", () => {
    expect(EDITOR).not.toMatch(/from "\.\.\/editor\/EditorTab"/);
    expect(EDITOR).not.toMatch(/lakeRuntime|createLakeDocument|EditorTab/);
    expect(EDITOR).toMatch(/DrawnixBoardCore/);
  });

  it("正文只存场景 + 视口：previewImage / cardHeight 不落盘", () => {
    expect(EDITOR).not.toMatch(/previewImage:/);
    expect(EDITOR).not.toMatch(/cardHeight:/);
    expect(DOC).toMatch(/elements: unknown\[\]/);
    expect(DOC).toMatch(/export function boardToBody/);
  });

  it("只读态不自动保存，自动保存有防抖 + 与上次序列化比较", () => {
    expect(EDITOR).toMatch(/if \(readOnlyRef\.current\) return;/);
    expect(EDITOR).toMatch(/AUTOSAVE_DEBOUNCE_MS/);
    expect(EDITOR).toMatch(/lastSerializedRef/);
    expect(EDITOR).toMatch(/boardToBody/);
  });

  it("视口被动记录、不回灌 value（pan/zoom 不该触发保存）", () => {
    expect(EDITOR).toMatch(/onViewportPersist/);
    expect(EDITOR).toMatch(/viewportRef\.current/);
    expect(EDITOR).not.toMatch(/plaitViewport: next/);
  });

  it("kind=board 端到端接线：noteKind / 正文目录 / 搜索文本 / 主进程新建", () => {
    expect(KINDS).toMatch(/"board"/);
    expect(STORE).toMatch(/path\.join\(this\.root, "boards", `\$\{id\}\.board\.json`\)/);
    expect(STORE).toMatch(/boardToSearchText/);
    expect(STORE).toMatch(/createBoardIn\(/);
  });

  it("移动端：kind=board 走进只读画板查看器（绝不挂 Lake 编辑器、不保存）", () => {
    // 路由：board 分支必须在「非 doc 占位」之前，否则画板会被挡成占位
    expect(MOBILE_WORKSPACE).toMatch(/t\.kind === "board" \? \(/);
    expect(MOBILE_WORKSPACE).toMatch(/<MobileBoardViewer content=\{t\.content\}/);
    // 查看器：只读 + 自适应 + 懒加载同一份引擎分包；不碰 Lake 编辑器/保存
    expect(MOBILE_VIEWER).toMatch(/readOnly/);
    expect(MOBILE_VIEWER).toMatch(/fitOnInit/);
    expect(MOBILE_VIEWER).toMatch(/loadDrawnixBoardCore/);
    expect(MOBILE_VIEWER).not.toMatch(/DocumentEditor|LakeEditor|lakeRuntime|saveNote/);
  });
});
