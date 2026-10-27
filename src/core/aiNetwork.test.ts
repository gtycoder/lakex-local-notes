import { describe, expect, it } from "vitest";
import { aiCanTouchNetwork, aiNetworkHint } from "./aiNetwork";

describe("AI 出网判据（D1：与云同步解耦）", () => {
  it("开启 + 在线 ⇒ 可以出网", () => {
    expect(aiCanTouchNetwork({ aiEnabled: true, online: true })).toBe(true);
  });
  it("关闭开关 ⇒ 任何网络状态都不出网", () => {
    expect(aiCanTouchNetwork({ aiEnabled: false, online: true })).toBe(false);
    expect(aiCanTouchNetwork({ aiEnabled: false, online: false })).toBe(false);
  });
  it("开启但离线 ⇒ 不出网（开关值不被改写）", () => {
    const state = { aiEnabled: true, online: false };
    expect(aiCanTouchNetwork(state)).toBe(false);
    expect(state.aiEnabled).toBe(true);
  });
  it("文案按「关开关优先于离线」给", () => {
    expect(aiNetworkHint({ aiEnabled: false, online: false })).toContain("已关闭");
    expect(aiNetworkHint({ aiEnabled: true, online: false })).toContain("离线");
    expect(aiNetworkHint({ aiEnabled: true, online: true })).toBe("");
  });
});
