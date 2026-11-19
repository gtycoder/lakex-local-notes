// @vitest-environment jsdom
/**
 * Sheet footer 槽契约护栏（261119 按钮边界审计 B-1 收口）。
 *
 * 契约：MobileSheet 的 footer 槽**根节点必须是 `.mb-sheet__foot`**（底栏唯一几何：8/16/20+safe，floating.css）。
 * 之前 footer 原样挂载 ⇒ 业务方拿页面级 `.mb-set-block__actions`（0 内距 0 安全区）当底栏，
 * 按钮底缘 = 屏幕底缘、手势条压在按钮上（现场②：便携包导入确认 / 更新中心弹窗）。
 *
 * 两道护栏：
 *  ① render：裸 footer 由 MobileSheet 兜底包一层 `.mb-sheet__foot`；已带类的不双包；
 *     复合原语按契约自带（SheetFooter 根 = .mb-sheet__foot；SelectionActionBar = 自管安全区账的浮动卡，不并账）。
 *  ② 源码对账：所有 footer={...} 表达式必须能对上「SheetFooter / .mb-sheet__foot / 自管账豁免」，
 *     新写裸 footer（`.mb-set-block__actions` 之类）直接判红。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileSheet } from "./MobileSheet";
import { SheetFooter } from "./SheetFooter";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, ".."); // src/mobile

/** 自管安全区账的 footer 根（不并入 .mb-sheet__foot；只减不增）。 */
const FOOTER_SELF_ACCOUNTED = [
  // DocListSheet 多选条：浮动玻璃卡自带 margin + --mobile-bottom-safe-area（mobile.css .mb-sel-actions），审计 X-1「不并账」。
  "SelectionActionBar",
];
const ACCOUNTED_TOKENS = ["SheetFooter", "mb-sheet__foot", "data-mb-foot-self", ...FOOTER_SELF_ACCOUNTED];

/* ── ① render 护栏 ─────────────────────────────────────────────── */
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = (element: ReactElement) => act(() => { root.render(element); });
const sheet = (footer?: ReactNode): ReactElement =>
  createElement(MobileSheet, { open: true, title: "标题", onClose: () => undefined, children: "内容", footer });
const footRoots = (): Element[] => [...host.querySelectorAll(".mb-sheet > .mb-sheet__foot")];

describe("MobileSheet footer 槽契约（261119 B-1）", () => {
  it("footer 根节点必须含 .mb-sheet__foot：裸 footer 由原语兜底包一层", async () => {
    await render(sheet(createElement("div", { className: "mb-set-block__actions" }, "按钮")));
    const roots = footRoots();
    expect(roots).toHaveLength(1);
    expect(roots[0].className).toContain("mb-sheet__foot");
    expect(roots[0].querySelector(".mb-set-block__actions")).not.toBeNull();
  });

  it("footer 根节点必须含 .mb-sheet__foot：已带 .mb-sheet__foot 的根节点不双包", async () => {
    await render(sheet(createElement("div", { className: "mb-sheet__foot mb-usheet-sign__foot" }, "按钮")));
    const roots = footRoots();
    expect(roots).toHaveLength(1);
    expect(roots[0].className).toBe("mb-sheet__foot mb-usheet-sign__foot");
    expect(host.querySelectorAll(".mb-sheet__foot")).toHaveLength(1);
  });

  it("SheetFooter 原语自带 .mb-sheet__foot（复合组件不被兜底二次包裹）", async () => {
    await render(sheet(createElement(SheetFooter, { cancel: { label: "取消" }, confirm: { label: "确定" } })));
    expect(host.querySelectorAll(".mb-sheet__foot")).toHaveLength(1);
    expect(footRoots()).toHaveLength(1);
  });

  it("自管安全区账的复合 footer（SelectionActionBar 形态）不被包裹（不并账）", async () => {
    function FloatingCard(): ReactElement {
      return createElement("div", { className: "mb-sel-actions mb-glass" }, "批量操作");
    }
    await render(sheet(createElement(FloatingCard)));
    expect(host.querySelectorAll(".mb-sheet__foot")).toHaveLength(0);
    expect(host.querySelector(".mb-sel-actions")).not.toBeNull();
  });

  it("无 footer 不渲染底栏；多节点 footer 一律兜底包一层", async () => {
    await render(sheet(undefined));
    expect(footRoots()).toHaveLength(0);
    await render(sheet([createElement("button", { key: "a" }, "A"), createElement("button", { key: "b" }, "B")]));
    const roots = footRoots();
    expect(roots).toHaveLength(1);
    expect(roots[0].querySelectorAll("button")).toHaveLength(2);
  });
});

/* ── ② 源码对账：footer 表达式必须落在契约内 ─────────────────────── */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

/** 切出每个 footer={...} 表达式（花括号配平；跳过字符串）。 */
function footerExpressions(src: string): string[] {
  const out: string[] = [];
  const re = /\bfooter=\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") {
        const q = c;
        i++;
        while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      } else if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

/** footer={footer} 这类变量间接：取同文件里 const/let <id> = 的初始化式（括号配平到深度 0 的 ;）。 */
function resolveIdentifier(src: string, expr: string): string {
  const id = /^[A-Za-z_$][\w$]*$/.exec(expr.trim());
  if (!id) return expr;
  const assign = new RegExp("(?:const|let)\\s+" + id[0] + "\\s*=\\s*").exec(src);
  if (!assign) return expr;
  let depth = 0;
  let i = assign.index + assign[0].length;
  const start = i;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
    } else if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === ";" && depth <= 0) break;
    i++;
  }
  return src.slice(start, i);
}

