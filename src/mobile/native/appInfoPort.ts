/**
 * 移动端 AppInfoPort（Phase B4，§6.4）：读 Capacitor App.getInfo() 原生版本/构建号。
 * Web 预览环境（无 Capacitor）回退到构建常量。
 */
import type { AppInfo, AppInfoPort } from "../../core/ports.js";
import { S3V3_POINTER_VERSION } from "../../core/s3v3/protocol/s3v3Types.js";

/** 同步协议版本 —— **单一来源** = S3 v3 pointer 版本号（桌面/移动共用的协议事实，
 * src/core/s3v3/protocol/s3v3Types.ts）。不要再写字面量：这里曾经硬编码 "4"（V1 重置前的老值），
 * 「关于」页因此显示成 manifest v4。manifest 时代已结束（CORE-05：v3 云端只有 pointer + 内容寻址索引）。 */
const PROTOCOL_VERSION = String(S3V3_POINTER_VERSION);

export const mobileAppInfoPort: AppInfoPort = {
  async getAppInfo(): Promise<AppInfo> {
    try {
      const { App } = await import("@capacitor/app");
      const info = await App.getInfo();
      return {
        name: info.name || "LakexLocalNotes",
        version: info.version || "0.0.0",
        build: info.build || "",
        protocolVersion: PROTOCOL_VERSION,
        platform: "android",
      };
    } catch {
      // Web 预览/测试环境：Capacitor 不可用，回退常量
      return {
        name: "LakexLocalNotes",
        version: "0.0.0-dev",
        build: "dev",
        protocolVersion: PROTOCOL_VERSION,
        platform: "web",
      };
    }
  },
};
