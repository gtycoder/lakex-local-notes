/**
 * 更新中心版本标签（261118：appInfo 取数竞态下曾显示「已是最新版本（0.0.0）」假版本号）。
 * 判据：appInfo 未就绪 ⇒ 如实说「已是最新版本」不带括号；就绪后带真实版本。
 */
import { describe, expect, it } from "vitest";
import { statusText } from "./UpdateCenterSection";

describe("更新中心版本标签不打假版本号", () => {
  it("appInfo 未就绪 ⇒ 无占位版本；就绪 ⇒ 真实版本", () => {
    const snapshot = { status: "up-to-date", manifest: null, progress: null, downloadedVersion: null } as never;
    const settings = { ignoredVersion: null } as never;
    expect(statusText(snapshot, settings, "")).toBe("已是最新版本");
    expect(statusText(snapshot, settings, "1.4.0")).toBe("已是最新版本（1.4.0）");
    expect(statusText(snapshot, settings, "")).not.toContain("0.0.0");
  });
});
