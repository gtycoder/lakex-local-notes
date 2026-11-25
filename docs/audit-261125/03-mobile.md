# 03 · 移动端域审计（第 3 流 · 只读 · 261125）

> 范围：`src/mobile/**`（377 个非测试文件 / 约 94k 行 TS+TSX）、`android/**`（16 个 Capacitor 插件 + 纯规则 Kotlin + JVM 单测）、
> 移动端桥接（`src/lib/native.ts` 移动部分、`capacitor.config.ts`、`vite.mobile.config.ts` / `scripts/android-build.sh` 构建接线）、
> `docs/MOBILE-OPS.md`、`docs/MOBILE-TECH-STACK.md`。桌面/electron/core/样式/文档由其它流负责；
> 本流只在「移动与 electron 各写一份同一逻辑、该上移 core」处对 electron 侧做对照取证。
> **只出方案不改代码**；每条 file:line 均为本次实读核实。无法当面核实的条目已标「未核实」。

## 1. 概览

**范围与方法**：先读 AGENTS.md、docs/HANDOFF.md §0/§1/§2/§3、MOBILE-TECH-STACK（十节全文）、MOBILE-OPS 全文；
再按五条审计目标逐项取证——重复抽提用「同名工具/同语义判据」全仓 grep + 实读比对；能力抽象核对 gone/同步状态/保存闸/
键盘/缩略档位/桥接契约/DB 分层各自的判据来源；大文件取 wc + 结构映射；历史兼容逐条判 AGENTS §3#7；
死代码用「生产/测试/脚本三方引用扫描」（对照 lakeNativeContract 与 16 个 Kotlin 插件方法面）。

**总体评价**：移动端是全仓收口纪律最好的域之一。已收敛、本次确认无需再动的面：
- **契约面有机制护栏**：bridge 方法归属（T1/T2/T3/TEST_SEAM）由 contractSurface.test.ts 卡死、TEST_SEAM 只许变小
  （`src/mobile/contractSurface.test.ts:64-72`）；lakeNative 声明缺实现当场抛（`native/lakeNativeContract.ts:46-60`）。
  全仓引用扫描未发现死 bridge 方法 / 死原生方法 / 引用已删方法的过期脚本
  （`scripts/mobile-lake-coverage.mjs:180` 的 `createNoteIn` 经核对是**桌面**实例入口，desktop `preload.cjs:124` 存在，非过期）。
- **错误归一/toast/Sheet/时间格式化已单一来源**：toastActionError + reportMobileActionError 分层收口
  （`lib/actionError.ts:1-10` 自述收编前 37 处手写）；Sheet 原语 = `ui/MobileSheet.tsx` + useSheetResize/useSwipeToClose；
  列表时间 = `core/dateFormat.formatListTime` 单一来源 + `mobile/lib/listTime.ts` 薄包装（:1-8）。
- **同步编排已上收 core**：v3 走 core/s3v3 + 两端 PlatformDataPort 适配（`mobilePlatformPort.ts:26-43` 自述逐字段对齐）；
  同步状态写入点唯一（`sync/syncStatusStore.ts`）；S3 闸门/云状态判据在 core（cloudSyncGate/cloudState）。
- **gone 主判据单一**：`core/syncDecisions.isGoneNote`（`syncDecisions.ts:81-83`）+ noteGoneState 只供原料
  （`noteRepository.ts:154-175`），MobileApp/useWorkspaceSession/useNotebookTabs 全部过 core 判定。

**余留问题四类**（对应下方 M 清单）：
1. **测试后端进了启动产物**：sql.js（生产 Android 从不用）被打进首屏 chunk，685KB wasm 随 APK 分发（M-01）。
2. **Kotlin 侧纯规则先例未铺开**：RemoteAssetRules/CameraCaptureRules 已示范「纯规则对象 + JVM 单测」，
   但原子写 4 处 3 种 tmp 命名、魔数嗅探两份、路径包含检查 5 处仍未收口（M-03/M-11/M-16）。
3. **少量「双唯一来源」与两端各写一份**：缩略档位两个常量（M-08）、回收站子树两路边集两端各一份实现（M-02）、
   S3 Secret 掩码/留空沿用三处（M-10）、GB 体积阶梯两份逐字重复（M-09）。
4. **大文件与注释欠账**：7 个 800+ 行文件、24 个文件缺头注释、个别过期注释锚点（M-04/M-05/M-06/M-14/M-15）。

**无 P0/P1 级**数据安全/同步语义缺陷；下列方案以 P2 为主，P3 项多为登记或顺手清。

---

## 2. 方案清单

### M-01 · sql.js 测试后端不该进启动 chunk 与 APK（P2 · 移动/构建）

