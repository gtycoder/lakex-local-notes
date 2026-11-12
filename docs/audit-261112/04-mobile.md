# 04 · 移动端全量审计（src/mobile + Android Kotlin + 移动样式）

> **性质**：发布前只读审计（不修改任何产品代码/样式/配置/测试/文档）。唯一新增文件 = 本报告。
> **审计员**：audit-mobile（task-3）· **日期**：2026-11-12 · **基线**：工作区 HEAD（`git log -1` 见下「可复现命令」）
> **范围**：`src/mobile/**`、`android/app/src/main/java/com/lakexlocalnotes/android/*.kt`、`mobile.html`、`capacitor.config.ts`、`vite.mobile.config.ts`、移动端门禁脚本；`docs/MOBILE-DESIGN.md` / `docs/MOBILE-AI.md` / `docs/MOBILE-OPS.md` 作为契约参考（只读）。
> **不在范围**：桌面端、`src/core` 的共享纯逻辑本身（只在「该不该下沉」时讨论）、vendor 内核。

---

## 0. 方法与范围

### 0.1 做了什么（可复现）

```bash
cd "$(git rev-parse --show-toplevel)"
git log -1 --format='%h %s'                      # 基线
find src/mobile -name '*.ts' -o -name '*.tsx' | wc -l        # 640（含测试）
find src/mobile -name '*.test.ts' -o -name '*.test.tsx' | wc -l  # 302
find src/mobile -name '*.ts' -o -name '*.tsx' -o -name '*.css' | xargs wc -l | tail -1   # 81884
find src/mobile -name '*.css' | xargs wc -l | tail -1        # 6115（25 个文件）
ls android/app/src/main/java/com/lakexlocalnotes/android/*.kt | wc -l   # 18
find android -name '*.kt' | xargs wc -l | tail -1            # 5070（main 18 文件 4752 行 / android 包测试 5 文件 279 行 / 模板测试 2 文件 39 行）
```

- **import 图**：自写脚本对 `src/mobile/**` 全部非测试文件做相对 import 解析（740 条跨目录边），再对 `src/mobile + src/core + src/lib + src/features + src/components + src/hooks` 做 Tarjan SCC 找环。
- **样式**：脚本统计 25 个 CSS 的令牌定义/使用、颜色字面量、`!important`、跨文件同名类定义；逐文件读 `mobileLayers.test.ts` 基线。
- **Kotlin**：逐文件抽取 `@CapacitorPlugin` / `@PluginMethod` 面；对 IO/线程/校验/Keystore 做 grep 比对；读 Manifest/gradle/network security 配置。
- **对账**：拿 `docs/MOBILE-DESIGN.md` 的原语台账与 backlog、`docs/MOBILE-AI.md` 的 SecretBox 声明、`lakeNativeContract` 注释里的计数逐条核对现状。
- **未做**（审计纪律）：不装依赖、不跑构建、不跑全量 vitest、不启动 App/模拟器、不跑设备快照门禁、不碰真实数据目录。因此**性能结论只引用仓库内已落盘的实测基线**，不新造数字。

### 0.2 证据等级

- **已核实**：本会话用命令/读数直接验证，给出 file:line 或可复现命令。
- **推断**：基于已核实事实的合理判断，明确标注，不作为修复依据。
- 「既定设计」：仓库文档已登记并解释过的现状，本报告**不重复立项**（避免撞 §3#17）。

### 0.3 一处口径修正

任务书写「55 个子目录」；实测 `src/mobile` **一级 25 个目录**（递归 26 个，因为 `data/` 等无二级目录），文件 640 个。本报告以实测为准。

---

## 1. 事实地图

### 1.1 规模分布（LOC，含测试，按目录）

| 目录 | LOC | 文件 | 职责（实测） |
| --- | --- | --- | --- |
| `data/` | 8629 | 64 | SQLite 仓储（notes/quickNotes/tree/trash/history/search/v3State）+ schema + dbHealth |
| `bitable/` | 6956 | 55 | 多维表移动端渲染/编辑/视图配置（`MobileBitableViewer.tsx` 835 行 + `mobileBitable.css` 746 行） |
| `notebook/` | 6615 | 52 | 工作区外壳：树/胶囊/抽屉/面板/外壳 reducer（`shellModel.ts`） |
| `usheet/` | 6386 | 46 | 表格（Univer）移动端 chrome/dock/签名板 |
| `editor/` | 5339 | 43 | 文档编辑器宿主、dock、查找条、文档列表 Sheet、缺失资源占位 |
| `settings/` | 5053 | 40 | 设置抽屉 + 8 个子页 + S3/AI/同步表单 hooks |
| `ui/` | 4518 | 71 | **原语层**（48 个非测试模块）：MobileSheet/floating/ConfirmDialog/toast/selection/settingsPrimitives… |
| `home/` | 4382 | 27 | 首页五格 Dock + 小记卡/知识库/日记/AI/标签分页 + 写作卡 |
| `native/` | 4097 | 44 | Capacitor 端口适配（sqlite/bodyStore/assetFs/keystore/keyboard/pdf/shortcut/…） |
| `bridge/` | 3468 | 25 | `window.lakeNative` 实现：10 个域 + 3 个辅助模块；`bridge.ts` 51 行纯组合 |
| `v3/` | 3297 | 22 | S3 v3 移动适配（platformPort / deviceStore / remote / sync） |
| `ai/` | 2525 | 19 | AI 页/对话 store/设置 |
| `hooks/` | 2338 | 23 | 键盘/返回栈/路由转场/自动保存/自动同步 |
| `ink/` `tags/` `diary/` `portable/` `sync/` `update/` `board/` `lib/` `pad/` `theme/` `search/` `import/` `trash/` | 合计 ≈ 1.0 万 | — | 手写板、标签、日记、便携包、同步状态/锁、更新中心、画板、小工具、平板外壳、主题令牌、搜索类型、分享导入、回收站预览 |

