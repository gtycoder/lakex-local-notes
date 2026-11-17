import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(new URL("./ai.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const TSX = readFileSync(new URL("./MobileAiPage.tsx", import.meta.url), "utf8");

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(escaped + "\\s*\\{([^}]*)\\}"));
  return match?.[1] ?? "";
}

describe("mobile AI embedded layout", () => {
  it("does not add the top safe area a second time below the home toolbar", () => {
    // 261117 现场：内嵌副栏复用 .mobile-topbar 的安全区高度/上内距 ⇒ 顶部安全区被结算两次。
    // 现口径（topChrome 契约）：内嵌 = data-edge="nested"，inset / 顶部空气 / 内容高全部由契约派生，
    // 本地规则不再复位几何（护栏 topChromeContract.test.ts 钉全类；本测试钉这条回归的现场）。
    expect(TSX).toContain('data-edge={embedded ? "nested" : "overlay"}');
    expect(TSX).toContain('data-size={embedded ? "compact" : "regular"}');
    const head = declarations(".mobile-ai-page--embedded .mobile-ai-page__head");
    expect(head).not.toContain("--mobile-top-safe-area");
    expect(head).not.toContain("--mb-chrome-inset-top");
    expect(head).not.toMatch(/(^|[;\s])(height|margin-top|padding-top)\s*:/);
  });
});
