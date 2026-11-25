/**
 * 小记 capture 路径（长按桌面图标 / `lakexlocalnotes://quick-note` 深链）护栏 —— **261010 统一后的口径**。
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
const COMPOSER_LAZY = code(read("./quickNoteComposerLazy.tsx"));
const FLOW = code(read("./captureModeFlow.ts"));
const COMPOSER_SKELETON = code(read("./QuickNoteComposerSkeleton.tsx"));
const EDITOR = code(read("../../features/quickNotes/QuickNoteEditor.tsx"));
const AUTO_SYNC = code(read("../hooks/useAutoSync.ts"));
// M-05 拆分：「上次同步」行在 S3SettingsSection.tsx ⇒ 聚合读（语义 = 设置页常驻显示这一行）。
const SETTINGS = code(read("../settings/SettingsDrawer.tsx") + read("../settings/S3SettingsSection.tsx"));
const SYNC_FORM = code(read("../settings/useSyncSettingsForm.ts"));
const BRIDGE = ["bridge.ts", "bridge/sync.ts", "bridge/notes.ts", "bridge/quickNotes.ts", "bridge/tree.ts"].map((f) => code(read("../" + f))).join("\n");
const SYNC_STATUS = code(read("../sync/syncStatusStore.ts"));
const SHORTCUT = code(read("../native/quickNoteShortcut.ts"));
const MAIN = code(read("../main.tsx"));
const MAIN_ACTIVITY = read("../../../android/app/src/main/java/com/lakexlocalnotes/android/MainActivity.kt");
const MANIFEST = read("../../../android/app/src/main/AndroidManifest.xml");
const SHORTCUTS = read("../../../android/app/src/main/res/xml/shortcuts.xml");
const ANDROID_STYLES = read("../../../android/app/src/main/res/values/styles.xml");
const ANDROID_STYLES_V31 = read("../../../android/app/src/main/res/values-v31/styles.xml");

describe("小记 capture 路径（261010 统一为内核卡片）", () => {
  it("capture 与工作台共用同一个内核 composer（第二套轻量框已删除）", () => {
    expect(existsSync(new URL("./QuickNoteFlashComposer.tsx", import.meta.url)), "轻量框组件应已删除（统一后只留一套）").toBe(false);
    // 261019 起走自研加载壳（预取过则同步渲染、零 fallback）；分包动态 import 收在壳里
    expect(COMPOSER_LAZY).toMatch(/import\("\.\/QuickNoteComposer"\)/);
    expect(MOBILE_APP).toMatch(/<QuickNoteComposerLazy/);
    expect(MOBILE_APP).not.toContain("QuickNoteFlashComposer");
    expect(HOME).toMatch(/<QuickNoteComposerLazy/);
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
    expect(MOBILE_APP).toMatch(/<QuickNoteComposerLazy[\s\S]{0,200}draft/);
    expect(COMPOSER).toMatch(/bridge\.getQuickNoteDraft\(/);
    expect(COMPOSER).toMatch(/bridge\.saveQuickNoteDraft\(/);
    expect(COMPOSER).toMatch(/bridge\.clearQuickNoteDraft\(/);
    // 草稿存内核原样正文：否则恢复时会丢待办/列表/分割线
    expect(COMPOSER).toMatch(/stripAssetAccessToken\(apiRef\.current\?\.getBody\(\)/);
    expect(COMPOSER).toMatch(/saveQuickNoteDraft\(\{ id: noteId, text, body, tagIds \}\)/);
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
    const mainActivity = read("../../../android/app/src/main/java/com/lakexlocalnotes/android/MainActivity.kt");
    expect(mainActivity, "原生插件必须在 MainActivity 注册，否则 JS 调用只会 reject").toMatch(/registerPlugin\(ShowKeyboardPlugin::class\.java\)/);
  });

  it("开启应用对齐用**显式就绪信号**，不再猜 3s（用户 261013）", () => {
    expect(MOBILE_APP, "就绪信号 = phase 离开 booting（bridge.init + refreshAll 之后）").toMatch(/useAutoSync\(phase === "ready"\)/);
    expect(AUTO_SYNC, "不许再出现 3s 猜时间").not.toMatch(/setTimeout\([^)]*, 3000\)/);
    expect(AUTO_SYNC, "就绪 effect 触发那一次对齐").toMatch(/if \(!ready\) return;/);
  });

  it("同步可观测性：上次同步（时间/结果/失败原因）落盘并常驻设置页（用户 261013）", () => {
    expect(SYNC_STATUS, "状态 store 要落盘 + 可订阅").toMatch(/writeLocalStorage\(KEY/);
    expect(BRIDGE, "写入点唯一 = bridge.syncNow").toMatch(/writeSyncStatus\(\{ at: new Date\(\)\.toISOString\(\), ok: /);
    expect(BRIDGE, "失败也要记（此前只有 console.warn，界面上看不到）").toMatch(/ok: false/);
    expect(SETTINGS, "设置页常驻显示这一行").toContain("lastSyncText");
    expect(SYNC_FORM, "同步状态文本走共享描述器").toMatch(/describeSyncStatus\(lastSync\)/);
    expect(SYNC_FORM, "跟随 store 刷新").toMatch(/subscribeSyncStatus\(/);
  });

  it("capture 会话不主动发起同步（前台 / 后台两处都过 capture 会话判定）", () => {
    const auto = code(read("../hooks/useAutoSync.ts"));
    expect(auto).toMatch(/isCaptureSession/);
    expect((auto.match(/await isCaptureSession\(\)/g) ?? []).length, "前台 + 后台都要判定").toBeGreaterThanOrEqual(2);
    // 用户自己配的「按固定间隔」定时器不在此列（那是他设的节奏，不是我们替他补的动作）
    expect(auto).toMatch(/setInterval/);
  });
});

/**
 * 261022：保持速度的启动修法（用户定稿，不加遮罩/不延长等待）。
 * 关键 = 冷启动首帧前同步判定 capture（不画首页骨架）+ 纯色底（不露白）+ 同构骨架。
 */