**关键计数（已核实）**：移动端源码（剔测试）**52,269 行**；测试 **302 文件 / 29,615 行**（测试:源码 ≈ 0.57，但分布不均，见 P2-5 的 Kotlin 侧）。
**样式总量**：25 个 CSS / 6,115 行；令牌定义 346 个（其中 `--mb-*` 69 个、重定义的 `--lake-*` 185 个，见 `theme/tokens.css` 头注释的设计口径）。
**`!important` 15 条**（文档棘轮 19，只许降）；**颜色字面量 294 处，全部落在 `theme/{tokens,light,dark}.css` 内**（唯一的例外是 `quick-notes.css:36` 的一句**注释**）。

### 1.2 模块依赖方向（data / bridge / native / ui / feature）

实测跨目录 import 边（非测试文件）主要方向：

```
feature(home/notebook/settings/bitable/usheet/editor/tags/…) ──► ui/（原语）
feature ──► bridge(.ts) ──► bridge/域 ──► data/
feature ──► data/（少量直连：notebook 11、portable 5、settings 4、home 3…）
bridge/ ──► native/（8 条）、bridge/ ──► sync/（6 条）
native/ ──► data/（4 条：cachePort→searchIndex/derivedSearchCache、nativeSqliteDb→sqliteDb 类型、TestMock）
native/ ──► home/（1 条：kernelPrewarm→quickNoteComposerLazy）、portable/（1 条：portablePackage→portableMapping 类型）
data/ ──► native/（4 条：assetFs、bodyStore —— 仓储直接调原生端口）
data/ ──► sync/（1 条）、native → bridge（1 条：cachePort→bridge/context）
MobileApp.tsx/hooks/ ──► 各 feature（编排层）
```

**方向结论（已核实）**：
1. **没有运行时循环依赖**：对含 `src/mobile` 在内的 6 个源码根做 Tarjan，只有 3 组环，且**全部是 `import type`（类型在编译期擦除）**：
   - `MobileApp.tsx` ↔ `hooks/useBackHandler.ts`（`useBackHandler.ts:10 import type { Route } from "../MobileApp"`）
   - `home/HomePage.tsx` ↔ `home/NotebookGrid.tsx`（`NotebookGrid.tsx:10 import type { LibraryView } from "./HomePage"`）
   - `home/HomePage.tsx` ↔ `tags/TagsHomeTab.tsx`（`TagsHomeTab.tsx:25 import type { MobileQuickNote } from "../home/HomePage"`）
   ⇒ **可忽略**。真要收，把 `Route`/`LibraryView`/`MobileQuickNote` 提到 `home/types.ts`；收益仅「类型别互相指」，按 §3#17 不建议单独立项。
2. **越层但属「端口适配桶」**：`native/*` 名义上是适配层，实际有 6 个文件反向 import 业务（上表）。原因是 `native/` 在本仓同时承担「端口实现 + 启动编排」（`kernelPrewarm`、`cachePort`、`appInfoPort`）。**这是历史成形的事实，不是本次新产生的破坏**；影响 = 新人找「缓存清理逻辑在哪」会去 `native/` 而实际在 `data/`。建议只在文件头注释登记（成本 0），不建议拆目录（见 §5）。
3. **`data/ → native/`（4 条）是必须的**：本地正文/资产是原生文件系统，SQLite 仓储要调 `BodyStore`/`assetFs`。**不要把这条边改掉**（改成 port 注入只会多一层间接，收益停在「更整洁」）。

**与桌面的共享面（重要，防止误判为重复）**：移动端 import 的桌面模块集中在
`src/features/{editor,quickNotes,attachment,ink,ai,bitable,board,import,usheet}/**` 与 `src/core/**`、`src/lib/**`。
其中 `features/editor/lakeRuntime.ts`（8 处 import）、`features/quickNotes/QuickNotePreview.tsx`（home/tags）、`features/editor/LakeEditor.tsx`（editor/trash）、`features/ink/InkPad.tsx` 是**被两端复用的实现**（非复制）。这与 AGENTS §3#14「UI 两端独立」并不冲突：这些是「内核宿主 / 只读预览 / 共享逻辑」，移动端只在自己的 CSS 域内改外观（`features.css` 有专门注释说明「结构类名共享、视觉各端自有」，`src/mobile/main.tsx:29`）。

### 1.3 Screen 清单与入口（已核实）

