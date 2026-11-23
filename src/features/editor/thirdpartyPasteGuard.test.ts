/**
 * 261123 专案（正式包现场）：第三方文档 21K 粘贴「打崩渲染进程」调查的护栏。
 *
 * 实证结论（详见交付简报）：渲染进程**并未**崩溃/挂死 —— 五项日志实证（无 render-process-gone /
 * 无 unresponsive / 无未捕获异常与 Promise 拒绝 / Crashpad 无 dump / 正文结构完整收尾）；
 * 事故同规模的四种第三方形状（内核原生 / Word mso / 转义卡片 / ne-clipboard）实测
 * 61–75ms 完整落盘。用户现场看到的「坏」= 侧栏「已收起」分区类名撞车的布局塌陷
 * （已修，防回退护栏见 styles/geometrySources.test.ts）。
 *
 * 本护栏把粘贴管线在**事故样本**上的正确性钉死：
 *  - upgradePastedHtml / normalizeYuqueClipboardCards 对样本零异常；
 *  - 输出长度不得塌缩（内容不被吞）；
 *  - 21K 规模（事故量级）耗时 < 500ms —— 灾难性正则回溯（AGENTS §7#21 教训）会直接爆表；
 *  - 样本里的卡片载荷（codeblock value）与转义卡片文本原样保留。
 *
 * 样本 = 正式现场正文的**脱敏**副本（IP/凭据/邮箱/域名已替换为文档示例值，绝不入库真实数据），
 * 位置 src/features/editor/fixtures/thirdparty-paste-sample.html。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeYuqueClipboardCards, upgradePastedHtml } from "./clipboardHtml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(path.join(HERE, "fixtures", "thirdparty-paste-sample.html"), "utf8");

/** 事故量级：21,315 字符（正式包日志 paste.html chars=21315）。 */
const scaled21k = (() => {
  let s = fixture;
  while (s.length < 21315) s += "\n" + fixture;
  return s.slice(0, 21315);
})();

describe("第三方粘贴护栏（261123 事故样本，脱敏）", () => {
  it("样本基线：来自正式现场且已脱敏", () => {
    expect(fixture.length).toBeGreaterThan(5000);
    expect(fixture).not.toMatch(/107\.182|fmnSKH|Xssleu|zhipin|bandwagon|qq\.com|kanzhun|boss-mail/);
  });

  it("upgradePastedHtml：零异常、内容不吞、卡片载荷保留", () => {
    const out = upgradePastedHtml(fixture);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(fixture.length * 0.9);
    expect(out).toContain('name="codeblock"');
    expect(out).toContain("value=\"data:%7B");
  });

  it("21K 规模（事故同量级）耗时 < 500ms：灾难性回溯不得回归", () => {
    const startedAt = performance.now();
    const out = upgradePastedHtml(scaled21k);
    const ms = performance.now() - startedAt;
    expect(out.length).toBeGreaterThan(scaled21k.length * 0.9);
    expect(ms).toBeLessThan(500);
  });

  it("normalizeYuqueClipboardCards：ne-clipboard 载荷改写行内链接卡，非载荷原样返回", () => {
    const payload = encodeURIComponent(JSON.stringify({
      type: "doc",
      children: [{ type: "card", name: "bookmarkInline", attrs: { value: { mode: "title", src: "https://docs.example.com/x", text: "x" } } }],
    }));
    const html = '<meta charset="utf-8"><ne-clipboard data="' + payload + '"></ne-clipboard>';
    const out = normalizeYuqueClipboardCards(html);
    expect(out).toContain("yuqueInline");
    expect(normalizeYuqueClipboardCards(fixture)).toBe(fixture);
  });

  it("转义卡片文本（&lt;card&gt;）不被管线误吞", () => {
    const esc = '<p>&lt;card type="inline" name="codeblock" value="data:%7B%22code%22%3A%22x%22%7D"&gt;&lt;/card&gt;</p>';
    const out = upgradePastedHtml(esc);
    expect(out).toContain("&lt;card");
  });
});
