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
const MOBILE_DOC_EDITOR = read("../../mobile/editor/DocumentEditor.tsx");
const DESKTOP_DOC_EDITOR = read("./EditorTab.tsx");
const CORE_THUMB = read("../../core/quickNoteImageThumb.ts");
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

  it("新插入图片走「上传后确认 origin 再放行」的跟踪器（边界 A）", () => {
    expect(RUNTIME).toContain("createImageThumbUploadTracker");
    expect(RUNTIME).toContain("imageThumbTracker.onUploaded");
    expect(RUNTIME).toContain("imageThumbTracker.dispose()");
  });

  it("档位单一来源 = core 常量 1024（资产服务档位表里才有效）", () => {
    expect(CORE_THUMB).toContain("export const MOBILE_IMAGE_THUMB_WIDTH = 1024;");
  });

  it("移动端写作卡无条件传缩略档，且无实验 flag/调试暴露残留", () => {
    expect(MOBILE_COMPOSER).toContain("imageThumbWidth={MOBILE_IMAGE_THUMB_WIDTH}");
    expect(MOBILE_COMPOSER).not.toContain("exp-image-thumb");
    expect(MOBILE_COMPOSER).not.toContain("__expComposer");
  });

  it("移动端文档编辑器启用同一档 + 正文 allowlist（边界 C），桌面文档编辑器不传", () => {
    expect(MOBILE_DOC_EDITOR).toContain("imageThumbWidth: MOBILE_IMAGE_THUMB_WIDTH");
    expect(MOBILE_DOC_EDITOR).toContain("imageThumbAllowFiles: thumbAllowRef.current.files");
    expect(MOBILE_DOC_EDITOR).toContain("imageThumbAllowFiles(content)");
    // 桌面：Retina 清晰度优先，保持原图（零变化）
    expect(DESKTOP_DOC_EDITOR).not.toContain("imageThumbWidth");
  });

  it("桌面小记 composer 不传缩略档（桌面零变化）", () => {
    expect(DESKTOP_COMPOSER).not.toContain("imageThumbWidth");
  });

  it("docs/LAKEX-CONTRACT.md 已回填 onBeforeRenderImage（§5.51）", () => {
    expect(CONTRACT).toContain("onBeforeRenderImage");
  });
});
