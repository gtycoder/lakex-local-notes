/**
 * 小记 capture 路径（长按桌面图标 / `lakenotes://quick-note` 深链）护栏 —— **261010 统一后的口径**。
 *
 * 决策修订：260920 定的是「capture = 不挂内核的轻量框（秒开、不可展开）」，工作台才用内核编辑器；
 * 261010 用户改为**统一**：capture 与工作台共用**同一个内核卡片**（桌面同款未展开版式：图片/待办/有序/无序/分割线
 * + 右上角展开）。依据是实测：**内核已就绪时开这张卡片只要 62–70ms**（与 textarea 同量级），
 * 334–928ms 只出现在**内核未加载**的冷态 ⇒ 「慢」来自内核未加载，不来自卡片样式。
 *
 * 统一后本护栏盯住四条：
 *  1. capture 仍走**独立入口**且在启动门（`phase === "booting"`）之前 —— 不等 bridge.init/refreshAll；
 *  2. capture 用的是**同一个** `QuickNoteComposer`，不再有第二套轻量框实现（组件文件必须已删除）；
 *  3. 草稿防丢仍在（含富内容 `body`）；
 *  4. 系统分享带入（seed）不被丢 —— 先落成草稿再由 composer 恢复。
 *
 * vitest 跑在 node 环境、起不了内核 ⇒ 与 quickNoteNoteUi 同套路做**源码级**断言（只扫代码、不扫注释）。
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
/** 去掉块注释与整行行注释，避免"注释里提到某名字"误判。 */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MOBILE_APP = code(read("../MobileApp.tsx"));
const COMPOSER = code(read("./QuickNoteComposer.tsx"));
const HOME = code(read("./HomePage.tsx"));

describe("小记 capture 路径（261010 统一为内核卡片）", () => {
  it("capture 与工作台共用同一个内核 composer（第二套轻量框已删除）", () => {
    expect(existsSync(new URL("./QuickNoteFlashComposer.tsx", import.meta.url)), "轻量框组件应已删除（统一后只留一套）").toBe(false);
    expect(MOBILE_APP).toMatch(/import\("\.\/home\/QuickNoteComposer"\)/);
    expect(MOBILE_APP).toMatch(/<QuickNoteComposer/);
    expect(MOBILE_APP).not.toContain("QuickNoteFlashComposer");
    expect(HOME).toMatch(/<QuickNoteComposer/);
  });

  it("capture 仍是独立入口，且在启动门之前渲染（不等 bridge.init/refreshAll）", () => {
    const captureIdx = MOBILE_APP.indexOf("if (captureOpen)");
    const bootingIdx = MOBILE_APP.indexOf('if (phase === "booting")');
    expect(captureIdx).toBeGreaterThan(-1);
    expect(bootingIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeLessThan(bootingIdx);
    expect(MOBILE_APP).toMatch(/setCaptureOpen\(true\)/);
  });

  it("capture 传 draft（草稿恢复 + 防抖落库 + 保存/取消清除，含富内容 body）", () => {
    expect(MOBILE_APP).toMatch(/<QuickNoteComposer[\s\S]{0,200}draft/);
    expect(COMPOSER).toMatch(/bridge\.getQuickNoteDraft\(/);
    expect(COMPOSER).toMatch(/bridge\.saveQuickNoteDraft\(/);
    expect(COMPOSER).toMatch(/bridge\.clearQuickNoteDraft\(/);
    // 草稿存内核原样正文：否则恢复时会丢待办/列表/分割线
    expect(COMPOSER).toMatch(/stripAssetAccessToken\(apiRef\.current\?\.getBody\(\)/);
    expect(COMPOSER).toMatch(/saveQuickNoteDraft\(\{ id: noteId, text, body \}\)/);
  });

  it("系统分享带入不被丢：seed 先落成草稿，再由 composer 恢复", () => {
    expect(MOBILE_APP).toMatch(/sharedContentToSeed/);
    expect(MOBILE_APP).toMatch(/bridge\.saveQuickNoteDraft\(\{ id, text: captureSeed\.text, body, images \}\)/);
    // 带入的 body 也走无内核写入通道（绝不手拼正文/裸 img）
    expect(MOBILE_APP).toMatch(/quickNoteBodyFromTextAndImages\(/);
  });
});
