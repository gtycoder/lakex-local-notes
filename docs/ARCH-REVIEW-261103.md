# ARCH-REVIEW-261103 — 架构评审与目标架构（pad 外壳 / 手写板 ink·PDF / 全局）

> 评审时间 261103；基线 = 分支 `feat/pad-touch-ui`（评审起点 4d4f70f4，评审期间只加了 L1 窗口矩阵装置与两处回归修复）。
> 本文是**结论与提案**，不是实施记录：实施按本文 §4 的阶段独立开工、独立回滚。
> 方法：**3 路只读评审并行**（pad 外壳 / ink·PDF / 全局分层）+ Lead 复核与量化；所有结论带 file:line 或实测数字。
> 局限：未上真机做长时压测（除已有 261102 实测）、移动端 ink 数字为 Node 侧实测 + 2~3× 推算（文中标注）。

## 0. TL;DR

1. **不整体重写**。现有分层（core 纯域 / bridge 数据面 / 两套 UI / editor 适配）是对的：`check:core` 135 文件 0 违规、mobile→electron / →desktop **0** 越界。重写会打掉 S3 v3、编辑器与 3413 例测试换不来收益。
2. **真正要修的是 4 条主线**：
   - **① 判据与外壳状态机**（pad）：判据三份实现 + pad 4 个布尔在 overlay owner 之外 + 1184 行上帝组件 ⇒ 收成「窗口尺寸类 store + 外壳 reducer + 按边界拆件」。
   - **② ink 的「随文档线性恶化」路径**（C1/C2/C3）：撤销 2~4 步、每落一笔整篇序列化 27ms、300 页 15 笔/页撞 16MiB ⇒ v3 紧凑编码 + 操作级撤销 + 序列化移出热路径。
   - **③ 首屏预算量错对象**：护栏只量入口 <script>（78KB gz），**真实首屏 392KB gz**（20 条 modulepreload 另有 176KB gz，bridge chunk 97KB gz 里静态 import 了 Capacitor SQLite）⇒ 预算改「首屏资源图字节」+ SQLite 动态 import。
   - **④ CI 零覆盖**：两个 workflow 都不跑 vitest / dist-mobile 构建 / 预算；560 个测试文件与 53MB 产物全靠人手。
3. **投入**：最小有效集（B 方案）**3~5 人日**；完整目标架构 **15~20 人日**（分 8 段，每段可独立上线）。
4. 本批已落地：**键盘弹起把平板打回 medium 的真回归修复**、**Esc 逐层契约修复**、**窗口矩阵装置 `check:windowsweep`**、`ARCHITECTURE.md` 过期横幅。

## 1. 现状（一句话版）

- 规模：`src/core` 30.4k / `src/mobile` 47.3k / `src/features` 33.9k / `electron` 26.4k / `src/components` 10.5k LOC；测试 560 文件 55.8k LOC / 3413 例（34.9s）。
- 边界（import 图实测）：core 外依赖 0；mobile→electron 0、mobile→desktop 0；mobile→features 36（允许：纯逻辑）；features→desktop 1、components→desktop 1（类型环，Warning）。
- 数据流：UI → `bridge`/`lakeNative` → IPC/Capacitor → SQLite+文件（真相）→ `core/s3v3*` 引擎 → 两端 remote adapter。**这条主线健康，不动。**
- 移动构造：`MobileApp(761) → NotebookWorkspace(1184) → DocumentEditor/各 viewer`；pad 判据在 `pad/formFactor.ts` + 两处 `useFormFactor`。
- 产物：dist-mobile 53MB（assets 44MB，289 个 JS chunk 33MB raw）；入口 JS 78KB gz、CSS 138KB gz；但 **20 条 modulepreload 另有 176KB gz**（见 C-global-1）。

## 2. 问题清单

### A. 平板外壳（pad）

| 级别 | 问题 | 证据 | 影响 |
|---|---|---|---|
| **C1（已修）** | 键盘弹起把外壳打回 medium | `AndroidManifest.xml:19` adjustResize + 旧 `formFactorOf(innerWidth, innerHeight)`；innerHeight 744→~460 < 560 | 1280 平板打字时页签/树/大纲被卸载、手机标题框回来，收键盘再翻回；6 态门禁无键盘态所以没红 |
| **C2** | 面板开合 = 挂载/卸载 | `NotebookWorkspace:849/:1006` vs 手机抽屉常驻 `:1066` | 树滚动/展开/行内重命名状态丢失；手势关闭态无 DOM ⇒ 无跟手预览；入场动画每次重播 |
| W1 | 浮层互斥在平板不成立 | pad 4 bool（`:144-147`）在 `useWorkspaceOverlays` 之外；15 写点/18 派生；Esc 3 个 owner | 树/大纲可与 create/find/tabs/menu 同时开；行为不可测 |
| W2（已修） | Esc 逐层契约是假的 | 旧 `escape` 各分支 return undefined ⇒ hook 恒 preventDefault（`usePadShortcuts.ts:57` 的 defaultPrevented 守卫） | 上一层永远收不到 Esc；当前无可见 bug、新层级必踩 |
| W3 | CSS 双归属 + 顺序依赖 + 门禁看不见 | 9 组 (选择器,属性) 同时写在 `mobile.css:1240-1257` 与 `pad.css`；`ui-metrics.mjs:266-272` 不拆逗号组 ⇒ 全漏检 | pad.css 后加载才「碰巧」对；拆包/排序一变就回潮 |
| W4 | 每键全工作区 reconcile | 内联 handlers → `usePadShortcuts` deps 每渲染变；正文进顶层 `tabs` state（`useNotebookTabs:253-255`）→ 1184 行组件 + 8 个 keep-alive pane 全量重渲；React.memo 0 处 | 长文输入路径上的隐性抖动来源（未 profile，方向明确） |
| W5 | medium 档实质无产物 | pad.css medium 仅 6 规则 + 1 var；编辑器 mount 仍 760（`mobile.css:1252`）vs 内容 `min(92%,1200)`（`pad.css`）；无 medium 快照 | 8 英寸平板/分屏（600–799）实际体验无基线 |
| W6 | 面板 50% 声明没被门禁覆盖 | pad.css 148 条声明中 74 条（.pad-tree/.pad-outline/--pinned）6 态测不到（默认关） | 侧栏改动只靠人工 |
| W7 | 「无前缀规则手机零命中」靠 JSX 不渲染 | 98/148 声明无 `data-form-factor` 前缀 | pad 分支泄漏会直接打手机（当前靠 `{!padTwoPane && …}` 兜） |

