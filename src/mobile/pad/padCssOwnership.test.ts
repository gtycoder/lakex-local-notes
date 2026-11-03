import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 平板 CSS 归属（261103 A4）：`data-form-factor` 规则**只允许出现在 pad/pad.css**。
 *
 * 为什么：261102-261103 期间平板几何一半在 mobile.css、靠「pad.css 后加载」碰巧取胜；
 * import 顺序一换就回潮（评审 W3）。把规则搬到单一归属 + 这条静态断言之后，顺序不再是正确性前提。
 * 例外：pad.css 自己、以及源码注释里提到该属性的文字（只检查**规则选择器行**）。
 */
const MOBILE_SRC = join(__dirname, "..");

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...cssFiles(p));
    else if (p.endsWith(".css")) out.push(p);
  }
  return out;
}

describe("平板样式归属（data-form-factor 只许在 pad.css）", () => {
  it("其它移动端 CSS 不得出现 data-form-factor 规则选择器", () => {
    const offenders: string[] = [];
    for (const file of cssFiles(MOBILE_SRC)) {
      const rel = relative(MOBILE_SRC, file).replaceAll("\\", "/");
      if (rel === "pad/pad.css") continue;
      // 只认「规则头以 html[data-form-factor...] 开头」的行；注释/文档字符串不算。
      const hit = readFileSync(file, "utf8")
        .split("\n")
        .some((line) => /^html\[data-form-factor=/.test(line.trim()));
      if (hit) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("pad.css 的规则都是平板几何（存在且带 data-form-factor 前缀）", () => {
    const css = readFileSync(join(MOBILE_SRC, "pad/pad.css"), "utf8");
    expect(css).toMatch(/html\[data-form-factor="expanded"\]/);
    expect(css).toMatch(/html\[data-form-factor="medium"\]/);
  });
});