- **问题与证据**：
  - `src/mobile/data/sqliteDb.ts:2` 自述「测试专用移动 SQLite：sql.js……生产端是 Android 原生 SQLite」，
    但 :11-12 **静态** import sql.js 与 wasm 资源；生产路径 initializeDb 只开 NativeSqliteDb（`bridge/context.ts:89-92`），
    SqlJsDb/SqlJsAsyncDb 全仓唯一非测试消费者 = `native/nativeSqliteDbTestMock.ts:1-8`（测试 mock）。
  - 生产文件从 sqliteDb.ts 取的只是类型与 executeBatch/executeBatchInTransaction 小工具（如 `bridge/notes.ts`、
    `v3/mobilePlatformPort.ts:42` 的 import）⇒ 整个 sql.js 胶水被打进 `vite.mobile.config.ts:133-137` 的
    "mobile-bridge-data" 首屏 chunk（实测 `dist-mobile/assets/mobile-bridge-data-*.js` 含 sql-wasm/UTF8ToString/getAsObject 标记）。
  - `sql-wasm-*.wasm`（684,897B）被 cap sync 原样打进 APK：`android/app/src/main/assets/public/assets/sql-wasm-*.wasm` 实测存在。
- **具体方案**：把 sqliteDb.ts 拆两半——`data/dbPortTypes.ts`（DbLike/MobileDb 接口 + executeBatch* 纯工具，零重依赖）
  与 `data/sqliteDbWeb.ts`（SqlJsDb/SqlJsAsyncDb + initSqlJs，仅测试 mock 与浏览器兜底**动态 import**）；
  调用点只改 import 路径；wasm 由 lazy chunk 带走（浏览器预览才会拉）。护栏：`mobileLazyChunks.test.ts` 加一条
  「入口静态图不得出现 sql.js」+ check:bundle 复测首屏数字。
- **代价与风险**：一次性搬移约 200 行、调用点 import 改名（机械）；风险 = 测试 mock 的动态 import 时序（单测内 await 即可）。
  浏览器预览本就停在 booting（MOBILE-OPS §4），行为零变化。
- **优先级**：P2（启动解析 + APK 体积都有实测收益，且与 HANDOFF「mobile entry 瘦身」方向一致）
- **涉及端**：移动（+ 构建产物）

### M-02 · 回收站子树「两路边集」两端各写一份实现——上收纯判据 + 对拍（P2 · 移动/桌面/共享）

- **问题与证据**：
  - 移动端 collectSubtree（`src/mobile/data/trashSubtree.ts:33`，头注释 :5-10）用 JS 图遍历实现
    「parent_id 边 ∪ deleted_from_parent_id+trashed_at 边」（:44-50 注明「与桌面 trashLifecycle.purgeSubtreeIds 同口径」）；
  - 桌面同语义是 SQL 递归（`electron/trashLifecycle.ts:88-105`，:90 明写「判据 = 两条边取并集」）+ 级联更新（:147-175、:263-294）。
  - 两端各自的回归用例夹具**不同源**（`electron/trashCascade.test.ts` 用 Store 实例自建树；
    `src/mobile/data/trashCascade.test.ts:318,342` 有自建 Fixture + assertTrashLifecycle）⇒ F-01 那类边集漂移只能靠两端各自记得改。
- **具体方案**：不合并两种实现（桌面 SQL 递归有 5k 文档性能理由），只上收**判据数据**：
  ① `core/trashSubtreeScenarios.ts` 导出共享场景表（树形 + 期望两路边集，含「同步扁平化后 dfp 链」场景）；
  ② 移动端 collectSubtree 单测、桌面 trashLifecycle 单测都消费这张表做**对拍断言**（MOBILE-TECH-STACK §一的「跨端对拍证明等价」路线）；
  ③ 两端文件的边集注释改为指向它。
- **代价与风险**：新增一份纯数据 + 两处测试改造（~150 行）；不改任何生产行为。收益 = purge/restore/级联语义的漂移会被 CI 抓住
  （该语义历史上出过 F-01 漏 purge 子文档）。
- **优先级**：P2（语义同源 + 有历史事故证据）
- **涉及端**：移动 / 桌面 / 共享（core 纯数据）

### M-03 · Kotlin 原子写 4 处 3 种 tmp 约定——抽 AtomicFiles.kt（P2 · 移动）