### B. 手写板 ink / PDF 导入 / 图片页

| 级别 | 问题 | 证据（实测） | 影响 |
|---|---|---|---|
| **C1** | 撤销在密集页退化 2~4 步 | 每步存整页 before+after（`history.ts:11-12/82-95`，预算 16MiB）：200 笔/页 1476KiB⇒11 步；500⇒4；1000⇒2 | PDF 批注页写满后几乎不能撤销 |
| **C2** | 每成笔/翻页整篇序列化 | 300 页×10 笔 = 10.9MiB；`inkToBody` 26.7ms、parse 30ms；移动保存再付 sha256Sync（1MiB 15.3ms / 8MiB 120ms）+ 整篇过桥 | 每落一笔 ~27ms 主线程（>16.7ms 帧预算）；每次翻页写盘+标脏 ⇒ 下一轮 S3 整篇 PUT |
| **C3** | 300 页约 15 笔/页撞 16MiB，撞到时这一笔直接消失 | `inkDoc.ts:19/391` throw ⇒ `InkPad.tsx:317-329` 序列化失败 return（docRef 不更新、activeStroke 已清） | 有横幅但不进正文；密集批注不可用 |
| C3b | `activePageId` 是本机视图却进正文 | `inkDoc.ts:374-389` + `inkPadWiring.test.ts:219-227` 锁死 | 翻 20 页 = 20 次整篇写盘+同步；与 AGENTS §4「本机视图不进正文」矛盾 |
| W1 | PDF 导入上传阶段零进度 | `pdfImport.ts:138-168` 只有栅格化回调 | UI 冻结在「第 n/N 页」，观感卡死（HANDOFF 已自认） |
| W2 | 取消/失败留孤儿资产；原生 cacheDir 不清理 | `PdfRenderPlugin.kt:87-93` 每次新 uuid 目录不删 | 反复导入累积（300 页≈7–8MB/次） |
| W3 | Android 缩略图对 webp 无效 + 300 页缩略图全挂载 | `AssetServer.kt:306-314` 只认 png/jpg；PDF 页图正是 webp；`InkPageStrip` 无虚拟化 | 预览拉原图×300、DOM+polyline 卡顿 |
| W4 | 移动端无「外部正文刷新」通道 | `InkPad.tsx:126-128` 只在挂载 parse；桌面有 reloadKey、移动 pane key 只有 `t.id` | 同步拉到新正文后仍显示旧内容 |
| W5 | 擦除中 pointercancel 丢笔迹且无 undo | `InkPad.tsx:561-571/630-657` | 来电/系统手势打断 = 笔迹已删、undo 无记录 |
| W6 | 解析整篇全或无 | `inkDoc.ts:286-326` 1 页坏 → 整篇 null | 300 页文档 1 页坏就打不开 |
| W7 | 桌面 ink CSS 9 处 1px 边框（红线是 0.5px）+ 两份 shared.css 漂移 36 行 | `inkPad.shared.css:22,39,106,126,167,180,196,254`；ui-metrics 不校验边框 | 设计系统漂移无人拦 |
| W8 | 原 PDF 永久入库并全端同步，运行时从不读 | `pdfImport.ts:114-121` 只为插件从磁盘读 + 防孤儿 | 页图 7–8MB + 原 PDF（≤100MiB）进 S3 |

### C. 全局（分层 / 状态 / 构建 / 测试）

