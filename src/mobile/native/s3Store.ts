/**
 * 移动端 S3 **client 共用工厂**（D6，261016）：传输层 CapacitorHttpHandler 走原生 OkHttp。
 *
 * 历史（D-7，261028）：本文件原有 `createCapacitorS3Store`（v2 `S3Store` 适配器）**全仓零调用**——
 * v3 的远端端口是 `src/mobile/v3/s3v3Remote.ts`（core/s3v3Ports 的 `S3v3Remote`）。
 * 随 v2 端口类型（S3Store/SyncConfig/SyncDbPort/SyncReport）一起删除；本文件只剩工厂。
 */
import { normalizeEndpoint } from "../../core/syncUtils.js";
import { CapacitorHttpHandler } from "./capacitorHttpHandler";

/** 移动端唯一的 S3 client 工厂（D6，261016）。
 *
 * 背景：原先「测连通」（bridge.createS3Client）与「全部同步」（本文件）各建一套 client，
 * 且**设置不同**——测连通那份没有 responseChecksumValidation 绕行 ⇒ 会出现
 * 「测连通报 Checksum mismatch，真同步却正常」这类难查的不一致（见 SYNC-PROTOCOL §7.3 D6）。
 * 现在两处共用本工厂：传输层分层（Capacitor 原生 HTTP）、checksum 绕行、凭证形态只有一处。
 * ⚠️ D2（261017 定稿）：移动端**只支持虚拟托管风格（forcePathStyle=false）**——
 * 阿里云 OSS / 腾讯云 COS（2024+ 新桶）/ AWS / 七牛均要求或推荐虚拟托管；自建 MinIO/路径风格不在移动端支持范围。
 * 桌面端仍保留开关（不受此约束）。若未来要做，必须 D2（设置页暴露风格）与 D3（允许 http 内网端点）一起。 */
export interface MobileS3ClientOptions {
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export async function createMobileS3Client(opts: MobileS3ClientOptions): Promise<import("@aws-sdk/client-s3").S3Client> {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    // D7（261017）：与桌面一致，region 缺省用 cn-east-1（空串在 SDK 里行为不稳定）。
    region: opts.region?.trim() || "cn-east-1",
    // D3（261017）：与桌面同一份 normalizeEndpoint（补 https / 去尾斜杠 / 修重复协议）。
    endpoint: normalizeEndpoint(opts.endpoint),
    forcePathStyle: opts.forcePathStyle,
    credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    // 七牛 Kodo：GET 请求默认发 x-amz-checksum-mode 但七牛仅返回 content-md5，导致 SDK 校验 mismatch；
    // 禁用响应严格校验（不触发 SDK 对 body 的 content-md5 比对），避免 "Checksum mismatch"。
    // 这是**两端共用工厂的真正价值**：以前只有同步路径有这行，测连通路径没有。
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: new CapacitorHttpHandler(),
  });
}
