import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 261019：冷启动后很快点「编辑小记 / 新建小记」会先闪一下"正在加载编辑器…"。
 * 根因 = QuickNoteComposer 是懒加载分包，首屏期间没预取；修复 = ① 就绪后空闲预取分包（只 import、不实例化内核）；
 * ② 兜底从文字页改为写作卡骨架（即使真的没赶上，也只是骨架而不是"加载页"）。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const PREWARM = read("./kernelPrewarm.ts");
const APP = read("../MobileApp.tsx");
const HOME = read("../home/HomePage.tsx");
const CSS = read("../mobile.css");

describe("小记编辑器分包预取（261019）", () => {
  it("预取只 import 分包、且与会话内只排一次", () => {
    expect(PREWARM).toContain("export function scheduleComposerPrewarm");
    const LAZY = read("../home/quickNoteComposerLazy.tsx");
    expect(PREWARM).toMatch(/loadQuickNoteComposer\(\)/);
    expect(LAZY).toMatch(/import\("\.\/QuickNoteComposer"\)/);
    expect(PREWARM).toContain("composerScheduled");
  });

  it("就绪即排预取（与内核预热的 4s 排期分开）", () => {
    expect(APP).toContain("scheduleComposerPrewarm()");
    expect(APP).toMatch(/scheduleKernelPrewarm\(\);\s*\n\s*\/\/[^\n]*\n\s*scheduleComposerPrewarm\(\);/);
  });

  it("写作卡走自研加载壳（无 Suspense），兜底是骨架而非「正在加载编辑器」文字页", () => {
    expect(HOME).toContain("QuickNoteComposerLazy");
    expect(APP).toContain("QuickNoteComposerLazy");
    expect(HOME).not.toContain("QuickNoteComposer = lazy");
    expect(HOME).not.toContain("正在加载编辑器…");
    const LAZY = read("../home/quickNoteComposerLazy.tsx");
    const SKELETON = read("../home/QuickNoteComposerSkeleton.tsx");
    expect(LAZY).toContain("QuickNoteComposerSkeleton");
    expect(SKELETON).toContain("mb-composer-skeleton");
    expect(CSS).toMatch(/\.mb-composer-skeleton\s*\{[^}]*display:\s*flex/);
  });
});