| 级别 | 问题 | 证据 | 影响 |
|---|---|---|---|
| **C1** | 首屏预算量错对象 | `check-bundle-budget.mjs:48-50,65` 只量入口 script + preload 条数；实测首屏 = 78KB + 176KB preload + 138KB CSS ≈ **392KB gz**；最大 preload `bridge-*.js` 97KB gz（`MobileApp.tsx:8 → bridge.ts → bridge/context.ts:8 → nativeSqliteDb.ts:1` 静态 import `@capacitor-community/sqlite`） | 护栏形同虚设；SQLite 桥压在 FCP 前 |
| **C2** | CI 零覆盖 | `.github/workflows` 仅 release.yml（tag）与 packaged-smoke（PR 桌面冒烟） | vitest / dist-mobile / check:bundle / ui-metrics 全靠人手 |
| W1 | 状态双源 | formFactor 三份表示（dataset / 模块变量 / 每组件 useState）；同步 UI 3 处手写订阅；`bridge/sync.ts:414` 绕过 `syncSettingsStore` 写设置；`bridge/context.ts:68` 资产 Map 只增不删（单张≤25MiB） | 改一处忘一处；长会话内存只增 |
| W2 | 桌面入口把 6.1MB 内核打进首屏 | 入口 gz 1.90MB（raw 6.99MB，含 createOpenEditor/ne-engine）；三处静态入口 `EditorTab.tsx:6,432` / `TrashPanel.tsx:12,210` / `useHistorySnapshotViewer.ts:11,55`；移动端已 lazy（`quickNoteKernelFallback.test.ts:33`） | 桌面冷启多解析 ~7MB；两端口径不对称 |
| W3 | 测试 24% 是源码文本断言 + 不在 CI | 133/560 文件用 `readFileSync` 断言源码；`mobileLayers.test.ts` 逐文件计数（pad 批次 152→151→148 连改）；全仓 2275 条 `toContain` | 重构假红、真回归未必红 |
| W4 | 上帝组件 | NotebookWorkspace 1184 行 / 21 effect / 24 callback / 8 state | pad 5 次「用户报→修」全落这里 |
| W5 | desktopTypes 类型环、无全仓依赖方向门禁 | `desktopTypes.ts:8,12` ↔ `OutlineSidebar.tsx:10`/`Sidebar.tsx:19` | 拆包/复用被锁 |
| W6 | 预算余量失真 | 桌面 app-css 2MB 预算/303KB 实际（6.6×）；桌面 app-js 2.9MB/1.91MB（34% 余量）；preload「目标≤12」6 批未收紧 | 涨 900KB 也不红 |
| W7 | `ARCHITECTURE.md` 停留在 Manifest V2 时代 | 文中写 manifest V2 同步、quickNotesSync manifest v1、s3Maintenance manifest prune；实际 = S3 v3（AGENTS §4） | 新会话会被带偏 |

## 3. 目标架构

### A. pad 外壳：判据 store + 外壳 reducer + 按边界拆件（推荐 A，先 B 后 A）

**A1 判据单一来源** `src/mobile/pad/windowClass.ts` + `formFactorStore.ts`
- 纯函数：`widthClass(w) / heightClass(h) / effectiveWindowHeight(inner, shell)`（本批已加后者）+ 断点单源；
- 唯一 listener（`resize`/`orientationchange`/matchMedia 合并、rAF 节流），用 `useSyncExternalStore` 给 React；`installFormFactor()` 只负责写 `html[data-form-factor]`；
- 删 3 个死导出（`currentFormFactor` / `nativeDeviceHint` / `isPadLayout` 无生产消费者）与 `body.lake-tablet`（无 CSS/JS 消费者）。
- 收益：3 份表示 → 1 份；断点只写一次 + 静态测试。

**A2 外壳 reducer** `src/mobile/workspace/shellModel.ts`
- `state = { overlay: OverlayKind|null, panels: { left: PanelMode, right: PanelMode } }`，`PanelMode = closed | floating | pinned`；
- `action = openOverlay/closeOverlay | togglePanel | setPanelMode | escape | setTier | activeNoteChanged | outlineAvailabilityChanged`；
- selector：`docked` / `capsuleHidden` / `escapeOrder`；持久化只在 hook 边界（只存 pinned，key 不变）。
- 收益：21 个 effect 里的隐式互斥 → 20~30 例表驱动测试即可锁死；W1/W2/C2 的关合路径一处定义。

**A3 拆 NotebookWorkspace（只搬不重写，目标装配层 150–200 行）**
`useWorkspaceSession`（tabs+保存屏障+autosave ~200）· `WorkspaceTopBar`(150) · `WorkspaceCapsule`(50) · `WorkspacePanels`（树/大纲 悬浮+停靠 130）· `NotePaneHost`（kind switch 130）· `WorkspaceOverlayHost`（tabs/create/switch/info/icon/history 120）· `useTreeDrag`(130) · `WorkspaceMenu`(60)。依赖方向：session ← shell ← panes；panes 只吃 tab 数据。

**A4 CSS 单一归属**
- 把 `mobile.css:1240-1257` 的 tablet 几何整体搬进 `pad.css`（compact 规则留 mobile.css），删 9 组双归属 ⇒ import 顺序不再影响正确性；
- 静态测试：`data-form-factor` 选择器只许出现在 `pad.css`；修 `ui-metrics` 的逗号组拆分，让跨文件重复真正可见；
- 补 medium 视口快照基线（600×800）与 2 条 pad 交互 L1 断言（树开、固定大纲：DOM/宽度/zIndex），不做整页快照。

**C2 的修法（面板常驻）**：树/大纲在 `padTwoPane` 下**常驻 DOM**，用 class 控制显隐（与手机抽屉同构）⇒ 状态保持、手势可跟手、动画一致；需要重烤一次平板基线（元素数变化属预期）。

### B. ink / PDF：v3 紧凑格式 + 热路径常数化 + 视图拆分（推荐 A，不碰同步协议）

**B1 `core/inkDoc` v3（读 1|2|3、写 3）**
- 点编码扁平化 `[x,y,p]` + 坐标定点 0.01：实测 100 笔×60 点 369→108KiB（**−71%**），300 页上限 15→~50 笔/页；
- `activePageId` 移出正文（设备本地 `lakex-local-notes-v3.ink-nav.<noteId>`，同 bitable-nav）——**需用户裁决**；
- `sourcePdf` 去 `url`（只留 name/pageCount；原 PDF 用 cacheDir 临时文件喂插件）——**需用户裁决**；
- 坏页可丢：结构字段仍严格，单页数据坏则丢该页 + 横幅列出被丢页数；
- 可选 `textLayer`（桌面导入时 unpdf 抽文本 ≤6 万字）供 FTS/AI；移动无文本层。