- **路由类型只有 2 个**（`MobileApp.tsx:105`）：`{kind:"home", tab}` 与 `{kind:"notebook", notebookId, initialNoteId, initialMode}`。文档/编辑是工作区内部态，不是路由。
- **首页 5 格 = `HOME_TABS`**（`home/tabPager.ts` 单一来源）：小记 / 知识库 / 日记 / AI / 标签；`settings/defaultSpace.ts` 直接复用该常量（`defaultSpace.test.ts:20` 钉住）。
- **懒加载边界仅 3 处**（`MobileApp.tsx:87/91/94`）：`NotebookWorkspace` / `SearchSheet` / `SettingsDrawer`；再叠加 `QuickNoteComposerLazy`（`home/quickNoteComposerLazy.tsx`）与若干 `lazy()` 视图（usheet/bitable/board/ink）。
- **设备走查 23 屏**（`scripts/css-audit/mobile-walkthrough.mjs:170-204`，与文档一致）：home-library / home-quicknotes / home-library-shelf / notebook-workspace / doc-0…doc-4（5 屏）/ quicknote-editor / doc-outline / doc-note-info / doc-history / notebook-icon-sheet / settings / settings-{常规,外观,历史,资源管理,云端与同步,清理缓存,回收站,关于}。
- **快照门禁 10 态**（`scripts/mobile-audit/baseline/mobile-snap.json`，`npm run check:mobilesnap`）+ 平板 10 态（`npm run check:tabletsnap`）+ `check:bitablesnap`（3 态）+ `capture-entry.mjs`（10 条入口）+ `edit-surface-invariants.mjs`（键盘不变式）+ `perf-baseline.mjs`（性能基线）。

### 1.4 Kotlin 插件 → JS bridge 映射表（14 个 Capacitor 插件 / 64 个 `@PluginMethod`）

| Kotlin（文件 / 行） | 插件名 | 原生方法 | TS 封装（唯一注册点） |
| --- | --- | --- | --- |
| `AiChatPlugin.kt` / 414 | `AiChat` | getSettings, saveSettings, testConnection, chat, cancel | `native/aiChat.ts:82` |
| `AssetSyncPlugin.kt` / 608 | `AssetSync` | configure, isAvailable, copyAssetDir, putFile, getFile, listAssets, listAllAssets, statLocal, writeLocal, readLocal, removeLocal, listLocal, listQuickAssets, listImageAssets | `native/nativeAssetSync.ts:43` |
| `AssetUsagePlugin.kt` / 48 | `AssetUsage` | usage | `native/assetUsage.ts:13` |
| `BodyStorePlugin.kt` / 317 | `BodyStore` | write, writeMany, moveMany, clearStaging, read, statMany, readMany, remove, stat, writeSnapshot, readSnapshot | `native/bodyStore.ts:31` |
| `CrashLogPlugin.kt` / 83 | `CrashLog` | read, clear | `native/crashLog.ts:18` |
| `OpenFilePlugin.kt` / 252 | `OpenFile` | open, saveAs | `bridge/assets.ts:19` + `editor/DocumentEditor.tsx:36`（**两处重复 registerPlugin**，见 P2-6） |
| `PdfRenderPlugin.kt` / 240 | `PdfRender` | cancel, cleanupCache, renderPdf | `native/pdfRender.ts:66` |
| `PinShortcutPlugin.kt` / 94 | `PinShortcut` | isAvailable, isPinned, requestPin | `native/quickNoteShortcut.ts:63` |
| `PortablePackagePlugin.kt` / 586 | `PortableImport` | pickAndStage, discardStaging, readRows, readBaseline, copyPayload, beginImport, commitImport, rollbackImport, recoverPending, pendingInfo | `native/portablePackage.ts:92` |
| `SecureStorePlugin.kt` / 111 | `SecureStore` | set, get, remove | `native/keystoreSecretStore.ts:27` |
| `SharedContentPlugin.kt` / 248 | `SharedContent` | consume | `native/sharedContent.ts:57` |
| `ShowKeyboardPlugin.kt` / 42 | `ShowKeyboard` | show | `native/nativeKeyboard.ts:17` |
| `StylusInputPlugin.kt` / 35 | `StylusInput` | setHandwritingEnabled | `native/stylusInput.ts:7` |
| `UpdatePlugin.kt` / 613 | `Update` | check, download, status, cancel, cleanup, verify, install, isWifi | `native/updateManager.ts:80` |

**非插件的原生面（不进 Capacitor 桥，走 JS interface / 进程内服务）**：
- `AssetServer.kt`（656 行）：`127.0.0.1:19876` 资产 HTTP 服务（Range / `?w=128|256|512|1024` 缩略 / `?base64=1`），token 经 `lakeAssetToken.getToken()` 注入（`MainActivity.kt:237`，CORS 请求强制校验 `AssetServer.kt:546-560`）；端口与桌面 `ASSET_ORIGIN` 同值。
- `MainActivity.kt`（246）：插件注册 + `lakeInsets`/`lakeSystemBars`/`lakeLaunchUrl`/`lakeBoot` 四个 JS interface + 30s 首屏看门狗。
- `AwsV4Signer.kt`（85）：SigV4，仅 `AssetSyncPlugin` 使用（`AssetSyncPlugin.kt:177/241`）。
- `SecretBox.kt`（74）：Keystore 加解密小盒，仅 `AiChatPlugin.kt:44` 使用。

**调试契约**：`window.lakeNative` = 68 个方法（67 bridge + 1 extra），单一来源 `native/lakeNativeContract.ts`，`lakeNativeContract.test.ts:67` 钉住计数；声明了但实现不存在 ⇒ 启动期抛错。

### 1.5 数据/同步适配

- `bridge.ts` 只做组合（51 行）：10 个域（sync/assets/notes/quickNotes/tree/home/diary/ai/batchNotes/duplicateNotes）由 `...xxxDomain` 展开；`context`（锁/S3 工厂/设置）、`assetCache`、`noteTagReads` 是辅助模块。方法面最大的是 notes / quickNotes / sync 三个域。
- 同步纯逻辑在 `src/core/s3v3/**` 与 `src/core/s3v3Decision/Merge`；移动只提供 `v3/mobilePlatformPort.ts`(695) / `v3/mobileDeviceStore.ts`(427) / `v3/s3v3Remote.ts` 三个适配器 —— **与桌面 `electron/s3v3/*` 同构、非复制**（AGENTS §4 已定）。
- 互斥域：`sync/maintenanceLocks.ts` 三把 `KeyedAsyncQueue`（write/maintenance/priority），与 `core/maintenancePolicy.ts` 对账（`bridge/context.ts:178` 有「入队判据必须一致」的断言）。

