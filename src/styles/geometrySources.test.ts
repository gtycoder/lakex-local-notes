import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// W3（260923）：把 PANEL-CONTRACT §1 的「垂直几何 = 令牌单一来源」变成可执行约束。
// 动机：peek 顶 80 / 浮层顶 112 / 阅读态大纲 74 曾从 P5 一直写死到 260923；macOS 红绿灯 y=13 同理。
// 本测试是"防漂移"的：一旦有人把几何写回字面值，或让令牌出现第二个定义点，立刻红。
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

const TOKENS = ["--topbar-height", "--breadcrumb-height", "--editor-toolbar-height", "--tab-item-height"];
const SCANNED = [
  "styles/app/base.css", "styles/chrome.css", "styles/app/shell.css", "styles/app/editor.css",
  "styles/app/tabs.css", "features/outline/outline.css", "styles/compat.css", "styles/overlay.css",
  "styles/kit.css", "styles/feature.css", "styles/themes/base.css",
];

describe("垂直几何：令牌单一来源（PANEL-CONTRACT §1）", () => {
  it("4 个令牌各只在 styles/app/base.css 定义一次", () => {
    const defs = new Map<string, string[]>();
    for (const f of SCANNED) {
      for (const m of read(f).matchAll(/--(topbar-height|breadcrumb-height|editor-toolbar-height|tab-item-height)\s*:/g)) {
        const name = "--" + m[1];
        if (!defs.has(name)) defs.set(name, []);
        defs.get(name)!.push(f);
      }
    }
    for (const t of TOKENS) expect(defs.get(t), t + " 的定义点").toEqual(["styles/app/base.css"]);
  });

  it("派生消费者一律引用令牌（不再写死几何）", () => {
    expect(read("styles/chrome.css")).toContain("--lake-dir-peek-top: calc(var(--topbar-height) + 4px)");
    expect(read("styles/app/shell.css")).toContain("--lake-floating-panel-top: calc(var(--topbar-height) + 4px + var(--breadcrumb-height) + var(--editor-toolbar-height))");
    expect(read("styles/chrome.css")).toMatch(/\.protyle-breadcrumb\s*\{[^}]*height:\s*var\(--breadcrumb-height\)/);
    expect(read("styles/app/editor.css")).toMatch(/\.ne-ui-toolbar\s*\{\s*height:\s*var\(--editor-toolbar-height\)/);
    expect(read("styles/app/tabs.css")).toMatch(/height:\s*var\(--tab-item-height\)/);
    // 标签条垂直内距 = (顶栏 − 标签)/2，再 ±2px 把内容下移到「顶栏+4px 拼接缝」可见头区的中心
    expect(read("styles/app/tabs.css")).toMatch(/padding:\s*calc\(\(var\(--topbar-height\)\s*-\s*var\(--tab-item-height\)\)\s*\/\s*2\s*\+\s*2px\)\s*10px\s*calc\(\(var\(--topbar-height\)\s*-\s*var\(--tab-item-height\)\)\s*\/\s*2\s*-\s*2px\)/);
    // 阅读态大纲顶 = 顶栏 + 4 拼接缝 + 面包屑
    expect(read("styles/app/editor.css")).toMatch(/\.ne-viewer-toc-sidebar\s*\{[^}]*top:\s*calc\(var\(--topbar-height\)\s*\+\s*4px\s*\+\s*var\(--breadcrumb-height\)\)/);
    // 阅读态大纲底 = 状态栏保留高：内核浮层是 bottom:0（铺到视口底、压住状态栏 z 180），
    // 只在状态栏实际存在时上收，其他空间不留空
    expect(read("styles/app/editor.css")).toContain(".app-shell:has(.document-statusbar) .lake-editor-tab .ne-viewer-toc-sidebar");
    expect(read("styles/app/editor.css")).toMatch(/bottom:\s*var\(--statusbar-reserve\)/);
  });

  it("目录浮层从顶栏下缘起，底部仍保留 12px；固定态不受影响", () => {
    const css = read("styles/chrome.css");
    const top = css.match(/--lake-dir-peek-top:\s*([^;]+);/);
    expect(top?.[1]).toBe("calc(var(--topbar-height) + 4px)");
    expect(css).toContain("--lake-dir-peek-height: calc(100vh - var(--lake-dir-peek-top) - 12px)");
    const floating = css.match(/\.sidebar\.sidebar-floating,\s*\.sidebar\.sidebar-collapsed\s*\{([^}]+)\}/)?.[1];
    expect(floating).toContain("top: var(--lake-dir-peek-top)");
    expect(floating).toContain("height: var(--lake-dir-peek-height)");
    expect(floating).toContain("bottom: auto");
    expect(css).not.toMatch(/\.sidebar\.sidebar-docked\s*\{[^}]*--lake-dir-peek/);
  });

  it("「已收起」分区规则必须限定在 .sidebar 内（261123 撞名修复防回退）", () => {
    const css = read("styles/chrome.css");
    // 裸 .sidebar-collapsed 会命中 .app-shell.sidebar-collapsed / .sidebar.sidebar-collapsed
    // （侧栏「收起」状态类同名）⇒ max-height:33.333% 把整壳压成窗口 1/3 高
    // （用户 261123 现场：空态挤顶部一小块 + 灰底大空，目录栏收起悬浮即触发）。
    expect(css).not.toMatch(/^\.sidebar-collapsed\b/m);
    expect(css).toContain(".sidebar .sidebar-collapsed {");
  });

  it("过期字面值不得回归（112px 曾是大纲回退值）", () => {
    expect(read("features/outline/outline.css")).not.toContain("112px");
  });

  it("侧栏面板材质单一来源 = compat.css 平面版（261125 用户裁决 S-02，零视觉变化）", () => {
    const compat = read("styles/compat.css");
    const shell = read("styles/app/shell.css");
    // 用户看图选定 A 平面版 = 面 panel / 无边 / 无影 / radius-md（即现状生效值）。
    expect(compat).toMatch(
      /\.sidebar\.sidebar-docked \{[^}]*background: var\(--lake-bg-panel\);[^}]*border: 0;[^}]*box-shadow: none;[^}]*border-radius: var\(--lake-radius-md\);/,
    );
    // 「卡片派」副本（0.5px 边 + radius-card + 双层阴影）与同值重复项已删，禁止回流。
    expect(shell).not.toMatch(/\.sidebar\.sidebar-docked \{[^}]*(border|box-shadow|border-radius)/);
    expect(shell).not.toContain("var(--lake-radius-card)");
    // 小记工作区圆角只由 compat 给（0）；shell 侧双写已收单。
    expect(compat).toMatch(/\.app-shell\.quick-notes-active \.workspace,[\s\S]{0,240}?border-radius: 0;/);
    expect(shell).not.toMatch(/\.app-shell\.quick-notes-active \.workspace \{[^}]*border-radius/);
  });

  it("app-shell 栅格多态单一来源 = shell.css 壳层几何（261125 审计 S-07，防同层 import 顺序回流）", () => {
    // 合并前 .app-shell/.sidebar-collapsed/.sidebar-floating/.quick-notes-active 的 grid-template-columns
    // 分散在 outline.css / misc.css / shell.css 三处，同层靠 import 顺序定胜负（改外壳几何要猜加载顺序）。
    // 现全部收拢到 shell.css「壳层几何」分区；chrome.css 的空间态（trash/resources/tags/diary）在 shell 层，
    // 层序压过 legacy 全部规则（AGENTS §3#14 层序即优先级），归属不变。
    const OWNERS = new Set(["styles/app/shell.css", "styles/chrome.css"]);
    const offenders: string[] = [];
    for (const f of SCANNED) {
      const css = read(f);
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = m[1].trim().replace(/\s+/g, " ");
        if (!selector || selector.startsWith("@")) continue;
        if (!/(^|[\s,])\.app-shell\b/.test(selector)) continue;
        if (!/grid-template-columns\s*:/.test(m[2])) continue;
        if (!OWNERS.has(f)) offenders.push(f + " :: " + selector.slice(0, 80));
      }
    }
    expect(offenders, "app-shell 栅格列定义越界（单一来源 = shell.css 壳层几何 + chrome.css 空间态）：\n  " + offenders.join("\n  ")).toEqual([]);
  });

  it("壳层几何块内顺序即优先级：quick → ai → focus → 窄窗两列 → 宽窗三列（同特异性后者胜）", () => {
    // 块内顺序是行为的一部分：0,2,0 的 quick/ai/focus 必须排在窄窗两列（misc 原规则）之前、
    // 宽窗三列（outline 原规则）之前，否则窄窗下小记/AI 写作/专注模式会掉进 0 宽侧栏列（用户 260915 现场）。
    const css = read("styles/app/shell.css");
    const markers = [
      ".app-shell.quick-notes-active { grid-template-columns: var(--activity-rail-width) 0 minmax(0, 1fr); }",
      ".app-shell.ai-writing-active { grid-template-columns: var(--activity-rail-width) 0 minmax(0, 1fr); }",
      ".app-shell.focus-mode { grid-template-columns: 0 0 minmax(0, 1fr); }",
      "var(--activity-rail-width, 38px) minmax(148px, 1fr)",
      "var(--activity-rail-width) var(--sidebar-grid-w, var(--sidebar-width)) minmax(0, 1fr)",
    ];
    let prev = -1;
    for (const marker of markers) {
      const at = css.indexOf(marker);
      expect(at, "壳层几何块缺这条（取值=合并前现生效值，零视觉变化）：" + marker).toBeGreaterThan(prev);
      prev = at;
    }
  });

  it("固定目录高度 = 网格区 − margin，不溢出窗口（261017 修）", () => {
    const css = read("styles/app/shell.css");
    // height:100% + 上下 margin ⇒ 比可用高度高 38px，窗口变矮时目录最后几行滚到底也看不到。
    const docked = (css.match(/\.sidebar\.sidebar-docked\s*\{([^}]+)\}/)?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(docked).toContain("height: auto");
    expect(docked).not.toMatch(/height:\s*100%/);
    expect(docked).toContain("align-self: stretch");
    // 底边距 0：stretch 扣掉上边距后正好贴窗口底（与修复前观感一致）。
    expect(css.replace(/\s+/g, " ")).toContain("margin: calc(var(--topbar-height) + 4px) 4px 0 0;");
  });
});