**B2 热路径常数化**
- `commit` 只更新内存 doc + 置 dirty，**序列化移进 500ms 防抖**（capture 时现算）；
- `renderedStrokes` 加 id→d 缓存：500 笔页整页重算 16.4ms → 新增一条 0.4ms；
- 撤销改**操作级补丁**（stroke-add / erase 只存新增/被擦笔迹 ≈3.6KB/步；结构操作保留页快照）⇒ 60 步、单步内存 −99%；
- `eraseAt` 中断（pointercancel）用 `eraseBeforeRef` 回滚该页（≈3 行）。

**B3 视图拆分（不动渲染选型：SVG + perfect-freehand）**
`useInkSession`（doc/patch/history/保存）· `useInkInput`（pointer/坐标/擦除）· 视图三件（`DesktopToolbar` / `MobileDock+overlays` / `InkStage+PageStrip`）；`InkPad` 只编排 981→~350 + 3 文件。

**B4 IO 健壮性**
上传阶段回调 done/total；失败/取消按已知 filename 删刚上传资产；成功后删该 uuid cacheDir + 启动扫陈旧目录；栅格化与上传重叠（池 2–4）；Android 缩略图支持 webp；`InkPageStrip` 按视口虚拟化。

### C. 全局：门禁变真 + 状态单源 + 首屏预算

- **`scripts/check-arch.mjs`**（新）：① 首屏资源图字节预算（HTML script + 全部 modulepreload + entry CSS 递归求和）；② import 方向规则（core 无外依赖、mobile 不 import electron/desktop、features 不 import desktop）；③ 契约值导出（IPC 方法数、断点、预算数）供测试引用，替代散落的文本断言。
- **PR CI**：tsc + vitest(isolate:false) + 双 build + check:bundle + ui-metrics（约 8–10 分钟，无 AVD）。
- **SQLite 动态 import**：`nativeSqliteDb.ts` 改 `initializeDb()` 内 `await import()`，把 bridge chunk 97KB gz 移出首屏。
- **状态单源**：30 行 `createStore` + `useSyncExternalStore` 替换 15 处手写订阅；同步 UI 单写入点（`bridge/sync.ts:414` 改走 store）；资产 Map 改 LRU（≤32MiB）或落盘即丢；`formFactor` 并入 A1。
- **桌面内核 lazy**：三处静态入口（EditorTab / TrashPanel / useHistorySnapshotViewer）改 lazy，**先量后动**（入口 gz 预计 1.90MB→~0.4MB）。
- **测试分层**：保留 ~10 条最高价值契约（IPC 三处一致 / CSP 单源 / 移动独立性 / 内核懒加载 / 互斥域 / 断点单源），其余迁 `check-arch`；24% 静态断言**随改动渐进迁移**，不一次性重写。

### 预算矩阵（建议）

| # | 指标 | 现行 | 建议 |
|---|---|---|---|
| 1 | 首屏资源图 JS+CSS gz | 392KB（未测） | mobile ≤420KB / desktop ≤2.5MB |
| 2 | entry JS gz | 78KB | ≤80KB 不变 |
| 3 | 单懒 chunk gz | lakeRuntime 1.69 / usheet 1.84 / plantuml 1.40 | ≤2MB |
| 4 | modulepreload | 20 条 / 176KB gz | 改字节预算 ≤200KB |
| 5 | APK（clean build） | 37.95MB | ≤38.5MB |
| 6 | 冷启（gate AVD） | 无基线 JSON | FCP ≤800ms、真首页 P50 ≤1.2s / P95 ≤2.0s |
| 7 | 全量测试 wall | 34.9s | ≤25s（isolate:false）且 PR 必跑 |
| 8 | ink 交互 | 落笔 27ms / undo 2–4 步 | 落笔前端 ≈0ms / undo ≥30 步 |

## 4. 分阶段实施（每段独立上线、独立回滚、无数据迁移）

