import { describe, expect, it } from "vitest";
import { canTouchNetwork, cloudStateHint, cloudStateOf, isCloudActive } from "./cloudState";

/** 云同步状态 = 单一判据（用户 261006：关闭云同步 = 当作完全没配置 / 离线本地空间）。 */
describe("云同步状态（单一判据）", () => {
  it("没凭据 = unconfigured：不允许出网", () => {
    expect(cloudStateOf(false, { enabled: true, autoMode: "interval" })).toBe("unconfigured");
    expect(canTouchNetwork("unconfigured")).toBe(false);
    expect(cloudStateHint("unconfigured")).toContain("未配置");
  });

  it("配了但关了「启用云同步」= offline：等同没配置，一律不出网", () => {
    expect(cloudStateOf(true, { enabled: false, autoMode: "interval" })).toBe("offline");
    expect(cloudStateOf(true, { enabled: false, autoMode: "manual" })).toBe("offline");
    expect(canTouchNetwork("offline")).toBe(false);
    expect(cloudStateHint("offline")).toContain("已关闭");
  });

  it("开着 + 自动同步=manual = manual：允许按需出网（手动同步 / 恢复补拉）", () => {
    expect(cloudStateOf(true, { enabled: true, autoMode: "manual" })).toBe("manual");
    expect(canTouchNetwork("manual")).toBe(true);
    expect(cloudStateHint("manual")).toBeNull();
  });

  it("开着 + 自动同步 = auto", () => {
    expect(cloudStateOf(true, { enabled: true, autoMode: "interval" })).toBe("auto");
    expect(cloudStateOf(true, { enabled: true, autoMode: "onOpenClose" })).toBe("auto");
    expect(canTouchNetwork("auto")).toBe(true);
  });

  it("UI 的「是不是云端」：没配置或关了开关都是本地（顶栏图标据此在磁盘/云之间切）", () => {
    expect(isCloudActive(true, true)).toBe(true);     // 配了 + 开着 ⇒ 云
    expect(isCloudActive(true, false)).toBe(false);   // 关掉 ⇒ 磁盘
    expect(isCloudActive(false, true)).toBe(false);   // 没配置 ⇒ 磁盘
    expect(isCloudActive(false, false)).toBe(false);
  });

  it("缺设置行（老库/异常）按 offline 处理，绝不放行出网", () => {
    expect(cloudStateOf(true, null)).toBe("offline");
    expect(canTouchNetwork(cloudStateOf(true, null))).toBe(false);
  });
});
