/**
 * 「关于」页的协议版本必须来自唯一来源（261012：用户发现页面显示 manifest v4，实际应为 V1）。
 * 这条护栏钉死：mobileAppInfoPort 报出的 protocolVersion === core 的 MANIFEST_VERSION（字符串化）。
 * 任何"再写一个字面量"的做法都会在这里失败。
 */
import { describe, expect, it } from "vitest";
import { MANIFEST_VERSION } from "../../core/syncUtils.js";
import { mobileAppInfoPort } from "./appInfoPort";

describe("移动端 AppInfo 的协议版本", () => {
  it("protocolVersion 来自 core 的 MANIFEST_VERSION（当前 = 2（新增 kind=ink），不是历史值 4）", async () => {
    const info = await mobileAppInfoPort.getAppInfo();
    expect(info.protocolVersion).toBe(String(MANIFEST_VERSION));
    expect(MANIFEST_VERSION).toBe(2);
  });
});
