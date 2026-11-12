# 25 发版前复核（release review，移动端）— 基线 `c2d4962b..HEAD`

> 只读复核，不改代码；本文只列**问题**与**结论**。范围：`src/mobile/**`、`android/**`（配置，不构建）、`scripts/mobile-audit/**`；桌面/共享 core 仅用于对照。
> 门禁实跑：`npx tsc --noEmit` → **0 error**；`npx vitest run src/mobile` → **316 files passed / 3 skipped，1577 tests passed / 3 skipped，0 failed**（65s）；`git diff --check` → **干净**；`git status` 干净（无临时脚本/未提交改动）。

## 0. 结论一句话

- 移动端本轮语义**与桌面红线一致**（远端 purge 保副本 / 恢复历史=内容动作 / 编辑锁只读 / warning 持久化 / 移动目标剔除日记本 / 取消标记两端均已移除），未发现阻断发版的代码问题。
- **Warning 1 项**：`android/capacitor.settings.gradle` 被 git 跟踪且含**本机 clone 目录名**的相对路径，换目录名会构建失败/每次 `cap sync` 脏工作树（见 §3.1）。
- **发版前必须重跑全量移动设备门禁，并按 §3#21③ 重烤基线**：手机 10 态基线设备（lake_gate）数据已被清理，且平板 10 态基线早于本轮 UI 改动（见 §4）。

## 1. 移动端本轮语义复核（`c2d4962b..HEAD`）

| 语义 | 移动端现状 | 证据（文件/提交） | 结论 |
| --- | --- | --- | --- |
| 远端 purge → 保留「云端已删除（仅本地）」副本 | 收敛端口 `purgeLocalNote` 为**软删保副本**：`trashed_at=COALESCE(...)`、`deleted_from_parent_id=COALESCE(...)`、`cloud_deleted=1`、`is_dirty=0`、清 `restore_pending_at`；不写墓碑/不删行/不删正文 | `src/mobile/v3/mobilePlatformPort.ts:492`、`purgeSoftDelete.test.ts`、`d8ff18fc` | ✅ 正确（配合 core 的 `applyCloudDeletedProjection`） |
| 恢复历史版本 = 内容动作（不改生命周期） | `saveRestoredNoteContent` 只写正文/标题 + 脏位（`is_dirty=1`），不动 `trashed_at/parent_id`；purged 明确拒绝 | `src/mobile/data/noteRepository.ts:289`、`saveRestoredSnapshot` 接线 `20361880` | ✅ 与桌面 `historyLifecycle.restoreHistory` 同红线 |
| 编辑锁只读（N3/N4/N5） | `getNoteInfo` 透出 `isEditLocked/editLockedAt`；`saveNote` 锁拒写；打开/编辑入口只读 + 横幅 + toast；`applyRemoteNoteMeta` 对回收站行做**内容级全写**（不碰位置三件套） | `src/mobile/bridge/notes.ts:121/184`、`NotePaneHost.tsx`、`useWorkspaceSession.ts`、`mobilePlatformPort.ts:409`、`lockedNoteGuard.test.ts` | ✅ 桌面锁在移动端真正生效（无解锁入口 = 刻意差异） |
| warning 持久化 + apply_skipped | 「上次同步」落盘 `warnings`（**上限 20 条**、message 截 200、未知 kind 丢弃）+ `warningSummary`（完整列表计数）；设置页重启后仍显示逐项；apply 失败 kind = `apply_skipped`（非 wire） | `src/mobile/sync/syncStatusStore.ts:37/44/117`、`src/mobile/v3/sync.ts:67`、`src/core/syncWarningText.ts:58`、`1a014cb7` | ✅ |
| 移动目标剔除日记本 | `moveTargetsFromSnapshot → core.moveTargetCandidates` 剔除日记子树（按 `space=diary` 根判断，桌面+移动共用单一判据） | `src/mobile/ui/docBatch.ts:47`、`src/core/diary.ts:390`、`d4d03260` | ✅（§3#25 生效） |
| 取消日记标记移除是否有残留 | 移动端无 UI/桥/写路径；`src/mobile` 仅 `bridge/diary.ts` 头注释与 `DiaryPage.tsx` JSX 注释提及历史裁决，**非代码路径**；`mobileDiaryWiring.test.ts` 以「已移除」护栏反向卡住（`not.toContain`，断言前先去注释） | `fd58dc0a`、`mobileDiaryWiring.test.ts` | ✅ 无功能残留（grep 命中仅注释/护栏，属预期） |
| 单篇出口（转为文档 / 转为小记） | 「转为文档」保留（`core.diaryConvertTargets` 排除日记本）；「转为小记」**仅桌面有入口**（见 §2） | `DiaryPage.tsx`、`4b6a524a`、`f965e62c` | ✅ 转为文档可用；转为小记=已知平台差异 |

