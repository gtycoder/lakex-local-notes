/**
 * 小记轻量框（长按桌面图标 / `lakenotes://quick-note` 深链路径）护栏（260920）。
 *
 * 用户 260920 定稿的分工：
 * - **长按速记那条路径 = 轻量速记框**（`textarea` + 图片，零内核实例、**不可展开**）——要的是秒开；
 * - **工作台里的「新建小记」/「编辑」仍是完整内核编辑器**（`QuickNoteComposer` → `QuickNoteEditor`）。
 *
 * 启动路径（260920 优化）：
 * - 轻量框挂在 `MobileApp` 的**独立入口**（`captureOpen`），在 `bridge.init()`/`refreshAll()` **之前**渲染
 *   ⇒ 输入框最早出现（保存时才按需 `ensureDb()`）；
 * - Lake 内核（6.7MB）已从入口 chunk 拆出（`NotebookWorkspace`/`QuickNoteComposer`/`TrashPreviewPage` 按需加载），
 *   入口不再静态引用内核。
 *
 * 内核**没有**"不建实例就把文本转成 Lake 正文"的能力（`setDocument('text/*')` 要编辑器实例、
 * `markdownStream` 要阅读器实例；见 docs/LAKEX-CONTRACT.md §5.12）⇒ 轻量框的正文只能走无内核写入者
 * 唯一被认可的通道 `core/quickNoteModel.quickNoteBodyFromTextAndImages` → `core/lakeDocForm`
 * （`<p>` + 图片 `<card>` 容器，绝不产出裸 `<img>`）。
 *
 * vitest 跑在 node 环境、起不了内核，故与 quickNoteNoteUi 同套路做**源码级**断言（只扫代码、不扫注释）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
/** 去掉块注释与整行行注释，避免"注释里提到某名字"误判。 */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const FLASH_CODE = code(read("./QuickNoteFlashComposer.tsx"));
const HOME_CODE = code(read("./HomePage.tsx"));
const MOBILE_APP_CODE = code(read("../MobileApp.tsx"));
const REPO_SRC = read("../quickNotesRepository.ts");
const MODEL_CODE = code(read("../../core/quickNoteModel.ts"));

describe("小记：轻量框不挂内核", () => {
  it("不引内核编辑器 / 运行时，也不做展开（零内核实例）", () => {
    for (const forbidden of ["QuickNoteEditor", "lakeRuntime", "createLakeDocument", "fullscreen", "ne-ui-"]) {
      expect(FLASH_CODE, `轻量框不应出现 ${forbidden}`).not.toContain(forbidden);
    }
    expect(FLASH_CODE).toContain("<textarea");
  });

  it("保存走无内核写入通道（saveQuickNoteWithImages），不在组件里手拼正文", () => {
    expect(FLASH_CODE).toMatch(/bridge\.saveQuickNoteWithImages\(/);
    // 组件只给 text + 图片字节；body 由 core 合成 ⇒ 代码里不应出现正文标签
    for (const tag of ["<card", "data-lake-id", "ne-p"]) {
      expect(FLASH_CODE, `轻量框不应手拼正文：${tag}`).not.toContain(tag);
    }
  });

  it("有本地草稿防丢（挂载恢复 + 防抖落库 + 保存/取消清除）", () => {
    expect(FLASH_CODE).toMatch(/bridge\.getQuickNoteDraft\(/);
    expect(FLASH_CODE).toMatch(/bridge\.saveQuickNoteDraft\(/);
    expect(FLASH_CODE).toMatch(/bridge\.clearQuickNoteDraft\(/);
  });

  it("合成路径复用内核写入形态单一来源（lakeDocForm），媒体是 card 不是裸 img", () => {
    expect(REPO_SRC).toMatch(/quickNoteBodyFromTextAndImages/);
    expect(MODEL_CODE).toMatch(/lakeImageCardParagraph\(/);
    expect(MODEL_CODE).not.toMatch(/<img\b/);
  });

  it("长按/深链 → MobileApp 独立入口，且在 bridge.init/refreshAll 之前渲染", () => {
    // 深链回调 = 打开独立入口
    expect(MOBILE_APP_CODE).toMatch(/setCaptureOpen\(true\)/);
    expect(MOBILE_APP_CODE).toMatch(/if \(captureOpen\) \{/);
    expect(MOBILE_APP_CODE).toMatch(/<QuickNoteFlashComposer/);
    // 轻量框分支必须在启动门（phase === "booting"）之前 ⇒ 不等 bridge.init/refreshAll
    const captureIdx = MOBILE_APP_CODE.indexOf("if (captureOpen)");
    const bootingIdx = MOBILE_APP_CODE.indexOf('if (phase === "booting")');
    expect(captureIdx).toBeGreaterThan(-1);
    expect(bootingIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeLessThan(bootingIdx);
    // HomePage 里的「新建小记」/「编辑」仍走完整内核编辑器（懒加载），不再是轻量框
    expect(HOME_CODE).toMatch(/QuickNoteComposer/);
    expect(HOME_CODE).not.toContain("QuickNoteFlashComposer");
  });
});
