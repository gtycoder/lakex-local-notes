import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 动效契约（261017 A 批）。
 *
 * 这批不是"再加点动画"，而是把动效收口成可检查的规则：
 *   · 时长/曲线只有一套来源（themes/base.css 的 --lake-motion-* / --lake-ease-*）；
 *   · 浮层入场只动 opacity/transform，挂在原语上起播（不用 rAF/相位门控）；
 *   · 按压反馈只走 kit 原语，并且只用 instant 档（跟手）；
 *   · reduced-motion 仍由 a11y 层统一兜底；
 *   · 不再出现第二套 TS 动效刻度（旧 src/lib/uiTokens.ts 已删）。
 * 改这些规则时请连同本文件一起改 —— 它是"别再散回去"的判据。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(HERE, rel), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("动效契约", () => {
  it("时长与曲线只有一套来源，且过冲曲线已登记", () => {
    const base = read("themes/base.css");
    expect(base).toMatch(/--lake-motion-instant:\s*80ms/);
    // 261029 动效收敛：除按压两档外，其余时长统一 250ms、曲线统一 ease-out。
    expect(base).toMatch(/--lake-motion-fast:\s*250ms/);
    expect(base).toMatch(/--lake-motion-panel:\s*250ms/);
    expect(base).toMatch(/--lake-motion-slow:\s*250ms/);
    expect(base).toContain("--lake-ease-standard: ease-out");
    expect(base).toContain("--lake-ease-overshoot: ease-out");
  });

  it("浮层入场只动 opacity/transform（不触发布局）", () => {
    const overlay = stripComments(read("overlay.css"));
    const blocks = [...overlay.matchAll(/@keyframes\s+ln-(?:scrim|dialog|surface)-in\s*\{([\s\S]*?)\}\s*\}/g)].map((m) => m[1]);
    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      expect(block).not.toMatch(/(?:^|[;{])\s*(width|height|top|left|right|bottom|margin|padding|font-size|background|border|filter)\s*:/);
    }
  });

  it("菜单/气泡入场挂在原语上（custom surfaceClassName 也走同一套，不按表面类各写一份）", () => {
    const overlay = read("overlay.css");
    expect(overlay).toMatch(/\.ln-overlay-surface\s*\{[\s\S]*?animation:\s*ln-surface-in/);
    // 不用 data-* 相位门控：隐藏窗口里 rAF 不触发，会把菜单卡成不可见。
    expect(overlay).not.toContain("data-overlay-entered");
  });

  it("按压物理只走 kit 原语，并且用 instant 档（跟手）", () => {
    const kit = read("kit.css");
    expect(kit).toContain(".ln-btn:active:not(:disabled) { transform: translateY(.5px) scale(.98); }");
    expect(kit).toContain(".ln-iconbtn:active:not(:disabled) { background: var(--lake-bg-press); transform: scale(.94); }");
    expect(kit).toMatch(/--lake-ease-overshoot/);
    expect(kit).not.toMatch(/\d+ms/); // kit 层一律走令牌，不许出现裸毫秒值
  });

  it("大面板收起/展开已收编到 slow 档，不再留 260ms 裸值", () => {
    const outline = stripComments(read("../features/outline/outline.css"));
    expect(outline).toMatch(/transition:\s*opacity\s+var\(--lake-motion-slow\)/);
    expect(outline).not.toContain("260ms");
  });

  it("浮层入场只有一套来源（legacy lake-pop-in 已收编）", () => {
    expect(stripComments(read("app/shell.css"))).not.toContain("lake-pop-in");
    expect(stripComments(read("components.css"))).not.toContain("@keyframes lake-pop-in");
  });

  it("reduced-motion 契约仍在，且不再有第二套 TS 动效刻度", () => {
    const a11y = read("a11y.css");
    expect(a11y).toContain("@media (prefers-reduced-motion: reduce)");
    expect(a11y).toContain("animation-duration: 1ms");
    expect(existsSync(path.resolve(HERE, "../lib/uiTokens.ts"))).toBe(false);
  });

  it("设置/历史/回收站浮窗入场时长走 --lake-motion-panel（不再裸 180ms）", () => {
    // 261022 D2：settings.css 的 .floating-dialog 入场原本写死 180ms，偏离 190ms 的 panel 档；
    // 动效时长只有 --lake-motion-* 一套来源（§3#14），这里把那一行钉回令牌，禁止再散回裸值。
    const settings = stripComments(read("app/settings.css"));
    expect(settings).toMatch(/animation:\s*floating-dialog-enter\s+var\(--lake-motion-panel\)\s+var\(--lake-ease-standard\);/);
    expect(settings).not.toMatch(/animation:\s*floating-dialog-enter\s+\d+(?:\.\d+)?m?s/);
  });
});
