/**
 * 仓库级构建护栏：lakex 资源本地化必须**只有一份实现**。
 *
 * 为什么：此前桌面 `vite.config.ts` 与移动 `vite.mobile.config.ts` 各有一份复制品
 * （移动那份自注释写着「POC 复制，正式迁移时抽共享模块」）⇒ 升级内核要改两处，且移动端少了
 * 桌面的 CSS `@import` 内联兜底。261010 收成 `scripts/lakexLocalize.ts`。
 *
 * 放在 electron/ 只是因为 vitest 的 include 覆盖 `src/**` 与 `electron/**`；本测试与主进程无关。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string): string => readFileSync(path.join(process.cwd(), p), "utf8");
const SHARED = read("scripts/lakexLocalize.ts");
const DESKTOP = read("vite.config.ts");
const MOBILE = read("vite.mobile.config.ts");

describe("lakex 资源本地化单一来源", () => {
  it("两端构建配置都从 scripts/lakexLocalize.ts 取实现", () => {
    for (const [name, src] of [["vite.config.ts", DESKTOP], ["vite.mobile.config.ts", MOBILE]] as const) {
      expect(src, name + " 未引用共用模块").toContain("scripts/lakexLocalize");
      expect(src, name + " 又抄了一份镜像表").not.toContain("const ALIPAY_JS_REUSE");
      expect(src, name + " 又抄了一份镜像表").not.toContain("const MIRROR_EXACT");
    }
  });

  it("两端都挂了 CSS @import 内联兜底（移动端此前缺这道）", () => {
    expect(DESKTOP).toContain("lakexGwUrlLocalPostcss()");
    expect(MOBILE).toContain("lakexGwUrlLocalPostcss()");
  });

  it("共用模块导出镜像表与两个入口", () => {
    expect(SHARED).toContain("export const ALIPAY_JS_REUSE");
    expect(SHARED).toContain("export const MIRROR_EXACT");
    expect(SHARED).toContain("export function lakexGwUrlLocalPostcss");
    expect(SHARED).toContain("export function lakexAlipayLocal");
  });

  it("移动端仍保留自己的构建收尾（index.html + 预览页）", () => {
    expect(MOBILE).toContain("mobileBundleFinalize");
    expect(MOBILE).toContain("dist-mobile/index.html");
  });
});
