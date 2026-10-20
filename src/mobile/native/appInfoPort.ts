/**
 * 移动端 AppInfoPort（Phase B4，§6.4）：读 Capacitor App.getInfo() 原生版本/构建号。
 * Web 预览环境（无 Capacitor）回退到构建常量。
 */
import type { AppInfo, AppInfoPort } from "../../core/ports.js";
import { MANIFEST_VERSION } from "../../core/syncUtils.js";

/** 同步协议版本 —— **单一来源** = core 的 MANIFEST_VERSION（V2 新增 kind=ink；V1 仅用于读取旧清单升级）。
 * 不要再写字面量：这里曾经硬编码 "4"（V1 重置前的老值），「关于」页因此显示成 manifest v4。 */
const PROTOCOL_VERSION = String(MANIFEST_VERSION);

export const mobileAppInfoPort: AppInfoPort = {
  async getAppInfo(): Promise<AppInfo> {
    try {
      const { App } = await import("@capacitor/app");
      const info = await App.getInfo();
      return {
        name: info.name || "LocalLakeNotes",
        version: info.version || "0.0.0",
        build: info.build || "",
        protocolVersion: PROTOCOL_VERSION,
        platform: "android",
      };
    } catch {
      // Web 预览/测试环境：Capacitor 不可用，回退常量
      return {
        name: "LocalLakeNotes",
        version: "0.0.0-dev",
        build: "dev",
        protocolVersion: PROTOCOL_VERSION,
        platform: "web",
      };
    }
  },
};
