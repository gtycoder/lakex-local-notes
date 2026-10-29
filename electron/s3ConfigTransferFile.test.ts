import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { encodeS3ConfigTransfer } from "../src/core/s3ConfigTransfer.js";
import { readS3ConfigFile, writeS3ConfigFile } from "./s3ConfigTransferFile.js";
import type { S3Settings } from "../src/core/syncUtils.js";

const SETTINGS: S3Settings = {
  endpoint: "https://s3.cn-north-1.qiniucs.com",
  region: "cn-north-1",
  bucket: "local-lake-hebei",
  prefix: "lakex-local-notes",
  accessKeyId: "AKIDEXAMPLE1234567890",
  secretAccessKey: "SECRET-EXAMPLE-0123456789",
  forcePathStyle: true,
};
const dirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-s3-config-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("S3 配置文件（主进程）", () => {
  it("写入→读取逐字段一致，文件里没有明文密钥/endpoint", async () => {
    const file = path.join(tempDir(), "s3.json");
    await writeS3ConfigFile(file, SETTINGS, new Date("2026-10-17T14:30:00Z"));
    const text = fs.readFileSync(file, "utf8");
    expect(text).not.toContain(SETTINGS.secretAccessKey);
    expect(text).not.toContain(SETTINGS.accessKeyId);
    expect(text).not.toContain("qiniucs");
    await expect(readS3ConfigFile(file)).resolves.toEqual(SETTINGS);
  });

  it("兼容直接放迁移码的 .txt", async () => {
    const file = path.join(tempDir(), "s3.txt");
    fs.writeFileSync(file, await encodeS3ConfigTransfer(SETTINGS), "utf8");
    await expect(readS3ConfigFile(file)).resolves.toEqual(SETTINGS);
  });

  it("超过 64KB 就拒绝（防选错大文件）", async () => {
    const file = path.join(tempDir(), "big.json");
    fs.writeFileSync(file, "x".repeat(65 * 1024), "utf8");
    await expect(readS3ConfigFile(file)).rejects.toThrow(/过大/);
  });
});