---

## 2. 问题清单

> **总计：P0 = 0，P1 = 2，P2 = 7。**
> P0 为 0 是**结论而非偷懒**：本轮专门核对了发布前最怕的四类（数据丢失路径 / 桥契约断裂 / 明文密钥 / 一次性可复现崩溃），均未发现新缺陷；已核对项列在 §2.10，**请不要重复立项**。

### P1-1 样式所有权跨界 + 级联顺序由 JS import 图隐式决定（真问题，成本中等）

**已核实事实**：
1. `mobile.css` 1,390 行 / 411 个选择器 / 15 个「=====」段，是最大单文件；里面**不是只有外壳**：
   - `:36` 段「Phase 1 产品壳」；`:839-874` **画板**（`.mobile-board-viewer`、`.draw-toolbar`、`.lakex-drawnix-core`）；`:1049-1304` **多维表编辑态**（`.mbt-*`，约 250 行）；`:1256` **编辑 dock** 的 `:active` 规则（`.med-btn`/`.med-ins-item`/`.med-f-btn`/`.med-outline-item`/`.med-doc-item`）；`:1305` 底部 Dock。
   - 而 `bitable/mobileBitable.css`（746 行）、`board/board.css`（45 行）、`editor/editor-dock.css`（351 行）**各自也在定义同名类**。
2. 全端「同一类名在 ≥2 个 CSS 文件出现」实测 **69 个**，其中跨 feature 的：`.mbt-grid`/`.mbt-grid-wrap`/`.mbt-attachment`（mobile.css + mobileBitable.css）、`.mobile-board-viewer`/`.draw-toolbar`/`.lakex-drawnix-core`/`.is-editing`（mobile.css + board.css）、`.med-btn`/`.med-ins-item`/`.med-f-btn`/`.med-outline-item`/`.med-doc-item`（mobile.css + editor-dock.css）、`.attachment-preview`（mobile.css + features.css）。
3. **级联顺序不是由入口清单决定**：`mobile.css` 由 `MobileApp.tsx:64` 引入（不在 `main.tsx:23-35` 那张 CSS 清单里），因此它的求值位置由 **MobileApp 的 JS 模块图**决定；`main.tsx` 直引 13 个 `.css`（含 2 个字体），其余 CSS 由各 feature 组件 import。**重复声明最终谁生效无法从任何一份清单读出**，只能看构建产物/实测 ⇒ 隐式、脆弱。若将来有人在 `main.tsx` 或组件里调整 import 顺序（看似无关），观感会静默变化；现有门禁（元素级快照/像素对比）只能发现「变了」，无法告诉你「哪条规则开始生效」。

**代价**：开源后新贡献者按「文件名叫 mobileBitable.css ⇒ 多维表样式都在这」去找，会漏掉 250 行；改 `.mbt-grid` 时改错文件是静默失效。这是**真实发生过的形态**（`mobile.css:888-890` 的注释就在解释「旧 `.mbt-*` 已删、不要加回来」，说明维护者自己踩过）。

**为什么不是「既定设计」**：`docs/MOBILE-DESIGN.md:422` 已登记「**规则全部未分层，顺序靠 import 顺序**」，并明确「全端 @layer 迁移是独立项目，不要分批做」——**这部分我完全同意、不提议 @layer 迁移**。本项只针对「**一个 feature 域的规则住在别的域的文件里**」这一层，与 @layer 无关。

**修法（最小）**：把 `:839-874` 段搬到 `board/board.css`、`:1049-1304` 段搬到 `bitable/mobileBitable.css`、`:1256` 的 `.med-*` 归 `editor/editor-dock.css`；同步 `mobileLayers.test.ts` 的 `BASELINE`（移动是**同文件内删等量/跨文件迁移**，总声明数不变，只改每文件账面）。**风险点**：搬动可能改变级联结果（因为 feature CSS 在后面 ⇒ 多数情况是「更靠后、更赢」，但仍必须跑设备门禁，见 §4）。

### P1-2 资产路径校验有两套实现，允许集合不一致（安全面重复，真问题）

**已核实事实**：
- `AssetSyncPlugin.kt:29-45` 的 `resolveLocalAssetFile()`：只允许 `note-assets/` 与 `quick-notes/assets/` 两个根，拒绝绝对路径/`..`/软链逃逸（canonical 前缀校验）。
- `AssetServer.kt:174-190` 另写一套：用 `when` 决定根（**额外允许 `quick-notes/staging/`** —— 小记草稿 staging），再做 canonical 前缀校验。
- 两套语义差异 = 「staging 目录在 HTTP 服务可达、在原生同步插件不可达」。**当前不是漏洞**（两处都做了 canonical 前缀校验，URL 也已 decode 后再校验），但**这正是一个以后最容易分叉成漏洞的点**：任何一方加根/加例外时另一方不会自动同步；而 `AssetServerTest.kt` 只有 119 行（另有 3 个 Kotlin 测试文件合计 279 行），覆盖不到「编码 `%2e%2e`、双斜杠、软链、大小写」这类对抗样例。

