/**
 * 内核预热护栏（261010）。
 *
 * 预热的价值与边界都写在 `kernelPrewarm.ts` 头注释里，本测试只盯"它别退化"：
 *  1. **必须空闲触发**（requestIdleCallback / setTimeout 兜底），不能挡启动首屏；
 *  2. **必须销毁**（走 `destroyLakeEditor` —— 只调 `editor.destroy()` 不够，它不清 `__disposeExtras`）；
 *  3. **只点燃、不保留实例**（返回值只能是 "ok"/"failed"，实例不得外泄 ⇒ 不演变成实例池/移交）；
 *  4. 失败必须吞掉（优化不得影响功能）；
 *  5. 只在 `phase === "ready"` 之后排期。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const PREWARM = read("./kernelPrewarm.ts");
const APP = read("../MobileApp.tsx");

describe("内核预热（只点燃、不保留实例）", () => {
  it("空闲触发，不挡启动首屏", () => {
    expect(PREWARM).toMatch(/requestIdleCallback/);
    expect(PREWARM).toMatch(/setTimeout/);
    expect(PREWARM).toMatch(/scheduled/); // 会话内只排一次
  });

  it("顺带预取 capture 的懒加载分包（打开时不再现拉 composer/style/字体）", () => {
    expect(PREWARM).toMatch(/import\("\.\.\/home\/QuickNoteComposer"\)/);
  });

  it("必须走 destroyLakeEditor 释放（只 editor.destroy() 不够）", () => {
    expect(PREWARM).toMatch(/destroyLakeEditor\(editor\)/);
  });

  it("不保留实例：返回值只有 ok/failed，实例不外泄（防退化成实例池/移交）", () => {
    expect(PREWARM).toMatch(/Promise<"ok" \| "failed">/);
    expect(PREWARM).not.toMatch(/let\s+\w*(editor|instance)\w*\s*:/i);
  });

  it("失败吞掉（预热不得影响功能）", () => {
    expect(PREWARM).toMatch(/catch \{/);
    expect(PREWARM).toMatch(/finally \{/);
  });

  it("只在启动就绪后排期", () => {
    expect(APP).toMatch(/if \(phase === "ready"\) scheduleKernelPrewarm\(\)/);
  });
});