| 段 | 内容 | 人日 | 依赖 | 回滚 | 护栏 |
|---|---|---|---|---|---|
| **P0（本批已做）** | C1 键盘形态回归修复、W2 Esc 修复、`check:windowsweep` 装置、`ARCHITECTURE.md` 横幅 | 0.5 | — | 单 commit revert | pad 单测 +13、窗口矩阵 7 案、平板/手机 6 态 |
| **P1** | pad C2：面板常驻 + class 显隐（手势跟手/状态保持） | 1 | P0 | 单 commit | 平板 6 态重烤、`check:windowsweep` 新增「关态在 DOM 不可见」 |
| **P2** | pad B 方案：4 bool → `PanelMode`、Esc 单一 owner、expanded 删两个 overlay 分支；A4 CSS 归属迁移 + ui-metrics 逗号组 | 1.5 | P1 | 分两个 commit | 双 6 态 + mobileLayers（形态归属迁移登记） |
| **P3** | pad A1：windowClass 纯函数 + formFactorStore（useSyncExternalStore）+ 删死导出/死类名 | 2 | P2 | 新增文件为主，旧 hook 留一版 | formFactor 纯函数测试 + 窗口矩阵 |
| **P4** | pad A2+A3：shellModel reducer（20–30 例表驱动）→ 拆 NotebookWorkspace 8 件（先纯搬 JSX、再迁 action、最后 panes） | 3–4 | P3 | 每步一个 commit | 双 6 态 + 新增 shellModel/session 测试 |
| **P5** | ink P0（无格式变更）：序列化移防抖、d 缓存、擦除回滚、编辑态翻页不写盘、webp 缩略图、strip 虚拟化 | 1–2 | — | 单 PR | inkOpenReadOnly / inkPadWiring / 新增 inkPerf（500 笔整页 <5ms、300 页 serialize <35ms） |
| **P6** | ink v3：紧凑编码 / activePageId 出正文 / sourcePdf 去 url / 坏页可丢（**格式升级：旧端读到新版本只读保护**，同 v1→v2 先例） | 2–3 | P5 + 用户裁决 | 版本锁 + 发布说明 | inkDoc v3 往返/越界/旧版只读、golden body 同内容同字节 |
| **P7** | ink IO：上传进度、失败/取消清理、cacheDir 清扫、栅格与上传重叠 | 1 | P6 或独立 | 单 PR | pdfImport 用例 + 真机 300 页 A/B |
| **P8** | 全局：check-arch + PR CI + SQLite 动态 import + 状态单源 + assets LRU；桌面内核 lazy（先量后做） | 2–3 | 可与 P1–P7 并行 | 脚本/单文件级 | check:core / mobileIndependence / bundle 新预算 |

> 顺序建议：**P0（已做）→ P8 的门禁/CI（让后面每步都被真护栏接住）→ P1→P2→P3/P4（pad）→ P5→P6→P7（ink）**。
> 若只做最小集（B 方案）：P0 + P1 + P2 + P5 ≈ **4–5 人日**，已能消掉 80% 真实痛点（键盘回归、面板状态丢失、落笔卡顿、undo 退化）。

## 5. 明确不做（防过度设计）

1. **不整体重写**：core/bridge/S3 v3/两端 UI 的分层是对的；重写会打掉协议与 3413 例测试。
2. **不引状态库**（Zustand/Redux）/Tailwind/Radix/Motion：15 个 store 全是域内局部（最大 92 行），无跨层证据。
3. **不合并两端 UI/CSS**（mobileIndependence 已冻结 0 基线）；两份 inkPad.shared.css 用「关键规则一致」护栏替代合并。
4. **不给移动端加 `@layer`**：内核 CSS 1.28MB 未分层且在入口后加载，分层只能靠 !important 反压，收益为负。
5. **不加 32px 跨档滞后**：无抖动复现；加了只让判据与 CSS 时序更复杂。
6. **不拆 core 大文件**（bitableDoc 2406 / s3v3Engine 1130 / electron/store 1598）：纯逻辑 + 重测试，拆是 churn。
7. **不做 ink「页对象存储」/页级同步**（方案 B）：动 S3 声明/孤儿语义，收益未取证。
8. **不改 canvas / 接原生 Ink 引擎**（PencilKit/Android Ink）：违背 INK-PAD「不为平台维护三套墨迹引擎」。
9. **不新建「统一导入服务层」**：pdfImport 247 行纯编排 + 两端适配器已是最小正确分层。
10. **不手动 manualChunks**（vite 里有 A/B：拆了画板坏）；设备快照门禁不搬 CI（无 GPU/AVD）。
11. **不一次重写 2275 条 `toContain` 静态断言**：随改动渐进迁移。
12. **不为 pad 再建第三套 IA / 单独 entry / 单独 APK**：两轮用户定稿 + 历史评估（40–70 人日）都否。

## 6. 待用户裁决（只列需要产品/口径拍板的）

1. **`activePageId` 移出正文**（v3）：符合 AGENTS §4「本机视图不进正文」，但会改写 `inkPadWiring.test.ts:219-227` 的既有契约、且「同一篇在手写板翻到第几页」不再跨端同步。建议：**移出**。
2. **`sourcePdf` 是否继续入库**：现在原 PDF（≤100MiB）永久进正文引用 + 全端同步，运行时从不读。建议：**降为元数据（name/pageCount）+ 临时文件喂插件**；要留存让用户显式存为附件。
3. **首屏预算改「资源图字节」**（当前 392KB 会立刻显形，需排 P8 的 SQLite 动态 import）。建议：**接受**。
4. **桌面内核 lazy 是否先做 A/B 实测**（改 3 处静态入口）。建议：**先量**，有收益再做。
5. **实施节奏**：只做最小集（P0+P1+P2+P5，4–5 人日）还是走完整 8 段（15–20 人日）。建议：先最小集 + P8 门禁，验一版再决定后半。

## 7. 评审方法与证据索引

- 3 路只读评审（arch-pad / arch-ink / arch-global，均为独立会话、未改仓库）+ Lead 复核；关键量化：`check-bundle-budget.mjs` 实际统计对象、首屏 392KB gz（入口 78 + preload 176 + CSS 138）、ink 序列化 26.7ms/10.9MiB、undo 步数（200/500/1000 笔 = 11/4/2）、pad.css 148 声明中 74 条无门禁、2275 条 toContain / 133 文件 readFileSync、测试 3413 例 34.9s。
- 设备侧：`check:windowsweep`（7 个窗口 × 形态判据 + resize 状态保持）已入库；键盘回归在 lake_tab 实测（视口 744→460 仍 expanded；真短宽窗 1600×460 回落 medium）。
- 本文只写长期结论；易过期事实（当前分支/提交/计数）在 HANDOFF §0。
## 8. 实施记录（261103 当日，分支 `feat/pad-touch-ui`）

