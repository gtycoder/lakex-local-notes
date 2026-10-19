import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 261019：小记写作/编辑中按 Android 返回键，必须**先退出编辑**（与「取消」同语义），
 * 不能一路落到「首页交给系统」而直接退出 App。
 * 实现 = 写作卡打开时往统一返回栈 push 一个处理器（浮层打开时它们在上层，仍先消费）。
 */
const HOME = readFileSync(new URL("./HomePage.tsx", import.meta.url), "utf8");

describe("小记编辑中返回键（261019）", () => {
  it("写作卡打开时注册返回栈处理器，消费返回并退出编辑", () => {
    expect(HOME).toMatch(/import \{ pushBackHandler \} from "\.\.\/ui\/backStack"/);
    expect(HOME).toMatch(/if \(composer === null\) return;\s*\n\s*return pushBackHandler\(\(\) => \{ closeComposer\(\); return true; \}\);/);
  });
});