- **问题与证据**：
  - `BodyStorePlugin.kt:61-79` `atomicWrite`（tmp = "target.name + .tmp- + UUID"，rename 失败重试一次再抛）；
  - `AssetSyncPlugin.kt:404-418` `atomicWriteBytes`（同构第二份，重试/清理逻辑逐行不同）；
  - `AssetSyncPlugin.kt:257-289`（流式下载 tmp = ".tmp-" 前缀式）与 :627-649（".tmp-download-" + UUID）各自手写 temp+rename；
  - `PortablePackagePlugin.kt:517-519`（"PENDING_FILE + .tmp" 写后 rename）。
  ⇒ 同一「原子写」4 份实现、3 种临时名约定；且残留过滤口径不一（:124/:342/:378/:476 只按 ".tmp-" **前缀**过滤，
  对「name + .tmp- + UUID」后缀式残留**认不出来**——命名与过滤器在漂）。
- **具体方案**：新增 `android/.../AtomicFiles.kt`（`writeAtomic(target, bytes)` / `streamAtomic(target, writeBody)`，
  统一 tmp 命名 = ".tmp-<uuid>-<name>" 并提供 `isTemp(name)` 过滤器），四个调用点替换；JVM 单测钉
  「中断不留半文件 / rename 失败重试 / 过滤器兼容三种历史命名」。
- **代价与风险**：~120 行新文件 + 4 处替换；替换期间旧 tmp 残留需过滤器兼容历史命名（双判前/后缀即可）。
- **优先级**：P2（≥3 处重复、语义同源、过滤器漂移有脏清单实际风险）
- **涉及端**：移动（Kotlin）

### M-04 · EditorDock.tsx（881 行）拆分：命令判据 / 面板 JSX 分离（P2 · 移动）

- **问题与证据**：`src/mobile/editor/EditorDock.tsx` 单文件混三层：
  ① 纯判据函数 lineHeightValue/activeMarkFromDom/isCommandEnabled/isCommandActive/readCommandValue（:57-186）；
  ② 状态 hook useActiveCommandStates/useEditorExec（:189-265）；
  ③ 组件本体（:267-881），其中插入面板 + Aa 字体面板 JSX 集中在 :739-847。头注释质量高（:1-13）但文件已过「改一处面板要滚过整条命令簿记」的线。
- **具体方案**：抽 `editor/dockCommandState.ts`（①②，纯函数 + hook，含 :140-143 命令生效判据注释）与
  `editor/DockPanels.tsx`（③ 的面板 JSX，props 收「命令执行器 + 当前值」）；EditorDock 只留工具栏 + 编排。
  护栏既有：execCommand.test（命令入口唯一性）、dockPanelFocusGuard、edit-surface-invariants 装置（动几何必跑）。
- **代价与风险**：纯搬移；风险 = 「取值型命令不另造一套」的注释契约（:24-27）须随代码搬走。移动改动 ⇒ 交付前装包（AGENTS §3#21④）。
- **优先级**：P2
- **涉及端**：移动

### M-05 · SettingsDrawer.tsx（865 行）：S3/同步视图块抽 S3SettingsSection（P2 · 移动）

- **问题与证据**：`src/mobile/settings/SettingsDrawer.tsx` 内 `view === "s3"` 整块（:444-695，约 250 行：
  第三方说明/连接表单/云同步闸门/首次相遇询问/上次同步/同步诊断/警告清单）内联在主组件；同文件其它视图已走分节组件模式
  （:381-385 AppearanceSettingsSection/AiSettingsSection/HistorySettingsSection、:764 UpdateCenterSection、:741 PortableImportSection）
  ⇒ s3 是唯一没按模式抽的大块。整文件注释密度 26/865 偏低。
- **具体方案**：抽 `settings/S3SettingsSection.tsx`（props = useS3SettingsForm 状态面 + 首次相遇回调），与既有分节同形；
  `data-set-id` 逐个保持不变（settingsSearch.ts SETTING_ITEMS 契约 + settingsSearch.test 卡）。
- **代价与风险**：纯搬移 + props 面设计；风险 = 首次相遇弹窗与手动同步按钮回调时序；改后跑 bridgeCloudState.test + 设置屏 mobilesnap 态。
- **优先级**：P2
- **涉及端**：移动

### M-06 · 其余大文件拆分登记（P3 · 移动）

- **问题与证据**（实测行数）：home/HomePage.tsx 1440、MobileApp.tsx 1245、bitable/MobileBitableViewer.tsx 1041、
  usheet/MobileUsheetViewer.tsx 1006、v3/mobilePlatformPort.ts 791、android/PortablePackagePlugin.kt 1062、
  AssetSyncPlugin.kt 723、notebook/NotebookWorkspace.tsx 647、portable/importPortable.ts 637、bridge/sync.ts 617。
  结构映射实测：HomePage 的 QuickNoteCard 整体在文件尾（:1255-1440，含独立常量 IMAGE_TAP_WINDOW_MS :1255）；
  MobileApp 尾部三个页面组件 MobileBootErrorPage/MobileDatabaseProblemPage/MobileHomeSkeleton（:1115/:1160/:1204）与主组件无关；
  mobilePlatformPort 的 createMobilePlatformPort（:97-735）与 createMobileBodyFileDriver（:737-791）是两个独立工厂。
