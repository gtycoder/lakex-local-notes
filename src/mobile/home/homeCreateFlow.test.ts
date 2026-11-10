/**
 * 首页新建流护栏（261014 用户点单）——**源码级**断言（与 quickNoteCapturePath / quickNoteNoteUi 同套路）：
 *
 * 这一批改的是"入口长什么样、点了之后去哪"，jsdom 里起不了内核、也量不到手势，
 * 所以把**结构事实**钉住（顺序、动作分派、通道），行为细节交给纯函数单测（ui/createPress.test.ts）与设备走查。
 *
 * 盯住六条：
 *  1. 冷启动默认落在「小记」tab；
 *  2. 261110 改版：底部 **五格 Dock**（小记/知识库/日记/AI/标签）+ 中央悬浮「＋」；顶栏 = 设置 | 空间标题 | 空间内动作 + 搜索 + **云同步（恒可见、恒最右）**；
 *  3. 空间切换只在 Dock（单一来源 HOME_TABS），左右横滑仍是同一个分页容器；
 *  4. 新建面板 = 图 3 那两组（261110 起七项，含「日记」），**没有模板、没有 OCR 识图**（我们没有该能力）；
 *  5. 拍摄/图片 → 内核 insertFiles 通道；待办 → 内核 taskList 命令；空白文档 → 只选**已有**笔记本；
 *  6. 「＋」的长按/上滑判定走纯函数，且**长按不误建**（不上滑松手 = 取消）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
/**
 * 去掉注释，避免"注释里提到某名字"误判。
 * ⚠️ **只剥 JSDoc 块（/ ** … * /）与整行注释**，不剥任意块注释：
 * 本批代码里有 accept="image/*" 这类**字符串里的斜杠星号**，通用块注释正则会从那里一路吃到下一个
 * 结束符，把整段代码静默删掉 ⇒ 断言会以"代码似乎没写"的形式假失败
 * （与 AGENTS §7.25 的探针假阴性同一类坑）。
 */
const code = (src: string) => src.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const HOME = code(read("./HomePage.tsx"));
const SHEET = code(read("../ui/CreateSheet.tsx"));
const COMPOSER = code(read("./QuickNoteComposer.tsx"));
const MOBILE_APP = code(read("../MobileApp.tsx"));
const PRESS = code(read("../ui/createPress.ts"));
const CSS = code(read("../mobile.css"));
/** 分页状态机（纯函数 + DOM 适配层）：判据不再写在 HomePage 里。 */
const TAB_PAGER = code(read("./tabPager.ts"));
const PAGER = code(read("./useTabPager.ts"));

