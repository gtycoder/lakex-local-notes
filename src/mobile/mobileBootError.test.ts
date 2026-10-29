import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MOB-08：启动失败必须可处置（重试 / 清缓存重试 / 复制诊断），且错误页优先于骨架。
 * 旧实现 catch 后 phase 仍停在 booting ⇒ 只会永久显示骨架 + 启动遮罩（error 分支根本走不到）。
 */
const APP = readFileSync(new URL("./MobileApp.tsx", import.meta.url), "utf8");

describe("移动端启动失败页（MOB-08）", () => {
  it("错误页优先于 booting 骨架，不再被永久骨架挡住", () => {
    const errorAt = APP.indexOf("if (error) return (");
    const bootingAt = APP.indexOf('if (phase === "booting")');
    expect(errorAt).toBeGreaterThan(-1);
    expect(bootingAt).toBeGreaterThan(errorAt);
  });

  it("三个处置动作齐全，且都用现有能力（不新增原生 API）", () => {
    expect(APP).toContain("onRetry={() => void boot()}");
    expect(APP).toContain("onClearCacheAndRetry={() => void clearCacheAndRetry()}");
    expect(APP).toContain("onCopyDiagnostics={() => void copyBootDiagnostics()}");
    // 重试 = 重新走 bridge.init()；清缓存 = 既有 cachePort；复制 = 既有 getDiagnostics
    expect(APP).toMatch(/await bridge\.init\(\)/);
    expect(APP).toContain("mobileCachePort.clearDerivedCaches()");
    expect(APP).toContain("bridge.getDiagnostics()");
  });

  it("错误页只用既有 mb-* / 布局类，不写内联样式", () => {
    const page = APP.slice(APP.indexOf("function MobileBootErrorPage"), APP.indexOf("function MobileHomeSkeleton"));
    expect(page).not.toContain("style={{");
    expect(page).toMatch(/className="mb-btn mb-btn--primary mb-btn--block"/);
    expect(page).toContain("mobile-settings-content");
  });
});