- **具体方案**（按性价比排序，均为纯搬移）：
  ① HomePage 尾部 QuickNoteCard → `home/QuickNoteCard.tsx`（约 185 行出栈）；
  ② MobileApp 尾部三页面组件 → `MobileBootPages.tsx`；
  ③ createMobileBodyFileDriver → `v3/mobileBodyFileDriver.ts`（只依赖 noteBodies/assetFs）；
  ④ PortablePackagePlugin.kt 见 M-16；AssetSyncPlugin.kt 本地资产 fs 面（:302-530）与远端下载（:554-660）可拆两文件。
  MobileBitableViewer/MobileUsheetViewer 内部耦合高（10+ useState/视图状态机），**只登记不强推**：优先抽各自工具条/面板子组件，
  别整文件重排（对齐 InkPad 拆分「先迁护栏再动」的既有教训，HANDOFF §2）。
- **代价与风险**：每项 30-80 行机械搬移；风险 = keep-alive/懒加载 chunk 归属变化（动后跑 check:arch + mobileLazyChunks + 装包）。
  收益是可维护性 ⇒ 触 §3#17「整洁」红线，故全部 P3、有真实改动需求时顺路做。
- **优先级**：P3
- **涉及端**：移动（④ Kotlin）

### M-07 · SQL IN 占位符 / chunk 小工具 4 处重复（P3 · 移动）

- **问题与证据**：`placeholders` + `chunk` 逐字重复于 `bridge/duplicateNotes.ts:31,33`、`bridge/batchNotes.ts:66,72`
  （各有 `SQL_CHUNK = 400`：duplicateNotes.ts:27、batchNotes.ts:43）；`v3/mobilePlatformPort.ts:91` 又一份 chunk；
  另有 10 处内联 `map(() => "?").join(",")`（mobileDeviceStore.ts:236,263,290,439、mobilePlatformPort.ts:376,545,711、
  diaryRepository.ts:147、gcRepository.ts:17、quickNoteTagsRepository.ts:255 等）。
  `core/sqlParameterBatch.ts` 已有分批工具（500/批）不管占位符，与移动的 400 口径并存。
- **具体方案**：core/sqlParameterBatch.ts 旁加 `placeholders(n)` 与 `chunkBatch(items, size)`，统一 400/500 口径注释；替换重复处。
- **代价与风险**：~40 行纯机械。**如实说**：收益主要停在「整洁」⇒ P3 封顶、顺手做。
- **优先级**：P3
- **涉及端**：移动 / 共享

### M-08 · 图片缩略档位出现两个「唯一来源」+ 三份档位表（P3 · 移动/共享）

- **问题与证据**：
  - `src/core/quickNoteImageThumb.ts:34` `MOBILE_IMAGE_THUMB_WIDTH = 1024`，注释自称「显示缩略档位（px）**唯一来源**」；
  - `src/mobile/home/quickNoteImage.ts:24` `CARD_IMAGE_THUMB_PX = 1024`，注释自称「卡片内图片统一档位」——同值双常量，只改一处即漂。
  - 档位集合三份：`core/assetUrl.ts:105` `ASSET_THUMB_WIDTHS = [128,256,512,1024]`（有测试钉值 assetUrl.test.ts:87）、
    `electron/assetServer.ts:118-119`、`AssetServer.kt:57-61`——后两处靠注释「必须与 core 一致」维系，无对拍。
- **具体方案**：① CARD_IMAGE_THUMB_PX 改为引用 core 常量（留一行别名）；② 加轻量一致性测试（读两处字面量与 ASSET_THUMB_WIDTHS 对拍，
  静态校验风格同 check-android-release-config，解析不到要显式红）。
- **代价与风险**：~30 行；无行为变化。
- **优先级**：P3 偏上（档位漂移后果 = 缩略缓存打散/请求被拒，属低概率真 bug）
- **涉及端**：移动 / 桌面 / 共享

### M-09 · GB 体积阶梯两份逐字重复（P3 · 移动/共享）

- **问题与证据**：`src/mobile/portable/exportPortable.ts:115-121` 与 `src/core/update/updateManifest.ts:111-121` 的 formatBytes
  逐字同构（B/KB/MB/GB 阶梯 + 一位小数，仅取整写法微差）；另两个 formatBytesShort 变体（`core/s3v3Report.ts:259-263` KiB/MiB、
  `mobile/sync/syncProgressStore.ts:73-80` B/KB/MB/GB）输出口径**不同**。`src/lib/formatBytes.ts:8-15` 明钉
  「formatBytes（设置口径）与 formatBytesCompact（同步口径）**别合并**」。