用户裁决：**8 段全做**；同时**彻底清除「平板模仿桌面工具栏」遗留冗余代码**；自主推进。以下为落地状态（commit 见 git log）：

| 段 | 状态 | 落地要点 / 验证 |
|---|---|---|
| P0 | ✅ | 键盘形态回归修复（effectiveWindowHeight）、Esc 逐层修复、`check:windowsweep`（7 窗口矩阵 + resize 状态保持）、ARCHITECTURE 过期横幅 |
| P1 | ✅ | 树/大纲**常驻 DOM**（开合只切 class；手势跟手、滚动/展开状态保持）；去挂载入场动画 |
| P2 | ✅ | 4 bool → 每侧一个 `PanelMode`；Esc 单一 owner；平板通用几何整体迁入 `pad.css` + `padCssOwnership.test`；ui-metrics 逗号选择器口径修正（13→105 收紧为棘轮） |
| P3 | ✅ | `formFactor` 收敛成单一 store（`useSyncExternalStore`，installFormFactor 唯一 listener）；删 `isPadLayout` / `nativeDeviceHint` / `currentFormFactor` 旧语义 / `body.lake-tablet` / `window.__lakeSetTablet`；Kotlin 侧同步删除 `lakeDevice` / `isTabletLayout` / `pushDeviceProfile` / `onConfigurationChanged` 覆盖 |
| P4 | ✅ | `shellModel.ts` 纯 reducer（closed/floating/pinned × 两侧 + `padEscapeTarget` + `padPinnedPrefs`，+7 例表驱动）；拆出 `WorkspaceCapsule` / `WorkspaceTreePanel` / `WorkspaceOutlinePanel`（NotebookWorkspace 1212→~1140 行） |
| P5 | ✅ | ink 热路径：序列化移出 commit/翻页（500ms 防抖 + capture 现算）、id→path 缓存（500 笔页新增 0.4ms）、pointercancel 回滚擦除、`InkPageStrip` 虚拟化、Android `?w=` 支持 webp + 磁盘缓存；+inkPerf 护栏 |
| P6 | ✅ | `inkDoc` v3：扁平点编码 + 定点 0.01（真实样本 **−52%**，300 页批注 10.9→3.6MiB **−67%**）；`activePageId` 移出正文 → `lakex-local-notes-v3.ink-nav.<noteId>`；`sourcePdf{name,pageCount}`、页级 `pdf:{page}`；坏页可丢 + 计数 + 告警（旧端读 v3 进只读保护，同 v1→v2 先例） |
| P7 | ✅ | PDF 导入改**流式**：`onPage` 逐页 + 上传池 3 路与栅格化重叠；进度分 raster/upload；失败/取消按 URL 定向清理已上传页图；移动端 `bridge.cleanNoteOrphans`（写域登记）+ 删暂存 PDF + 清原生 cacheDir；启动扫陈旧目录 |
| P8 | ✅ | `check-arch.mjs`（首屏资源图 gzip 预算 + import 方向 + 契约导出，接进 check:bundle）；`.github/workflows/pr.yml`；SQLite 懒加载（+修 **thenable 启动卡死**：Capacitor 代理自带会抛的 `then`，必须用 `{plugin}` 盒子 resolve）；assets LRU（32MiB）；vitest `isolate:false` 实测 −40% 但设备一致性测试依赖模块隔离 ⇒ 回退并留结论 |

**实测（本批）**：tsc 0；全量 vitest **553 文件 3442 例**（12 skipped）；`check:core` 135/0；`check:mobileui`（!important 19/19、字号 48/49、跨文件重复 105/105）；双 build；`check:bundle`（mobile entry 78.6KB/81.9KB、CSS 137.8KB/141.3KB）；`check:arch`（mobile 393.1KB/420KB、desktop 2.79MB/3.0MB）；手机 + 平板 6 态 **0 差异**；`check:windowsweep` pass；`compileDebugKotlin` 通过。

**剩余（列 P9，需另开）：** ① bridge/sync 域（s3v3 引擎/核心纯逻辑）从首屏静态图改按需（bridge chunk ~97KB gz 的大头，需实测）；② 桌面 CodeMirror 经典脚本改 defer/按需（可回收 407KB gz，届时桌面首屏预算收紧回 2.5MB）；③ `features/outline → desktop` 唯一冻结 import 违规清零；④ `deviceConformance.mobile.test.ts` 拆独立 worker 后可重开 vitest `isolate:false`；⑤ NotebookWorkspace 进一步拆 TopBar/OverlayHost/NotePaneHost（本轮已拆胶囊与两侧栏）。

## 9. P9 实施记录（261103 同日，分支 `feat/pad-touch-ui`）