## 2. 与桌面语义差异清单

| # | 差异 | 类型 | 说明/证据 |
| --- | --- | --- | --- |
| 1 | **「转为小记」只有桌面入口**，移动端无 | **已知差异**（非缺陷） | `git grep 转为小记 src/mobile` = 0；桌面 `DiaryWorkspace.tsx:355` 有。用户裁决只要求日记本不可变 + 单篇出口存在（桌面已覆盖）；若要求移动端也提供需另立项。 |
| 2 | 编辑锁：桌面可加/解锁（`set_note_locked`），移动端只读消费、无解锁 UI | **刻意**（移动端编辑收口） | `electron/ipc/registerNotes.ts:291` vs `src/mobile/bridge/notes.ts`（无 setNoteEditLocked 暴露）。 |
| 3 | warning 持久化：移动端落盘（≤20 条 + 分组计数），桌面 `SyncStatusPopover` 只读本轮内存回执 | 差异（不影响协议/数据） | `syncStatusStore.ts` vs 桌面无对应落盘；两边 `apply_skipped` kind 一致。 |
| 4 | 远端 purge 收敛路径端口名不同：移动 `purgeLocalNote`（软删），桌面走 `store.deleteNote`（回收站 + 墓碑路径） | 平台实现差异，语义都收敛到「回收站副本 + cloud_deleted 投影」 | `mobilePlatformPort.ts:492` / `electron/s3v3/desktopPlatformPort.ts:129` + `applyNotesCloudDeleted`；两端由共享 conformance 覆盖。 |
| 5 | 资产：移动默认 `deferAssets=true`（按需补拉），桌面全量 | **刻意** | `resolveDeferAssets` + `ensureNoteAssets`；桌面无此差异。 |
| 6 | 移动 `window.lakeNative` 是桌面 IPC 的**裁剪契约面**（如无日记标记/取消、无 quick-note tag 写方法） | **刻意**（UI 独立） | `src/mobile/native/lakeNativeContract.ts` + `contractSurface.test.ts` 卡住。 |
| 7 | 移动「设备本地同步状态」落盘（syncStatus/syncDiagnostics/syncProgress） | 刻意 | 桌面用主进程状态行；两端都不进 S3。 |

> 未发现「桌面有、移动端缺」的**语义漏项**（除 #1 已知差异）。

## 3. Android 配置卫生

### 3.1 ⚠️ Warning：`android/capacitor.settings.gradle` 被跟踪且写死本机 clone 目录名

- 文件头写明 `DO NOT EDIT ... GENERATED EACH TIME "capacitor update" IS RUN`，但**已入库**且内容为：
  `project(':capacitor-android').projectDir = new File('../../lakex-local-notes/node_modules/@capacitor/android/capacitor')`
  —— 相对路径里带**本机仓库目录名** `lakex-local-notes`。换 clone 目录名（或打包机目录不同）时该路径解析到错误位置，Gradle 构建失败；每次 `npx cap sync` 也会按当前目录名重写 → 工作树常脏。
- 建议：加入 `android/.gitignore` 并由 `cap sync`/构建脚本生成（或改为 `../../node_modules/...` 的规范相对路径）。**发版前处理**（否则别人 clone 后构建不可复现）。
- 证据：`git show HEAD:android/capacitor.settings.gradle`、`git ls-files` 显示已跟踪；本轮 `git status` 干净（说明当前目录名恰好匹配）。

