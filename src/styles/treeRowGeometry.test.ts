// @vitest-environment jsdom
/**
 * 桌面目录树行几何护栏（261119 用户点单「稀疏一点点 + 选中行与相邻行有空隙」）。
 *
 * 口径（docs/DESIGN.md Rows / Selection & Hover Surfaces）：
 * - 行高档位**不动**：普通行 27px / 笔记本行 29px（行内 2px 内距、字号 --lake-font-size-body）；
 * - 行间只加**小空隙**（1px；下一档 = --lake-space-xxs 2px，用户口径绝不 4px+）；
 * - hover / 选中 = 同一个行块（.note-row）上只换颜色 ⇒ 与 hover **同几何**，只差色；
 *   行块圆角 8px 档（--lake-radius-sm），选中块靠行间隙与相邻块分开（思源式独立行块）；
 * - hover / 选中**瞬时**（无过渡）。
 */
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../lib/types";

// 行壳会引内核意图预取（点/hover 行即预热内核 chunk）；几何护栏与内核加载无关，直接桩掉。
vi.mock("../features/editor/kernelPrefetch", () => ({ prefetchEditorKernelNow: vi.fn() }));

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const CHROME = read("./chrome.css");
const MISC = read("./app/misc.css");
const SHELL = read("./app/shell.css");
const BASE = read("./themes/base.css");

/** 取「选择器 { ... }」规则体（只取顶层规则体，行几何规则都在顶层）。 */
const ruleBody = (css: string, selector: string): string => {
  const hit = css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}"));
  expect(hit, `找不到规则 ${selector}`).toBeTruthy();
  return hit![1];
};

describe("桌面目录树行几何（261119 行间隙微调）", () => {
  it("行间隙存在：.note-row 行尾 1px（≤2px 档；下一档 --lake-space-xxs，绝不 4px+）", () => {
    const body = ruleBody(CHROME, ".note-row");
    expect(body).toMatch(/margin-bottom:\s*1px/);
    // 只许 1px / 2px 档：出现 3px+ 直接红（用户「1–2px 级别、绝不 4px+」）。
    expect(body).not.toMatch(/margin-bottom:\s*[3-9]px/);
    // 行间隙必须是**行块外**的外边距，不得靠加行内距/行高冒充（行高档位红线）。
    expect(body).not.toMatch(/padding:\s*3px/);
  });

  it("行高档位未变：普通行 27 / 笔记本行 29，行内 2px 8px，占位高度与真实行高一致", () => {
    expect(MISC).toMatch(/\.note-row,\s*\.tree-row \{\s*min-height: 27px/);
    expect(MISC).toMatch(/\.tree-row\.type-notebook \{ min-height: 29px;/);
    expect(ruleBody(CHROME, ".note-row")).toMatch(/padding: 2px 8px/);
    // content-visibility 占位高度 = 真实行内容盒（23 / 25 + 上下内距 4 = 27 / 29），
    // 行间隙是外边距、不进占位 ⇒ 滚入视口无跳动（261111 目录跳动修复不回退）。
    expect(SHELL).toContain("contain-intrinsic-size: auto 23px;");
    expect(CHROME).toContain("contain-intrinsic-size: auto 25px;");
  });

  it("字号 = 14.5px 试档（body 与 bodyMd 的中间值，令牌求均、不写字面量）", () => {
    const body = ruleBody(CHROME, ".note-row-copy strong");
    // 261120 用户点单第二轮：16px（正文字号默认）太大、14px 偏小 ⇒ 试 14.5px。
    // 用相邻两档令牌求均值（calc），不引入字号字面量、也不新增档位令牌。
    expect(body).toMatch(/font-size: calc\(\(var\(--lake-font-size-body\) \+ var\(--lake-font-size-bodyMd\)\) \/ 2\)/);
    expect(body).not.toMatch(/font-size: var\(--lake-font-size-body\);/);
  });

  it("选中块与 hover 同几何：状态规则只换色（无 margin/padding/圆角/尺寸/过渡声明）", () => {
    // 几何只在基座 .note-row 一条规则里（含圆角 8px 令牌）——状态规则不得再动几何。
    expect(ruleBody(CHROME, ".note-row")).toMatch(/border-radius: var\(--lake-radius-sm\)/);
    expect(BASE).toMatch(/--lake-radius-sm: 8px/);
    const stateSelectors = [
      ".note-row:hover",
      ".note-row:active",
      ".note-row.active",
      ".note-row.active:hover",
      ".note-row.is-multi-selected",
      ".note-row.is-multi-selected:hover",
    ];
    const COLORISH = /^(background|background-color|color|box-shadow|font-weight|filter)$/;
    for (const sel of stateSelectors) {
      const decls = ruleBody(CHROME, sel)
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => d.split(":")[0].trim());
      expect(decls.length, `${sel} 应有状态声明`).toBeGreaterThan(0);
      for (const prop of decls) {
        expect(COLORISH.test(prop), `${sel} 只许换色，实际有 ${prop}`).toBe(true);
      }
    }
    // 状态切换瞬时（动效红线：hover/选中不做过渡）。
    for (const sel of stateSelectors) expect(ruleBody(CHROME, sel)).not.toMatch(/transition|animation/);
  });

  it("render：行块是单元素，hover/选中/多选都打在同一个 .note-row 上（同盒 = 同几何）", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const { TreeRowFace } = await import("../components/app/sidebar/TreeRowFace");
    const node: TreeNode = {
      id: "n1",
      parentId: null,
      workspaceId: "default",
      nodeType: "note",
      title: "文档",
      noteFileId: "n1",
      sortOrder: 0,
      createdAt: "t",
      updatedAt: "t",
      isConflict: false,
    };
    const noop = () => {};
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const faceProps = {
      node,
      open: false,
      expandable: false,
      active: true,
      selected: true,
      context: false,
      dragging: false,
      releasing: false,
      dropParent: false,
      sameLevelLine: false,
      dropPosition: null,
      locked: false,
      onPointerDown: noop,
      onContextMenu: noop,
      onCreateMenu: noop,
      onToggle: noop,
      onSelect: noop,
      onRowClick: noop,
      onIconClick: noop,
      onContext: noop,
      consumeSuppressedClick: () => false,
    };
    act(() => root.render(createElement(TreeRowFace, faceProps)));
    const row = host.querySelector<HTMLElement>('[data-tree-node-id="n1"]')!;
    // hover 靠 :hover 伪类打在行自身；选中态（active / is-multi-selected）也在同一元素
    // ⇒ 选中块与 hover 块是同一个盒，几何天然一致，只差色。
    expect(row.classList.contains("note-row")).toBe(true);
    expect(row.classList.contains("tree-row")).toBe(true);
    expect(row.classList.contains("active")).toBe(true);
    expect(row.classList.contains("is-multi-selected")).toBe(true);
    expect(host.querySelectorAll(".note-row").length).toBe(1);
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
});