describe("首页新建流（261014）", () => {
  it("从工作区回到首页会刷新列表（261020：新建/编辑后笔记本计数不能停在旧值）", () => {
    // 首页是 keep-alive 常驻层：只在冷启动 refreshAll 的话，回首页后计数/最近文档是旧的。
    expect(MOBILE_APP).toContain("prevRouteKindRef");
    expect(MOBILE_APP).toMatch(/prev === "notebook" && route\.kind === "home"/);
    expect(MOBILE_APP).toMatch(/route\.kind === "home"\) void refreshAll\(\)/);
  });

  it("冷启动默认进「小记」（261110：落点改为读设置项「默认空间」，其默认值仍是小记）", () => {
    // 落点判据在 settings/defaultSpace（可选值取 HOME_TABS）；本文件只钉"不再写死 tab"。
    expect(MOBILE_APP).toMatch(/useState<Route>\(\(\) => \(\{ kind: "home", tab: readDefaultHomeTab\(\) \}\)\)/);
    expect(MOBILE_APP).toContain('import { readDefaultHomeTab } from "./settings/defaultSpace"');
  });

  it("底部 Dock = 五格空间（HOME_TABS 单一来源）；＋ 是 Dock 外的中央悬浮按钮", () => {
    const dock = HOME.slice(HOME.indexOf('aria-label="空间"'), HOME.indexOf("</nav>"));
    expect(dock.length).toBeGreaterThan(0);
    expect(HOME).toContain("HOME_TABS.map((id)");
    expect(HOME).toContain("HOME_TAB_META[id]");
    // 搜索 / ＋ / 同步都不在 Dock 格子里（分别去了顶栏与悬浮按钮）
    expect(dock).not.toContain("<Search");
    expect(dock).not.toContain("<Plus");
    expect(dock).not.toContain("立即同步");
    // ＋ = 悬浮按钮（Dock 的兄弟节点），带长按上滑速记的 aria 说明
    expect(HOME).toContain("mb-home-fab");
    expect(HOME).toMatch(/aria-label="新建（长按上滑可速记）"/);
  });

  it("顶栏：设置 | 当前空间标题 | 空间内动作 + 搜索 + 云同步（同步恒在最右、任何空间都可见）", () => {
    const header = HOME.slice(HOME.indexOf("<header"), HOME.indexOf("</header>"));
    expect(header).toContain("mobile-topbar--home");
    expect(header).toContain("mobile-topbar-group--start");
    expect(header).toContain("mobile-topbar-group--center");
    expect(header).toContain("mobile-topbar-group--end");
    // 顺序：设置 → 空间标题 → 排序/视图 → 搜索 → 云同步（云同步恒最后）
    const order = ['aria-label="设置"', "mobile-home-space-title", 'aria-label="排序"', 'aria-label="搜索"', "aria-label={syncProgress"];
    let last = -1;
    for (const label of order) {
      const at = header.indexOf(label);
      expect(at, label + " 应出现在顶栏且顺序正确").toBeGreaterThan(last);
      last = at;
    }
    expect(header).toContain('"立即同步"');
    // 云同步是顶栏最后一个按钮（用户 261110：必须始终可见，不收起）
    const cloud = header.indexOf("aria-label={syncProgress");
    expect(header.slice(cloud, header.indexOf("</header>"))).not.toContain("toolbar__button");
    expect(header).toContain("setFilterOpen");
    expect(header).toContain("toggleView");
  });

  it("空间顺序单一来源：HOME_TABS = 小记 / 知识库 / 日记 / AI / 标签（Dock 与分页同源）", () => {
    expect(TAB_PAGER).toContain('export const HOME_TABS = ["quick", "library", "diary", "ai", "tags"] as const;');
    expect(HOME).toContain("HOME_TABS.map((id)");
  });

  it("Dock 几何：五列等分 + 标签 nowrap/省略 + FAB 圆形", () => {
    expect(CSS).toMatch(/\.mb-home-dock\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
    expect(CSS).toMatch(/\.mb-home-dock__label\s*\{[^}]*white-space:\s*nowrap/);
    expect(CSS).toMatch(/\.mb-home-fab\s*\{[^}]*border-radius:\s*50%/);
  });

  it("同步进行中渲染可视进度条（P0-6）：条 + 阶段文案 + 百分比，读索引阶段走不确定态", () => {
    expect(HOME).toContain("mobile-sync-strip");
    expect(HOME).toContain("mobile-sync-strip__bar");
    expect(HOME).toContain("describeSyncProgress(syncProgress)");
    expect(HOME).toContain("is-indeterminate");
    expect(HOME).not.toContain("alert(");
  });

  it("首页用底部 Dock + 悬浮＋；AI 内嵌为第 4 格分页（不再全屏路由）", () => {
    expect(HOME).toContain("mb-home-dock");
    expect(HOME).toContain("mb-home-fab");
    expect(HOME).toContain("<MobileAiPage open embedded");
    // AI 从全屏路由下线：MobileApp 不再 import 页组件，改由首页内嵌；首页给回写刷新回调
    expect(MOBILE_APP).not.toContain("MobileAiPage");
    expect(MOBILE_APP).toContain("onAiChanged");
  });

  it("「＋」是统一加号（悬浮 FAB），并给出新建面板入口", () => {
    expect(HOME).not.toContain("FolderPlus");
    // 长按上滑速记的 aria 说明挂在 FAB 上；图标是统一的 Plus
    expect(HOME).toMatch(/aria-label="新建（长按上滑可速记）"[\s\S]{0,500}<Plus size=\{24\}/);
    expect(HOME).toMatch(/<CreateSheet open=\{createOpen\}/);
  });

  it("新建面板 = 两组六项；无模板、无 OCR", () => {
    const ids = [...SHEET.matchAll(/id: "([a-z-]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["blank-quick", "camera", "image", "todo", "blank-doc", "notebook", "diary"]);
    expect(SHEET).not.toMatch(/ocr/i);
    expect(SHEET).not.toMatch(/模板/);
    expect(SHEET).toMatch(/新建小记/);
    expect(SHEET).toMatch(/文档与知识库/);
  });

  it("拍摄/图片走取文件 → 内核 insertFiles；待办走内核命令；空白文档只选已有笔记本", () => {
    expect(HOME).toMatch(/pickLocalFile\("image\/\*", "environment"\)/);
    expect(HOME).toMatch(/pickLocalFile\("image\/\*"\)/);
    expect(HOME).toMatch(/command: "taskList"/);
    expect(HOME).toMatch(/initialInsert=\{composer\.mode === "new"/);
    // 261017/261022：统一走结构化命令入口（renderer 缺失时回退实例 execCommand，失败可见）
    expect(COMPOSER).toMatch(/execEditorCommandResult\(editorInstance, "insertFiles"/);
    expect(COMPOSER).toMatch(/execEditorCommandResult\(editorInstance, pending\.command\)/);
    expect(HOME).toMatch(/onCreateNote\(it\.id\)/);
    expect(HOME).toMatch(/notebooks\.map/);
  });

  it("悬浮＋：短按开新建面板，长按 260ms + 上滑 = 速记（判据走纯函数；长按不上滑松手 = 取消）", () => {
    const fabStart = HOME.indexOf('className={"mb-home-fab"');
    expect(fabStart).toBeGreaterThan(0);
    const fab = HOME.slice(fabStart, HOME.indexOf("</button>", fabStart));
    expect(fab).toMatch(/onPointerDown=\{onPressDown\}/);
    expect(fab).toContain("mb-home-fab__tip");
    // 手势不能"捕获指针"：捕获会把随后的 click 重定向到按钮本身（261014 实测踩过）。
    expect(fab).not.toContain("setPointerCapture");
    expect(HOME).not.toContain("setPointerCapture");
    expect(HOME).toMatch(/blockPressRelease\(\{ revealed: createPressRevealed\(elapsed\), dy \}\)/);
    expect(HOME).toMatch(/CREATE_LONG_PRESS_MS/);
    expect(PRESS).toMatch(/export function blockPressRelease/);
  });

  it("小记 / 知识库 / 标签 = 原生横向分页（跟手 + 松手吸附；写作会话锁横滑）", () => {
    // 三页常驻在同一个横向滚动容器里（手指拖动时相邻页同时可见）——不是"按 tab 条件渲染 + 手写横滑"。
    // 261110：五页（小记/知识库/日记/AI/标签），分页判据仍是同一套纯函数（count 参数控制页数）。
    expect((HOME.match(/className="mobile-tab-pane[ "]/g) || []).length).toBe(5); // 261109 +日记；261110 +AI（带修饰类）
    expect(HOME).toContain("<TagsHomeTab");
    expect(HOME).not.toContain("useHorizontalSwipe");
    expect(HOME).not.toMatch(/key=\{tab\}/);
    // 分页判据/状态机 = 纯函数单一来源（home/tabPager 的 reducePager + 单测 tabPager.test.ts），
    // HomePage 只接线；四份 ref 镜像（interacting/commitByScroll/programmatic/timer）与 alignStage 已删除。
    expect(TAB_PAGER).toContain("export function reducePager");
    expect(PAGER).toContain("reducePager(");
    expect(HOME).toContain("useTabPager({ tab, onTabChange })");
    for (const dead of ["interactingRef", "commitByScrollRef", "programmaticRef", "programmaticTimerRef", "alignStage", "settledIndex(", "pagerScrollLeft("]) {
      expect(HOME, "HomePage 不再自己做分页判据：" + dead).not.toContain(dead);
    }
    // DOM 只负责 scrollTo；过半回写由 reducer 的 commitTab 给出（不等 scrollend）。
    expect(PAGER).toMatch(/el\.scrollTo\(\{ left: effect\.scrollLeft/);
    expect(PAGER).toContain('addEventListener("scroll", onScroll');
    expect(PAGER).toContain('addEventListener("touchstart", onTouchStart');
    expect(PAGER).toContain("onTabChangeRef.current(transition.commitTab)");
    // 定时器只剩"没有 scrollend 的老 WebView"的单次兜底：有 scrollend 时一个都不挂（旧的 600ms 常驻定时器已删）。
    expect(PAGER).toContain('"onscrollend" in window');
    expect(PAGER.match(/setTimeout\(/g) || []).toHaveLength(1);
    // 写作/编辑小记期间锁横滑（否则父级 [tab] effect 清掉写作卡 = 丢草稿）
    expect(HOME).toMatch(/composer !== null \? " mobile-tab-stage--locked" : ""/);
    // 舞台 = 原生横向滚动 + 吸附；锁定态只留纵向滚动
    expect(CSS).toMatch(/\.mobile-tab-stage\s*\{[^}]*overflow-x:\s*auto/);
    expect(CSS).toMatch(/scroll-snap-type:\s*x mandatory/);
    expect(CSS).toMatch(/\.mobile-tab-pane\s*\{[^}]*scroll-snap-align:\s*start/);
    // 锁定必须"双保险"：舞台收掉横向滚动（内层竖滚的 hand-off 会绕过 touch-action）+ 内层也只留 pan-y
    expect(CSS).toMatch(/\.mobile-tab-stage--locked\s*\{[^}]*overflow-x:\s*hidden/);
    expect(CSS).toMatch(/\.mobile-tab-stage--locked \.mobile-scroll\s*\{[^}]*touch-action:\s*pan-y/);
  });

  it("桌面图标快捷 capture 那条路没被动（仍是独立入口）", () => {
    expect(MOBILE_APP).toMatch(/captureLaunchedRef/);
    expect(MOBILE_APP).toMatch(/setCaptureOpen\(true\)/);
  });

  it("新建面板第三格 =「日记」：默认今天、幂等打开（同一天点两次不会建两篇）", () => {
    // 面板唯一来源（CreateSheet）：文档与知识库组里出现 diary 格
    expect(SHEET).toContain('{ id: "diary", label: "日记"');
    // 分派：默认今天 + 幂等（不是 mode:"new"）
    expect(HOME).toContain("bridge.diaryOpenDate(formatDiaryDateKey())");
    expect(HOME).not.toContain('formatDiaryDateKey(), "new"');
    // 打开后直接进工作区编辑态
    expect(HOME).toContain('mode: "editor"');
  });
});