### 3.2 其余项（OK）

| 项 | 结果 |
| --- | --- |
| 版本号派生 | ✅ `android/app/build.gradle` 从**根 package.json** 读 semver，`versionCode = 1000 + major*10000+minor*100+patch`（注释与实现均有）；不手改 Gradle 版本 |
| 生成文件不入库 | ✅ `android/.gitignore`: `build/`、`app/src/main/assets/public`、`capacitor.config.json`、`capacitor.plugins.json`；`android/app/build/*` 被忽略 |
| 启动面/图标颜色 | ✅ 本轮仅 `ic_launcher_background.xml` 加注释（#F0FBF5 / launch #EDEDF1 与 `--lake-bg-window` #E9EDF3 的 4/0/2 差是**已登记刻意分离**，无颜色改动） |
| 泄漏扫描 | ✅ 产品代码无 `/Users/admin`（仅 1 处在历史审计文档 `docs/audit-261112/13`）；`src/mobile` 无 `console.log/debug`（0 处）；无 `__tmp`/临时脚本入库 |
| 温度脚本清理 | ✅ `.tmp-*` 均已删，`git status` 干净 |

## 4. 移动端快照/门禁：发版前是否需要重烤

- **本轮 CSS/几何**：`src/mobile/**/*.css` **0 改动**（`mobile.css` 等均未变）；视觉层改动只有 `DiaryPage` 菜单项/文案（不在 10 态）与设置页 warning 区块（仅在存在 warning 时渲染；门禁设备不配 S3 ⇒ 不出现）。
- **手机 10 态**：task-67 后用新 APK 实测 **10/10 0 差异**；其后 `1a014cb7..HEAD` 只有 `d4d03260` 动 `src/mobile/ui/docBatch.ts`（移动目标过滤，不在 10 态）⇒ 语义上不影响。
- **平板 10 态**：基线（`baseline/mobile-snap-tablet.json`）早于本轮设置/日记改动，且本轮**未重跑平板**。
- **结论（发版前）**：**需要重跑全量并重烤基线**。理由：① 手机基线设备 lake_gate 的数据已在任务清理中 `pm clear`（无夹具 → 直接跑必然 10/10 红且无法判真伪）；② 平板基线早于本轮改动、未复核；③ AGENTS §3#21③：换夹具/发版前全量 → 先重灌 `gate-fixture`，采暖态后 `--from <warm>.json --write-baseline` 重烤手机+平板两条基线，再连跑两轮 0 差异；23 屏走查（`mobile-walkthrough`）同批跑一次。**不是因为本轮移动语义改动需要重烤，而是流程/装置状态要求。**

## 5. 问题清单（只列不改）

| 级别 | 项 | 位置 | 建议 |
| --- | --- | --- | --- |
| **Warning** | `capacitor.settings.gradle` 入库且含本机 clone 目录名 | `android/capacitor.settings.gradle`（HEAD 已跟踪） | 发版前 gitignore + 由 `cap sync` 生成，或改规范相对路径 |
| Info | 平板 10 态基线早于本轮 UI 改动、未复核 | `scripts/mobile-audit/baseline/mobile-snap-tablet.json` | 发版前重跑/重烤 |
| Info | 手机基线设备数据已清（无夹具） | lake_gate 5556 | 发版前重灌夹具 + 重烤 |
| Info | 历史审计文档含本机路径（非产品代码） | `docs/audit-261112/13-write-guard-sweep.md:108` | 可留（历史报告），如需彻底干净可脱敏 |
| Info | 移动端无「转为小记」入口（已知差异） | `src/mobile/**`（grep 0） | 如产品要求移动端也支持，另立项 |

## 6. 发版门禁实跑记录（本次）

- `npx tsc --noEmit`：**0 error**。
- `npx vitest run src/mobile`：**316 files passed | 3 skipped（319）；1577 tests passed | 3 skipped（1580）；0 failed**（65.29s）。
- `git diff --check`：**干净**；`git status`：**干净**。
- 未跑完整 vitest（全量由 lead 串行收口）；未构建 APK（复核任务不构建）；未跑设备装置（见 §4 结论）。
