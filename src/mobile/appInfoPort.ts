/**
 * 移动端 AppInfoPort（Phase B4，§6.4）：读 Capacitor App.getInfo() 原生版本/构建号。
 * Web 预览环境（无 Capacitor）回退到构建常量。
 */
import type { AppInfo, AppInfoPort } from "../core/ports.js";

/** manifest 协议版本（与 src/core/syncEngine 的协议版本一致）。 */
const PROTOCOL_VERSION = "4";

export const mobileAppInfoPort: AppInfoPort = {
  async getAppInfo(): Promise<AppInfo> {
    try {
      const { App } = await import("@capacitor/app");
      const info = await App.getInfo();
      return {
        name: info.name || "Lake Notes",
        version: info.version || "0.0.0",
        build: info.build || "",
        protocolVersion: PROTOCOL_VERSION,
        platform: "android",
      };
    } catch {
      // Web 预览/测试环境：Capacitor 不可用，回退常量
      return {
        name: "Lake Notes",
        version: "0.0.0-dev",
        build: "dev",
        protocolVersion: PROTOCOL_VERSION,
        platform: "web",
      };
    }
  },
};