describe("footer 槽源码对账（261119 B-1）", () => {
  it("每个 footer 表达式都要能对上 SheetFooter / .mb-sheet__foot / 自管账豁免", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const file of walk(SRC)) {
      const src = readFileSync(file, "utf8");
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      for (const expr of footerExpressions(src)) {
        scanned++;
        // JSX 直接量看表达式本身；变量间接看它的初始化式（裸 .mb-set-block__actions 无处可藏）。
        const where = expr.includes("<") ? expr : resolveIdentifier(src, expr);
        const ok = ACCOUNTED_TOKENS.some((t) => where.includes(t));
        if (!ok) offenders.push(rel + " :: footer={" + expr.trim().replace(/\s+/g, " ").slice(0, 90) + "}");
      }
    }
    expect(scanned, "扫描到的 footer 表达式数量异常（提取器失效？）").toBeGreaterThan(10);
    expect(
      offenders,
      "以下 footer 根节点不带 .mb-sheet__foot（迁 SheetFooter 或包 .mb-sheet__foot；自管安全区账的浮动卡进 FOOTER_SELF_ACCOUNTED）：\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("提取器自证：旧现场形态（footer={footer} 指向裸 .mb-set-block__actions）必须被判红", () => {
    const legacy =
      'const footer = busy ? (<div className="mb-set-block__actions">x</div>) : null;' +
      '\n<MobileSheet footer={footer}>';
    const [expr] = footerExpressions(legacy);
    expect(expr.trim(), "提取器必须切出表达式本身").toBe("footer");
    const where = resolveIdentifier(legacy, expr);
    expect(where, "变量间接必须解析到初始化式").toContain("mb-set-block__actions");
    expect(ACCOUNTED_TOKENS.some((t) => where.includes(t))).toBe(false);
  });

  it("B-1/B-9 实锤面已收口：便携包/更新弹窗走 SheetFooter，破坏性主操作走 danger 档", () => {
    const portable = readFileSync(path.join(SRC, "settings/PortableImportSection.tsx"), "utf8");
    expect(portable).toContain("SheetFooter");
    expect(portable, "B-9：破坏性主操作统一 danger 档（实心红主按钮），不再用裸 --danger-text").toContain('variant: "danger"');
    expect(portable).not.toContain("mb-btn--danger-text");
    const update = readFileSync(path.join(SRC, "settings/UpdateCenterSection.tsx"), "utf8");
    expect(update).toContain("SheetFooter");
    expect(update, "B-9：多按钮面板主操作带 grow（mb-flex1），不再与次操作同宽排队").toContain("mb-flex1");
  });
});

/* ── ③ 底栏几何静态算术（审计 B-1/B-3/B-5/B-6 的验证法落地）───────────────── */
function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(selector + " {");
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
}

describe("底栏几何单一账（B-1/B-3/B-5/B-6）", () => {
  const css = readFileSync(path.join(SRC, "floating.css"), "utf8");

  it("B-1：.mb-sheet__foot 声明里消费 --mobile-bottom-safe-area（8/16/20+safe 口径）", () => {
    expect(ruleBody(css, ".mb-sheet__foot")).toContain("--mobile-bottom-safe-area");
  });

  it("B-3：有 foot 时 body 底内距退回纯间距（body+foot 的 safe 项计数 = 1，不再双叠）", () => {
    expect(css, "必须有「有 foot ⇒ body 降底内距」的收口规则").toContain(".mb-sheet:has(> .mb-sheet__foot) .mb-sheet__body");
    const bodyWithFoot = ruleBody(css, ".mb-sheet:has(> .mb-sheet__foot) .mb-sheet__body");
    expect(bodyWithFoot).toContain("padding-bottom: var(--lake-space-md)");
    expect(bodyWithFoot, "有 foot 时 body 不再消费安全区").not.toContain("--mobile-bottom-safe-area");
    // 无 foot 的滚动末端让位保持不动（16 / 20 + safe）。
    expect(ruleBody(css, ".mb-sheet__body")).toContain("--mobile-bottom-safe-area");
  });

  it("B-5：数据表抽屉底栏补上安全区项", () => {
    const bitable = readFileSync(path.join(SRC, "bitable/mobileBitable.css"), "utf8");
    expect(ruleBody(bitable, ".mbt-drawer__foot")).toContain("--mobile-bottom-safe-area");
  });

  it("B-6：AI 三面板底栏并入 .mb-sheet__foot（.ai-sheet__foot / .ai-sheet__body 平行账已删）", () => {
    const ai = readFileSync(path.join(SRC, "ai/ai.css"), "utf8");
    expect(ai, ".ai-sheet__foot 规则必须删除").not.toContain(".ai-sheet__foot {");
    expect(ai, ".ai-sheet__body 平行账必须删除").not.toContain(".ai-sheet__body {");
    for (const f of ["ai/AiCorpusSheet.tsx", "ai/AiSendSheet.tsx", "ai/AiImageSheet.tsx"]) {
      const src = readFileSync(path.join(SRC, f), "utf8");
      expect(src, f + " 底栏必须用 .mb-sheet__foot").toContain('className="mb-sheet__foot"');
    }
  });
});