**修法**：抽 `AssetPaths.kt`（`internal object`）：
```kotlin
// roots: staging(可读) / note-assets / quick-notes/assets —— 单一清单，含「可写」「可读」标志
fun resolve(filesDir: File, rel: String, mode: Mode): File  // mode = READ | WRITE
```
`AssetServer` 与 `AssetSyncPlugin` 都调它，`staging` 的差异用显式参数表达（而不是藏在 when 里）；补 6 条对抗单测（`..`、URL 编码、symlink、`note-assetsX/` 前缀绕过、超长路径、空段）。**不新增依赖、不改对外行为。**

### P2 清单（按「不做会付什么代价」排序）

#### P2-1 `--mb-radius-xl` 是悬空令牌 ⇒ 多选操作条圆角失效（确定的小视觉缺陷）
- `mobile.css:520`：`.mb-sel-actions{ … border-radius: var(--mb-radius-xl); … }`；全仓 **0 处定义** `--mb-radius-xl`（`grep -rn -- '--mb-radius-xl:' src` = 0），使用者只有这 1 处。
- CSS 语义：`var()` 无 fallback 且未定义 ⇒ 该声明在计算值阶段失效 ⇒ `border-radius` 回落初始值 **0**。而意图显然是 20px（`--lake-radius-xl: 20px` 已存在，`theme/tokens.css`）。
- 影响面：`ui/SelectionActionBar.tsx:32` 的底部批量操作条（首页小记/回收站/目录树多选都在用，`selectionMode.render.test.tsx:125` 只断言类名存在，**测不出计算值**）。
- 修法：改 `var(--lake-radius-xl)`（或补一条 `--mb-radius-xl: 20px` 到 `kit.css`，若 v2 想保留 `mb-` 命名空间）。1 行；需跑 `check:mobileui` + 受影响 2~3 态快照。

#### P2-2 Keystore 加解密有两份实现，且文档声称「单一实现」
- `SecureStorePlugin.kt:36-45`（ALIAS `lakex-local-notes-mobile.secret.v1` / PREFS `lakex-local-notes-secure`）自己实现了 key 生成 + AES-GCM + 失败清理；`SecretBox.kt:19-74` 是**同一套算法的通用化版本**（alias/prefs 参数化），被 `AiChatPlugin.kt:44` 使用。
- 而 `docs/MOBILE-AI.md:354` 写的是「复用 SecureStorePlugin.kt 的模式，**把加解密抽成 SecretBox.kt 单一实现**，两个插件共用」——**文档与代码不一致**：SecureStore 并未改用 SecretBox。
- 代价：两份失败语义要各自维护（换锁屏/恢复出厂后「删键重填」的行为必须一致）；安全代码的重复比普通代码风险高。
- 修法：`SecureStorePlugin` 内部改成 `SecretBox(ALIAS, PREFS)` + 自己的三方法，删掉 ~60 行重复；单测不易覆盖（需真机 Keystore），至少做一次真机 smoke（设置 S3 密钥 → 杀进程 → 重开读回）。

#### P2-3 `mobile.html` 两个互相矛盾的 `theme-color` + 内联色字面量
- 仓库根 `mobile.html:6` `content="#f5f6f8"`、`:11` `content="#ededf1"`；`:14` 内联 `<style>html,body{background:#ededf1}</style>`；`capacitor.config.ts` 又写 `backgroundColor: '#ededf1'`。后一个 `theme-color` 生效，前一个是死值；三处「首帧底色」不共享来源。
- 代价：换主题/品牌色时漏改其一 ⇒ 启动瞬间状态栏色与页面不一致（只在真机可见，门禁抓不到）。
- 修法：删 `mobile.html:6`（保留 `:11`），在注释里指向 `capacitor.config.ts`；内联 style 属于「首帧防白闪」，保留但注明与 config 同源。

