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
const EDITOR = code(read("../../features/quickNotes/QuickNoteEditor.tsx"));
const AUTO_SYNC = code(read("../hooks/useAutoSync.ts"));
const SETTINGS = code(read("../settings/SettingsDrawer.tsx"));
const BRIDGE = code(read("../bridge.ts")) + code(read("../bridge/sync.ts"));
const SYNC_STATUS = code(read("../sync/syncStatusStore.ts"));

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

  // ── 261013（用户定稿，模仿思源"闪念速记"）：把 capture 做成"假单独模块" ──
  //  ① 提交后**不进入小记列表**：重挂一条新的空小记、停在写作界面可连续记；
  //  ② 退出只有"手动"（系统返回键 / 「取消」）；快捷入口这次会话**直接退 App 回桌面**；
  //  ③ 这条流程**不主动发起任何同步**（入口 / 回前台 / 进后台三处都跳），只有点「保存并同步」才出网。
  it("提交后留在写作界面可连续记（重挂新小记，而不是关闭 capture）", () => {
    const idx = MOBILE_APP.indexOf("onSaved={");
    expect(idx, "capture 的 onSaved 应存在").toBeGreaterThan(-1);
    const savedSeg = MOBILE_APP.slice(idx, idx + 260);
    expect(savedSeg, "onSaved 里应重挂新小记（setCaptureNonce）").toMatch(/setCaptureNonce/);
    expect(savedSeg, "onSaved 里不应再关闭 capture —— 那就变成「提交即离开写作界面」了").not.toMatch(/setCaptureOpen\(false\)/);
  });

  it("手动退出统一走 closeCapture，且快捷入口会话直接退 App（不回小记列表页）", () => {
    expect(MOBILE_APP).toMatch(/function closeCapture\(\)/);
    expect(MOBILE_APP).toMatch(/onCloseCapture: closeCapture/); // 系统返回键
    expect(MOBILE_APP).toMatch(/onCancel=\{closeCapture\}/); // 「取消」按钮
    const from = MOBILE_APP.indexOf("function closeCapture()");
    const body = MOBILE_APP.slice(from, from + 420);
    expect(body, "快捷入口会话的手动退出必须退 App（「假单独模块」）").toMatch(/captureLaunchedRef[\s\S]{0,160}exitApp\(\)/);
  });

  it("新建小记自动聚焦（快捷 capture 与页面「新建小记」共用同一写作卡，两条路一起补）", () => {
    expect(EDITOR, "编辑器 API 应暴露 focus（内核官方命令 focus 聚焦编辑器）").toMatch(/focus: \(\) =>[\s\S]{0,160}execCommand[\s\S]{0,12}"focus"/);
    expect(COMPOSER, "写作卡应在内核就绪后自动聚焦").toMatch(/autoFocusIfCreating\(\)/);
    expect(COMPOSER, "补一拍：就绪后 150ms 再试一次（内核「要等一拍」口径）").toMatch(/setTimeout\(tryFocus, 150\)/);
    expect(COMPOSER, "只在创建时聚焦；打开已有小记编辑不抢焦点").toMatch(/if \(editNote\) return;/);
  });

  it("快捷 capture 自动弹键盘（WebView 程序化 focus 不弹 ⇒ 走原生 ShowKeyboard 插件）", () => {
    expect(MOBILE_APP, "capture 写作卡应传 raiseKeyboard（页面路有手势，不传）").toMatch(/raiseKeyboard/);
    expect(COMPOSER, "聚焦之后请原生弹一次键盘").toMatch(/showNativeKeyboard\(\)/);
    const mainActivity = read("../../../android/app/src/main/java/com/lakenotes/mobile/MainActivity.kt");
    expect(mainActivity, "原生插件必须在 MainActivity 注册，否则 JS 调用只会 reject").toMatch(/registerPlugin\(ShowKeyboardPlugin::class\.java\)/);
  });

  it("开启应用对齐用**显式就绪信号**，不再猜 3s（用户 261013）", () => {
    expect(MOBILE_APP, "就绪信号 = phase 离开 booting（bridge.init + refreshAll 之后）").toMatch(/useAutoSync\(phase === "ready"\)/);
    expect(AUTO_SYNC, "不许再出现 3s 猜时间").not.toMatch(/setTimeout\([^)]*, 3000\)/);
    expect(AUTO_SYNC, "就绪 effect 触发那一次对齐").toMatch(/if \(!ready\) return;/);
  });

  it("同步可观测性：上次同步（时间/结果/失败原因）落盘并常驻设置页（用户 261013）", () => {
    expect(SYNC_STATUS, "状态 store 要落盘 + 可订阅").toMatch(/writeLocalStorage\(KEY/);
    expect(BRIDGE, "写入点唯一 = bridge.syncNow；ok 按「真的跑了引擎」判（notes 非 null）").toMatch(/writeSyncStatus\(\{ at: new Date\(\)\.toISOString\(\), ok: result\.notes !== null/);
    expect(BRIDGE, "失败也要记（此前只有 console.warn，界面上看不到）").toMatch(/ok: false/);
    expect(SETTINGS, "设置页常驻显示这一行").toMatch(/describeSyncStatus\(lastSync\)/);
    expect(SETTINGS, "跟随 store 刷新").toMatch(/subscribeSyncStatus\(/);
  });

  it("capture 会话不主动发起同步（前台 / 后台两处都过 capture 会话判定）", () => {
    const auto = code(read("../hooks/useAutoSync.ts"));
    expect(auto).toMatch(/isCaptureSession/);
    expect((auto.match(/await isCaptureSession\(\)/g) ?? []).length, "前台 + 后台都要判定").toBeGreaterThanOrEqual(2);
    // 用户自己配的「按固定间隔」定时器不在此列（那是他设的节奏，不是我们替他补的动作）
    expect(auto).toMatch(/setInterval/);
  });
});
