/**
 * 移动端 S3 端口的**源码级护栏**（P1 漂移修复，261016）。
 *
 * 背景：两端 S3 传输层对拍（docs/SYNC-PROTOCOL.md §7）查出移动端内部不自洽——
 * 「测连通」与「全部同步」各建一套 client 且设置不同。这些护栏把修复钉住：
 *   · D6：`new S3Client` 在 src/mobile 下只能有**一处**（共用工厂），checksum 绕行同理；
 *   · D1：端口方法必须调用 core 的 `assertSafeKey`（桌面一直有，移动端原先没有）；
 *   · D4：404 判定必须用 core 的 `isNoSuchKey`（不能只认状态码 / 只认 NoSuchKey）。
 * D-7（261028）后 v2 `S3Store` 适配器（createCapacitorS3Store）已删，端口护栏改钉 **v3 远端**
 * （src/mobile/v3/s3v3Remote.ts）：它是当前唯一在跑的移动端 S3 端口实现。
 *
 * 为什么用源码级而不是行为级：这两个端口在实现内部动态 import @aws-sdk 并 new client，
 * 没有可注入点（为测试而拆注入点属过度设计）。源码级护栏只保证"接线在、且没有走回头路"，
 * 判据本身（assertSafeKey / isNoSuchKey）已在 core 的单测里覆盖。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 本测试 261016 随 s3Store 一起移入 mobile/native/ ⇒ 基准要再上一层才是 src
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

function mobileSources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  (function walk(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if ((e.name.endsWith(".ts") || e.name.endsWith(".tsx")) && !e.name.endsWith(".test.ts")) {
        out.push([path.relative(SRC, full).split(path.sep).join("/"), readFileSync(full, "utf8")]);
      }
    }
  })(path.join(SRC, "mobile"));
  return out;
}

describe("移动端 S3 端口护栏（P1 漂移修复）", () => {
  it("D6：new S3Client 只能有一处（共用工厂），两处调用点都走它", () => {
    const sources = mobileSources();
    const all = sources.map(([, t]) => t).join("\n");
    expect(count(all, /new S3Client\(/g), "src/mobile 下只能有一个 S3 client 构造点（src/mobile/native/s3Store.ts 的工厂）").toBe(1);
    const bridge = read("mobile/bridge.ts");
    const context = read("mobile/bridge/context.ts");
    expect(/new S3Client\(/.test(bridge), "bridge.ts 不得再自建 client").toBe(false);
    expect(/createMobileS3Client\(/.test(context), "bridge/context.ts 必须调用共用工厂（C3-5 第①步后客户端工厂在这里）").toBe(true);
    expect(/createS3Client\(/.test(read("mobile/bridge/sync.ts")), "sync 域的 S3 客户端只能经 context 的 createS3Client").toBe(true);
    expect(/createS3Client\(/.test(bridge), "bridge 组合层不再直接建 client").toBe(false);
    expect(/createMobileS3Client\(/.test(read("mobile/native/s3Store.ts")), "s3Store.ts 必须调用共用工厂").toBe(true);
  });

  it("D5：移动端 gzip PUT 必须带 Content-Encoding（与桌面一致）", () => {
    const mobile = read("mobile/v3/s3v3Remote.ts");
    const desktop = readFileSync(path.join(SRC, "..", "electron/s3Store.ts"), "utf8");
    expect(mobile, "移动端 gzip 分支必须设置 ContentEncoding").toMatch(/ContentEncoding:\s*"gzip"/);
    expect(mobile, "移动端 gzip 正文必须按二进制发送").toMatch(/ContentType:\s*"application\/octet-stream"/);
    expect(mobile, "移动端二进制 gzip 不得声明 application/json（CapacitorHttp 会改走文本正文）").not.toMatch(/ContentType:\s*"application\/json"/);
    expect(desktop, "桌面端仍必须设置 Content-Encoding").toMatch(/command\.ContentEncoding\s*=\s*"gzip"/);
  });

  it("D3/D7：移动端复用 endpoint 规范化/校验，region 与桌面同缺省", () => {
    const sync = read("mobile/bridge/sync.ts");
    expect(sync, "保存前必须 normalizeEndpoint").toMatch(/normalizeEndpoint\(/);
    expect(sync, "保存前必须 validateS3Settings（强制 https）").toMatch(/validateS3Settings\(/);
    const store = read("mobile/native/s3Store.ts");
    expect(store, "client 工厂必须 normalizeEndpoint").toMatch(/normalizeEndpoint\(opts\.endpoint\)/);
    expect(store, "client 工厂 region 缺省必须 cn-east-1").toMatch(/opts\.region\?\.trim\(\)\s*\|\|\s*"cn-east-1"/);
  });

  it("D1：端口方法必须过 core 的 assertSafeKey（对齐桌面 ObjectStore）", () => {
    const remote = read("mobile/v3/s3v3Remote.ts");
    expect(/import \{[^}]*assertSafeKey[^}]*\} from "\.\.\/\.\.\/core\/syncUtils\.js"/.test(remote), "必须从 core 引 assertSafeKey（单一来源，别在移动端另写一份）").toBe(true);
    // 校验点 = get / put / deleteMany（list 接收前缀、deleteByPrefix 走 list，不是单键）
    expect(count(remote, /assertSafeKey\(/g), "单键端口方法都要校验：少于 3 个说明有漏").toBeGreaterThanOrEqual(3);
  });

  it("Android 原生流式传输挂在 v3 remote 上（putFromFile / getToFile）", () => {
    const remote = read("mobile/v3/s3v3Remote.ts");
    expect(remote).toMatch(/remote\.putFromFile = async/);
    expect(remote).toMatch(/NativeAssetSync\.putFile\(/);
    expect(remote).toMatch(/remote\.getToFile = async/);
  });

  it("D4：404 判定必须用 core 的 isNoSuchKey（别在移动端另写一套）", () => {
    const remote = read("mobile/v3/s3v3Remote.ts");
    expect(/import \{[^}]*isNoSuchKey[^}]*\} from "\.\.\/\.\.\/core\/syncUtils\.js"/.test(remote), "必须从 core 引 isNoSuchKey").toBe(true);
    expect(/isNoSuchKey\(/.test(remote), "必须调用它").toBe(true);
    // 桌面判据还认 NotFound（七牛/AWS 实测会返回）⇒ 自己拼 404 判定会漏
    expect(/httpStatusCode\s*===\s*404/.test(remote), "不得再自己拼 404 判定（见 SYNC-PROTOCOL §7.3 D4）").toBe(false);
  });

  it("D6：七牛 checksum 绕行只允许出现在共用工厂里（一次）", () => {
    const all = mobileSources().map(([, t]) => t).join("\n");
    // 只数**带冒号的声明**（注释里提到这个选项名不算）——本仓踩过"注释被当代码"的坑（AGENTS §7.25）
    expect(count(all, /responseChecksumValidation\s*:/g), "绕行是工厂的职责，调用点不得各自再设").toBe(1);
  });
});
