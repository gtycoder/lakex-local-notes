import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * task-26 护栏：小记写作卡图片显示缩略（?w=1024）只允许沿「移动端写作卡 + 卡片已带 original」这条窄路，
 * 内核升级/配置漂移/桌面误传时直接红。
 *
 * 契约来源：docs/LAKEX-CONTRACT.md（Lead 回填后启用第 5 条断言）。
 */

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");
const BUNDLE = read("../../../vendor/lakex-doc-react/src/components/lakex/lakex.js");
const RUNTIME = read("./lakeRuntime.ts");
const MOBILE_COMPOSER = read("../../mobile/home/QuickNoteComposer.tsx");
const DESKTOP_COMPOSER = read("../../components/app/QuickNoteComposer.tsx");
const CONTRACT = read("../../../docs/LAKEX-CONTRACT.md");

describe("task-26 图片显示缩略护栏", () => {
  it("内核 bundle 仍支持 image.onBeforeRenderImage（升级后这里先红）", () => {
    expect(BUNDLE).toContain("onBeforeRenderImage");
  });

  it("lakeRuntime 只在 width>0 且拿到 allow Set 时才挂 hook（fail-safe）", () => {
    expect(RUNTIME).toContain("onBeforeRenderImage");
    expect(RUNTIME).toMatch(/prefs\.imageThumbWidth > 0[\s\S]{0,240}prefs\.imageThumbAllowFiles instanceof Set[\s\S]{0,400}onBeforeRenderImage/);
    // 实验期取证/开关残留必须清干净（正式语义无实验分支）
    expect(RUNTIME).not.toContain("__imageThumbStats");
    expect(RUNTIME).not.toContain("expImageThumb");
  });

  it("移动端写作卡无条件传 1024，且无实验 flag/调试暴露残留", () => {
    expect(MOBILE_COMPOSER).toContain("imageThumbWidth={1024}");
    expect(MOBILE_COMPOSER).not.toContain("exp-image-thumb");
    expect(MOBILE_COMPOSER).not.toContain("__expComposer");
  });

  it("桌面小记 composer 不传缩略档（桌面零变化）", () => {
    expect(DESKTOP_COMPOSER).not.toContain("imageThumbWidth");
  });

  it("docs/LAKEX-CONTRACT.md 已回填 onBeforeRenderImage（§5.51）", () => {
    expect(CONTRACT).toContain("onBeforeRenderImage");
  });
});