| 项 | 结果 | 关键数字 |
|---|---|---|
| P9-1 bridge/sync 按需 | ✅ | mobile 首屏 **392,977 → 366,792B gz（−26,185B / −6.7%）**；bridge chunk **97,164 → 31,671B gz**；preload 20→28 条（rolldown 共享 chunk，字节降）⇒ 条数预算 23→30（注释写明「字节由 check-arch 守」），首屏预算 420→**390KB** |
| P9-2 CodeMirror defer | ✅ | desktop 首屏 **2,785,488 → 2,378,113B gz（−407,375B）**；defer 预算 450KB；桌面首屏预算 3.0MB→**2.5MB**；dev Electron 冒烟（#root 渲染、`window.CodeMirror`=object） |
| P9-3 import 违规清零 | ✅ | 新增 `core/layoutConstants.ts`（大纲宽 280/200/420）+ desktopTypes re-export；check-arch 违规 **0** / 冻结清单 **0** |
| P9-4 isolate:false | ⚠️ 二次尝试后回退 | projects（unit isolate:false + conformance isolate:true）实测 **30.21 → 19.25~21.51s（−32~36%）**，但两轮红点不同（`bridge/home.test` jeep-sqlite、`electron/assetServer.test` 模块加载期 env、`bridgeStartup` 模块状态）⇒ 结构性依赖文件级隔离；结论与重开前置（去全局化、显式注入）写进 `vitest.config.ts`，未改断言 |
| P9-5 工作区拆件 | ✅（纯 JSX 已抽尽） | 除 P4 的 Capsule/Panels 外，新增 `WorkspaceTopBar` / `WorkspaceOverlayHost` / `NotePaneHost` / `WorkspaceDrawers`；NotebookWorkspace **1212 → 984 行**；`kernelStyleBootstrap` 判据改「相对 import 闭包」 |

**门禁**：tsc 0 / 全量 vitest **566 文件 3463 例** 30.21s / check:core 136/0 / check:mobileui / 双 build / check:bundle / check:arch（mobile 366.8KB/390KB、desktop 2.38MB/2.5MB、defer 407.4KB/450KB、import 违规 0）/ 手机 + 平板 6 态 **0 差异** / `check:windowsweep` pass。

**剩余（P10 候选）**：① P9-5c —— 把树拖拽/会话屏障/chrome 滚动逻辑逐字搬 hook（≈−250 行，行为不变）；② `bridge` 里仍静态的 `s3v3Report`（12KB，受 syncDiagnosticsStore 值导入约束）；③ 把 import 方向规则扩到 `components→desktop`（Sidebar 常量同法下沉）；④ `plantuml`/`MobileUsheetViewer` 等 6~7MB raw 懒 chunk 的按需化评估。

## 10. P10 实施记录（261103 同日，分支 `feat/pad-touch-ui`）

| 项 | 结果 | 关键数字 |
|---|---|---|
| P10-① 工作区逻辑搬 hook（P9-5c） | ✅ | 新增 `useTreeDrag`(168) / `useWorkspaceChrome`(159) / `useWorkspaceSession`(206)；NotebookWorkspace **984 → 660 行（−324 / −32.9%）**；行为行逐字命中 475/478（余 3 条等价改写） |
| P10-② 设置抽屉按需 | ✅ | `SettingsDrawer` 改 `lazy()` ⇒ mobile entry JS **79,032 → 53,496B gz（−25.5KB）**，首屏资源图 **366,792 → 340,783B gz（−26KB）**；预算 entry 80KB→60KB、首屏 390KB→**360KB**；设备冒烟（打开设置/云同步子页）正常 |
| P10-③ import 规则扩到 components | ✅ | `SIDEBAR_*_WIDTH` 下沉 `core/layoutConstants`（desktopTypes re-export，Sidebar 改核心）；check-arch 新增 `components-no-desktop` 并纳入扫描 ⇒ 违规 **0 / 清单 0** |
| P10-④ 大懒 chunk 评估 | ✅ 结论=不改 | 28 条 preload 只有 usheetDoc 等小 chunk；`MobileUsheetViewer`(6.9MB raw)/`plantuml`(6.4MB)/`lakeRuntime`(6.3MB)/`DrawnixBoardCore` 均不在首屏图，只在打开对应文档时加载 ⇒ 保持现状 |

**累计首屏收益（P9+P10）**：移动 **392,977 → 340,783B gz（−52.2KB / −13.3%）**、entry **79,032 → 53,496B gz（−32.3%）**；桌面 **2,785,488 → 2,378,113B gz（−407.4KB）**；import 违规 0；NotebookWorkspace 1212 → 660 行（−45.5%）。

**门禁**：tsc 0 / vitest **566 文件 3463 例** 30.2s / check:core 136/0 / check:mobileui / 双 build / check:bundle（entry 53,496/61,440、css 137,795/141,312、preload 28/30）/ check:arch（mobile 340.8KB/360KB、desktop 2.38MB/2.5MB、defer 407.4KB/450KB、import 违规 0）/ 手机+平板 6 态 0 差异 / windowsweep pass。

**仍可继续（P11 候选）**：① `bridge` 里 `s3v3Report` 静态 12KB（设置页已懒加载，剩余取决于 sync 诊断读路径）；② `useWorkspaceAssemble`（restore/初始打开/runSync/treeMenuItems 等剩余效果）可再压行数；③ `plantuml`/usheet 大 chunk 内部再拆（收益未取证，需实测）；④ 桌面内核三入口 lazy（P8 W2，仍“先量后做”）。

## 11. P11 实施记录（261103 同日，分支 `feat/pad-touch-ui`）

