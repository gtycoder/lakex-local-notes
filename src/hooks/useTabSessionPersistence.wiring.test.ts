/**
 * Batch4-D 接线护栏（静态源码契约）：会话落盘的判据必须单一来源。
 *
 * 与 render 用例互补：那边验证行为（安全模式不改会话文件），这里锁「App 不再自己写会话」，
 * 防止以后有人在 App 里另加一次 writeTabSession 把判据绕开。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = readFileSync(path.join(process.cwd(), "src/App.tsx"), "utf8");

describe("App 会话落盘接线（Batch4-D）", () => {
  it("会话落盘走 useTabSessionPersistence，App 里不再直接 writeTabSession/clearTabSession", () => {
    expect(APP).toContain("useTabSessionPersistence({");
    expect(APP).toContain("safeModeStatus");
    expect(APP).not.toContain("writeTabSession(");
    expect(APP).not.toContain("clearTabSession(");
  });

  it("会话判据不散落：App 只用 useSafeModeStatus 取一次状态，不自己判断/自己写", () => {
    expect(APP.match(/useSafeModeStatus\(\)/g)?.length).toBe(1);
    // 判据实现只在 useSafeModeStatus.tabSessionWriteDecision 一处；App 不许内联复制。
    expect(APP).not.toContain("tabSessionWriteDecision");
    // 注：内核预取保留 Batch3-B 自己的「启动时一次」查询（另一件事，由 electron/safeModeWiring.test.ts 锁着）。
  });
});
