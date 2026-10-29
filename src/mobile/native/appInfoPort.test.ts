/**
 * 「关于」页的协议版本必须来自唯一来源（261012：用户发现页面显示 manifest v4）。
 * 261028 CORE-05：协议事实从 manifest 版本改为 S3 v3 pointer 版本 —— 这条护栏钉死
 * mobileAppInfoPort 报出的 protocolVersion === core 的 S3V3_POINTER_VERSION（字符串化）。
 * 任何"再写一个字面量"的做法都会在这里失败。
 */
import { describe, expect, it } from "vitest";
import { S3V3_POINTER_VERSION } from "../../core/s3v3/protocol/s3v3Types.js";
import { mobileAppInfoPort } from "./appInfoPort";

describe("移动端 AppInfo 的协议版本", () => {
  it("protocolVersion 来自 core 的 S3V3_POINTER_VERSION（当前 = 3，不是历史 manifest 值）", async () => {
    const info = await mobileAppInfoPort.getAppInfo();
    expect(info.protocolVersion).toBe(String(S3V3_POINTER_VERSION));
    expect(S3V3_POINTER_VERSION).toBe(3);
  });
});
