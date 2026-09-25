/**
 * UI 原语门禁（260926，Phase 1）。
 *
 * 背景：全仓曾有 21 处手写 createPortal 浮层，各自处理遮罩/外点/Esc/层序，漏一处就出
 * 「透明面板 / 遮罩盖不住外壳」这类结构 bug（Phase 0 实测）。这里把三条不变量钉死：
 *   1. createPortal 只允许出现在 Overlay 原语（+ 显式白名单）；
 *   2. 三支表面类 .ln-dialog/.ln-menu/.ln-popover 各只定义一次（防止表面漂移回多处）；
 *   3. overlay 层序令牌唯一、且整体高于外壳 topbar（防止浮层掉到外壳之下）。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** 允许 createPortal 的非原语文件（有意保留，见 docs/UI-PRIMITIVES-PHASE1-260926.md）：
 *  - ImageLightbox / AttachmentPreview：全屏媒体预览（自带背景点击关闭 + fixed 铺满）
 *  - kernelUiAtoms：非交互 tooltip tip（§3.7 决定不建 Tooltip 原语） */
const PORTAL_ALLOWLIST = [
  "components/ui/Overlay.tsx",
  "features/editor/ImageLightbox.tsx",
  "features/attachment/AttachmentPreview.tsx",
  "features/editor/selectionToolbar/kernelUiAtoms.tsx",
];

describe("UI 原语门禁", () => {
  it("createPortal 只允许出现在 Overlay 原语与显式白名单", () => {
    const offenders: string[] = [];
    for (const abs of walk(SRC)) {
      if (!abs.endsWith(".tsx")) continue;
      const rel = path.relative(SRC, abs).split(path.sep).join("/");
      if (readFileSync(abs, "utf8").includes("createPortal(") && !PORTAL_ALLOWLIST.includes(rel)) offenders.push(rel);
    }
    expect(offenders, "浮层必须走 <Dialog>/<Menu>/<Popover>（src/components/ui/Overlay.tsx）").toEqual([]);
  });

  it("三支表面类 .ln-dialog/.ln-menu/.ln-popover 都只在 overlay.css 定义", () => {
    const files: Record<string, Set<string>> = { "ln-dialog": new Set(), "ln-menu": new Set(), "ln-popover": new Set() };
    for (const abs of walk(SRC)) {
      if (!abs.endsWith(".css")) continue;
      const rel = path.relative(SRC, abs).split(path.sep).join("/");
      const text = readFileSync(abs, "utf8");
      for (const name of Object.keys(files)) {
        if (new RegExp("(^|\\n)\\." + name + "\\s*[,{]").test(text)) files[name].add(rel);
      }
    }
    for (const name of Object.keys(files)) expect([...files[name]], name).toEqual(["styles/overlay.css"]);
  });

  it("overlay 层序令牌唯一、依次递增、且都高于外壳 topbar", () => {
    const css = readFileSync(path.join(SRC, "styles/themes/base.css"), "utf8");
    const val = (name: string): number => {
      const m = [...css.matchAll(new RegExp("--" + name + "(?![\\w-])\\s*:\\s*(-?\\d+)", "g"))];
      expect(m.length, "--" + name + " 应唯一定义").toBe(1);
      return Number(m[0][1]);
    };
    const topbar = val("lake-z-topbar");
    const band = ["lake-z-overlay-menu", "lake-z-overlay-scrim", "lake-z-overlay-dialog", "lake-z-overlay-lightbox"];
    for (const t of band) expect(val(t), t + " 须高于 topbar").toBeGreaterThan(topbar);
    for (let i = 1; i < band.length; i++) expect(val(band[i]), band[i]).toBeGreaterThan(val(band[i - 1]));
  });
});
