/**
 * 画板编辑器挂载/路由护栏（260920）。
 *
 * vitest 是 node 环境，起不了 Canvas/DOM 画布；用源码级断言锁死四条易回归的集成约束
 * （与 sheetEditorMount.test.ts / bitableEditorMount.test.ts 同套路）：
 * - MultiTabEditor 必须按 kind 路由到 BoardEditor（否则画板 JSON 会被 Lake 编辑器打开 = 毁正文）；
 * - BoardEditor 不引用 Lake 内核（零内核实例是这个 kind 的存在理由）；
 * - previewImage / cardHeight 绝不写进正文（那是卡片专用字段，实测占带画板文档 90%+ 体积）；
 * - 只读态不自动保存；自动保存有防抖 + 与上次序列化比较。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const EDITOR = readFileSync(new URL("./BoardEditor.tsx", import.meta.url), "utf8");
const TABS = readFileSync(new URL("../editor/MultiTabEditor.tsx", import.meta.url), "utf8");
const DOC = readFileSync(new URL("../../core/boardDoc.ts", import.meta.url), "utf8");
const STORE = readFileSync(new URL("../../../electron/store.ts", import.meta.url), "utf8");
const KINDS = readFileSync(new URL("../../core/noteKind.ts", import.meta.url), "utf8");
const MOBILE_VIEWER = readFileSync(new URL("../../mobile/board/MobileBoardViewer.tsx", import.meta.url), "utf8");
const MOBILE_WORKSPACE = readFileSync(new URL("../../mobile/notebook/NotebookWorkspace.tsx", import.meta.url), "utf8");
const IMAGE_ASSETS = readFileSync(new URL("./boardImageAssets.ts", import.meta.url), "utf8");

describe("画板编辑器护栏", () => {
  it("MultiTabEditor 按 kind=board 懒加载 BoardEditor", () => {
    expect(TABS).toMatch(/tab\.kind === "board"/);
    expect(TABS).toMatch(/import\("\.\.\/board\/BoardEditor"\)/);
    expect(TABS).toMatch(/<BoardEditor/);
  });

  it("只读（锁定）必须封死画板写入：运行中同步 plait options.readonly + 宿主兜底", () => {
    // 260930 用户报「画板锁定后还能编辑、思维导图还能加节点」——只隐藏工具栏不够。
    // plait-core / plait-mind 按 board.options.readonly 判定 ⇒ 锁定那一刻必须把它同步过去。
    const CORE = readFileSync(new URL("../../../vendor/lakex-doc-react/src/cards/DrawingBoard/DrawnixBoardCore.tsx", import.meta.url), "utf8");
    expect(CORE).toMatch(/React\.useEffect\(\(\) => \{\s*if \(board\) board\.options\.readonly = !!readOnly;\s*\}, \[board, readOnly\]\)/);
    const start = EDITOR.indexOf("const handleCoreChange");
    const end = EDITOR.indexOf("return (", start);
    expect(EDITOR.slice(start, end)).toContain("if (readOnlyRef.current) return;");
  });

  it("BoardEditor 不引用 Lake 内核（独立画板 = 零内核实例）", () => {
    expect(EDITOR).not.toMatch(/from "\.\.\/editor\/EditorTab"/);
    expect(EDITOR).not.toMatch(/lakeRuntime|createLakeDocument|EditorTab/);
    expect(EDITOR).toMatch(/DrawnixBoardCore/);
  });

  it("正文只存场景 + 视口：previewImage / cardHeight 不落盘", () => {
    expect(EDITOR).not.toMatch(/previewImage:/);
    expect(EDITOR).not.toMatch(/cardHeight:/);
    expect(DOC).toMatch(/elements: unknown\[\]/);
    expect(DOC).toMatch(/export function boardToBody/);
  });

  it("只读态不自动保存，自动保存有防抖 + 与上次序列化比较", () => {
    expect(EDITOR).toMatch(/if \(readOnlyRef\.current\) return;/);
    expect(EDITOR).toMatch(/AUTOSAVE_DEBOUNCE_MS/);
    expect(EDITOR).toMatch(/lastSerializedRef/);
    expect(EDITOR).toMatch(/boardToBody/);
  });

  it("视口被动记录、不回灌 value（pan/zoom 不该触发保存）", () => {
    expect(EDITOR).toMatch(/onViewportPersist/);
    expect(EDITOR).toMatch(/viewportRef\.current/);
    // 真口径：拖动回调里只存 ref / 会话记忆，绝不 setCardValue（回灌 → 每次 pan 都保存，260916 的坑）
    const persistAt = EDITOR.indexOf("onViewportPersist=");
    expect(persistAt).toBeGreaterThan(0);
    expect(EDITOR.slice(persistAt, persistAt + 600)).not.toContain("setCardValue");
  });

  it("视图本机记忆（260926 A1）：位置记本机、重开/重挂时恢复", () => {
    // 打开时：本机记下的优先，其次才是正文里那份（历史遗留的 viewport）
    expect(EDITOR).toMatch(/view\?\.viewport \?\? doc\.viewport \?\? null/);
    expect(EDITOR).toMatch(/writeBoardView\(noteId, \{ viewport \}\)/);
    expect(EDITOR).toMatch(/readBoardView\(noteId\)/);
    // 隐藏 → 显示这一帧把记下的视口对一次给引擎（隐藏期间容器 0 尺寸 / 同步后重载都可能抖回旧值）
    expect(EDITOR).toMatch(/if \(!visible\) return;[\s\S]{0,400}plaitViewport: remembered/);
    // 平移 = 画布容器滚动（内核 onViewportPersist 对平移不触发）⇒ 必须直接盯容器记/放滚动量
    expect(EDITOR).toMatch(/querySelector<HTMLElement>\("\.viewport-container"\)/);
    expect(EDITOR).toMatch(/writeBoardView\(noteId, \{ scroll: \{ left: container\.scrollLeft, top: container\.scrollTop \} \}\)/);
    expect(EDITOR).toMatch(/container\.scrollLeft = remembered\.left;/);
    // 采集必须限定在画板内：挂在 window 上会让应用里任何一次点击都来写一遍
    // （包括刚打开、恢复还没生效的那次 ⇒ 会把记下的位置覆盖成默认位置）
    expect(EDITOR).toMatch(/const onPointerUp = \(event: PointerEvent\) => \{[\s\S]{0,200}host\.contains\(target\)/);
    // 位置只在本机（localStorage，L3）：不进正文、不进 S3
    const STORE = readFileSync(new URL("./boardViewStore.ts", import.meta.url), "utf8");
    expect(STORE).toMatch(/lake-notes-v3\.board-views/);
    expect(STORE).toMatch(/localStorage/);
  });

  it("视图不进正文（260926 B）：保存序列化不再带当前视口 ⇒ 缩放/平移不会标脏文档", () => {
    expect(EDITOR).not.toMatch(/docOf\(forDisk, initialDoc, viewportRef\.current\)/);
    // 序列化只带正文里那份历史 viewport（不再传活视口）
    expect(EDITOR).toMatch(/docOf\(forDisk, initialDoc\.viewport \?\? null\)/);
  });

  it("不跳动（260926 C）：有记下的位置时先藏住画板，贴好滚动位置再显示", () => {
    expect(EDITOR).toMatch(/useState\(\(\) => !initial\.view\?\.scroll\)/);
    expect(EDITOR).toMatch(/board-editor--restoring/);
    expect(EDITOR).toMatch(/setViewReady\(true\)/);
    const CSS = readFileSync(new URL("./boardEditor.css", import.meta.url), "utf8");
    // 隐藏必须**保留盒子**，两个反面教材（260926 实测）：
    // ① display:none 会让容器塌成 0 尺寸 ⇒ 浏览器钳掉滚动位置（切走再回来变成 0,0 / max,max）；
    // ② visibility:hidden 单用会被内核工具条自己的 `visibility: visible` 顶掉 ⇒ 画笔/箭头/形状三个按钮
    //    切到文档后仍留在页面上（用户 260926 报"永久停留"）。
    // 261005 起「贴位置」过渡态也并入 tabs.css 的共享隐藏规则（见下面 TABS 断言），本文件不再自带隐藏声明。
    // 只查**声明**（注释里提到 content-visibility 是反面教材，不算）
    expect(CSS).not.toMatch(/content-visibility\s*:\s*hidden\s*;/);
    expect(CSS).not.toMatch(/^\s*visibility: hidden;/m);
    // 261005：切标签的隐藏**统一**走共享规则（tabs.css 的 :is(...):not([data-active])），
    // 画板不再自带 --hidden、也不用 fn__none（同一个语义只能有一套实现）。
    expect(EDITOR).not.toMatch(/board-editor--hidden/);
    expect(EDITOR).toMatch(/data-active=\{\(focused \?\? visible\) \? "true" : undefined\}/);
    const TABS = readFileSync(new URL("../../styles/app/tabs.css", import.meta.url), "utf8");
    // 261005：切标签统一用 opacity+visibility（保留布局尺寸；content-visibility 与网格重叠组合会压掉
    // 活动编辑器的绘制，实测文档/多维表整片空白，勿改回）。
    expect(TABS).toMatch(/:is\([^)]*\.board-editor[^)]*\):not\(\[data-active="true"\]\):not\(\[data-pane-visible="true"\]\),\s*\.board-editor--restoring \{\s*opacity: 0;\s*visibility: hidden;\s*pointer-events: none;\s*\}/);
  });

  it("kind=board 端到端接线：noteKind / 正文目录 / 搜索文本 / 主进程新建", () => {
    expect(KINDS).toMatch(/"board"/);
    expect(STORE).toMatch(/path\.join\(this\.root, "boards", `\$\{id\}\.board\.json`\)/);
    // 搜索文本按 kind 分派：主进程只认 searchTextForKind，具体解析器在共享的 noteSearchText.ts
    // （260928 清掉 store.ts 里已成为死引用的 boardToSearchText/sheetToSearchText/bitableToSearchText）
    expect(STORE).toMatch(/searchTextForKind/);
    expect(readFileSync(new URL("../../core/noteSearchText.ts", import.meta.url), "utf8")).toMatch(/boardToSearchText/);
    expect(STORE).toMatch(/createBoardIn\(/);
  });

  it("移动端：kind=board 走进只读画板查看器（绝不挂 Lake 编辑器、不保存）", () => {
    // 路由：board 分支必须在「非 doc 占位」之前，否则画板会被挡成占位
    expect(MOBILE_WORKSPACE).toMatch(/t\.kind === "board" \? \(/);
    expect(MOBILE_WORKSPACE).toMatch(/<MobileBoardViewer content=\{t\.content\}/);
    // 查看器：只读 + 自适应 + 懒加载同一份引擎分包；不碰 Lake 编辑器/保存
    expect(MOBILE_VIEWER).toMatch(/readOnly/);
    expect(MOBILE_VIEWER).toMatch(/fitOnInit/);
    expect(MOBILE_VIEWER).toMatch(/loadDrawnixBoardCore/);
    expect(MOBILE_VIEWER).not.toMatch(/DocumentEditor|LakeEditor|lakeRuntime|saveNote/);
  });

  it("画板图片走资产管线：内联 data URL 提升为 note-assets 文件 + canonical URL", () => {
    // 复用内核插图同一条通道（不新增 IPC、不动引擎）
    expect(EDITOR).toMatch(/uploadLakeResource/);
    expect(EDITOR).toMatch(/promoteInlineImages/);
    expect(IMAGE_ASSETS).toMatch(/collectInlineImageUrls/);
    expect(IMAGE_ASSETS).toMatch(/replaceInlineImageUrls/);
    // 提升未落地前不保存 ⇒ 正文里永远不会出现 base64 图片
    expect(EDITOR).toMatch(/promoteInFlightRef\.current > 0/);
    // 打开已有画板时先 hydrate（资产 URL → data URL）再 promote（老正文里的内联图自然收敛，不写兼容代码）
    expect(EDITOR).toMatch(/await hydrateBoardAssets\(cardValueRef\.current\.plaitValue\)/);
    expect(EDITOR).toMatch(/await promoteInlineImages\(cardValueRef\.current\.plaitValue\)/);
    // 内存 data URL / 磁盘资产 URL：写盘前用 promotedRef 映射换口径
    expect(EDITOR).toMatch(/replaceInlineImageUrls\(cardValueRef\.current\.plaitValue, promotedRef\.current\)/);
  });

  it("画板 AI：只接内核 ai.generate 钩子，Key 走主进程既有通道，只读不给入口", () => {
    // 内核契约（vendor types）：ai?: { generate(request) => Promise<string|object> }，
    // 请求里给 systemPrompt（画板 JSON 规范）/ contextPrompt（历史+当前画布+本轮需求）/ signal（取消）。
    expect(EDITOR).toMatch(/ai=\{aiConfig\}/);
    // 只读（锁定/回收站）不给 AI 入口 —— 它会往正文落元素，属写操作。
    expect(EDITOR).toMatch(/readOnly \? undefined : \{ generate: aiGenerate \}/);
    // 转给主进程既有的 AI 通道：不新增 IPC、Key 不出主进程。
    expect(EDITOR).toMatch(/runAiChat\(requestId, messages\)/);
    expect(EDITOR).toMatch(/cancelAiChat\(requestId\)/);
    expect(EDITOR).toMatch(/request\.signal\?\.addEventListener\("abort"/);
    // 主进程 ai_chat 入参上限 20 万字符（electron/ipc/registerAi.ts）——超了要给能看懂的提示。
    expect(EDITOR).toMatch(/190_000/);
  });
});
