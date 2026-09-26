/**
 * 浮动弹窗坐标系门禁（260926）。
 *
 * 设置 / 回收站 / 历史三个浮窗用 `src/components/useFloatingDialog.ts` 拖动与缩放，那套逻辑按
 * **视口绝对坐标**读写：读 `getBoundingClientRect()`、写 `style.left/top`。成立的前提是这三个面板
 * 保持 `.floating-dialog` 的 `position: fixed`。
 *
 * 260926 的坑：`.history-panel { position: relative }`（同层后声明胜出，把 fixed 顶掉）⇒ left/top 从
 * 「视口绝对」变成「相对居中位置的偏移」⇒ 每拖一次/点一次就把居中量再叠一遍，历史弹窗一路往右下
 * 跑出屏幕（用户报「无法看、点一下更靠右下、最后完全不可见」）。回收站/设置面板没写 position，
 * 所以只有历史面板中招 —— 这也解释了「为什么偏偏这个弹窗」。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

describe("浮动弹窗坐标系（拖拽浮窗必须保持 fixed）", () => {
  it(".floating-dialog 用 fixed + translate 居中（拖拽绝对坐标的基准）", () => {
    const css = read("styles/app/settings.css");
    const rule = css.slice(css.indexOf(".floating-dialog {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("position: fixed;");
    expect(body).toContain("transform: translate(-50%, -50%);");
  });

  it("三个浮窗面板都不改写 position（改掉 fixed 会破坏拖动坐标）", () => {
    for (const file of ["styles/app/panels.css", "styles/app/settings.css"]) {
      // 去掉注释再扫，避免注释里的示例被当成规则
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
      for (const cls of ["history-panel", "trash-panel", "settings-panel"]) {
        // 只匹配"直接选中该面板自身"的规则：类名后到 `{` 之间不能出现空白（排除后代选择器）
        const re = new RegExp("\\.(" + cls + ")(?![\\w-])[^{}\\s]*\\{[^}]*position:", "g");
        expect(css.match(re) ?? [], `${file} 的 .${cls}`).toEqual([]);
      }
    }
  });

  it("拖动/缩放按视口绝对坐标读写，且窗口缩小能把浮窗拉回可见区", () => {
    const hook = read("components/useFloatingDialog.ts");
    expect(hook).toContain("panel.getBoundingClientRect()");
    expect(hook).toMatch(/panel\.style\.left = `\$\{nextX\}px`;/);
    expect(hook).toMatch(/x: Math\.round\(rect\.left\), y: Math\.round\(rect\.top\)/);
    expect(hook).toMatch(/window\.addEventListener\("resize", reclamp\)/);
  });
});
