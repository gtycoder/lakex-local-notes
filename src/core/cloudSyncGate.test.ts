import { describe, expect, it } from "vitest";
import {
  CLOUD_SYNC_ENABLE_NEED_UNCONFIGURED,
  CLOUD_SYNC_ENABLE_NEED_VERIFIED,
  cloudSyncEnableGate,
  s3ConfigFingerprint,
} from "./cloudSyncGate";

describe("云同步开启闸门（261114 用户裁决）", () => {
  it("没配置 ⇒ 不能开启，提示先填写并测试", () => {
    const gate = cloudSyncEnableGate({ configured: false, verified: false });
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.message).toBe(CLOUD_SYNC_ENABLE_NEED_UNCONFIGURED);
  });

  it("已配置但没通过连接测试 ⇒ 不能开启，提示先测试连接", () => {
    const gate = cloudSyncEnableGate({ configured: true, verified: false });
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.message).toBe(CLOUD_SYNC_ENABLE_NEED_VERIFIED);
  });

  it("已配置且测试通过 ⇒ 允许开启", () => {
    expect(cloudSyncEnableGate({ configured: true, verified: true })).toEqual({ allowed: true });
  });

  it("指纹只看连接字段（trim；不含 Secret 明文）", () => {
    const a = s3ConfigFingerprint({ endpoint: " https://s3.example.com ", region: "cn", bucket: "b", prefix: "p", accessKeyId: "ak" });
    const b = s3ConfigFingerprint({ endpoint: "https://s3.example.com", region: "cn", bucket: "b", prefix: "p", accessKeyId: "ak" });
    expect(a).toBe(b);
    expect(s3ConfigFingerprint({ endpoint: "https://other.example.com", region: "cn", bucket: "b", prefix: "p", accessKeyId: "ak" })).not.toBe(a);
    expect(s3ConfigFingerprint({ endpoint: "", region: "", bucket: "", prefix: "", accessKeyId: "" })).toBe("\u0000\u0000\u0000\u0000");
  });
});
