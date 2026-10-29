import { describe, expect, it } from "vitest";
import { effectiveS3Settings, isQiniuEndpoint, s3ConfigFingerprint } from "./s3FormState.js";

const base = { endpoint: "https://s3.cn-north-1.qiniucs.com", region: "cn-north-1", bucket: "b", prefix: "p", accessKeyId: "ak", secretAccessKey: "sk", forcePathStyle: false };

describe("s3FormState：连接测试指纹", () => {
  it("同配置指纹稳定（保存后重新读回不变）", () => {
    expect(s3ConfigFingerprint(base)).toBe(s3ConfigFingerprint({ ...base }));
  });

  it("改任一连接字段指纹就变（必须重新测试）", () => {
    const fp = s3ConfigFingerprint(base);
    expect(s3ConfigFingerprint({ ...base, endpoint: "https://x" })).not.toBe(fp);
    expect(s3ConfigFingerprint({ ...base, bucket: "b2" })).not.toBe(fp);
    expect(s3ConfigFingerprint({ ...base, prefix: "p2" })).not.toBe(fp);
    expect(s3ConfigFingerprint({ ...base, accessKeyId: "ak2" })).not.toBe(fp);
    expect(s3ConfigFingerprint({ ...base, region: "r2" })).not.toBe(fp);
  });

  it("Secret 不进指纹（主进程回 masked 时不抖动）", () => {
    // 指纹只吃连接字段：Secret 被主进程回填成 masked 时不能把「测试通过」判失效。
    const masked = { ...base, secretAccessKey: "********" };
    expect(s3ConfigFingerprint(masked)).toBe(s3ConfigFingerprint(base));
  });

  it("首尾空白不算改动（保存前后 trim 一致）", () => {
    expect(s3ConfigFingerprint({ ...base, bucket: "  b  " })).toBe(s3ConfigFingerprint(base));
  });
});

describe("s3FormState：七牛 Path-style", () => {
  it("识别七牛域名（含自定义 endpoint 写法）", () => {
    expect(isQiniuEndpoint("https://s3.cn-north-1.qiniucs.com")).toBe(true);
    expect(isQiniuEndpoint("https://s3-cn-east-1.qiniucs.com")).toBe(true);
    expect(isQiniuEndpoint("https://s3.amazonaws.com")).toBe(false);
    expect(isQiniuEndpoint("http://127.0.0.1:9000")).toBe(false);
    expect(isQiniuEndpoint(undefined)).toBe(false);
  });

  it("七牛时强制关闭 Path-style；非七牛保留用户选择", () => {
    expect(effectiveS3Settings({ ...base, forcePathStyle: true }).forcePathStyle).toBe(false);
    const minio = { ...base, endpoint: "http://127.0.0.1:9000", forcePathStyle: true };
    expect(effectiveS3Settings(minio).forcePathStyle).toBe(true);
  });
});
