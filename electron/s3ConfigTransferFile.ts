/**
 * S3 配置文件的落盘 / 读取（主进程侧）。
 *
 * 文件格式与加解密在 src/core/s3ConfigTransfer.ts（两端单一来源）；这里只负责：
 * - 写出时把明文密钥封成迁移码（渲染层/文件里都不出现明文）；
 * - 读入时限制文件大小（防选错大文件）、utf8 读取、交给 core 解码校验。
 *
 * 与思源一致：导出文件可跨设备传输；区别是我们不额外打 zip，直接一个可读的 .json。
 */
import fs from "node:fs";
import { decodeS3ConfigTransferFile, encodeS3ConfigTransferFile } from "../src/core/s3ConfigTransfer.js";
import type { S3Settings } from "../src/core/syncUtils.js";

const MAX_CONFIG_FILE_BYTES = 64 * 1024;

/** 写出 .json 配置文件（权限 0600：只有本用户可读）。 */
export async function writeS3ConfigFile(filePath: string, settings: S3Settings, now: Date = new Date()): Promise<void> {
  const text = await encodeS3ConfigTransferFile(settings, now);
  fs.writeFileSync(filePath, text, { encoding: "utf8", mode: 0o600 });
}

/** 读取 .json 配置文件（也兼容直接放迁移码的 .txt）。 */
export async function readS3ConfigFile(filePath: string): Promise<S3Settings> {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("选择的不是文件");
  if (stat.size > MAX_CONFIG_FILE_BYTES) throw new Error("配置文件过大，不像是 S3 配置文件");
  const text = fs.readFileSync(filePath, "utf8");
  return decodeS3ConfigTransferFile(text);
}
