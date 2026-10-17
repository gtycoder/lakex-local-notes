import { describe, expect, it } from "vitest";
import { encodeS3ConfigTransfer, decodeS3ConfigTransfer, encodeS3ConfigTransferFile, decodeS3ConfigTransferFile, s3ConfigTransferFileName, maskAccessKeyId, summarizeS3Settings, S3_TRANSFER_PREFIX } from "./s3ConfigTransfer.js";
import type { S3Settings } from "./syncUtils.js";

const SETTINGS: S3Settings = {
  endpoint: "https://s3.cn-north-1.qiniucs.com",
  region: "cn-north-1",
  bucket: "local-lake-hebei",
  prefix: "lake-notes",
  accessKeyId: "AKIDEXAMPLE1234567890",
  secretAccessKey: "SECRET-EXAMPLE-do-not-log-0123456789",
  forcePathStyle: false,
};

describe("S3 配置迁移码", () => {
  it("导出→导入逐字段一致（含 path-style）", async () => {
    const code = await encodeS3ConfigTransfer({ ...SETTINGS, forcePathStyle: true });
    expect(code.startsWith(S3_TRANSFER_PREFIX)).toBe(true);
    const decoded = await decodeS3ConfigTransfer(code);
    expect(decoded).toEqual({ ...SETTINGS, forcePathStyle: true });
  });

  it("迁移码本体不含明文字段（防复制到聊天窗口时直接暴露）", async () => {
    const code = await encodeS3ConfigTransfer(SETTINGS);
    expect(code).not.toContain(SETTINGS.secretAccessKey);
    expect(code).not.toContain(SETTINGS.accessKeyId);
    expect(code).not.toContain("qiniucs");
    expect(code).not.toContain("local-lake-hebei");
  });

  it("容忍换行/空格（从聊天窗口复制过来常带空白）", async () => {
    const code = await encodeS3ConfigTransfer(SETTINGS);
    const messy = `  \n${code.slice(0, 120)}\n  ${code.slice(120)}  \n`;
    await expect(decodeS3ConfigTransfer(messy)).resolves.toEqual(SETTINGS);
  });

  it("改一个字符就失败（AES-GCM 认证）", async () => {
    const code = await encodeS3ConfigTransfer(SETTINGS);
    // 改中间字符（末尾可能是 base64 填充位，改了也不改变字节，不能用来证明认证）。
    const index = S3_TRANSFER_PREFIX.length + 10;
    const tampered = code.slice(0, index) + (code[index] === "A" ? "B" : "A") + code.slice(index + 1);
    expect(tampered).not.toBe(code);
    await expect(decodeS3ConfigTransfer(tampered)).rejects.toThrow(/无效或已损坏/);
  });

  it("贴错内容 / 明文 JSON / 空串都给明确原因", async () => {
    await expect(decodeS3ConfigTransfer("")).rejects.toThrow(/请先粘贴/);
    await expect(decodeS3ConfigTransfer("随便一段文字")).rejects.toThrow(/不是 Lake Notes 的 S3 迁移码/);
    await expect(decodeS3ConfigTransfer(JSON.stringify(SETTINGS))).rejects.toThrow(/不是 Lake Notes 的 S3 迁移码/);
    await expect(decodeS3ConfigTransfer(S3_TRANSFER_PREFIX + "AAAA")).rejects.toThrow(/无效或已损坏/);
  });

  it("过长的输入在解码前就拒绝", async () => {
    await expect(decodeS3ConfigTransfer(S3_TRANSFER_PREFIX + "A".repeat(9000))).rejects.toThrow(/过长/);
  });

  it("导出要求 Secret 可读、配置合法", async () => {
    await expect(encodeS3ConfigTransfer({ ...SETTINGS, secretAccessKey: "  " })).rejects.toThrow(/没有可读取的 Secret/);
    await expect(encodeS3ConfigTransfer({ ...SETTINGS, endpoint: "http://s3.example.com" })).rejects.toThrow(/不合法/);
    await expect(encodeS3ConfigTransfer({ ...SETTINGS, endpoint: "" })).rejects.toThrow(/不合法/);
  });

  it("导出时规范化 endpoint（去尾斜杠 / 补协议），导入结果已规范化", async () => {
    const code = await encodeS3ConfigTransfer({ ...SETTINGS, endpoint: " s3.cn-north-1.qiniucs.com/ " });
    const decoded = await decodeS3ConfigTransfer(code);
    expect(decoded.endpoint).toBe("https://s3.cn-north-1.qiniucs.com");
  });

  it("配置文件：JSON 包装一层元数据，内层仍是加密迁移码", async () => {
    const file = await encodeS3ConfigTransferFile(SETTINGS, new Date("2026-10-17T14:30:00Z"));
    const parsed = JSON.parse(file) as { app: string; kind: string; version: number; payload: string; exportedAt: string };
    expect(parsed).toMatchObject({ app: "lake-notes", kind: "s3-config", version: 1 });
    expect(parsed.exportedAt).toBe("2026-10-17T14:30:00.000Z");
    expect(parsed.payload.startsWith(S3_TRANSFER_PREFIX)).toBe(true);
    expect(file).not.toContain(SETTINGS.secretAccessKey);
    expect(file).not.toContain("qiniucs");
    await expect(decodeS3ConfigTransferFile(file)).resolves.toEqual(SETTINGS);
  });

  it("配置文件兼容直接放迁移码的 .txt；错误文件有明确原因", async () => {
    const code = await encodeS3ConfigTransfer(SETTINGS);
    await expect(decodeS3ConfigTransferFile(code)).resolves.toEqual(SETTINGS);
    await expect(decodeS3ConfigTransferFile("")).rejects.toThrow(/空/);
    await expect(decodeS3ConfigTransferFile("{}")).rejects.toThrow(/不是 Lake Notes 的 S3 配置文件/);
    await expect(decodeS3ConfigTransferFile(JSON.stringify({ app: "lake-notes", kind: "s3-config", version: 2, payload: "x" }))).rejects.toThrow(/版本不受支持/);
    const file = await encodeS3ConfigTransferFile(SETTINGS);
    const payloadIndex = file.indexOf(S3_TRANSFER_PREFIX);
    const tamperAt = payloadIndex + S3_TRANSFER_PREFIX.length + 10;
    const tamperedFile = file.slice(0, tamperAt) + (file[tamperAt] === "A" ? "B" : "A") + file.slice(tamperAt + 1);
    await expect(decodeS3ConfigTransferFile(tamperedFile)).rejects.toThrow(/无效或已损坏|不是 Lake Notes/);
  });

  it("导出文件名带本地时间戳且是 .json", () => {
    expect(s3ConfigTransferFileName(new Date(2026, 9, 17, 22, 31, 5))).toBe("lake-s3-config-20261017-223105.json");
  });

  it("AK 打码与摘要不含 Secret", () => {
    expect(maskAccessKeyId("AKIDEXAMPLE1234567890")).toBe("AKID…7890");
    expect(maskAccessKeyId("short")).toBe("********");
    const summary = summarizeS3Settings(SETTINGS);
    expect(summary).toMatchObject({ endpoint: SETTINGS.endpoint, bucket: SETTINGS.bucket, accessKeyMasked: "AKID…7890" });
    expect(JSON.stringify(summary)).not.toContain(SETTINGS.secretAccessKey);
  });
});