#### P2-4 大文件回涨，backlog 已落后于现状
- `docs/MOBILE-DESIGN.md:453` 记「HomePage 1116 / MobileApp 965 / EditorDock 844 / MobileUsheetViewer 998」；实测今天：`home/HomePage.tsx` **1312**、`MobileApp.tsx` **1076**、`usheet/MobileUsheetViewer.tsx` **999**、`editor/EditorDock.tsx` **844**、`settings/SettingsDrawer.tsx` **774`。
- 代价：HomePage 一个文件同时承担 5 个分页的卡片渲染 + 虚拟列表 + 多选 + 长按；开源后 review 成本高。**但它是「已登记 backlog」**，不是新问题 ⇒ 本项只要求**把数字更新进文档**，不要求本批拆。

#### P2-5 Kotlin 侧测试覆盖极薄
- 18 个 main 文件 / **4,752 行**，android 包测试只有 **5 个文件 / 279 行**（`AssetServerTest` 119、`AssetSyncPluginTest` 53、`AwsV4SignerTest` 42、`SharedContentPluginTest` 36、`OpenFilePluginTest` 29）。
- 零直接测试的最大风险面：`UpdatePlugin.kt`（613 行，含 sha256 + 证书指纹校验 + 系统安装器）、`PortablePackagePlugin.kt`（586，含 zip 解压 + 回滚）、`BodyStorePlugin.kt`（317，原子写 + gzip 快照）。
- 代价：这三块是「错了就丢数据/装错包」的路径；当前只能靠设备手测兜底。**不建议为了覆盖率写假测试**，建议按 §4 补 3 个「纯函数/路径级」测试（zip 条目名白名单、sha256/证书比对、原子写 falback）。

#### P2-6 文档/注释漂移（3 处，可一次性对齐）
1. `native/lakeNativeContract.ts:6-7` 注释仍写「实现本体 71 个方法、契约只暴露 47 个 bridge 方法」；`lakeNativeContract.test.ts:67` 钉的是 **67**（+1 extra = 68）。注释应改为与测试同口径。
2. `OpenFile` 插件在**两个文件各注册一次**：`bridge/assets.ts:19` 与 `editor/DocumentEditor.tsx:36`（两处 `registerPlugin<{open}>("OpenFile")`）。Capacitor 允许同名重复注册但会各自持有代理对象 ⇒ 两处行为漂移时很难查。建议只保留 `bridge/assets.ts`，`DocumentEditor` 从那里 import。
3. `docs/ARCHITECTURE.md` 只有 1 处提到移动端（`:56` 手写板）；移动端 25 个目录的架构事实完全不在其中 ⇒ 见附录 A-1。

#### P2-7 `native/` 目录的职责混装（登记即可，不拆）
- 实测 `native/` 44 文件里混了 3 类东西：①纯 Capacitor 端口（sqlite/bodyStore/assetFs…）；②启动编排（`kernelPrewarm`、`composerPrewarm`、`appInfoPort`）；③缓存清理（`cachePort` 反向依赖 `data/searchIndex`+`bridge/context`）。
- 代价：找代码时误导（「清缓存」在 `native/` 但业务在 `data/`）。**不建议拆目录**（搬迁 44 个文件 + 全量 import 路径，收益只是整洁，撞 §3#17 ③）。建议在 `native/` 加 6 行目录说明。

### 2.10 已核实「不是问题」（防止后续审计重复立项）

下面每一项都按「疑似问题」查过，结论是**维护现状**，附证据：

| 疑似问题 | 结论与证据 |
| --- | --- |
| 移动端与桌面存在大量复制粘贴 | **否**。对 `electron/**` 与 `src/mobile/**` 做同名函数扫描：仅 8 个同名（`subscribe`/`countRows`/`hashText` 等）且无一处是复制体；FTS 纯逻辑两端共用 `src/core/search/`（`mobile/data/searchIndex.ts:1` 与 `electron/searchRepository.ts:3` 同一 import）。 |
| 移动端 import 了桌面样式/桌面 UI 组件 | **否（有护栏）**。移动端只 import `src/styles/fonts/*` 与 `src/features/**`（内核宿主/共享组件）；桌面 CSS 白名单 4 条由 `mobileIndependence.test.ts` 卡住（`MOBILE-DESIGN.md:382`）。 |
| `!important` 失控 | **否**。移动端实测 15 条 < 棘轮 19（`grep -rn '!important' src/mobile --include=*.css | wc -l`），集中在 `editor/edit-surface-kernel.css`(7)。 |
| 颜色字面量散落 | **否**。294 处全部在 `theme/{tokens,light,dark}.css`（移动 theme 目录 = 移动端取值唯一来源，AGENTS §3#14 的移动对应物）。唯一非 theme 命中是注释。 |
| 浮层/toast/确认框有多套 | **否**。浮层四件套（`floating.css` + `ui/MobileSheet|MobileSheetMenu|ConfirmDialog|Toasts`）被 30+ 消费方复用；`showToast` 179 处调用 / 40 文件全走 `ui/toastBus`；错误 toast 已在 261107 收口到 `lib/actionError.ts`（文档称 34 处 / 12 文件）。 |
| 长按/多选有第二份计时器 | **否**。`ui/useLongPress.ts` 唯一实现；多选 `ui/useSelectionMode.ts` + `selection.ts`。 |
| 桥契约有可能少方法 | **否**。`lakeNativeContract.test.ts` 5 例钉住「声明⊆实现 + 计数 67/68 + 缺失即抛」。 |
| 明文密钥落 WebView | **否**。`native/keystoreSecretStore.ts` + `SecureStorePlugin.kt`；`localStorageSecretStore` 仅是 web/vitest 后端。 |
| 循环依赖 | **否**（3 组全是 `import type`，见 §1.2）。 |
| 性能无基线、靠感觉 | **否**。`.css-audit/perf/mobile-perf.json` 已 record（HEAD `fbb5c8ae`、5556、412×842、appVersion 1.1.0）：coldStartToHome p50 **1595ms** / worst 1674；capture 冷启 / 写作卡热开 / 键盘开合 long task / 文档打开 4 个指标同文件；`check:perfmobile` 做 compare。**换 AVD/重灌夹具必须 --record 重烤**（AGENTS §7）。 |

---

## 3. 方案（逐问题：根因 → 落点 → 验证）

| 编号 | 根因 | 落点 | 验证（最小） |
| --- | --- | --- | --- |
| P1-1 | 功能域规则历史堆进外壳文件，且顺序靠 import 图 | `mobile.css` `:839-874` → `board/board.css`；`:1049-1304` → `bitable/mobileBitable.css`；`:1256` → `editor/editor-dock.css`；同步 `mobileLayers.test.ts` BASELINE | `npm run check:mobileui`；`check:mobilesnap --states <多维表态>,<画板态>,<home-quicknotes>`；全量 10 态 + 23 屏只在发版前跑 |
| P1-2 | 两个 Kotlin 消费者各写一份路径校验 | 新增 `android/.../AssetPaths.kt`；`AssetServer.kt:174-190` 与 `AssetSyncPlugin.kt:29-45` 改为调用 | `cd android && ./gradlew testDebugUnitTest`（Kotlin 单测，非设备）；补 6 条对抗样例；设备手测缩略图/复制/导入各 1 次 |
| P2-1 | 令牌名笔误（`mb-` 前缀未定义） | `mobile.css:520` 一处 | `grep -- '--mb-radius-xl:' src` 应命中定义或使用处改 `--lake-radius-xl`；`check:mobileui` + 1 态快照 |
| P2-2 | 安全代码未真正抽成单一实现 | `SecureStorePlugin.kt` 改用 `SecretBox`；同步 `MOBILE-AI.md:354` 措辞 | 真机 smoke（写/读/删 S3 密钥各 1 次）；`gradlew test` |
| P2-3 | 三处首帧底色各自硬编码 | `mobile.html:6` 删除；注释指向 `capacitor.config.ts` | 设备冷启动截屏：状态栏色 = 页面底色 |
| P2-4 | backlog 未推进且未更新数字 | `docs/MOBILE-DESIGN.md:453` 更新实测行数（或标注「已回涨」） | 文档 diff 只有数字 |
| P2-5 | 原生高危路径零测试 | 优先补 3 个纯函数级测试（zip 白名单 / sha256+证书 / 原子写回退） | `gradlew testDebugUnitTest` 绿 |
| P2-6 | 注释/注册点/架构文档漂移 | `lakeNativeContract.ts:6-7`；`DocumentEditor.tsx:36` 改 import；ARCHITECTURE 补移动端索引（或明确「移动架构只在 MOBILE-*」） | `npx tsc --noEmit` + grep 计数 |
| P2-7 | 目录职责混装 | `native/` 顶部加说明注释（不搬迁） | 无门禁影响 |

**跨端统一 vs 保持独立的裁决（明确判据）**：

| 类别 | 裁决 | 判据 |
| --- | --- | --- |
| UI 组件 / CSS / 令牌**取值** | **保持两端独立**（现状正确） | 触屏密度、命中盒、手势、键盘态与桌面不可共用；AGENTS §3#14 已定。**不要**提议合并 `mb-*` 与 `ln-*`。 |
| 纯逻辑（FTS 构造、冲突判定、S3 协议、便携包格式、字体/图标编解码、日期格式） | **必须在 `src/core`**（现状已基本达成） | 「同一输入必须产出同一结果，且与渲染无关」。现状 FTS/`core/search`、`s3v3`、`portableFormat`、`nodeIcons`、`dateFormat` 都已共享。 |
| 数据访问（SQL/文件/事务） | **两端各自实现** | 宿主不同（better-sqlite3 vs Capacitor SQLite；Node FS vs BodyStore）。**不要**为「统一仓储」造抽象层。 |
| 原生能力契约（插件名/方法/错误） | **可以统一的是「形状」，不是实现** | 移动端无 IPC 错误码通道（`core/errorContract.ts` 只被 desktop 用），因此**不要把桌面错误码硬套到 Capacitor reject**；只需保持「插件名 = TS 常量、方法名 = 单一来源」这一层（现状已达成）。 |
| 样式「层序」 | **保持未分层现状，不做渐进 @layer 迁移** | `MOBILE-DESIGN.md:422-424` 已定：全端迁移是独立项目。本审计不推翻。 |

---

## 4. 分阶段迁移与设备门禁适配

**阶段 0（发版前必做，30 分钟内可完成）**：P2-1（1 行）、P2-3（1 行删除）、P2-6-1/2（注释 + OpenFile 去重）。门禁：`npx tsc --noEmit` + `npm run check:mobileui` + `git diff --check`；**不跑设备**（纯文本/无几何变化；P2-1 建议补跑 1~2 态）。

**阶段 1（发版前，1 个批次）**：P1-2（AssetPaths.kt 抽取 + 对抗单测）。门禁：`cd android && ./gradlew testDebugUnitTest`；`bash scripts/android-build.sh --sync --install` 后设备手测 3 条（缩略图、复制副本含图、便携包导入）。

**阶段 2（发版后第一批，独立批次）**：P1-1（样式域归位）。**必须**：
1. 只搬不写（搬完 `mobile.css` 净减 ≈ 300 行，feature 文件净增等量；`mobileLayers.test.ts` BASELINE 逐文件更新，总数守恒）。
2. 搬完先 `check:mobileui`（层/独立性不动），再跑**受影响的 2~3 态**：`check-mobile-snap.mjs --states home-quicknotes,doc-0,<平板对应态>`。
3. **只有确认 0 差异后**才在发版前的全量里跑 10 态 + 23 屏；若出现差异，优先怀疑「搬动改变了级联谁赢」，按「把搬走的规则在**新家保持不变的选择器特异性**」修正，不要用 `!important` 压（棘轮只许降）。
4. 更新 `docs/MOBILE-DESIGN.md:439-443` 的「CSS 审计结论」与本报告 P1-1 状态。

**阶段 3（持续）**：P2-5（Kotlin 测试）、P2-4（大文件拆分，按 backlog 顺序）、P2-7（注释）。

**门禁清单（移动端，来自 `package.json` + AGENTS §3#21）**：
```
npx tsc --noEmit && npx vitest run <相关文件> && git diff --check   # 每改动
npm run check:mobileui                                             # 动样式必跑
npm run check:mobilesnap -- --states <受影响态>                     # 动视觉/外壳
npm run check:tabletsnap / check:bitablesnap                      # 对应侧
npm run check:perfmobile                                          # 动启动/键盘/列表（本地，不进 CI）
bash scripts/android-build.sh --sync --install                     # 交付前（AGENTS §3#21④）
```
**装置红线提醒**：快照门禁依赖设备内数据，只在专用 AVD `lake_gate`（CDP 9336）+ 固定夹具上跑；重灌夹具或建过数据必须先重烤基线（AGENTS §7#14）。

---

## 5. 明确不做项（附理由，避免下一轮重复讨论）

1. **不做桌面/移动 UI 合并**，不共享 `ln-*`/`mb-*`、不共享 React 组件（AGENTS §3#14 定稿）。
2. **不做移动端 @layer 渐进迁移**（`MOBILE-DESIGN.md:422` 已定：独立项目）。本报告的 P1-1 只做「文件归位」，不改层。
3. **不拆 `native/` 目录**（P2-7 只登记）：搬迁 44 文件收益仅「整洁」。
4. **不为「统一错误码」改造 Capacitor reject**：移动端错误是 in-process 字符串 + `getNativeErrorMessage` 归一化，套 `core/errorContract` 的 7 码属过度设计（§3#17）。
5. **不把两端数据访问抽成「统一 Repository 抽象」**：宿主差异是本质差异。
6. **不重写 `mobile.css`**：只搬域外规则，保留外壳段；不要按「一屏一文件」重切（会打散现有 10 态基线的对应关系）。
7. **不清理 vendor / 内核 CSS / `inkPad.shared.css` 副本**（§3#18 + 类名集合护栏 `inkSharedCssParity.test.ts`）。
8. **不为 Kotlin 覆盖率写无断言/镜像式测试**；只补三个高危纯函数。

---

## 6. 需用户裁决

1. **P1-1 是否现在做？** 它是本轮唯一「动了就要跑设备门禁 + 可能需要重烤快照」的改动。收益 = 开源后可维护性（250+ 行错位规则归位）；代价 = 1 个批次 + 2~3 态快照 + 可能 1 次基线重烤。
   推荐：**发版后第一批做**（发版前只做阶段 0/1）。若用户希望「开源首版样式结构即正确」，则提前到发版前，但必须留出设备对拍时间。
2. **P2-2 的处理口径**：是「SecurityStore 改用 SecretBox（代码符合文档）」还是「改文档承认两份实现」？推荐前者（安全代码单一实现），但需要真机 smoke，可能影响已保存的 S3 密钥（**只换实现不换 alias/prefs 则无影响**，需确认）。
3. **`docs/ARCHITECTURE.md` 归属**：移动端架构事实目前只在 `docs/MOBILE-DESIGN.md` / `MOBILE-OPS.md`。是「在 ARCHITECTURE 加一节移动端索引」还是「ARCHITECTURE 明确声明只管桌面」？属于跨域文档裁决（不在本专项范围内）。

---

## 附录 A · 跨域线索（只记录，不深挖）

- **A-1 `docs/ARCHITECTURE.md` 已过期（对移动端）**：全文 182 行，仅 `:56` 提到 `MobileInkPad.tsx`；而 §1.1 的 25 个移动目录、14 个 Kotlin 插件、`bridge` 13 域都不在其中。该文件的 §4.2/4.3 SQLite 表清单也需与 `src/mobile/data/schema.ts`（460 行，`MOBILE_SCHEMA_VERSION`）对账。**建议由文档/桌面审计员处理**（本专项只读）。
- **A-2 `docs/MOBILE-DESIGN.md` 的 backlog 与门禁账本需要一次数字对账**（P2-4 引用了其中 1 条；`:382-389` 的「白名单 4 条 / 桌面类名 0 / !important 19」应与当前实测再核一遍）。
- **A-3 `getQuickNoteImage` 把整幅图片字节以 `Uint8Array` 过 JS 桥**（`bridge/quickNotes.ts:166`，消费方 `home/QuickNoteComposer.tsx:296`）。列表/卡片走 AssetServer 的 `?w=1024`（AGENTS §4 已定），但写作卡重开时这条路径可能是原图 ⇒ **大图（实测仓库里有 3000×2000、单条小记 660KB 的记录）在内存里会多一份**。本次未取证（需要设备堆采样），列为「待取证性能点」，不作为 finding。
- **A-4 移动端门禁脚本清单**（供发版清单复用）：`scripts/mobile-audit/{check-mobile-snap,check-mobile-snap-tablet,check-bitable-snap,capture-entry,edit-surface-invariants,perf-baseline,boot-timeline,insert-panel-geometry,long-doc-dom,keyboard-toggle}.mjs` + `scripts/css-audit/{mobile-walkthrough,audit-dead-css,audit-primitives,audit-lookalike}.mjs`。
- **A-5 `android/app/build.gradle`**：release 未配置签名时**回退 debug keystore 但保持 `debuggable=false`**（`:62-64` 有注释说明 SEC-03）；开源前需确认 CI secrets 路径（`ANDROID_KEYSTORE_PATH` 等 4 个环境变量）不会误发布「debug 签名制品」——这属构建/发布域，不在本专项结论内。
- **A-6 未覆盖清单（本专项明确没做的）**：未跑任何 vitest/构建/设备；未逐个 review 302 个移动测试的有效性；未做 55 个 feature 组件的逐行语义审查；未核对 `src/mobile/v3/*` 与 `core/s3v3` 的协议细节（属同步专项）；未审查 `bitable/`（6956 行）与 `usheet/`（6386 行）的业务逻辑正确性，只看了其样式/结构/桥接面。