- **具体方案**：只收敛「GB 阶梯」族：`src/lib/formatBytes.ts` 加 `formatBytesLadder`，exportPortable/updateManifest 改用；
  两个 formatBytesShort **不动**（显示口径不同、各有断言）。
- **代价与风险**：~20 行；显示字串逐字不变。收益偏整洁 ⇒ P3。
- **优先级**：P3
- **涉及端**：移动 / 桌面 / 共享

### M-10 · S3 Secret 掩码与「留空=沿用」策略三处各写一份（P3 · 移动/桌面/共享）

- **问题与证据**：`S3_SECRET_MASK = "********"` 两个导出（`electron/ipc/registerSync.ts:29`、
  `src/mobile/settings/useS3SettingsForm.ts:13`）+ `core/s3ConfigTransfer.ts:81` 内联第三个掩码字面量；
  「掩码/留空 ⇒ 沿用已保存值」两处实现（`registerSync.ts:119` vs `useS3SettingsForm.ts:90-95`，移动侧注释自述「与桌面同口径」）。
  安全相邻的保存语义，两端漂移后果 = 「改了没存上」或「掩码被当密钥存坏」。
- **具体方案**：core 加 `s3SecretPolicy.ts`：导出 S3_SECRET_MASK + `resolveSecretField(draft, saved)`，两端表单调它；
  s3ConfigTransfer 的掩码常量同源；两端既有设置测试补一条同源断言。
- **代价与风险**：~40 行；风险低。
- **优先级**：P3（实现点仅 2 个，但属「策略上收 core」正例）
- **涉及端**：移动 / 桌面 / 共享

### M-11 · Kotlin 图片魔数嗅探两份 + randomHex4 两份（P3 · 移动）

- **问题与证据**：`RemoteAssetRules.sniffMagic`（`RemoteAssetRules.kt:22-38`，五格式魔数 + JVM 单测）与
  `AssetServer.sniffMime`（`AssetServer.kt:625-643`，注释「对齐桌面 assetServer.sniffMime」）同语义双实现；
  `randomHex4` 在 `RemoteAssetRules.kt:43` 与 `CameraCaptureRules.kt:20` 各一份。
- **具体方案**：AssetServer 改调 sniffMagic；randomHex4 提到共用对象；JVM 单测合并断言。
  替换时把嗅探容错边界差异（头长度门槛）取并集并写测试。
- **代价与风险**：~30 行。
- **优先级**：P3
- **涉及端**：移动（Kotlin）

### M-12 · noteWriteState 判据注释与实现不一致 + 对账表 core 列指向偏差（P3 · 移动/共享）

- **问题与证据**：`src/mobile/data/noteRepository.ts:189-196` 注释写「gone = trashed_at 或 purge（**is_purged=1,is_dirty=0**）」，
  实现是 `trashed_at != null || is_purged === 1`（不看 is_dirty）；`src/core/repositoryCapabilities.ts:53` 把该能力
  的 core 列填 `core/noteSaveDecision.ts`，而该模块只有 hasNoteSaveChanges（脏判据，noteSaveDecision.ts:1-10），
  gone 谓词实际内联在 noteRepository——「判据在 core」注记对这一半不成立。
- **具体方案**：一次口径确认后二选一（本报告不预设）：① 语义以实现为准（purged 一律拒用户写，符合 AGENTS §3#15/23）
  ⇒ 改注释 + 对账表 core 列改指 core/syncDecisions.isGoneNote；② 若 is_dirty 的 purged 行要允许恢复前留编辑 ⇒ 改实现走
  isGoneNote 同一谓词。顺手把谓词改为 `isGoneNote({ trashedAt, isPurged })` 消除第二判据。
- **代价与风险**：~15 行 + 一次口径确认；选②需回归 mobileGoneWiring / saveGuardCopy。
- **优先级**：P3（现状行为大概率正确，属契约注释债）
- **涉及端**：移动 / 共享

### M-13 · 键盘三套阈值判据：登记口径，不建抽象（P3 · 移动）