describe("capture 首帧（261022，零等待）", () => {
  it("原生同步 hint 在首帧前决定 capture；订阅跳过冷读，避免重复触发重挂写作卡", () => {
    expect(SHORTCUT).toContain("lakeLaunchUrl");
    expect(SHORTCUT).toContain("skipColdRead");
    expect(MAIN).toContain("readLaunchUrlHint()");
    // 261119 三模式：initialCapture 载荷带上模式（null/无参 = plain 旧语义）。
    expect(MAIN).toContain("<MobileApp initialCapture={initialCapture} initialCaptureMode={initialCaptureMode} />");
    expect(MOBILE_APP).toContain("initialCapture");
    expect(MOBILE_APP).toContain("useState(initialCapture)");
    expect(MOBILE_APP).toMatch(/skipColdRead:\s*initialCapture/);
    expect(MAIN_ACTIVITY).toContain("lakeLaunchUrl");
  });

  it("首帧纯色底：不盖图、不延迟（261120 用户点单：启动底改白）", () => {
    const HTML = read("../../../mobile.html");
    expect(HTML).toContain("background: #ffffff");
    expect(HTML).not.toContain("boot-screen");
  });

  it("入口分离（对齐思源的「普通启动带 logo / 速记不带」思路）：capture 走 alias 的独立主题", () => {
    expect(MANIFEST).toContain('android:name=".QuickNoteAlias"');
    expect(MANIFEST).toContain('android:theme="@style/AppTheme.NoActionBarLaunchNoLogo"');
    // lakexlocalnotes://quick-note 只由 alias 接；MainActivity 保留普通 launcher / 分享入口
    expect((MANIFEST.match(/android:host="quick-note"/g) ?? [])).toHaveLength(1);
    expect(SHORTCUTS).toContain('android:targetClass="com.lakexlocalnotes.android.QuickNoteAlias"');
    expect(ANDROID_STYLES).toContain("AppTheme.NoActionBarLaunchNoLogo");
    // 261120 用户点单：普通启动也**不再显示图标** —— 原 launcher 图标的薄荷背景层就是
    // 「绿色纸片背后的圆形底」；现在普通启动与 capture 的 NoLogo 同口径（品牌只在应用内 Paper Finch 动画出现）。
    expect(ANDROID_STYLES_V31).not.toMatch(/windowSplashScreenAnimatedIcon">@mipmap\//);
    expect((ANDROID_STYLES_V31.match(/@drawable\/launch_splash_none/g) ?? []).length).toBe(2);
  });

  it("写作卡骨架与真实卡片同构（正文/标签/动作行），内核就绪前盖住白卡", () => {
    expect(COMPOSER_SKELETON).toContain("mobile-qn-composer mb-composer-skeleton");
    expect(COMPOSER_SKELETON).toContain("mb-composer-skeleton__actions");
    expect(COMPOSER_SKELETON).toContain("mb-composer-skeleton--bare");
    // 模块已到、内核未就绪的窗口期：同一份骨架盖住卡片（不是启动遮罩，就绪即揭）
    expect(COMPOSER).toContain("mb-composer-skel-cover");
    expect(COMPOSER).toContain("QuickNoteComposerSkeleton bare");
    expect(COMPOSER).toContain('data-capture={draft ? "1" : undefined}');
  });

  // 261111（task-17）：冷启动首帧就并发预取写作卡分包（含内核 chunk），别再等 React 提交后的 effect。
  it("capture 首帧前预取写作卡/内核分包；普通启动不预取，失败静默、不阻塞首帧", () => {
    // 与懒加载壳用**同一个** loader ⇒ 同一模块 / 同一 pending promise（不会多拉一份 chunk）
    expect(MAIN).toMatch(/import \{ loadQuickNoteComposer \} from "\.\/home\/quickNoteComposerLazy"/);
    expect(COMPOSER_LAZY).toMatch(/export function loadQuickNoteComposer/);
    // 只在 initialCapture 时触发（普通启动 / 非原生平台 = 不预取；入口预算与首屏行为不变）
    expect(MAIN).toMatch(/if \(initialCapture\) void loadQuickNoteComposer\(\)\.catch\(\(\) => undefined\)/);
    // 只此一处调用；且不 await（绝不阻塞首帧）
    expect((MAIN.match(/loadQuickNoteComposer\(/g) ?? []).length).toBe(1);
    expect(MAIN).not.toMatch(/await loadQuickNoteComposer/);
    // 时序：同步 hint 判定之后、React 挂载之前起跑
    expect(MAIN.indexOf("readLaunchUrlHint()")).toBeGreaterThan(-1);
    expect(MAIN.indexOf("readLaunchUrlHint()")).toBeLessThan(MAIN.indexOf("loadQuickNoteComposer()"));
    expect(MAIN.indexOf("loadQuickNoteComposer()")).toBeLessThan(MAIN.indexOf("ReactDOM.createRoot"));
  });
});

/**
 * 快捷方式三模式（261119）：「小记」（无参 plain）/「拍照小记」（?src=camera）/「剪切板小记」（?src=clipboard）。
 * 三个模式共用「假单独模块」capture 语义（不主动同步、退出语义不变）；plain 旧路径零变化。
 * 取数/入卡时序全部在懒分包 home/captureModeFlow（mobile-entry 预算：懒分包不许引入口图模块）。
 */
describe("快捷方式三模式接线（261119）", () => {
  it("main.tsx：解析模式传给 MobileApp；initialCapture 判定仍是 isQuickNoteShortcutUrl（旧路径零变化）", () => {
    expect(MAIN).toMatch(/const initialCapture = isQuickNoteShortcutUrl\(launchUrlHint\)/);
    expect(MAIN).toMatch(/const initialCaptureMode = quickNoteShortcutMode\(launchUrlHint\)/);
    expect(MAIN).toMatch(/initialCaptureMode=\{initialCaptureMode\}/);
  });

  it("camera 分支：照片走 captureSeed 草稿通道**替换**旧草稿（261119 用户裁决「都做成替换」，不再 insertFiles 并入）", () => {
    expect(MOBILE_APP, "取数流在懒分包（不进 mobile-entry 静态图）").toMatch(/import\("\.\/home\/captureModeFlow"\)/);
    expect(MOBILE_APP, "总入口 = runCaptureFlow（分支在懒分包里）").toMatch(/m\.runCaptureFlow\(\{/);
    expect(MOBILE_APP, "写作卡就绪 loader = 懒加载壳同一 loader").toMatch(/whenReady: loadQuickNoteComposer/);
    expect(FLOW, "相机必须复用 takeCameraPhoto（取消返回 null 不回退）").toMatch(/takeCameraPhoto\(\)/);
    // 「替换」语义：camera = text 空 + images=[拍照图] 的 captureSeed 种子 —— 与 clipboard 同一条草稿通道
    expect(FLOW, "camera 与 clipboard 同走 captureSeed 草稿通道").toMatch(/input\.setCaptureSeed\(\{ text: "", images: \[image\] \}\)/);
    expect(FLOW, "不再走 initialInsert/insertFiles 的「并入草稿」语义").not.toMatch(/setCaptureInsert|insertFiles/);
    expect(MOBILE_APP, "capture 写作卡不再接 initialInsert（并入通道只剩首页「拍摄」在用）").not.toContain("initialInsert");
    // 取消 = 不落任何种子（旧草稿不动）：只放开挂载走草稿恢复态
    expect(FLOW, "取消/失败不落种子，只放开挂载").toMatch(/onCancel: \(\) => \{[\s\S]{0,200}setSeedReady\(true\)/);
    // 过期会话不注入：isCurrent 由 MobileApp 按代际给出
    expect(FLOW, "取数流要按 isCurrent 代际丢弃迟到结果").toMatch(/isCurrent\?: \(\) => boolean/);
    expect(MOBILE_APP, "MobileApp 给出代际判定").toMatch(/isCurrent: \(\) => captureFlowGenRef\.current === gen/);
    expect(FLOW, "注入时机等 composer 分包就绪（loader 由调用方传入）").toMatch(/input\.whenReady\(\)/);
    // 预算护栏：懒分包不许引入口图模块（共享提升会让 modulepreload 超预算，261119 实测 12→13/14）
    expect(FLOW, "captureModeFlow 不许 import quickNoteComposerLazy").not.toMatch(/quickNoteComposerLazy/);
  });

  it("clipboard 分支：读最新一条剪贴板文本预填；空/非文本 = 短 toast + 草稿恢复态写作卡", () => {
    expect(FLOW).toMatch(/readClipboardText\(\)/);
    expect(FLOW, "文本走 captureSeed 草稿通道预填正文（与 camera 同通道）").toMatch(/input\.setCaptureSeed\(\{ text, images: \[\] \}\)/);
    expect(FLOW, "空/非文本给可见提示").toContain("剪贴板没有可用的文本");
    // 取数落定前不挂写作卡（空结果/取消由取数流收尾放开）
    expect(MOBILE_APP).toMatch(/prefillPendingRef/);
    expect(MOBILE_APP).toMatch(/if \(!prefillPendingRef\.current\) setSeedReady\(true\)/);
    expect(MOBILE_APP, "camera/clipboard 取数落定前不挂写作卡（不空挂内核再重挂）").toMatch(/prefillPendingRef\.current = mode !== "plain"/);
    expect(MOBILE_APP).toMatch(/setSeedReady\(mode === "plain"\)/);
  });

  it("三模式共用「假单独模块」capture 语义（不主动同步、退出语义不变），取数流每触发只跑一次", () => {
    expect(MOBILE_APP, "三个模式都记 capture 会话（手动退出直接退 App）").toMatch(/captureLaunchedRef\.current = true/);
    expect(MOBILE_APP, "冷启动订阅仍按 initialCapture 跳过冷读").toMatch(/skipColdRead:\s*initialCapture/);
    expect(MOBILE_APP, "plain 模式不进取数流（旧语义零变化）").toMatch(/if \(mode === "plain"\) return;/);
    // 只有「快捷入口触发 / 冷启动」两处起流；保存后连记、取消都不自动再取（不再自动弹相机）
    expect((MOBILE_APP.match(/startCaptureFlow\(/g) ?? []).length, "取数流只在触发与冷启动两处起（保存/取消不得再取）").toBe(2);
  });

  it("shortcuts.xml 三块从上到下 = 拍照小记 / 剪切板小记 / 新建小记（旧块逐字不动只挪位），data URI 带 query", () => {
    // <shortcut> 块顺序即显示顺序（261119 顺序定稿）
    const order = [
      SHORTCUTS.indexOf('android:shortcutId="quick-note-camera"'),
      SHORTCUTS.indexOf('android:shortcutId="quick-note-clipboard"'),
      SHORTCUTS.indexOf('android:shortcutId="quick-note"'),
    ];
    expect(order.every((idx) => idx > -1), "三项都在").toBe(true);
    expect(order, "顺序 = camera / clipboard / quick-note").toEqual([...order].sort((a, b) => a - b));
    expect(SHORTCUTS).toContain('android:shortcutId="quick-note"');
    expect(SHORTCUTS).toContain('android:shortcutId="quick-note-camera"');
    expect(SHORTCUTS).toContain('android:shortcutId="quick-note-clipboard"');
    expect(SHORTCUTS).toContain('android:data="lakexlocalnotes://quick-note"');
    expect(SHORTCUTS).toContain('android:data="lakexlocalnotes://quick-note?src=camera"');
    expect(SHORTCUTS).toContain('android:data="lakexlocalnotes://quick-note?src=clipboard"');
    // 旧「小记」深链只此一份（无 query）；query URI 不影响 intent-filter 的 scheme+host 匹配
    expect(SHORTCUTS.split('android:data="lakexlocalnotes://quick-note"').length - 1).toBe(1);
  });
});
