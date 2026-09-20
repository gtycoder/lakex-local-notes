/**
 * 闪念速记轻量框（长按桌面图标 / `lakenotes://quick-note` 深链路径）护栏（260920）。
 *
 * 用户 260920 定稿的分工：
 * - **长按速记那条路径 = 轻量速记框**（`textarea` + 图片，零内核实例、**不可展开**）—— 要的是秒开；
 * - **工作台里的「新建小记」/「编辑」仍是完整内核编辑器**（`QuickNoteComposer` → `QuickNoteEditor`）。
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
const HOME_SRC = read("./HomePage.tsx");
const REPO_SRC = read("../quickNotesRepository.ts");
const MODEL_CODE = code(read("../../core/quickNoteModel.ts"));

describe("闪念速记：轻量框不挂内核", () => {
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

  it("合成路径复用内核写入形态单一来源（lakeDocForm），媒体是 card 不是裸 img", () => {
    expect(REPO_SRC).toMatch(/quickNoteBodyFromTextAndImages/);
    expect(MODEL_CODE).toMatch(/lakeImageCardParagraph\(/);
    expect(MODEL_CODE).not.toMatch(/<img\b/);
  });

  it("深链请求 → 轻量框；工作台「新建小记」仍是完整内核编辑器", () => {
    // 深链（newQuickNoteRequest）走 lite
    expect(HOME_SRC).toMatch(/setComposer\(\{ mode: "new", lite: true \}\)/);
    expect(HOME_SRC).toMatch(/composer\.mode === "new" && composer\.lite/);
    // 底部胶囊栏「新建小记」不传 lite（走 QuickNoteComposer → 内核）
    expect(HOME_SRC).toMatch(/setComposer\(\{ mode: "new" \}\)/);
    // key = 请求计数：每次长按重开空框，不串上一次输入
    expect(HOME_SRC).toMatch(/key=\{newQuickNoteRequest\}/);
  });
});