- **问题与证据**：同一「键盘弹起/遮挡」能力三把尺：① `useKeyboard.ts:60` `keyboardOpen: height > 8`（几何 offset）；
  ② `useKeyboardStableSheet.ts:17` `KEYBOARD_MIN_INSET_PX = 80` + :19 REVEAL_MARGIN_PX=12（Sheet 稳定/露输入）；
  ③ 装置口径「innerHeight 收缩 > 200px」（`scripts/mobile-audit/device-debt-smoke.mjs:6,163`、`perf-baseline.mjs:134-136`，AGENTS §7#17）；
  另 `usheet/keyboardCoverage.ts:19` KEYBOARD_COVER_MARGIN_PX=8（64 行断言辅助，**全仓只有自身测试引用**，头注释自称「后续如需复用可上移」）。
- **具体方案**：① MOBILE-TECH-STACK §五#7 补三口径表（谁/阈值/用途/为何不同），常量头注释互相引用；
  ② keyboardCoverage.ts 二选一：把 assertInputNotKeyboardCovered 接入 MobileUsheetViewer/MobileBitableFormView 的 render 测试（其设计目标），或连测试整体删除。
- **代价与风险**：文档 + 一次接线或删除。**不**做键盘判据统一抽象——三把尺服务不同失效模式，合并是为统一而统一。
- **优先级**：P3
- **涉及端**：移动

### M-14 · 契约文档与注释锚点过期批（P3 · 移动/文档）

- **问题与证据**（均为实读核实）：
  - `docs/MOBILE-TECH-STACK.md:68` 「+2 = runNativeSqliteSpike / **migrateSnapshotToNativeSqlite**」——后者全仓已不存在
    （仅剩 `native/lakeNativeContract.ts:40` 的 runNativeSqliteSpike）；
  - 同文档 §三 T2 成员表（:79）列 `listS3GcPending` 为「共享契约」，而 `contractSurface.test.ts:68-70` 已把它归入 TEST_SEAM
    并注明「桌面端 s3_gc_pending 链路已删，桥方法仅单测/预留」——归属表与机制不一致；
  - `src/mobile/editor/EditorDock.tsx:2` 引用已不存在的 `prototype/index.html`；
  - `src/mobile/MobileApp.tsx:2`「替代 MobilePocApp……§3.2 结构」——对象已删、§ 为历史编号（AGENTS 明示旧编号不对应现行文档）。
- **具体方案**：一次文档批：TECH-STACK §三按 contractSurface.test 现状重写（方法数以测试断言为唯一口径，本文**未逐个重数**）；
  两处注释改指现存锚点。
- **代价与风险**：纯文字。
- **优先级**：P3
- **涉及端**：移动 / 文档

### M-15 · 头注释补全：只补「契约级」文件（P3 · 移动）

- **问题与证据**：377 个非测试文件中 24 个前 15 行无 `/**` 头注释（实测清单）：settings/BasicSettingsSections.tsx、
  home/{useQuickNoteListModel,useQuickNoteDetailCache,MobileQuickNoteTagSheet}、ink/MobileInkPad.tsx、usheet/useSheetReadFilter.ts、
  main.tsx、native/{assetWrites,nativeSqlite,nativeSqliteDb}.ts、bridge/sync.ts、v3/{mobileDeviceStore,mobilePlatformPort}.ts、
  notebook/{useWorkspaceSession,WorkspaceOverlayHost,useNotebookTabs}、
  data/{schema,diagnosticsRepository,orphanAssetRepository,gcRepository,quickNotesRepository,notebookTreeRepository,treeRepository}.ts、
  editor/useEditorCommandDispatcher.ts。其中 schema.ts/quickNotesRepository.ts 在 import 块后有段落注释（不算裸奔）。
