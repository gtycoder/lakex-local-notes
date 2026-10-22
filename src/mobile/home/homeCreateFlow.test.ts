/**
 * 首页新建流护栏（261014 用户点单）——**源码级**断言（与 quickNoteCapturePath / quickNoteNoteUi 同套路）：
 *
 * 这一批改的是"入口长什么样、点了之后去哪"，jsdom 里起不了内核、也量不到手势，
 * 所以把**结构事实**钉住（顺序、动作分派、通道），行为细节交给纯函数单测（ui/createPress.test.ts）与设备走查。
 *
 * 盯住六条：
 *  1. 冷启动默认落在「小记」tab；
 *  2. 首页胶囊 = 搜索 | ＋ | 排序/视图 | AI | 云同步，且**云同步恒在最右**；
 *  3. 排序/视图**不再挂在顶栏**（已下移），顶栏留等宽空槽保持 tab 居中；
 *  4. 新建面板 = 图 3 那两组六项，**没有模板、没有 OCR 识图**（我们没有该能力）；
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

describe("首页新建流（261014）", () => {
  it("从工作区回到首页会刷新列表（261020：新建/编辑后笔记本计数不能停在旧值）", () => {
    // 首页是 keep-alive 常驻层：只在冷启动 refreshAll 的话，回首页后计数/最近文档是旧的。
    expect(MOBILE_APP).toContain("prevRouteKindRef");
    expect(MOBILE_APP).toMatch(/prev === "notebook" && route\.kind === "home"/);
    expect(MOBILE_APP).toMatch(/route\.kind === "home"\) void refreshAll\(\)/);
  });

  it("冷启动默认进「小记」", () => {
    expect(MOBILE_APP).toMatch(/useState<Route>\(\{ kind: "home", tab: "quick" \}\)/);
  });

  it("胶囊 = 搜索 | ＋ | AI（排序/视图 与 云同步都不在胶囊里）", () => {
    const nav = HOME.slice(HOME.indexOf('aria-label="首页操作"'), HOME.indexOf("</nav>"));
    expect(nav.length).toBeGreaterThan(0);
    const order = ['aria-label="搜索"', 'aria-label="新建"', 'aria-label="AI 助手"'];
    let last = -1;
    for (const label of order) {
      const at = nav.indexOf(label);
      expect(at, label + " 应出现在胶囊里且顺序正确").toBeGreaterThan(last);
      last = at;
    }
    // AI 是胶囊最后一个（也是唯一另一个）按钮；排序/视图与云同步都不在这里
    const ai = nav.indexOf('aria-label="AI 助手"');
    expect(nav.slice(ai)).not.toContain("mobile-bottom-bar__item");
    expect(nav).not.toContain('aria-label="立即同步"');
    expect(nav).not.toContain('aria-label="排序"');
  });

  it("排序/视图 + 云同步**固定挂在顶栏右上角**，云同步恒在最右，tab 仍居中", () => {
    const header = HOME.slice(HOME.indexOf("<header"), HOME.indexOf("</header>"));
    const order = ['aria-label="设置"', "mobile-home-tabs", 'aria-label="排序"', 'aria-label="立即同步"'];
    let last = -1;
    for (const label of order) {
      const at = header.indexOf(label);
      expect(at, label + " 应出现在顶栏且顺序正确").toBeGreaterThan(last);
      last = at;
    }
    // 云同步是顶栏最后一个按钮
    const cloud = header.indexOf('aria-label="立即同步"');
    expect(header.slice(cloud, header.indexOf("</header>"))).not.toContain("toolbar__button");
    // 左侧等宽空槽（右两枚 ⇒ 左补一格，tab 才居中）
    expect(header).toContain("mobile-topbar-gap");
    expect(header).toContain("setFilterOpen");
    expect(header).toContain("toggleView");
  });

  it("首页胶囊用收窄变体（3 项紧凑宽度），冷启动骨架同步", () => {
    expect(HOME).toContain("mobile-bottom-bar--home");
    expect(MOBILE_APP).toContain("mobile-bottom-bar--home");
  });

  it("「＋」是统一加号（不再按 tab 换图标），并给出新建面板入口", () => {
    expect(HOME).not.toContain("FolderPlus");
    expect(HOME).toMatch(/aria-label="新建"[\s\S]{0,900}<Plus \/>/);
    expect(HOME).toMatch(/<CreateSheet open=\{createOpen\}/);
  });

  it("新建面板 = 两组六项；无模板、无 OCR", () => {
    const ids = [...SHEET.matchAll(/id: "([a-z-]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["blank-quick", "camera", "image", "todo", "blank-doc", "notebook"]);
    expect(SHEET).not.toMatch(/ocr/i);
    expect(SHEET).not.toMatch(/模板/);
    expect(SHEET).toMatch(/新建小记/);
    expect(SHEET).toMatch(/新建文档知识库/);
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

  it("整块触发：手势挂在整条胶囊上（不是只挂 ＋），长按不上滑松手 = 取消（不误建）", () => {
    const nav = HOME.slice(HOME.indexOf('aria-label="首页操作"'), HOME.indexOf("</nav>"));
    expect(nav.length).toBeGreaterThan(0);
    expect(nav).toMatch(/onPointerDown=\{onPressDown\}/);
    expect(nav).toContain("mobile-block-quick");
    // 手势不能在胶囊上"捕获指针"：捕获会把随后的 click 重定向到胶囊本身，条目自己的 onClick 就再也不触发（261014 实测踩过）。
    expect(nav).not.toContain("setPointerCapture");
    expect(HOME).not.toContain("setPointerCapture");
    expect(HOME).toMatch(/blockPressRelease\(\{ revealed: createPressRevealed\(elapsed\), dy \}\)/);
    expect(HOME).toMatch(/CREATE_LONG_PRESS_MS/);
    expect(PRESS).toMatch(/export function blockPressRelease/);
  });

  it("小记 ↔ 知识库 = 原生横向分页（跟手 + 松手吸附；写作会话锁横滑）", () => {
    // 两页常驻在同一个横向滚动容器里（手指拖动时两页同时可见）——不是"按 tab 条件渲染 + 手写横滑"
    expect((HOME.match(/className="mobile-tab-pane"/g) || []).length).toBe(2);
    expect(HOME).not.toContain("useHorizontalSwipe");
    expect(HOME).not.toMatch(/key=\{tab\}/);
    // 分页判据 = 纯函数单一来源（home/tabPager），HomePage 只做接线
    expect(HOME).toMatch(/settledIndex\(el\.scrollLeft/);
    expect(HOME).toMatch(/pagerScrollLeft\(tabIndexRef\.current/);
    // 标签跟随：**过半即回写**（不能等 scrollend，否则会短暂"页是新的、标签还是旧的"）+ 触摸期间不做程序化对齐
    expect(HOME).toContain('addEventListener("scroll", commit');
    expect(HOME).toContain("interactingRef.current = true");
    expect(HOME).toMatch(/alignStage[\s\S]{0,120}interactingRef\.current\) return/);
    // 程序化滚动（点 tab / 宽度重对齐）期间的 scroll 事件不能回写 tab，否则动画开头会把标签弹回旧页
    expect(HOME).toContain("programmaticRef.current = true");
    expect(HOME).toMatch(/if \(programmaticRef\.current\) return/);
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
});
