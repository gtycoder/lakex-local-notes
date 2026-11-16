import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 现代 CSS 写法契约（261115，MODERN-WEB-AUDIT A12/A18/A19/A25）。
 *
 * 这些不是"风格偏好"，每条都有一个具体失效面：
 *  · field-sizing 缺失 ⇒ AI 输入条每次按键读一次 scrollHeight（强制布局）；
 *  · -webkit-mask 缺标准 mask ⇒ 非 Chromium 内核/未来版本上图标直接不见；
 *  · -webkit-overflow-scrolling ⇒ Chromium 早已 no-op，留着让人误以为管用；
 *  · text-wrap ⇒ 中文长标题/说明在窄栏里出现孤字换行。
 */
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(HERE, "..");

const read = (rel: string): string => readFileSync(path.join(SRC, rel), "utf8");

function walkCss(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkCss(p, out);
    else if (e.name.endsWith(".css")) out.push(p);
  }
  return out;
}

const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe("现代 CSS 写法契约", () => {
  it("AI 输入条自增高走 field-sizing: content（不再 JS 量 scrollHeight）", () => {
    expect(read("features/ai/aiDialogParts.css")).toMatch(/\.ai-dialog__composer \.ai-dialog__field \{[^}]*field-sizing: content/);
    expect(read("features/ai/AiAssistantDialog.tsx")).not.toMatch(/\.scrollHeight/);
  });

  it("每处 -webkit-mask 都有对应的标准 mask（前缀保留做兜底）", () => {
    const css = read("mobile/usheet/usheet-chrome.css");
    expect(count(css, "-webkit-mask:")).toBeGreaterThan(0);
    expect(count(css, "\n  mask:")).toBe(count(css, "\n  -webkit-mask:"));
  });

  it("全仓不再使用 -webkit-overflow-scrolling（Chromium no-op）", () => {
    const offenders = walkCss(path.join(SRC, "mobile"))
      .concat(walkCss(path.join(SRC, "styles")))
      .filter((f) => readFileSync(f, "utf8").includes("-webkit-overflow-scrolling"));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("对话框标题/正文启用 text-wrap（balance / pretty）", () => {
    const css = read("styles/overlay.css");
    expect(css).toContain("text-wrap: balance");
    expect(css).toContain("text-wrap: pretty");
  });

  it("AI composer 契约：药丸用 min-height（200% 不裁）、发送钮只有 kit 一份、chip 命中区 24", () => {
    const kit = read("styles/kit.css");
    const pillStart = kit.indexOf(".ln-pill {");
    const pill = kit.slice(pillStart, kit.indexOf("}", pillStart));
    expect(pill).toContain("min-height: 28px;");
    // 只允许 min-height，禁止固定 height（A03：含文字容器不得固定高；否则 200% 字号裁字）。
    expect(pill).not.toMatch(/(^|\n)\s*height: 28px;/);
    expect(kit).toContain(".ln-send-circle,");
    for (const rel of ["features/ai/aiDialogParts.css", "features/aiWriting/aiWriting.css"]) {
      expect(read(rel)).not.toMatch(/^\.(ai-dialog|aiw)-send-circle(\s|,|\{)/m);
    }
    const writing = read("features/aiWriting/aiWriting.css");
    expect(writing).toContain(".aiw-chip__close::before,");
    expect(writing).toContain(".aiw-attach-chip__remove::before");
    expect(writing).toContain("inset: -4px;");
  });
});