- **具体方案**：只补**跨端契约/数据语义**文件（data/* 仓储、nativeSqliteDb、mobileDeviceStore、bridge/sync.ts），
  每个 3-8 行写「职责/契约面/不变量指针」；纯 hook/UI 不批量补（收益停在整洁）。好样板：bridge/notes.ts:36-47、v3StateRepository.ts:26-31。
- **代价与风险**：约 10 文件 × 5 行；零行为风险。
- **优先级**：P3
- **涉及端**：移动

### M-16 · PortablePackagePlugin.kt（1062 行）拆规则对象 + 消 5 处路径检查重复（P2/P3 · 移动）

- **问题与证据**：路径包含检查（canonicalPath + startsWith(root+separator)）重复 5 处：:93-98、:297-299、:341-343、:369-371、:390-392；
  纯规则（条目名校验 :204-214 zip-slip 语义、MAX_ENTRIES、".zip.lln" 后缀闸 :46-47,:137,:173）与 IO/Activity 混在 1062 行插件里，
  而仓库已有先例（RemoteAssetRules.kt:12-13、CameraCaptureRules.kt:6 的「纯规则对象 + JVM 单测、IO 留插件」）。
- **具体方案**：① 私有 `isInside(root, file)` 收掉 5 处（10 行，零风险，建议无条件做）；
  ② 抽 `PortablePackageRules.kt`（条目名/上限/后缀闸纯函数）+ zip-slip 断言移 JVM 单测；插件本体按 staging/import/snapshot 分区。
- **代价与风险**：① P2（同一文件 5 处同构安全检查，漏改一处 = zip-slip 类回归）；② P3 约 150 行搬移。
- **优先级**：① P2 / ② P3
- **涉及端**：移动（Kotlin）

---

## 3. 明确不建议做

1. **移动端 UI/组件/样式与桌面合并**——用户 261012 定稿（MOBILE-TECH-STACK §一/§九）：UI 两端独立，仅共享必要逻辑。
2. **给两端仓储造统一 TS 接口（NoteStorePort）**——`repositoryCapabilities.ts:4-9` 记录用户 Q6 明确禁止扭曲签名；能力矩阵对账是定稿方案。
3. **键盘三套阈值合并成一个抽象**——三把尺服务不同失效模式（M-13），合并是为统一而统一。
4. **Kotlin 与 core 的命名/魔数/限额规则生成共享代码（代码生成器/DSL）**——跨语言无法共享实现；JVM 单测 + 注释契约已够，生成器过不了 §3#22 四问。
5. **删 v3 账本信封/行内 baseline 的读迁移（migratePersisted、v3StateRepository 一次性迁移）**——同步账本与基线不能删了重建（删=假删/误判），§3#7 判据不成立。
6. **为 enc:v1 密钥存量写迁移读取**——261204 用户裁决已结案（按未配置读出、零钥匙串访问），不重开。
7. **便携包恢复 formatVersion 1 / 旧 .zip 后缀兼容**——261110 用户定稿拒绝（portableFormat.ts:8 明写不写 v1 兼容）。
8. **收缩 inkDoc 读兼容（1|2|3|4）**——跨端历史正文/历史快照读取面，删=旧手写文档变砖；协议读兼容不许删。
9. **移动端小记插面板/斜杠入口回归**——用户 261010 定稿（MOBILE-TECH-STACK §七⚠️），别再提议。
10. **合并 formatBytes 与 formatBytesCompact 两口径**——`src/lib/formatBytes.ts:11-15` 明钉「别合并」（设置口径 vs 同步口径）。
11. **给 sql.js 后端做「浏览器端完整可用」**——MOBILE-OPS §4 定稿：浏览器预览只看骨架、不做验收（与 M-01 的 lazy 化是两回事）。
12. **全量给 hooks/UI 小文件补头注释、或大规模重排 MobileBitableViewer/MobileUsheetViewer**——收益停在整洁；只做 M-15 与顺路拆分。
13. **清理 vendor/依赖侧死代码**——AGENTS §3#18 红线。
14. **速记失败提示文案双写（HANDOFF 261119 登记）不重复立项**；batchNotes deleted_at 老账经核实**已修**（`bridge/batchNotes.ts:85` 现以 trashed_at 为判据）。

## 4. 历史兼容代码清单（逐条判 AGENTS §3#7：数据能否删了重建）

| # | 位置 | 类别 | 现状语义 | 能否删 | 删的代价 |
|---|---|---|---|---|---|
| 1 | src/mobile/data/schema.ts:251-258（FTS trigram→unicode61） | ③ 自愈（非兼容读） | 检测旧分词器索引 ⇒ DROP 重建 | **保留**（即「删了重建」正解） | 删=旧库搜索静默坏 |
| 2 | schema.ts:228-232（created_at 老行回填） | ① 真·历史数据 | v13 前老行 created_at=updated_at 一次性回填 | **不可删**（created_at 无法重建） | 删=日记「按创建时间」排序退化；建议大版本窗口到期再清 |
| 3 | schema.ts:281-284、292、301、306（published_at / sync_state×3 DROP COLUMN） | ① 可删候选 | 旧库残留列一次性清理，列已无人读写 | **可删**（删后旧库留惰性列，无害） | 仅省 4 条升级 DDL；收益=整洁 ⇒ 不强推 |
| 4 | notes.content 整库重置路径 | — | **已清**：schema.ts:22 注记 261022 迁移窗口关闭，全仓无残留 | — | — |
| 5 | data/quickNoteTagsRepository.ts:28、236（tag_absent_migrated） | ① 一次性迁移 | 旧 deleted_at 标签墓碑行物理删 + 并入待删（不跑会被当 active 误发布） | **暂不可删** | 删=旧备份/离线旧库恢复后标签墓碑误发布；下一大版本删 |
| 6 | sync/syncResumeMarker.ts:11-22、sync/syncDiagnosticsStore.ts:11-15、sync/historyCleanupScheduler.ts:18-58 | ① 迁移 + 降级兜底 | device_state 为主、localStorage 兜底（旧值首读兼容；表异常退化） | **可删**（三份数据均可丢弃重建） | DB 异常时丢一次续传标记（=多补一次同步）；随大版本清 |
| 7 | core/secretCipher.ts:6-7 + native/keystoreSecretStore.ts:43（enc:v1） | — | **已结案**：按未配置读出、无迁移代码（261204 裁决） | — | — |
| 8 | core/portable/portableFormat.ts:8,71 + PortablePackagePlugin.kt:46-47,137,173 | ② 协议版本闸 | formatVersion 1 / 旧 .zip 直接拒绝（旧包用新版重导） | **闸必须留**（无兼容代码可删） | — |
| 9 | data/v3StateRepository.ts:26-31,74,92-95,149 + core migratePersisted | ② 读兼容（一次性迁移） | 旧信封/行内 baseline → 迁移落 baseline 文件，下次写即 v2 | **不可删** | 删=旧设备基线丢失 ⇒ 假删/整轮重拉 |
| 10 | core/inkDoc.ts:9-34（读 1\|2\|3\|4 写 4）+ :15 inkNav v1/v2 回退种子 | ② 跨端读兼容 | 旧端写的历史正文/历史快照仍可读 | **不许删** | 删=旧手写文档/历史版本变砖 |
| 11 | v3/mobileDeviceStore.ts:47（旧路径残留）、:118（旧内存 map staging 兼容） | ③ 测试/内部兼容 | 新代码已不用，仅测试/历史调用可达 | **可删**（改测试引用） | 无 |
| 12 | 旧 APK 能力兜底：ink/mobilePdfImport.ts:46,58、native/pdfRender.ts:26、v3/mobileDeviceStore.ts:93,365 | ③ 版本偏斜防御 | 旧 APK 缺字段/插件时 width/height 兜底、逐篇扫描回退 | **不建议删** | 每条 2-5 行，删只省整洁；dev 半更新还会踩 |
| 13 | ui/MobileTitleTips.tsx:23、ink/MobilePageTab.tsx:55 | ③ 测试/宿主兼容 | 挂载/导出 API 旧签名兼容层 | **可删**（改测试/调用点） | 无 |
| 14 | bitable/mobileBitableForm.ts:18（保留移动端旧名） | ③ 内部命名 | core 名 → 移动旧名 re-export | **可删**（纯改名） | 无 |
| 15 | bridge/sync.ts:412、v3/sync.ts:183（manifests/latest.json 相关） | — | **已清**：旧「读 v3 永不写的 manifests」逻辑已删，现存注释仅记成因 | — | — |

**结论数**：可删 **5 类 / 约 10 处**（#3、#6、#11、#13、#14；#6 建议随大版本、#3 不强推）；
不可删 **5 类**（#2、#5 暂缓、#8 闸、#9、#10）；保留自愈 1 类（#1）；不建议删 1 类（#12）；已清/已结案 3 类（#4、#7、#15）。

## 5. 大文件与注释现状小结

**800+ 行文件（实测，括号=注释行约数）**：HomePage.tsx 1440（~82）/ MobileApp.tsx 1245（~129）/ PortablePackagePlugin.kt 1062 /
MobileBitableViewer.tsx 1041（**~33，最稀**）/ MobileUsheetViewer.tsx 1006（~73）/ EditorDock.tsx 881（~115）/
SettingsDrawer.tsx 865（**~26**）。另有 NotebookWorkspace.tsx 647、importPortable.ts 637、bridge/sync.ts 617（无头注释）。
拆分见 M-04/M-05/M-06/M-16；MobileBitableViewer/SettingsDrawer 的注释欠账随拆分补「视图状态机/保存闸」分区注释。

**缺头注释**：377 个非测试文件中 24 个前 15 行无 `/**`（清单见 M-15）；补全只做契约级 10 文件，纯 hook/UI 不批量补。

**缺契约注释的点**（比缺头注释更值得补）：
- 判据注释与实现漂移优先修（M-12 的 noteWriteState）——**契约注释的准确性 > 注释数量**；
- Kotlin 侧 RemoteAssetRules.kt:7-13 是好样板（写明与桌面哪份同口径）；缺的是重复实现收口（M-03/M-11/M-16）而非注释。

**过期注释锚点**：EditorDock.tsx:2（prototype/index.html 已不存在）、MobileApp.tsx:2（MobilePocApp/§3.2 旧编号）、
MOBILE-TECH-STACK §三（migrateSnapshotToNativeSqlite、T2 归属表）——统一进 M-14 文档批。
