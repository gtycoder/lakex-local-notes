/**
 * 蓝点快创「图形选择面板」护栏（260920）。
 *
 * 背景：plait 的 `withArrowLineAutoComplete` 提交快创时用
 * `createDefaultGeometry(board, points, originElement.shape)` ⇒ 新形状只复制**源形状类型**
 * （圆→圆、方→方）。云端语雀是提交后弹「最近使用 / 基础图形」面板让用户挑，画流程图方便得多。
 *
 * 我们**不 patch @plait/***，只在 vendor 适配层接住：判定「选择态下 pointerup 后画布新增单个 geometry」
 * = 快创提交 → 弹面板 → 选中后 `switchGeometryShape`。这些是易回归的集成约束，用源码级断言锁死
 * （与 boardEditorMount.test.ts 同套路；vitest 是 node 环境，跑不了真实画布）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CORE = readFileSync(
  new URL("../../../vendor/lakex-doc-react/src/cards/DrawingBoard/DrawnixBoardCore.tsx", import.meta.url),
  "utf8",
);
const PICKER = readFileSync(
  new URL("../../../vendor/lakex-doc-react/src/cards/DrawingBoard/LakexQuickShapePicker.tsx", import.meta.url),
  "utf8",
);
const CATALOG = readFileSync(
  new URL("../../../vendor/lakex-doc-react/src/cards/DrawingBoard/LakexShapeCatalog.tsx", import.meta.url),
  "utf8",
);
const CSS = readFileSync(
  new URL("../../../vendor/lakex-doc-react/src/cards/DrawingBoard/DrawnixBoardCore.css", import.meta.url),
  "utf8",
);

describe("蓝点快创图形选择面板", () => {
  it("只在「选择态 + 新增单个 geometry」时弹出（画形状/粘贴/复制不会误触发）", () => {
    expect(CORE).toMatch(/PlaitPointerType\.selection/);
    expect(CORE).toMatch(/PlaitDrawElement\.isGeometry\(element\)/);
    expect(CORE).toMatch(/added\.length !== 1/);
    // 自研 UI（工具栏/图形库/素材库/导出/面板自身）内的手势不算画布手势
    expect(CORE).toMatch(/QUICK_SHAPE_IGNORE_SELECTOR/);
  });

  it("选中后按云端口径改形状：复用内核 switchGeometryShape（不改 @plait 源码）", () => {
    expect(CORE).toMatch(/addSelectedElement\(current, element\)/);
    expect(CORE).toMatch(/DrawTransforms\.switchGeometryShape\(current, shape\)/);
    expect(CORE).toMatch(/memorizeLatestShape\(current, shape\)/);
    // 最近使用形状是本机偏好，不进文档/S3
    expect(CORE).toMatch(/RECENT_SHAPES_KEY/);
    expect(CORE).toMatch(/window\.localStorage\.setItem\(RECENT_SHAPES_KEY/);
  });

  it("面板 = 最近使用 + 基础/流程图/智能三节，图标复用图形库那套", () => {
    expect(PICKER).toMatch(/categories\.find\(\(item\) => item\.key === key\)/);
    expect(PICKER).toMatch(/"basic", "flowchart", "smart"/);
    expect(PICKER).toMatch(/最近使用/);
    expect(PICKER).toMatch(/ShapePreview/);
    expect(CATALOG).toMatch(/export const categories/);
    expect(CATALOG).toMatch(/export function ShapePreview/);
    // Esc / 点外面关闭；不选 = 保持复制出来的形状（不破坏既有习惯）
    expect(PICKER).toMatch(/event\.key === "Escape"/);
    expect(PICKER).toMatch(/pointerdown/);
  });

  it("面板样式随主题（深色用 island 令牌）且有入场动效", () => {
    expect(CSS).toMatch(/\.lakex-quick-shape \{/);
    expect(CSS).toMatch(/\[data-theme="dark"\] \.lakex-quick-shape/);
    expect(CSS).toMatch(/@keyframes lakex-quick-shape-in/);
  });
});