| 项 | 结果 | 关键数据 / 结论 |
|---|---|---|
| P11-① `s3v3Report` 按需 | ⚠️ **实测收益 1.2KB gz ⇒ 不做，已回退** | mobile 首屏 340,783 → 339,559B gz（−1,224B / −0.36%）；动态 import + 失败兜底带来的复杂度大于收益（§3#17） |
| P11-② 剩余组装逻辑搬 hook | ✅ | NotebookWorkspace **660 → 510 行（−150 / −22.7%）**；新增 `useWorkspaceAssemble`(79) / `useWorkspaceSync`(61) / `useWorkspaceActions`(200)，openSidebar/openOutline 并入 `useWorkspaceChrome`；旧 256 条逻辑行逐字命中 256/256，JSX 字节相同 |
| P11-③ 大 chunk 取证 | ✅ 结论=不改 | `plantuml`(6.4MB raw) 只被 `lakeRuntime`（懒 chunk）引用；28 条 preload 全是小 chunk（最大 activeEditor 17.6KB gz）⇒ 首屏图无大 chunk |
| P11-④ 桌面内核 lazy A/B | ✅ 结论=**有条件值得，本轮不做** | 静态：只改点名的 3 处首屏仅 −0.3%（内核挪进 preload，仍在首屏）；**5 个组件边界全 lazy** 才把首屏 2,074,572 → 215,856B gz（−89.6%）。动态（Electron 44.9 + CDP 9222，warm 5 次 / cold-cache 4 次）：warm `spawn→#root` 815→669ms、cold 1,360→**865ms（−36%）**；但 cold 下「点开首篇文档→引擎」约 **+538ms**。⇒ 必须 5 边界 + **启动 idle 预取 kernel chunk** 打包做才是净收益；单拆 3 处等于白做。证据 `/tmp/p11/results/`（driver.mjs / build 日志 / runtime-summary-*.json） |

**门禁（P11）**：tsc 0 / vitest **566 文件 3463 例**（`electron/s3v3/perf` 在满载并行下曾抖红一次、单跑通过，属既有已知）/ check:core 136/0 / check:mobileui / 双 build / check:bundle（entry 53,496/61,440、css 137,795/141,312、preload 28/30）/ check:arch（mobile **340,783B/360KB**、desktop 2,378,003B/2.5MB、defer 407,375B/450KB、import 违规 0）/ 手机+平板 6 态 0 差异 / windowsweep pass。

**P12 候选（按收益/风险排序）**：① 桌面内核 lazy（5 边界 + idle 预取 + entry 静态断言；预计 cold 出界面 −0.5s，需回归打开=只读/capture/focus/多 tab）；② `bridge` 内 `s3v3Report` 若未来设置页再变化可重测（当前收益不足）；③ 大 chunk 内部再拆（未取证）；④ 工作区继续压行（510 → ~450，收益仅可维护性）。

## 12. P12 实施记录（261103 同日，分支 `feat/pad-touch-ui`）

**P12-① 桌面内核 lazy（5 个边界 + idle 预取）· ✅**

- 边界：`MultiTabEditor→EditorTab`（复用既有「正在加载编辑器…」Suspense 占位）、`App→TrashPanel(embed)/NoteInfoDialog`、
  `DesktopOverlays→TrashPanel/HistoryPanel`（仅打开时挂载）、`QuickNotesWorkspace→QuickNoteEditor`。
  **偏离**：没有整体 lazy `QuickNotesWorkspace`（App 切到小记后立刻 `quickNotesRef.revealNote`，整体 lazy 会在内核 chunk
  解析前 ref=null 丢调用）——改为 lazy 其内核子件，内核仍完全移出入口静态图（import 图验证 lakeRuntime=0）。
- 预取：`src/features/editor/kernelPrefetch.ts` —— 就绪 3s 后 `requestIdleCallback` 里 `import("./EditorTab")`（与 lazy 同 chunk、
  幂等/失败静默/window 守卫）；把 1.61MB gz 内核 chunk 的下载解析挪出冷启动。
- 护栏：`desktopKernelLazy.test.ts`（5 边界静态契约 + 预取目标/静默）、`kernelPrefetch.test.ts`（幂等/SSR no-op）；
  `check-arch` desktop 首屏预算 2.5MB → **600KB**；`check-bundle` desktop app-js 2.9MB → **300KB**。
- **实测**：desktop 首屏 **2,378,113 → 541,234B gz（−1,836,879 / −77.2%）**（entry-js 149,873 / preload ×11 88,308 / css 303,053）；
  桌面 dev 冒烟（Electron + CDP 9222，临时 profile）：启动 → 新建文档 → 点树行 → 编辑器挂载（kernel chunk 已加载）、无异常。

**P12 门禁**：tsc 0 / 全量 vitest **568 文件 3470 例** / check:core 136/0 / check:mobileui / 双 build /
check:bundle（app-js 149,873/307,200、mobile entry 53,496/61,440、preload 28/30）/ check:arch（desktop **541.2KB/600KB**、
defer 407.4KB/450KB、mobile 340.8KB/360KB、import 违规 0）/ diff-check。

**P12 遗留 / 取舍**：① 冷 cache「启动即恢复上次文档」仍会等内核 chunk（3s idle 预取来不及），属 P11 量化取舍——若要消除需
把预取提前到 window load 后（会与首屏争 CPU，待实测）；② TrashPanel/HistoryPanel 关闭即卸载 ⇒ 面板内部选中/滚动状态下次打开重置
（列表本来每次 open 重读，判为可接受）；③ 桌面 dev 冒烟未覆盖设置面板（菜单打开）、小记工作区与历史面板的交互路径——单元/静态
契约已覆盖懒加载接线，建议下次桌面设备走查补一次。

**累计首屏（P9→P12）**：移动 392,977 → **340,783B gz（−13.3%）**；桌面 2,785,488 → **541,234B gz（−80.6%）**；
import 违规 0；NotebookWorkspace 1212 → 510 行（−57.9%）。
