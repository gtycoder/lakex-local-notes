/**
 * 两条「创建小记」入口的「保存并同步」护栏（261110）：
 *  · 路径 A = 首页 FAB → 空白小记；路径 B = 长按桌面图标 / \`lakexlocalnotes://quick-note\` 快捷 capture。
 *  · 两条必须共用**同一个** \`QuickNoteComposer\`，且「保存并同步」**只有一个**出网调用 =
 *    \`bridge.syncQuickNote(当前条)\`（单条快路径，见 docs/SYNC-PROTOCOL.md §12.3）。
 *  · 整轮 \`bridge.syncNow()\` 只属于首页顶栏云按钮，不得在 composer / capture 的 onSaved / closeCapture /
 *    自动同步（capture 会话）里出现。
 *
 * 全部为源码级断言（jsdom/node 起不了内核与原生桥），行号会漂，按"片段里有没有这个调用"钉住。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
/** 去注释版：断言"没有某个调用"时排除说明文字。 */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const COMPOSER = code(read("./QuickNoteComposer.tsx"));
const HOME = code(read("./HomePage.tsx"));
const APP = code(read("../MobileApp.tsx"));
const AUTO = code(read("../hooks/useAutoSync.ts"));
const LAZY = code(read("./quickNoteComposerLazy.tsx"));

describe("两条创建入口的「保存并同步」只推当前条（261110）", () => {
  it("两入口共用同一写作卡（QuickNoteComposerLazy），没有第二套实现", () => {
    expect(LAZY).toMatch(/import\("\.\/QuickNoteComposer"\)/);
    expect(HOME).toMatch(/<QuickNoteComposerLazy/);
    expect(APP).toMatch(/<QuickNoteComposerLazy/);
    expect((HOME.match(/<QuickNoteComposerLazy/g) ?? []).length).toBe(1);
    expect((APP.match(/<QuickNoteComposerLazy/g) ?? []).length).toBe(1);
  });

  it("composer 里唯一出网同步 = bridge.syncQuickNote(当前 noteId)；无 syncNow / runSync / 其它同步引擎", () => {
    expect(COMPOSER).toMatch(/bridge\.syncQuickNote\(noteId\)/);
    expect((COMPOSER.match(/bridge\.syncQuickNote\(/g) ?? []).length, "只允许一个同步调用点").toBe(1);
    expect(COMPOSER).not.toMatch(/bridge\.syncNow\(/);
    expect(COMPOSER).not.toContain("runSync");
    // 不得绕开 bridge 直接起 v3 引擎/整轮（那会破坏"只推这一条"）
    expect(COMPOSER).not.toMatch(/runMobileV3Sync|runMobileV3PushQuickNote|createMobileS3v3Remote/);
    // 「保存并同步」按钮 = save(true)；「保存」主按钮 = save(false)，后者完全不出网
    expect(COMPOSER).toMatch(/onClick=\{\(\) => void save\(true\)\}/);
    expect(COMPOSER).toMatch(/onClick=\{\(\) => void save\(false\)\}/);
  });

  it("正常路径（首页 FAB → 空白小记）的 onSaved 只关卡片 + 刷本地列表，不触发同步", () => {
    const at = HOME.indexOf("<QuickNoteComposerLazy");
    expect(at).toBeGreaterThan(-1);
    const seg = HOME.slice(at, at + 900);
    expect(seg).toMatch(/onSaved=\{async \(\) => \{ closeComposer\(\); await onQuickNotesChanged\(\); \}\}/);
    expect(seg, "onSaved 里不得有出网同步").not.toMatch(/syncNow|syncQuickNote/);
    // onQuickNotesChanged 的来源是 MobileApp.refreshAll（只读本地快照），不是网络
    expect(APP).toMatch(/const refreshAll = useCallback\(async \(\) => \{/);
    expect(APP).not.toMatch(/refreshAll[\s\S]{0,200}syncNow/);
  });

  it("capture 的 onSaved / closeCapture 不发起任何同步（假单独模块：只有点按钮才出网）", () => {
    const savedAt = APP.indexOf("onSaved={");
    expect(savedAt).toBeGreaterThan(-1);
    const savedSeg = APP.slice(savedAt, savedAt + 260);
    expect(savedSeg).toMatch(/setCaptureNonce/);
    expect(savedSeg).not.toMatch(/syncNow|syncQuickNote/);

    const closeAt = APP.indexOf("function closeCapture()");
    expect(closeAt).toBeGreaterThan(-1);
    const closeSeg = APP.slice(closeAt, closeAt + 420);
    expect(closeSeg).not.toMatch(/syncNow|syncQuickNote/);
  });

  it("capture 会话不主动整轮同步：入口 / 回前台 / 进后台三处都先过 isCaptureSession", () => {
    expect((AUTO.match(/await isCaptureSession\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // 前台 handler：判定必须出现在 runOnce 之前
    const fgAt = AUTO.indexOf("foregroundHandler = () =>");
    const bgAt = AUTO.indexOf("backgroundHandler = () =>");
    const fg = AUTO.slice(fgAt, bgAt);
    const bg = AUTO.slice(bgAt, bgAt + 700);
    expect(fg).toMatch(/if \(await isCaptureSession\(\)\) return;/);
    expect(bg).toMatch(/if \(await isCaptureSession\(\)\) return;/);
    expect(fg.indexOf("isCaptureSession")).toBeLessThan(fg.indexOf("runOnce("));
    expect(bg.indexOf("isCaptureSession")).toBeLessThan(bg.indexOf("runOnce("));
  });

  it("唯一整轮同步入口 = 首页顶栏云按钮（runSync 定义 + 一次点击）；composer/APP 不得出现 syncNow", () => {
    expect((HOME.match(/bridge\.syncNow\(/g) ?? []).length).toBe(1);
    expect(HOME).toMatch(/onClick=\{\(\) => void runSync\(\)\}/);
    // runSync 定义 1 次 + 按钮引用 1 次
    expect((HOME.match(/runSync/g) ?? []).length).toBe(2);
    expect(APP).not.toMatch(/bridge\.syncNow\(/);
  });
});
