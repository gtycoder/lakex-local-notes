# CODE-REVIEW-261015.md — 全面代码 review（前端 + 后端）与整改方案

> **本文件是「讨论议程」，不是执行单。** 本轮**只读**产品代码，未改任何源码；按用户 261015 指令：
> 只出方案，逐项讨论后再动手。
>
> 复现基线：`HEAD = origin/master = fc87325`、`git status` 干净（0 改动）。
> 所有数字都可由 §0.2 的命令重跑得到；口径与现有护栏不一致处一律标注「口径差」。

---

## B0 进度（261016 · 已完成）

**B0 = 先把红线变成可执行判据，不清理存量。** 落地文件只有一个：`scripts/ui-metrics.mjs`（+124 行），
已随本文档一起提交并推送。**未改任何产品代码、未改任何 CSS。**

| B0 项 | 落地内容 | 基线（只许降） |
| --- | --- | --- |
| C4-2 口径统一 | 桌面「颜色字面量 / `!important` / 令牌护栏」的扫描集合从**入口图 33 个**改为**全部桌面 CSS 58 个**（与字号护栏同口径） | 桌面 `!important` 由口径修正后的 **11** 起算 |
| C4-3③ 移动颜色护栏 | 新增「移动端非主题颜色字面量」统计 + 门禁（`src/mobile/theme/**` 才是合法归属） | **28**（全在 `mobile.css`） |
| C5-3 判据 | 新增「文字色误用裸 `--lake-accent`」统计 + 门禁（规则：文字一律 `--lake-accent-text`） | **36** |
| C4-4 跨文件棘轮 | 新增「跨文件重复 (选择器,属性) 组数」统计 + 门禁（补上 `cssLayers/mobileLayers` 只看文件内的盲区） | **298** / 全部对 9,190 |
| — 顺带 | 桌面「非主题颜色字面量 0」此前只报告不判失败 ⇒ 现在**硬判 0** | 0 |

**自证（必须做，本仓有探针静默失效 3 个月的先例）**：用两个临时探针文件注入 5 类违规，
实测 5 条护栏**全部咬人**（桌面颜色 0→1、桌面 `!important` 11→12、移动颜色 28→29、
accent 误用 36→37、跨文件重复 298→300，退出码 0→1），删除探针后逐项回到基线且退出码恢复 0。

**门禁实测（261016）**：`tsc` ✓ · 全库 vitest **258 文件 / 2010 例通过**（5 文件 16 例跳过）✓ ·
`check:core` 80 文件 0 违规 ✓ · `check:mobileui` ✓ · `check:bundle`（app-css 1.79MB ≤ 2MB）✓ · `git diff --check` clean ✓。

**B0 遗留（属 B2，不是 B0 缺陷）**：
① 基线本身**尚未清零**（移动颜色 28 / accent 36 / 跨文件 298）——B2 负责清理，B0 只保证**不再变多**；
② 桌面 `!important` 的**红线仍是 ≤10**，B0 只是把它从「不判失败」变成「≤11 的棘轮」，
   `AGENTS §3#14` 的文案未改；**Q2（放宽到 ≤11 还是删掉 `usheetEditor.css` 那条）仍待裁决**；
③ 跨文件重复的算法在 B0 实现时做了修正（旧的一次性脚本会把 `@media` 块内的规则整段漏掉），
   因此**基线数字由本文档初稿的 288 修正为 298**（分布：298 组全部是「恰好 2 个文件」）。

---

## 0. 方法、口径与纪律

### 0.1 扫描范围

| 范围 | 体量 |
| --- | --- |
| `src/**/*.ts,tsx` | 80,043 行 |
| `electron/**/*.ts,cjs` | 20,473 行 |
| `src/**/*.css`（含 1 个 vendor） | **73 个文件 / 11,586 行** |
| 模块数 | `src/core` 79 · `src/lib` 31 · `src/components` 31(+5 ui) · `src/hooks` 24 · `src/features/*` 8 个域 · `src/mobile` 91 个根条目 |

### 0.2 复现命令（本文件全部数字的来源）

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron

node scripts/ui-metrics.mjs                     # 官方硬指标（桌面/移动）
node scripts/check-core-boundaries.mjs          # core 平台泄漏
npx vitest run src/styles/cssLayers.test.ts src/mobile/mobileLayers.test.ts src/styles/geometrySources.test.ts

