/**
 * 移动端 261110 三处宿主接线（源码护栏；行为侧在 diary/diaryPage.render.test.tsx 与
 * data/diaryRepository.test.ts 里逐条覆盖）：
 *  · ① 知识库列表**不出现回收站笔记本**：判据取 core 的 TRASH_NOTEBOOK_ID（不写字面量），只过滤渲染；
 *  · ② 冷启动落点 = 设置项「默认空间」（settings/defaultSpace）；
 *  · ③ 从日记打开的文档，关闭/返回后回「日记」页签（页面返回与安卓返回键都收敛到
 *     useRouteTransition 的 onClosed ⇒ 来源只记一处）；
 *  · ④ 「取消日记标记（整本）」：写路径只在 data 层（bridge.clearDiaryMark → runWrite），页面只做确认。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
/** 去注释版：断言"源码里没有写字面量"时必须排除说明文字。 */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const APP = code(read("src/mobile/MobileApp.tsx"));
const LIBRARY = code(read("src/mobile/notebook/libraryNotebooks.ts"));
const BRIDGE = code(read("src/mobile/bridge/diary.ts"));
const PAGE = code(read("src/mobile/diary/DiaryPage.tsx"));

describe("知识库不显示回收站/日记本（261110；261109 收尾抽成纯函数）", () => {
  it("MobileApp 调纯函数 libraryNotebooks，不在组件里重写过滤判据", () => {
    expect(APP).toContain("libraryNotebooks(treeNodes)");
    // 硬编码 id 会把「回收站」这条持久化契约在移动端复制第二份。
    expect(APP).not.toContain("notebook-trash");
  });

  it("判据来自 core：TRASH_NOTEBOOK_ID（回收站）+ withoutDiaryNotebook（日记本），且不写死字面量", () => {
    expect(LIBRARY).toContain("TRASH_NOTEBOOK_ID");
    expect(LIBRARY).toMatch(/from "\.\.\/\.\.\/core\/syncDecisions(\.js)?"/);
    expect(LIBRARY).toContain("withoutDiaryNotebook");
    expect(LIBRARY).not.toContain("notebook-trash");
  });

  it("只过滤渲染（notebooks 列表），不动 treeNodes 存储/同步", () => {
    // 过滤后的 notebooks 只喂渲染；treeNodes 本身没有被原地改写。
    expect(LIBRARY).toContain("filter(");
    expect(APP).not.toMatch(/treeNodes\s*=\s*treeNodes\.filter/);
    expect(LIBRARY).not.toMatch(/treeNodes\s*=\s*treeNodes\.filter/);
  });
});

describe("冷启动落点 = 设置项「默认空间」（261110）", () => {
  it("初始 route 读 readDefaultHomeTab（不再写死小记），设置页有对应行", () => {
    expect(APP).toContain("readDefaultHomeTab");
    expect(APP).toMatch(/useState<Route>\(\(\) => \(\{ kind: "home", tab: readDefaultHomeTab\(\) \}\)\)/);
    const DRAWER = read("src/mobile/settings/SettingsDrawer.tsx");
    expect(DRAWER).toContain('itemId="editor-default-space"');
    expect(DRAWER).toContain("DEFAULT_SPACE_OPTIONS");
    expect(DRAWER).toContain("writeDefaultHomeTab");
  });
});

describe("从日记打开文档：返回回日记页签（261110）", () => {
  it("来源 tab 记录 + onClosed 回来源；首页常驻层的 tab 也取来源页", () => {
    expect(APP).toContain("workspaceOriginTabRef");
    // 关闭回来源（其余入口仍是既有「知识库」落点）
    expect(APP).toMatch(/setRoute\(\{ kind: "home", tab: origin \?\? "library" \}\)/);
    // 从日记进入时记 diary
    const diaryOpen = APP.slice(APP.indexOf("const openDiaryEntry"), APP.indexOf("const openDiaryEntry") + 700);
    expect(diaryOpen).toContain('workspaceOriginTabRef.current = "diary"');
    // 首页（工作区下层的常驻层）tab 也取来源页，返回时不闪一下知识库
    expect(APP).toMatch(/const homeTab: HomeTab = route\.kind === "home" \? route\.tab : \(workspaceOriginTabRef\.current \?\? "library"\)/);
    // 两条返回路径都收敛到同一个 close：安卓返回键走 requestWorkspaceBack（找不到 handler 时 → closeWorkspace）
    expect(APP).toMatch(/onBackFromNotebook: requestWorkspaceBack/);
    expect(APP).toContain("if (handler) void handler();");
    expect(APP).toContain("else closeWorkspace();");
  });
});

describe("取消日记标记（整本）= 数据层单一写路径（261110 收尾）", () => {
  it("bridge.clearDiaryMark 走写域；页面 ⋯ 菜单调它（不自己写 SQL）", () => {
    expect(BRIDGE).toContain("clearDiaryMark");
    expect(BRIDGE).toContain('runWrite("clearDiaryMark"');
    expect(PAGE).toContain("bridge.clearDiaryMark(");
    // 整本动作必须二次确认（数据保留，但结构变化）
    expect(PAGE).toContain("取消日记标记（整本）");
    expect(PAGE).toContain("confirmMobile");
    // 判据/写入在 data 层，页面不拼 SQL
    expect(PAGE).not.toContain("UPDATE folders");
  });
});

describe("日记新建链路 = mode 传到 core 的 plan（261110）", () => {
  it("bridge 带 mode（默认 open）并透传给 data 层；页面：＋/日历 = new，主按钮 = open", () => {
    expect(BRIDGE).toContain("diaryOpenDate(dateKey: string, mode: DiaryOpenMode = \"open\")");
    expect(BRIDGE).toContain("ensureDiaryNote(d, dateKey, mode)");
    expect(PAGE).toContain('openDate(todayKey, "open"');
    expect(PAGE).toContain('openDate(todayKey, "new"');
    expect(PAGE).toMatch(/openDate\(dateKey, "new"/);
    // 连点防重：在途守卫（同一时刻只允许一次写请求）
    expect(PAGE).toContain("openingRef.current");
  });
});
