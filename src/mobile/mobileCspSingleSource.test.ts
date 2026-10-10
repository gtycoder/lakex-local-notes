/**
 * 移动端 CSP 单一来源护栏。
 *
 * 背景（261010 收口）：mobile.html 曾硬编码一份 CSP，vite.mobile.config.ts 又持有一份并在构建期整条重写，
 * 两份**内容并不一致**（手写那份的 img-src/media-src 缺 http://127.0.0.1:*、connect-src 缺 data: blob:）
 * ⇒ 源码里那份是坏的，只有构建补丁能救它。现在：唯一来源 = vite.mobile.config.ts 的 MOBILE_CSP，
 * mobile.html 只留占位符。本测试卡住"不许再抄一份"。
 */
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HTML = readFileSync(path.join(process.cwd(), "mobile.html"), "utf8");
const VITE = readFileSync(path.join(process.cwd(), "vite.mobile.config.ts"), "utf8");

describe("移动端 CSP 单一来源", () => {
  it("mobile.html 只留占位符，不得手写策略", () => {
    expect(HTML).toContain("content=\"%MOBILE_CSP%\"");
    expect(HTML).not.toContain("default-src");
    expect(HTML).not.toContain("connect-src");
  });

  it("构建配置里定义了唯一来源 MOBILE_CSP", () => {
    expect(VITE).toMatch(/const MOBILE_CSP\s*=/);
  });

  it("script-src 的 sha256 hash 必须等于 mobile.html 内联脚本的 hash（漂移=白屏）", () => {
    const cspHash = /sha256-[A-Za-z0-9+/=]+/.exec(VITE)?.[0];
    expect(cspHash, "vite.mobile.config.ts 的 CSP 里没有 sha256 hash").toBeTruthy();
    // mobile.html 里的内联脚本（非 module src 的那一个）：KITCHEN_URL 必须在页面脚本之前生效，
    // 所以只能留在 HTML 内联 → 用 hash 放行（不能挪进 main.tsx：ESM import 会被提升到赋值之前）。
    const inline = /<script>([\s\S]*?)<\/script>/.exec(HTML)?.[1];
    expect(inline, "mobile.html 里找不到内联脚本").toBeTruthy();
    const computed = "sha256-" + crypto.createHash("sha256").update(inline as string, "utf8").digest("base64");
    expect(cspHash, "内联脚本改了但 CSP hash 没跟着改（页面脚本会被拦、白屏）").toBe(computed);
  });

  it("script-src 不再放行 unsafe-inline / unsafe-eval（261010 收紧）", () => {
    // 只取 MOBILE_CSP 常量本体（整文件正则会先命中头注释里的历史措辞）
    const cspBlock = VITE.slice(VITE.indexOf("const MOBILE_CSP"));
    const scriptSrc = /script-src([^;]*)/.exec(cspBlock)?.[1] ?? "";
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
    // 前提：产物里没有动态求值（收紧前实测全 chunk 命中 0）；若有新依赖引入 eval，本断言之外的产物扫描会先暴露
    expect(scriptSrc).toContain("sha256-");
  });

  it("唯一来源包含本机资源服务与 S3 的必要放行（历史漂移点）", () => {
    // img-src / media-src 必须放行本机 AssetServer（canonical URL 的真实来源）
    expect(VITE).toMatch(/img-src[^;]*http:\/\/127\.0\.0\.1:\*/);
    expect(VITE).toMatch(/media-src[^;]*http:\/\/127\.0\.0\.1:\*/);
    // connect-src 必须放行 data:/blob:（引擎导出/预览路径 fetch 成 blob）与本机资源端口
    expect(VITE).toMatch(/connect-src[^;]*data: blob:/);
    expect(VITE).toMatch(/connect-src[^;]*http:\/\/127\.0\.0\.1:\*/);
    // 七牛 S3（同步）
    expect(VITE).toMatch(/s3\.cn-north-1\.qiniucs\.com/);
  });
});