# 本次 review 的临时分析器（未入库，落在 /tmp）
node /tmp/review-css.mjs     # 去注释后统计 !important / 颜色 / 字号字面量（逐文件）
node /tmp/rev-cross.mjs      # 跨文件重复 (选择器,属性)
node /tmp/rev-state.mjs      # 跨端重复 + 状态类清单
node /tmp/rev-mod.mjs        # 模块依赖矩阵
node /tmp/rev-dup.mjs        # 同名函数跨文件定义
node /tmp/rev-accent.mjs     # 文字色是否误用裸 --lake-accent
```

### 0.3 判定纪律（AGENTS §3#17）

每条提案必须回答三问：**① 问题真实存在吗（有证据）？② 不做会付什么代价？③ 收益 > 新增复杂度？**
三问缺一即标「不做」，并在 §8 记录，避免下次重复提议。

### 0.4 一个重要的前提修正

用户担心「`!important` 滥用」与「层层套 CSS」。**实测结论是：红线基本没破**——
30 条 `!important` 全部有就地理由、跨文件重复只占 3.1%、73 个 CSS 全部被正确 import（0 孤儿）。
真正的欠账集中在三处：**移动端 `mobile.css` 的 28 个颜色字面量**、**护栏口径漏洞**、**状态样式仍有 41 处分散**。

---

## 1. 结论速览

| # | 议题 | 判定 | 真问题 | 建议动作 |
| --- | --- | --- | --- | --- |
| 1 | 公共函数/方法抽提 | 有真问题，量不大 | 7 组 | 直接抽，低风险 |
| 2 | 能力抽象与封装 | **大部分已具备**，别重做 | 3 项 | 只补缺口 |
| 3 | 模块划分/分层/分包 | 基本整齐 | 3 项 | 2 项纯搬迁（零行为变化） |
| 4 | 样式根位置 / 层层套 / !important | **红线达标** | 4 项（1 真违规 + 3 机制漏洞） | 先补护栏再清理 |
| 5 | 样式统一 / 选中态收归令牌 | 配对纪律好，但分散 | 3 项 | 补令牌族 + 收编 |
| — | 已用户定稿的边界 | — | — | **不讨论**（§8） |

---

## 2. 议题一：公共函数与方法抽提

### C1-1 `nowIso` 在 7 个文件里各写一遍 ★低风险

**证据**：`new Date().toISOString()` 的包装被定义 7 次——
`src/core/bitableDoc.ts:446`、`src/core/bitableMutations.ts:35`、
`electron/{quickNotes.ts:42,schemaInit.ts:4,trashLifecycle.ts:10,syncReconciliation.ts:8,store.ts:107}`。

**定性**：真实但极低价值。风险不在重复本身，而在**时间戳精度/时区口径**将来若统一（如改 UTC 周口径），7 处要同步改。

**方案**：抽到 `src/core/time.ts`（纯函数，符合 core 无平台依赖），electron 侧从 core 引。
**代价/收益**：约 7 行改动 + 1 个新文件；收益 = 口径单点。**建议做，但可并入其他批次**。

### C1-2 `formatBytes` 已有共享实现，仍有 2 处本地重写 ★低风险

**证据**：`src/lib/formatBytes.ts` 存在且被 `components/SettingsPanel.tsx:28`、`components/AssetsBrowser.tsx:19` 正确引用；
但 `src/components/SyncStatusPopover.tsx:46` 与 `src/mobile/settings/SettingsDrawer.tsx:57` 各自又写了一份。

**定性**：**明确的 DRY 违规**——同一进程内有 3 套实现，显示口径可能不一致（如小数位/单位阈值）。

**方案**：两处改引 `src/lib/formatBytes.ts`；若移动端因「不共享桌面样式」而想独立，注意**本项共享的是纯函数不是样式**，
`mobileIndependence.test.ts` 只禁样式 import，不受影响。
**验收**：`formatBytes.test.ts` 覆盖三种实现口径一致（或删掉重复后跑原有 snapshot）。

### C1-3 `escapeId` 在 3 个文件里逐字相同 ★低风险

**证据**：`src/features/editor/EditorTab.tsx:52`、`src/features/outline/OutlineList.tsx:10`、`src/features/outline/useOutline.ts:12`
三份 `CSS.escape` + try/catch 完全同构。

**方案**：抽到 `src/lib/cssEscape.ts`（或并入既有 DOM 工具文件）。**建议做**。

### C1-4 小记的 S3 key 构造在两处重复 ★★有实际风险

**证据**：
```
src/core/quickNotePush.ts:54-56      objectKey / assetKey / manifestKey
src/core/quickNotesSyncEngine.ts:226-228  objectKey / assetKey / manifestKey   ← 逐字相同
```
**定性**：这是**数据布局**，不是显示逻辑。两处独立实现意味着：将来改小记的对象前缀/命名，
**改一处漏一处 ⇒ 单条推送与整轮同步指向不同的对象**（会造成重复上传或读不到）。
AGENTS §4 已把「小记保存并同步 = 单条推送」列为高危路径（清单是单文件覆盖写、无 CAS）。

**方案**：把 quick-notes 的 key 布局抽到 `src/core/quickNoteKeys.ts`（`cfg` 派生），
`quickNotePush` 与 `quickNotesSyncEngine` 共用；测试里的同名私有副本同步改为引用。
**验收**：新增 1 例断言两个引擎对同一 (id, hash, filename) 产出相同 key；现有 `quickNotesSyncContract.test.ts` 复跑。
**建议做（优先级最高的抽提项）。**

### C1-5 日期/时间格式化散落 20+ 处，各写各的

**证据**：`pad = (n) => String(n).padStart(2,"0")` 在 `components/QuickNotesWorkspace.tsx:104/961`、
`components/SettingsPanel.tsx:51`、`components/NoteInfoDialog.tsx:27`、`mobile/ui/NoteInfoSheet.tsx:24`、
`electron/quickNoteConversion.ts:33` 各写一遍；另有 `mobile/home/HomePage.tsx:93-105` 与 `mobile/home/NotebookGrid.tsx:20-24`
各自内联「MM-DD HH:mm」；`src/lib/formatTime.ts` 已存在但只服务一处。

**定性**：真实但**分层敏感**——「今天显示 HH:mm、昨天显示 MM-DD、更早显示 YYYY-MM-DD」是**产品口径**，
现在这个口径散在 4 个入口里，任何一处调整就会出现「同一列表两种时间格式」。

**方案（建议分两步，不要一次做）**：
① 先抽**纯格式化** `src/core/dateFormat.ts`：`formatHm` / `formatMdHm` / `formatYmd` / `formatDateTime`（无本地化副作用）；
② **不**抽「相对时间策略」（那是产品语义，且桌面/移动列表口径可能有意不同）——
只在 §9 议题里问用户「两端列表时间措辞是否要一致」。
**验收**：抽完对拍现有快照（桌面 stylesnap 相关态 + 移动 6 态）+ 时间显示逐字符断言。

### C1-6 移动端多维表只读单元格重写了桌面已有的只读形态 ★★值得做

**证据**：`src/mobile/bitable/MobileBitableViewer.tsx`（272 行）里重写
`AttachmentCell:63` / `RatingCell:111` / `ProgressCell:124` / `LinkCell:136` / `RelationCell:145`；
而桌面 `src/features/bitable/bitableCells.tsx` 的同名组件**本就带 `readOnly` 分支**
（`:349 AttachmentCell(readOnly…)`、`:1084 LinkCell(readOnly…)`、`:1140 RatingCell`、`:1158 ProgressCell`、`:1246 RelationCell`）。

**定性**：**同一「只读渲染」语义在两处实现**，且桌面那份已经支持只读 ⇒ 移动端是在复刻一条已存在的分支。
风险 = 字段类型新增/语义变化时两处不同步（移动端今日的「只读控件」清单是 260929 手工补齐的）。

**方案（需讨论，涉及共享边界）**：抽出**只读展示**层（纯函数或 `<ReadOnlyCell field value/>`），
桌面与移动各自套自己的外观类名。**注意**：这**不**违反「移动端不共享桌面样式」——
共享的是渲染**逻辑**，类名仍由两端各自提供（与 `ImageLightbox`/`AttachmentPreview` 的既有口径完全一致，
见 `src/mobile/features.css` 头部注释）。
**验收**：移动端只读清单（bool 禁用复选、link href/target、5 星、进度百分比、关联 chip、时间到分钟）逐项设备复跑
（HANDOFF §8「多维表只读」既有判据）；`check:mobilesnap` 6 态 0 差异。

### C1-7 `NoteInfoDialog` 与 `NoteInfoSheet` 是同功能两端实现

**证据**：`src/components/NoteInfoDialog.tsx`（268 行）vs `src/mobile/ui/NoteInfoSheet.tsx`（147 行），
共享同名私有辅助 `fmtTime` / `fmtSize` / `rect` / `openAsset` / `copyId`（见 `rev-dup` 输出）。

**定性**：**形态差异是有意的**（Dialog vs Sheet，用户 261012 定稿移动端交互形态可重做），
但**「文档属性要显示什么」这份清单**被写了两遍（元数据 + 字数 + 引用资产 + 历史快照）。

**方案**：抽 `src/core/noteInfo.ts`：`buildNoteInfoRows(info)`（纯函数，产出 [{label, value, kind}]），
两个壳只负责渲染与交互。**收益** = 属性清单单点；**风险** = 低（纯搬迁）。
**建议做**，但排在 C1-6 之后。

### 已定稿、**不要**抽的（写入 §8 防重开）

- `src/components/settingsPrimitives.tsx`（143）与 `src/mobile/ui/settingsPrimitives.tsx`（139）：
  两端**有意 fork**，只共享 `settingsSearch.ts` 的设置项语义（文件头注释与 `MOBILE-TECH-UI-REDESIGN` 口径已写明，用户 261012 定）。
- 桌面/移动的 S3 store、repository 实现：见 C2-3 讨论，但**合并实现**不在本轮。

---

## 3. 议题二：能力抽象与封装

> **总判定：这个项目的「能力抽象」已经做得比一般项目好，主要缺口集中在「契约单点」而不是「重新抽象」。**

### C2-1 已具备的抽象（先确认，避免重做）

| 能力 | 现有抽象 | 状态 |
| --- | --- | --- |
| 多端存储/S3/缓存 | `src/core/ports.ts`（`CachePort` / `AppInfoPort`）+ `syncEngineTypes.ts`（`SyncDbPort`）+ `quickNotesSyncEngine.ts`（`QuickNotesSyncDbPort`） | 已有「端口注入」，两端口各自实现 ✅ |
| IPC | `electron/ipc/registrar.ts` 单一注册表，**Electron IPC 与 HTTP web 客户端（`webApiServer.ts`）共用同一批 handler** | 设计良好 ✅ |
| 内核资料检索 | AGENTS §2 三级检索 + vendor pin + `LAKEX-CONTRACT.md` | 已制度化 ✅ |
| 表格内核触点 | `src/features/usheet/usheetKernelContract.ts` + `univerContract.test.ts` + 运行时探针 | 已制度化 ✅ |
| 互斥域 | `src/core/maintenancePolicy.ts` + `mobile/maintenanceLocks.ts` | 已有单一判据 ✅ |
| 云同步状态 | `src/core/cloudState.ts`（两端共用） | 已有单一判据 ✅ |
| 搜索 | `src/core/search/`（桌面/移动共享） | 已共享 ✅ |

**结论：不要新建「能力抽象框架」。** 下面只补 3 个真实缺口。

### C2-2 IPC 能力面：116 通道，注册/暴露 **0 漂移**，但被手抄 3 遍

**证据**（可复现）：
```
preload 暴露通道: 116       主进程注册通道: 116
注册了但未暴露: 0           暴露但未注册: 0        ← 当前完全一致
```
但同一个能力面被**手写**在：`electron/preload.cjs`（165 行 `invoke` 清单）、
`src/lib/native.ts` 的 `LakeNative` 接口（110 个方法签名）、`src/mobile/bridge.ts`（68 个实现方法）。

**定性**：目前**没有漂移**（有 `electron/ipc/*.test.ts` + `lakeNativeContract.test.ts` 兜底），
所以这是「**将来会疼**」而不是「现在疼」：新增一个通道要改 3 处，且类型只在 `native.ts` 有。

**方案（保守，二选一）**：
- **A（轻）**：把通道名抽成 `electron/ipc/channels.ts` 常量表，preload/native/register 都从它引 ⇒ 拼写漂移不可能。
- **B（重，不建议）**：从注册表反推 preload 桥。
**建议 A**；B 会动 preload 的 CJS/asarUnpack 边界（AGENTS §7.10），风险不成比例。

### C2-3 领域仓储（Repository）能力面缺一个显式契约 ★★本轮最值得讨论的一项

**证据**：
- 桌面：`electron/store.ts`（1364 行）+ `noteQueries/noteMetadataRepository/trashRepository/historyRepository/searchRepository/assetRepository/resourceRepository/settingsRepository`
- 移动：`src/mobile/` 下 `noteRepository / treeRepository / trashRepository / historyRepository / quickNotesRepository / notebookTreeRepository / orphanAssetRepository / gcRepository / diagnosticsRepository`（**9 个**）
- `src/core/ports.ts` 只有 `CachePort` / `AppInfoPort`；**没有 `NoteRepository` / `TreeRepository` 契约**。

**定性**：两端实现了**同一组领域操作**（建/读/存/移/删/恢复/历史），但**没有共享接口**——
所以「桌面支持的语义，移动端是否支持」只能靠人读代码比对。这正是 HANDOFF 反复出现
「移动端漏了 X」「两端行为不一致」类缺陷的**结构性原因**（如 F16 互斥域、只读闸门、墓碑语义）。

**方案（建议分两步，先证价值）**：
① **不重构实现**，只**把契约显式化**：在 `src/core/ports.ts` 增加 `NoteStorePort` / `TreeStorePort` 接口（
  方法签名 = 当前两端**都已实现**的交集，先求同不求全）；
② 用**类型断言**把桌面对象与移动对象各自 `satisfies` 该端口（不改运行时行为）；
③ 再补一个「能力矩阵测试」：对每个端口方法断言两端都实现 ⇒ **漂移立刻红**。
**代价**：接口文件 + 2 处 `satisfies` + 1 个测试；**收益**：两端语义差异从「靠人读」变成「编译期 + 单测」。
**风险**：若强行要求两端签名完全一致，会把移动端特有参数（如 native sqlite 批处理）挤进接口 ⇒
**因此第一步只收交集，差集单独列成「已知差异表」**（不塞进接口）。
**这一项建议先讨论、后动手**（改动面涉及 core 类型 + 两端实现文件）。

### C2-4 S3 客户端两端实现（`electron/s3Store.ts` 239 行 / `src/mobile/s3Store.ts` 168 行）

**定性**：传输层不同（Node SDK vs Capacitor HTTP），**分成两份是正确的**。
需确认的是**协议层**（manifest 布局、ETag/条件写、错误分类、并发上限 8）是否也各写了一套。
**建议**：只做一次**协议对拍**（把两端的 key 生成、并发、重试、错误映射列成表逐项比对），
**不合并实现**。产出 = `docs/` 下一张对照表（或并入 `SYNC-PROTOCOL.md`）。

### C2-5 提示/Toast 能力：4 套实现（已定「暂缓」，本轮不重开）

AGENTS §3#10 已登记：`.sync-toast` / `.quick-notes-toast` / `.document-notice-toast` / 移动 `.mobile-toast`。
**保持不做**（验收难 + 跨端写域）。列入 §8。

---

## 4. 议题三：模块划分 / 分层 / 分包

### C3-1 `src/mobile/` 根目录 91 个条目（46 个非测试源码）平铺 ★★最清晰的一项

**证据**：
```
src/mobile/*.ts(x) 非测试源码 46 个：bridge.ts(1095) s3Store.ts(168) noteRepository.ts treeRepository.ts
trashRepository.ts historyRepository.ts quickNotesRepository.ts schema.ts sqliteDb.ts nativeSqlite.ts
persistence.ts viewportShell.ts secretStore.ts keystoreSecretStore.ts … + 7 个 use*.ts
（另有 editor/ home/ notebook/ settings/ ui/ theme/ trash/ bitable/ board/ usheet/ 共 11 个子目录）
```
**定性**：**混合了 5 类职责**：数据仓储（9）、原生桥（5）、持久化/迁移（4）、hooks（7）、杂项（bridge、schema）。
新人无法从目录判断该往哪放。**这是纯组织问题，零行为风险**。

**方案（建议一次搬迁，纯移动文件）**：
```
src/mobile/data/      noteRepository treeRepository trashRepository historyRepository
                      quickNotesRepository notebookTreeRepository orphanAssetRepository
                      gcRepository diagnosticsRepository schema sqliteDb persistence
src/mobile/native/    nativeSqlite nativeSqliteDb nativeSqliteMigration keystoreSecretStore
                      secretStore nativeKeyboard nativeAssetSync sharedContent assetFs
                      s3Store bridge                     ← 或拆 bridge 见 C3-5
src/mobile/hooks/     useAutoSave useAutoSync useBackHandler useCaretIntoView
                      useHorizontalSwipe useKeyboard usePanelDrag viewportShell(→hooks 或 ui)
src/mobile/           MobileApp main（保留入口）
```
**代价**：~46 个文件 + 引用路径改写（大量 import）+ `mobileLayers.test.ts` / `mobileIndependence.test.ts` 路径更新。
**收益**：结构可读；**风险**：低（有 tsc + 全库 1998 例 + 6 态快照兜底）。
**判据**：`tsc` + 全库 vitest + `check:mobilesnap` 6 态 0 差异 + 移动构建。
⚠️ **不要顺手改任何文件名/导出名**（纯搬迁，便于 review）。

### C3-2 `src/components/` 混装「应用屏」与「通用原语」

**证据**：31 个文件里 `Sidebar.tsx(1218)`、`SettingsPanel.tsx(1055)`、`QuickNotesWorkspace.tsx(987)`、`TrashPanel.tsx`、
`AssetsBrowser.tsx`、`SearchPanel.tsx` 是**应用屏**；`settingsPrimitives.tsx`、`colorPalette.css`、
`nodeIcon.css`、`historySnapshotPreview.css`、`markdown/` 是**原语/组件资产**；`ui/` 才是真原语。
另外 `src/components → src/features/*` 有 9 处依赖（`editor` 6 + `quickNotes` 3）。

**方案**：拆 `src/components/app/`（屏）与 `src/components/ui/`（原语）——
但**收益只到「结构更整齐」**，而 AGENTS §3#17 明确把「收益只停在代码更整洁」列为过度设计信号。
**建议：列为「可做可不做」，等用户裁决**；若做，与 C3-1 同批（都是纯搬迁）以免重复付回归成本。

### C3-3 `src/lib/` 有 10 个「一行转发壳」转发 `src/core/`

**证据**（`wc -l` = 1 行）：
`concurrency docStats keyedAsyncQueue markdownClean quickNoteModel requestVersion retry tabLimit tree treeIndex`
全部形如 `export * from "../core/xxx.js";`。

**定性**：这是**历史迁移层**（逻辑从 lib 搬到 core 后留的兼容出口）。它造成「同一个函数有两个合法 import 路径」⇒
新会话容易在 lib 与 core 各建一份。**但每份都仍有消费者**（如 `quickNoteModel` 16 处引用、`tree` 9 处），
**不能直接删**。

**方案（分两步）**：① 先用脚本列出每个壳的实际 import 点；② 逐个把调用方改到 `core/`，
③ 空壳删除。**收益** = 单一 import 路径；**风险** = 低但要改很多文件（机械改动）。
**建议做，独立批次，不带其他改动**。

### C3-4 模块依赖矩阵：**健康，无需整改**（记录备查）

- `core → lib` 6 处**全部是 `import type` / `export type`**（逐条核实：`syncEngineTypes` / `cloudState` / `syncAssets` / `syncModes` / `types.ts` / `quickNoteQueries`）⇒ **无运行时反向依赖** ✅
- 未发现 `core → features/components/hooks` 等分层倒置 ✅
- 最重的边：`hooks → lib`(48) · `components → lib`(42) · `features/bitable → core`(32) · `mobile/bridge → core`(19) —— 都是**正向**。
- 唯一需留意：`mobile/editor → features/editor`(11)，即移动端复用桌面编辑器运行时（`lakeRuntime.ts` 1745 行）——
  **这是有意的**（AGENTS §4：内核运行时不重复造），但意味着**改桌面编辑器会同时影响移动端**，
  属于已知耦合，登记为「注意」而非「整改」。

### C3-5 大文件是否拆分

| 文件 | 行数 | 内部函数/组件 | 判定 |
| --- | --- | --- | --- |
| `src/core/bitableDoc.ts` | 2258 | 139 | 多维表文档模型（序列化/字段/视图/筛选），**高内聚**；拆成「模型 / 序列化 / 迁移」可能值，但它是被测试重度覆盖的单一来源（`bitableDoc.test.ts` 1313 行）⇒ 建议**不动**，除非有具体痛点 |
| `src/features/bitable/BitableEditor.tsx` | 2075 | 55 | 拆点明确（Grid / 视图 / 配置面板 / 拖拽），但 261014 刚接入行窗口、正在稳定期 ⇒ **建议缓** |
| `src/features/editor/lakeRuntime.ts` | 1745 | 23 | 内核接线单一来源，**拆分会分散内核知识** ⇒ 按 AGENTS「一个语义一套实现」**不建议拆** |
| `src/mobile/bridge.ts` | 1095 | 15 | 移动端能力面，**可以按域拆**（notes / tree / quicknotes / assets / sync），但它是 `lakeNativeContract` 的派生源 ⇒ 拆分需同步契约测试。**建议列为可选** |
| `src/components/Sidebar.tsx` | 1218 | 29 | 261013 刚做过 memo 优化 ⇒ **不要碰**（回归风险 > 收益） |

**结论**：**本轮不建议为「行数」拆文件**。只建议 C3-1/C3-2/C3-3 这类**目录级**重组。

---

## 5. 议题四：前端样式 review（根位置 / 层层套 / `!important`）

### C4-1 `!important` 现状：**30 条，全部有就地理由 —— 红线没破** ★澄清项

**证据**（去注释后精确统计，比 grep 的 83 命中真实得多——另有 53 处只是注释里的**讲解**）：

| 文件 | 条数 | 是否压内核/第三方/内联 |
| --- | --- | --- |
| `mobile/editor/edit-surface-kernel.css` | 15 | ✅ 压内核注入的未分层样式（文件头写明） |
| `styles/components.css` | 5 | ✅ 1 条压 JS inline 宽度；4 条 `.seg__item`（见下） |
| `styles/tokens.css` | 3 | ⚠️ 见 C4-2 的「疑似死规则」 |
| `styles/compat.css` | 1 | ⚠️ `.fn__none{display:none!important}` 见下 |
| `styles/app/quick-notes.css` | 1 | ✅ 压内核 legacy 的 `position:fixed!important` |
| `features/usheet/usheetEditor.css` | 1 | ✅ 压内核写进行内样式的 `height:36px` |
| `mobile/mobile.css` | 2 | ✅ 压内核 `.ne-ui-boundary-popover` 定位 |
| `mobile/theme/dark.css` | 2 | ✅ 深色内核变量覆写 |
| **合计** | **30** | 28 条理由成立 |

**逐条可再评估的 2 组**：
1. `styles/compat.css:57` `.fn__none{display:none !important}`：
   该文件在 `layer(legacy)`。若 `.fn__none` 的唯一来源也是 legacy 层/未分层，则**普通声明即可**（未分层 >
   分层；同层靠顺序）。**建议实测验证后去掉**（保留 JSX 类名契约不变）。
2. `styles/components.css:308-309` 4 条 `.seg__item`：
   注释自己写明「这两个面板已不是横向 tab」——**`.ln-tabs` 接管横向页签后，`.seg` 的受众已收窄到
   「取值选择/图标型开关」**（设置页主题三选一、小记列表·卡片版式）。受众收窄 ⇒ **是否还需要这 4 条 !important 值得重测**。
   注释还记着一条事实：`.is-active` 里的 `color/background/border-color` **是被上面 !important 压死的死声明**——
   即**当前存在「注释宣称的设计意图」与「实际生效值」不一致**。这属于**清理项**，不是新增抽象。

**建议**：本轮只做「**验证后删**」两处，不新增任何 `!important`。

### C4-2 护栏口径漏洞：`ui-metrics` 的**颜色/!important 只覆盖入口图 33 个文件** ★★机制问题

**证据**（`scripts/ui-metrics.mjs:68`）：
```js
const desktopGraph = desktopCss.filter(p => reachableCss("src/styles/index.css").has(p));
const d = scan(desktopGraph);          // ← 颜色字面量 + !important 用这个集合
const fontSizeLiterals = … fontScope … // ← 字号却用「全部桌面 CSS」
```
- 桌面 CSS 共 **58 个**（73 − 14 移动 − 1 vendor）；`desktopGraph` 只有 **33 个**（就是输出里那个「样式文件 33」）。
- **不在图里的 25 个**包括 `features/bitable/*.css`(15) · `features/usheet/usheetEditor.css` ·
  `components/nodeIcon.css` · `components/colorPalette.css` · `components/markdown/markdown.css` ·
  `features/board/boardEditor.css` · `features/editor/noteRefCard*.css` 等（**组件直接 import，不走 index.css**）。
- **口径差实证**：官方输出「桌面 `!important` 10 / 目标 ≤10」，而真实桌面是 **11**——
  漏掉的正是 `features/usheet/usheetEditor.css:82`。**该文件自己的注释已经发现这件事**。
- 同源问题：**颜色字面量**护栏也只覆盖这 33 个文件（本次全量扫描确认那 25 个文件当前恰好 0 违规，
  所以「数字没骗人」，**但护栏是漏的**）。

**方案**：把 `scan()` 的输入从 `desktopGraph` 改成 `fontScope`（即「全部桌面 CSS，排除仅移动端的 b3」），
与字号护栏口径统一；输出里「样式文件 N」保留入口图 + 另列「实际扫描 M」。
**代价**：1 处改动 + 基线数字从 10 → 11（需同步 AGENTS §3#14 的「≤10」表述为「≤11 或先删掉那 1 条」）。
**建议**：**先修护栏口径，再谈清理**——否则清理成果无法被守住。

### C4-3 `src/mobile/mobile.css` 有 28 个颜色字面量 —— **唯一真实违规** ★★★

**证据**（去注释、非主题文件）：
```
src/mobile/mobile.css  28 处  ["#fff","rgba(16,24,40,.05)","#5b8def","#dfa03c", …]
（其余非主题文件全部 0 —— 桌面 0，移动其他文件 0）
```
**定性**：AGENTS §3#14 红线「**颜色字面量只允许出现在 `src/styles/themes/*`**」——
移动端对应物是 `src/mobile/theme/**`（`tokens.css` 134 个令牌 + `light`/`dark`）。
`mobile.css` **不是**主题文件 ⇒ **28 处全部是违规**。桌面有硬护栏（目标 0），**移动端没有颜色护栏**
（`ui-metrics` 对移动只统计 `var(--b3-*)` 与 `!important`，不统计颜色字面量）。

**方案**：
① 先从 28 处里**分类**：a) 本该有令牌（`#fff` → `--lake-bg-panel`/`--lake-text-on-accent`）；
   b) 数据驱动的（如「＋」号专用绿 `#00B96B` —— 用户 261012 已定「只有 + 号用绿」，它是**有意偏离**，
   应在 `mobile/theme/tokens.css` 定义 `--mb-brand-add` 之类并注明偏离理由）；c) 阴影/半透明
   （`rgba(16,24,40,.05)` → 应走与桌面同源的阴影令牌）。
② 逐类换令牌；**不改变任何观感**（令牌值 = 当前字面值）。
③ **给移动端补一条颜色护栏**（与桌面同口径：非 theme 文件 0 字面量）。
**验收**：`check:mobilesnap` 6 态 0 差异 + 走查 23 屏五类探针全 0 + 新护栏恒 0。

### C4-4 「层层套」的真实规模：跨文件重复 288 组 / 9,199（**3.1%**）

**证据**：同一 `(选择器, 属性)` 出现在多个文件里共 **298 组**（全部对 9,190）；
分布 = **298 组全部是「恰好 2 个文件」**。
**其中最大的一块是跨端复制**（见 C4-5），**桌面内部**的跨文件重复很少。
（口径说明：初稿用「整块删除 at-rule」的粗略算法得 288，会把 `@media` 内的规则整段漏掉；
B0 已换成正确的规则提取器 `extractRules()`，基线随之定为 **298**。）

**关键机制问题**：现有护栏 `src/styles/cssLayers.test.ts` 的 `dupGroups` 是**按文件内**统计的
（`scan(css)` 每个文件独立跑，`props` 是局部 Map）——**跨文件覆盖完全不在围栏内**。
这正是用户担心的「一层层套 CSS」**唯一没有护栏的形态**。

**方案**：把「跨文件重复 (选择器,属性)」做成**只许降的棘轮**。**✅ B0 已落地**（并入 `scripts/ui-metrics.mjs`，
基线 298，新增跨文件覆盖即 exit 1）。**收益**：把红线变成可执行判据——这是本轮**性价比最高的机制补强**。

### C4-5 跨端 CSS 复制：141 / 79 / 55 组 —— **已定稿，不合并**

**证据**：
```
src/styles/app/quick-notes.css      <-> src/mobile/quick-notes.css      141 组
src/features/attachment/attachment-preview.css <-> src/mobile/features.css  79 组
src/features/editor/image-lightbox.css         <-> src/mobile/features.css  55 组
```
**定性**：**这是有意设计**（`src/mobile/features.css` 头注释 + `mobileIndependence.test.ts` 明令移动端不得 import 桌面样式；
用户 261012 定「逻辑共享、外观各端自有」）。⇒ **不合并、不抽共享 CSS**。
**唯一建议**：补一条**漂移护栏**——对这三对文件断言「两端结构类名一致、差异只允许出现在已知清单内」，
防止将来只改一端（当前唯一的兜底是移动快照 6 态，而 Lightbox/附件预览**不在走查 22 屏覆盖内**，
注释里已自认这条路没验过）。**列为待裁决**。

### C4-6 「根位置修改」纪律：**已在执行，无需新机制**

证据：`kit.css` 的 `.ln-*` 原语收编（260930 大统一，overlay −29 / chrome −39 / bitableEditor −63）、
`@layer` 层序替代特异性、`!important ≤10`、`styles/*` 单一来源注释遍布。
**结论：这条纪律是达标的**，问题只在**护栏覆盖**（C4-2）与**存量违规**（C4-3）。

---

## 6. 议题五：样式统一（选中态等收归令牌）

### C5-1 选中态仍分散在 41 处 / 17 个文件

**证据**：
```
.is-selected   17 处 / 9 文件    components/colorPalette nodeIcon; features/bitable(2 文件);
                                 outline; mobile/kit(2) mobile/mobile mobile/ui/nodeIcon; styles/kit(6)
.is-active     18 处 / 12 文件   nodeIcon bitableEditor mobile/kit(2) mobile/mobile mobile/quick-notes
                                 app/quick-notes app/shell chrome(2) components(2) dialog kit(4) overlay
.is-disabled    8 处 / 1 文件    styles/kit.css   ← 单一来源（样板）
```
**好消息**：`styles/kit.css:137-143` **已经是选中三元组的单一来源**（注释写明：260930 把 4 处收成一处的
`accent-text + accent-tint + 600`），且配对纪律良好——**`accent-tint` 底 + `accent-text` 字 = 15 处，
`accent-tint` 底 + 裸 `accent` 字 = 0 处**。

**方案（建议只做「补齐」，不做「重构」）**：
① `.is-selected` 剩余的 8 个文件逐个核对：能挂 `.ln-row.is-selected` / 移动 `.mb-row.is-selected` 的**就地改类名**，
   不能的（彩色色板、节点图标网格 —— 它们是**图形选择**不是「行选择」）在 §9 逐条裁决；
② `.is-active` 里 `mobile/*` 的一批（`.bottom-bar-btn.active`、`.mobile-drawer-tabs button.active`、
   `.mobile-bottom-bar__item.active`）**是移动端选中态**，应统一到移动端原语（`mb-*`），而不是各写各的。

### C5-2 建议补的令牌族（**这是「收归令牌管理」的核心动作**）

现状：状态语义靠**组合已有令牌**表达（`--lake-accent-tint` + `--lake-accent-text`），
且**没有 `--lake-bg-selected` / `--lake-state-*` 家族**。可用令牌（已定义，两端各 134/136 个）：

```
--lake-bg-{panel,window,block,subtle,sunken,raised,canvas}
--lake-bg-hover(95 次) --lake-bg-press          ← 有 hover/press，没有 selected
--lake-accent(180) --lake-accent-text(45) --lake-accent-tint(71) --lake-accent-ink(-hover/-press)
--lake-text-1..4 --lake-disabled-opacity --lake-focus-halo/ring
```

**建议**：新增 **3 个语义别名**（值 = 现有值，零观感变化）：
```
--lake-bg-selected:   var(--lake-accent-tint)
--lake-fg-selected:   var(--lake-accent-text)
--lake-bg-selected-hover:  <浅一档>      ← 需先确认设计取什么值
```
然后要求「选中态只用这 3 个 + 字重」，配合 C4-4 的跨文件棘轮把分散实现**只许降**。
**代价**：3 行令牌（桌面 + 移动 theme 各一份 = 6 行）+ 收编调用点；**收益**：选中态从 41 处降到可枚举的一处来源。
⚠️ **风险/需用户裁决**：`--lake-accent-tint` 在深色下是 `rgba(154,171,206,.15)`，
「选中底 + hover 底」叠加时是否需要单独一档浅色 —— **这是设计问题，须用户定**，我不擅自定值。

### C5-3 规则与实现冲突：文字色误用裸 `--lake-accent` **36 处** ★★

**证据**（精确统计，排除 `border-color`）：
```
文字色 = var(--lake-accent)      36 处   ← 违反规则
文字色 = var(--lake-accent-text) 45 处   ← 正确口径
border-color = var(--lake-accent) 28 处   ← 合法（图形/边框）
```
典型违规点：`mobile/editor/editor-dock.css`（`.med-btn.med-active`、`.med-f-btn.med-f-on`、
`.med-doc-item.med-active`）· `mobile/mobile.css`（`.bottom-bar-btn.active`、`.mobile-bottom-bar__item.active`、
`.mobile-trash-action`、`.mobile-search-snippet mark`）· `styles/app/quick-notes.css`（`.quick-notes-tool-btn.is-on`）·
`features/bitable/*`（`.bt-link-open:hover`、`.bt-add-round:hover`、`.bt-icon-btn.is-on`）。

**规则出处**：AGENTS §3#14 ——「**文字一律用 `--lake-accent-text`**；`--lake-accent` 只做图形/边框/焦点环/底纹」。
**定性**：真违反，且**移动端占多数**（与 C4-3 同源：移动端缺同类护栏）。
**方案**：36 处逐条换成 `--lake-accent-text`（**注意深色下两者取值不同**，换完必须跑移动 6 态 + 桌面相关态对拍，
不能盲改）；换完把该判据加入护栏（扫描：非 theme 文件里 `color: var(--lake-accent)` 必须为 0）。

### C5-4 移动端令牌与桌面令牌「同名不同源」

**证据**：桌面 `themes/base.css` 136 个 + `light/dark/warm` 各 52/62/52；
移动 `mobile/theme/tokens.css` 134 个 + `light/dark`。**同名令牌（`--lake-bg-hover` 等）在两个 theme 目录各定义一份**，
取值部分相同（`light` 下 `--lake-bg-hover` 两端都是 `#f0f1f3`）、部分不同（深色 `--lake-accent-tint` 两端相同）。

**定性**：**这是有意设计**（移动端自有取值层，`MOBILE-TECH-STACK §九` 与 `mobileIndependence.test.ts` 已固化）⇒ **不改**。
**唯一建议**：登记一张「同名令牌取值差异表」（自动生成即可），让「有意不同」与「漂移」可区分。

---

## 7. 建议批次顺序（**先护栏，后清理**）

| 批次 | 内容 | 风险 | 可独立验收 |
| --- | --- | --- | --- |
| **B0 护栏** ✅ **已完成 261016** | C4-2（ui-metrics 口径统一）· C4-4（跨文件重复棘轮）· C4-3③（移动颜色护栏）· C5-3 判据 | 低 | 是（只加指标与门禁） |
| **B1 抽提** | C1-2 `formatBytes` · C1-3 `escapeId` · C1-4 **小记 key**（最高价值） · C1-1 `nowIso` | 低 | 是 |
| **B2 样式合规** | C4-3（28 处颜色 → 令牌）· C5-3（36 处字色）· C5-1（选中态收编）· C5-2（3 个语义令牌） | **中**（视觉） | 是（6 态 + 走查） |
| **B3 结构搬迁** | C3-1 `src/mobile` 分目录 · C3-3 `src/lib` 转发壳 | 低（纯移动） | 是 |
| **B4 契约显式化** | C2-3 Repository 端口 · C2-2 IPC 通道常量表 | 中 | 是 |
| **B5 待裁决** | C3-2 `components` 拆分 · C3-5 bridge 拆分 · C4-5 跨端漂移护栏 · C1-6 只读单元格共享 · C1-7 属性清单 | — | — |

---

## 8. 已定稿、**不再讨论**的边界（防重开）

1. **移动端不共享桌面样式**（`mobileIndependence.test.ts`）⇒ 跨端 CSS 复制**保留**，只谈漂移护栏（C4-5）。
2. **移动端设置页原语自建**（`settingsPrimitives` 两端 fork，用户 261012 定）⇒ **不合并**。
3. **提示/toast 不统一**（AGENTS §3#10 已登记暂缓）⇒ 不重开。
4. **内核 vendor 只做最小改动**（`LOCAL-CHANGES.md`）⇒ 不动 vendor、不升级内核。
5. **不清理第三方/依赖侧死代码**（AGENTS §3#18）。
6. **不为行数拆大文件**（本文件 §4 C3-5 结论）。
7. **`!important` 不是「滥用」**——30 条中 28 条理由成立；只做「验证后删」，不批量去 important
   （`components.css:298-307` 已记录 260923 批量去 important 导致宽度 1000→840 的教训）。

---

## 9. 待裁决问题清单（逐项讨论用）

| # | 问题 | 我的建议 | 需要用户定什么 |
| --- | --- | --- | --- |
| Q1 | 先做哪些批次？ | **B0 + B1**（护栏 + 抽提，零视觉风险） | 是否同意「先护栏后清理」 |
| Q2 | C4-2 护栏口径修正后，桌面 `!important` 从 10 → 11，是**放宽到 ≤11** 还是**先删掉 usheet 那条**？ | 先查能否删（内核行内高度是实测写死的，可能删不掉）⇒ 放宽到 11 并写明 | 二选一 |
| Q3 | C5-2 是否新增 `--lake-bg-selected` / `--lake-fg-selected` / `--lake-bg-selected-hover`？后者取什么值？ | 前两个直接加（零观感）；第三个**需设计取色** | 取色值 / 是否要 hover 变体 |
| Q4 | C5-3 的 36 处字色换成 `--lake-accent-text` 会**改变深色下的观感**，是否接受？ | 接受（这是红线要求），但需逐屏对拍 | 是否接受可能的深色细微变化 |
| Q5 | C4-5 是否加「跨端结构类名漂移护栏」？ | 加（Lightbox/附件预览不在走查覆盖内） | 是否认可其价值 |
| Q6 | C2-3 Repository 端口是否只收「交集」、差集单列成表？ | 是（避免为统一而扭曲签名） | 是否同意这个克制的口径 |
| Q7 | C1-6 移动端只读单元格复用桌面只读渲染（共享逻辑、不共享样式）？ | 做（桌面已有 readOnly 分支） | 是否认可边界 |
| Q8 | C3-1 `src/mobile` 目录重组（46 文件纯搬迁）本轮做不做？ | 做（低风险，独立批次） | 排期 |
| Q9 | C3-2 `src/components` 拆 `app/` + `ui/`？ | **倾向不做**（收益只到「更整洁」） | 裁决 |
| Q10 | C1-5 时间格式：桌面与移动列表的时间措辞是否要求一致？ | 先只抽纯函数，不动产品口径 | 产品口径 |

---

## 10. 附：本次 review 的原始数字（便于复核）

- `!important` 真实声明 **30**（桌面 11 / 移动 19）· grep 命中 83（53 为注释讲解）
- 非主题颜色字面量：桌面 **0** · 移动 **28**（全在 `mobile/mobile.css`）
- 字号字面量：桌面 **0** · 移动 **46**（`mobile.css` 38 + `editor-dock.css` 8，基线 49）
- 跨文件重复 `(选择器,属性)`：**298** / 9,190（B0 用正确提取器复测后的口径，见 C4-4）
- 跨端复制：quick-notes **141** · attachment-preview **79** · image-lightbox **55**
- 状态类：`is-selected` 17/9 · `is-active` 18/12 · `is-disabled` 8/1 · `is-on` 5 · `is-checked` 4 · `is-open` 2 · `is-current` 1 · `is-dragging` 3
- 字色误用：裸 `--lake-accent` **36** · `--lake-accent-text` **45** · `border-color` 用 accent 28（合法）
- IPC：注册 **116** = 暴露 **116**，漂移 **0**
- 同名函数跨文件定义 **147** 组（人工筛出真问题 7 组）
- 模块依赖：`core → lib` 6 处于**全部 type-only**，无反向运行时依赖
- CSS 孤儿文件 **0**（73 个全部被 import）
