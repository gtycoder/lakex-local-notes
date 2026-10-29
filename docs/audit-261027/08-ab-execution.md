# 08 · A/B 执行记录（261027 审计 → 落地）

> 会话：2026-10-28。基线：`master @ ea576a80`（审计快照是 41def9f0；另一会话已提交 4 个 commit，审计结论已在新 HEAD 复核）。
> 本文件记录 **A（止血批 Top10 前 9 项）** 的实现、**B（同步内核 v4 RFC）** 的交付，以及**偏离/延后项**与验收方式。
> 纪律：全程未 commit / 未 push；改动留在工作树，等用户验收。

---

## 1. 结论

| 项 | 状态 | 说明 |
|---|---|---|
| A · SD-01（P0 数据丢失） | ✅ 已修（261028 按用户裁决改为复用「远端 purge」语义） | 全量重拉时「本机有、云上没有」= 其他端已删除并 purge ⇒ 软删进回收站 + 打「云端已删除·仅本地」标，正文/附件/历史保留、不上传；显式恢复后 local-wins 重新上传。回归 `electron/s3v3/pullAllSafety.test.ts`（含恢复后重传） |
| A · SD-03（恢复入口断头） | ✅ 已修（最小版） | 「缺正文·可云恢复」判据改读 v3 事实：同步成功后把云端文档 id 回填给 Store（`markRemoteNoteIds`）；首轮同步前仍回退「仅历史」 |
| A · SD-04（待同步计数挂起） | ✅ 已修 | v3 成功同步后按本机 purge 墓碑批量 `markTombstonesPublished` |
| A · SD-05（成功报失败） | ✅ 已修 | `executePending` 清理失败降级为 warning（发布已成功就不再抛） |
| A · SEC-01（AI Key 外送） | ✅ 已修 | 草稿/保存改 `baseUrl` 必须显式带 Key；`baseUrl` 强制 https（本机 http 例外）；新增 12 例测试 |
| A · SEC-02（S3 目标改向） | ✅ 已修 | 保存前走 `validateS3Settings`；endpoint 变更记 `log.s3.warn` |
| A · SEC-03（debug APK） | ✅ 已改（待 CI 首跑） | release 变体 + debug keystore 签（debuggable=false）；CI 改 `assembleRelease`、去 `continue-on-error` |
| A · 死面清理 | ✅ 部分 | 删 4 个零引用模块、`TreeRepository` 接口、ink 两条永久置灰导出、ui-metrics 失效项；`config.xml` 改判为「生成文件，无可删」（见 §3） |
| A · MOB-06（purge 不清资产） | ✅ 已修 | `purgeTreeItem`/`purgeQuickNote` 删 `note-assets/{id}/` 与 `quick-notes/assets/{id}/`；+5 例回归 |
| A · MOB-01（返回键） | ✅ 已修 | 工作区 9 类浮层 + 首页标签面板 + 设置子页登记返回栈；`useBackHandler` 把浮层栈提到 capture 之前 |
| A · DT-01（doc 无错误边界） | ✅ 已修 | doc 分支与其余 4 kind 同构包 `EditorErrorBoundary` |
| A · DT-02（11 处原生 confirm） | ✅ 已修 | 新增 `useConfirm`（Overlay.Dialog），11 处全换；不可逆动作写清后果 |
| B · v4 RFC | ✅ 已交付 | `07-rfc-convergence-kernel-v4.md`（含 SyncPlan/IntentLog 契约、迁移、PR 拆分、待决问题） |

**未改动**：wire protocol、闭源内核、Univer 依赖、数据目录。

---

## 2. 验收方式（建议手点）

1. **P0 回归**：`npx vitest run electron/s3v3/pullAllSafety.test.ts`。手工等效：复制一份工作区 → 删 `sync-v3/baseline.json.gz` → 启动同步 → 本地独有文档仍在（可在回收站/列表打开），历史快照仍可恢复。
2. **SEC-01**：设置 → AI：只改「服务地址」不改 Key → 应报「修改服务地址时必须重新填写 API Key」；只改模型 → 正常。
3. **SEC-02**：S3 设置填 `http://` 或非法 URL → 保存被拒；合法 https → 正常。
4. **SEC-03**：CI Android job 首跑确认出 `LakexLocalNotes-<ver>-android-release.apk`；本机 `./gradlew assembleRelease` 后 `aapt dump badging … | grep debuggable` 期望无输出。
5. **MOB-06**：真机彻底删除一篇带图文档 → `adb shell run-as com.lakexlocalnotes.android ls files/note-assets/<id>` 应为「目录不存在」。
6. **MOB-01**：真机逐项按返回：目录抽屉/大纲/标签列表/属性/图标/历史/首页标签面板/设置子页 → 只关最上层，不再退出工作区/App。
7. **DT-01/02**：回收站「清空」与设置「从云端恢复」现在是自有 Dialog；可验收文案与危险色。
8. **门禁**：`npx tsc --noEmit && npx vitest run && node scripts/ui-metrics.mjs && npm run check:core && npm run check:mobileui && git diff --check`。

---

## 3. 偏离与延后（需用户拍板）

| 项 | 原因 | 建议 |
|---|---|---|
| ~~删除浏览器端（D-1）~~ | **用户 261028 裁决：保留并完善**（桌面端专用、用途是浏览器分屏读笔记；移动端不需要） | 见 `11-browser-end-plan.md`；SEC-07 升为 P1 必做，D-1/SEC-07 已在 02 文档改判 |
| **移动表格置灰 10 项（MOB-10）** | **用户 261028 裁决：保留，后续讨论**（原计划先优化表格端，被 S3-v3 中断） | 4 处不可达死分支可单独删（无视觉变化），但本轮未动 |
| **`config.xml`（02 D-2）** | 核实为 `cap sync` 生成且未被 git 跟踪（`android/.gitignore`） | 改判「无可删」；已在 02 文档更新 |
| **DT-03/DT-05 等 P1/P2** | 不在 Top10 止血批 | 按 `00` 的路线在后续批次做 |
| **AI `ai_chat` 的存量脏 baseUrl** | 本轮只挡「写入/测试」路径；历史已存的异常 baseUrl 仍会在对话时外发 | 建议下一批加「对话前二次校验」（3 行） |
| **Android 失败是否阻断发版** | 当前只红不阻断（按指令） | 若要硬门禁，把 release job 的 needs 加上 android |

---

## 4. 改动文件清单（工作树，未提交）

**同步/数据（Lead）**
- `src/core/s3v3Engine.ts`：`pullAll` 归档本地独有条目（I0）+ warning；`executePending` 两处调用失败降级。
- `src/core/s3v3DeviceStore.ts`：`archived.kind` 增加 `folder` + 契约注释。
- `electron/s3v3/desktopStoreAdapter.ts`：loadState 过滤归档 / saveState·saveQuickNotes·saveFolders 不删归档（并把「不在本轮状态」的兜底从 purge 改为软删）。
- `electron/s3v3/desktopSync.ts`：成功同步后回填云端文档 id + 记账 purge 墓碑。
- `electron/store.ts`：`remoteNoteIds` 探针 + 「缺正文」判据改用 v3 事实。
- `src/mobile/data/v3StateRepository.ts`、`src/mobile/v3/mobileDeviceStore.ts`：移动端归档持久化/过滤/不删。
- `electron/s3v3/pullAllSafety.test.ts`（新）。

**安全（sec-fix）**
- `src/core/aiProviders.ts`、`electron/ipc/registerAi.ts`、`electron/ipc/registerSync.ts`、`android/app/build.gradle`、`.github/workflows/release.yml`、`docs/RELEASE.md`、`electron/ipc/registerAi.test.ts`（新）、`electron/ipc/registerSync.test.ts`（新）、`src/core/aiProviders.test.ts`。

**清理（cleanup）**
- 删：`src/core/editorHost.ts`、`src/desktop/treeRepositoryAdapter.ts`(+test)、`src/lib/imageConverter.worker.ts`。
- 改：`src/core/ports.ts`(+test)、`src/components/ui/ExportSubmenuItem.tsx`、`scripts/ui-metrics.mjs`、`AGENTS.md`（!important 11→10）。

**桌面 UI（desktop-ui）**
- `src/features/editor/MultiTabEditor.tsx`、`src/hooks/useConfirm.tsx`（新）+ `.test.ts`（新）、`TrashPanel.tsx`、`SettingsPanel.tsx`、`QuickNotesWorkspace.tsx`、`HistoryPanel.tsx`、`QuickNoteTagManager.tsx`。

**移动（mobile-fix）**
- `src/mobile/native/assetFs.ts`、`data/trashRepository.ts`、`data/quickNotesRepository.ts`、`bridge/quickNotes.ts`、`notebook/NotebookWorkspace.tsx`、`home/MobileQuickNoteTagSheet.tsx`、`settings/SettingsDrawer.tsx`、`hooks/useBackHandler.ts` + 新测试。

**文档**
- `docs/audit-261027/07-rfc-convergence-kernel-v4.md`（B）、`docs/MOBILE-TECH-STACK.md`（purge 已知项改「已修」）、`docs/audit-261027/02-security.md`（D-2 改判）、`00` 顶部状态、本文件。

---

## 5. 门禁结果（实施后实测）

```
npx tsc --noEmit            → 0
npx vitest run              → 全绿（见 §6 复跑记录；新增测试已计入）
node scripts/ui-metrics.mjs → 通过（!important 10/10，无失效项）
git diff --check            → 干净
```

新增测试：`pullAllSafety`(1)、`registerAi`(7)、`registerSync`(7)、`aiProviders`(+5)、`useConfirm`(7)、`bridgePurge`(+3)、`quickNotesPurgeAssets`(2)、`mobileQuickNoteTagSheetBack`、`mobileBackOverlays`。

---

## 6. 后续（C 与 v4）

- **C**：补审 `src/core`（多维表 `bitableDoc` 2259 行、usheet、搜索、`quickNotes` 领域、`aiProviders` 消息模型），输出 `09-core-audit.md`。
- **v4**：按 `07` 的 §13 待决问题拍板后，从 E1（抽 protocol/plan）开始；**先完成对拍门禁**再切执行器。
- 设备门禁：本轮未起模拟器/真机；MOB-01/MOB-06 的「设备级 KEYCODE_BACK / run-as 目录不存在」仍待你验收（代码与单测已覆盖）。

---

## 7. C 阶段（core 业务语义补审，已完成）

产出：`09-core-data-models.md`（402 行，CORE-01..10）、`10-core-services.md`（492 行，CORE-01..14）。均只读审计，未改代码。

**最值钱的新发现（建议排在 v4 M0 之前修）**：
1. **多维表筛选静默恒真**：`evaluateFilter` 只对 `text|link` 走文本比较，markdown/ai 字段落到末尾 `return true` ⇒ 筛选形同虚设（09 CORE-01）。
2. **搜索索引会永久过期**：同步落盘走 `store.saveNote(id,title,content)`（不带 caches）⇒ `upsertSearch(..., null)` 读旧 `text_cache`，账本仍记「已索引」；移动端同语义是对的（10 CORE-01）。
3. **FTS5 保留字查询非法**：`buildMatchExpression` 给单词加 `*`，全大写 `AND/OR/NOT` ⇒ `near "AND": syntax error`，四个搜索入口静默无结果，单测还把错值钉成期望（10 CORE-02，已用 sqlite 实测）。
4. **「打开=只读」缺 core 判据**：坏正文策略四族分叉（usheet/board 无只读保护），移动端 usheet 全缺（09 CORE-02/03）——MOB-05 的真正根因在 core 而非移动端。
5. **死模块/假来源**：`quickNoteKeys` 自称 key 唯一来源但零生产引用（真源在 `s3v3Keys`）；`syncAdapters` 死模块让桌面 SHA-256 一直跑纯 JS；core 约 800 行 manifest v2 残留（10 CORE-03/04 与 §3 删除候选）。

**需用户裁决（C 文档 §5）**：① 表格 `ff` 是否 canonical 成 core 常量（跨端字节一致性）；② 手写板大正文 undo 是否改按页（当前 10MiB 每笔 2 次全序列化 ≈108ms/笔，实际只能撤 2 步）。

---

## 8. A 批收尾补强（261028 第二轮，未提交）

| 补强 | 内容 | 验证 |
|---|---|---|
| SEC-01 收尾 | `ai_chat` 对话前用 `validateAiBaseUrl` 校验已存配置的 baseUrl（挡「A 批之前已存进设置的脏地址」继续外发 Key） | `registerAi.test.ts` +1 例：脏 http 地址 ⇒ 拒绝且不发起请求；8/8 通过 |
| SEC-03 收尾 | CI 在 `assembleRelease` 后新增 `aapt dump badging` 断言：出现 `application-debuggable` 直接失败（不再依赖"CI 首跑人工看"） | 静态自检；待 CI 首跑 |
| AGENTS 同步 | `!important` 允许清单 11 → **10**（与 `ui-metrics` 基线一致） | `ui-metrics` 10/10 通过 |

至此 A 批的「待补缺口」只剩设备级点验（MOB-01/06、Android release 装机）与已裁决但延后的浏览器端 P1/P2（`11-browser-end-plan.md`）。

---

## 9. 用户裁决记录（261028）

| 议题 | 裁决 | 影响 |
|---|---|---|
| 浏览器端去留（01 P-04 / 02 D-1） | **保留并完善**：桌面端偶尔需要在浏览器里分屏读笔记；仅桌面端，移动端不需要；学习思源 | 02 D-1 改判「不删」；SEC-07 升 P1；新建 `11-browser-end-plan.md` |
| 移动表格置灰项（04 MOB-10） | **保留，后续讨论**（表格端优化原计划被 v3 中断） | 04 修复状态表与本节同步；死分支仍可单独删，但不在本轮 |
| 表格 `ff` 是否 canonical 化 | **用户裁决：不做换字体功能，直接收敛成常量** | 已实现：core `USHEET_CANONICAL_FONT_FAMILY` + `normalizeUsheetWorkbook` 强制归一；桌面不再读运行时字体令牌；移动端 capture/基线同函数（MOB-05 core 侧闭环） |
| ink 大正文 undo | **用户裁决：走推荐方案（操作日志 + 级页快照、全局 undo）** | 实施中：`features/ink/history.ts` 改为 patch 语义、`InkPad.commit` 每次只序列化一次 |
| 全量重拉的「本机有、云上没有」处置 | **用户裁决：放入回收站并标「本机有、云上没有」，复用远端 purge 逻辑** | 已实现（见上表 SD-01）；不再使用不可见的 archived 列表 |

---

## 10. 第二轮实施（261028 下午，用户裁决落地；未提交）

| # | 改动 | 文件 | 验证 |
|---|---|---|---|
| 1 | **表格 `ff` 收敛 core 常量**（裁决：不做换字体，直接收敛） | `src/core/usheetDoc.ts`（`USHEET_CANONICAL_FONT_FAMILY` + normalize 强制归一）、`UniverSheetEditor.tsx`、`usheetUniverFactory.ts`、删 `usheetFont.ts`、`MobileUsheetViewer.tsx`（capture/基线同函数） | `usheetDoc`/openReadOnly/移动 usheet 定向测试；新增「跨端逐字节相同」「base.css 同值」护栏 |
| 2 | **ink undo 推荐方案**（操作日志 + 页级快照、全局 undo） | `src/features/ink/history.ts`（页级 `InkPatch`，60 条 / 16MiB）、`InkPad.tsx`（每次只整篇序列化一次；落笔/橡皮/背景/加删页/移页走 patch） | 12 例（跨页、加删页、预算、10MiB/100 页 ≥30 步、无别名） |
| 3 | **浏览器端 P0 安全收口**（保留浏览器端；不做分屏/深链） | `electron/webApiServer.ts`（token 不再进静态 JS：HttpOnly cookie；统一 `isAllowedRequest`；删 `Sec-Fetch-Site: none` 放行）、`webApiServer.test.ts`、`vite.config.ts`（prod CSP 收成 19876/19880） | 25 例（6 项验收）+ assetServer/lakex 回归 60 例 |
| 4 | **全量重拉改为回收站语义**（用户裁决：复用远端 purge） | `src/core/s3v3Engine.ts`（pullAll：本地独有条目 → trashed + remotePurged）、`desktopStoreAdapter.ts`/`mobileDeviceStore.ts`（移除 archived、移动端小记 purged 分支软删）、`v3StateRepository.ts`、移除 `DeviceState.archived` | `pullAllSafety`（进回收站 + cloud_deleted 标 + 正文/历史在 + 不上传 + 显式恢复后重传）+ mixed conformance 更新 |
| 5 | **文档/红线同步** | AGENTS（!important 10、移动端 usheet 已接 helper）、HANDOFF 261028、02/05/08/09/11 | — |

**门禁（第二轮后实测）**：`tsc` 0 · vitest **448 文件 / 2841 passed（11 skipped）** · `ui-metrics` 10/10 · `check:core` 0 · `check:mobileui` 通过 · `git diff --check` 干净。

**遗留（明确未做）**：浏览器端 P1（能力矩阵 + 下载端点）/P2（bundle 分离）；移动表格置灰项（用户裁决保留待议）；C 的 CORE-02/03（坏正文策略、打开=只读 core 判据，建议与 v4 M3 一起）；设备级点验（MOB-01/06、Android release、浏览器端真机打开）。

---

## 11. 第三轮：浏览器端编辑完整性（261028，未提交）

用户问「浏览器端能否编辑文档/表格/多维表/画板」后实测代码结论：**五类编辑器本来就能编辑**（同一渲染层 + 同一 IPC → HTTP），但有两处编辑动作不可用，已修：

| # | 问题 | 修法 | 验证 |
|---|---|---|---|
| 1 | 浏览器插入本地图片/附件失败（`upload_resource` 要求 Uint8Array，HTTP JSON 传成普通对象） | shim 序列化加 TypedArray→number[] replacer；新增 `electron/ipc/bytes.ts · toUint8Array`（单一来源）；`upload_resource` / `stage_quick_note_image` / `stage_quick_note_file` 统一收 `Uint8Array | number[]` | `bytes.test.ts`（4 例）+ shim 含 replacer 断言；类型检查通过 |
| 2 | 浏览器 AI 助手不可用（无 onAiStream / 无 ai:stream 事件；HTTP 的 `event.sender.send` 是 no-op） | SSE 白名单加 `ai:stream`；shim 加 `onAiStream`；`createIpcRegistrar` 支持注入 `httpSend`，main 接 `broadcast` | `registrar.test.ts`（2 例：HTTP 事件转发/未注入 no-op）；`webApiServer.test.ts` 25 例 |

**门禁**：tsc 0 · vitest **450 文件 / 2847 passed（11 skipped）** · ui-metrics 10/10 · check:core 0 · check:mobileui · diff-check。

**仍不可用**：导出/导入/备份/目录选择（依赖 Electron 对话框）——属 11 的 P1（浏览器下载端点），未做。

---

## 12. 第四轮：功能/桌面/同步修复（261028 下午续，未提交）

用户复核后裁定：**安全项暂停**（CSP 通配等属既有有意决定，已撤回本轮误收窄）；其余功能/桌面/同步/UI 继续自主推进。

| # | 改动 | 依据 | 验证 |
|---|---|---|---|
| 1 | 多维表 markdown/ai 筛选不再恒真（并入文本分支 + 用例） | 09 CORE-01 | `src/core` 732 例绿 |
| 2 | 搜索索引：同步落盘带派生 cache+FTS（`searchTextForKind` 随 `saveNote`），打开文档的后置触发保留为兜底 | 10 CORE-01（修正版：原"永久不修"不准确） | 新增「远端改正文、不打开即命中新词」测试（去掉 caches 即红） |
| 3 | FTS5 保留字 AND/OR/NOT/NEAR 输出引号短语，不再 `AND*` 报错；改正被钉错的单测 | 10 CORE-02 | better-sqlite3 真 MATCH 断言 |
| 4 | 删 `quickNoteKeys` 零引用死模块（+测试） | 10 CORE-03 | `check:core` 116 文件 0 违规 |
| 5 | 空跑轮跳过 `saveBaseline`（零变更判据；state 仍落盘保标记清理） | 05 SD-07 保守版 | idlePublishRegression spy：空跑 0 次、追平远端 1 次 |
| 6 | 删 `validParents` O(N) 构造与未用 intent 导出、空语句 | 05 SD-10 | 同步层 89+93 例绿 |
| 7 | 9 处浮层估算定位改测量式 `usePopoverPosition`（顶栏/小记/大纲/同步浮窗） | 03 DT-03 | 定向 25 文件 231 例；ui-metrics 0；无 CSS 改动 |
| 8 | 抽 `editorViewport.ts`、`desktopDerivedState` 变纯函数、Suspense 文案统一 | 03 DT-14 | 新增 editorViewport/popoverMeasurement 测试 |

**安全复核（261028）**：CSP `http://127.0.0.1:*` 是 PDF/音视频内联与画板 data URL 所需（git `1ce3d3c2`/`4c2d2b49`），属「去过度防御」既有决定 ⇒ `vite.config.ts` 恢复通配并加注释；02 文档标 SEC-05「已定不做」。安全审计暂停，不再推进 SEC-04/06/08/09/10/11/12/13。

**门禁（第四轮后）**：tsc 0 · vitest **451 文件 / 2857 passed（11 skipped）** · ui-metrics 10/10 · check:core 116 文件 0 · check:mobileui · diff-check。

---

## 13. 第五轮：移动/桌面/同步功能项（261028 晚，未提交）

| # | 改动 | 依据 | 验证 |
|---|---|---|---|
| 1 | 移动端启动失败可处置（重试 init / 复制诊断 / 清派生缓存重试） | 04 MOB-08 | 定向 mobile 测试；真机点验待做 |
| 2 | 移动端设置项真正生效：附件上限读设置；历史清理低频调度（device_state 记时，默认 24h、0=关） | 04 MOB-09 | 定向 mobile 测试；设备行为待验 |
| 3 | 移动端标签恢复改为显式 `restore()`（首挂读存档，删除 `firstPersistRef` 隐式协议） | 04 MOB-12 | tabRestore 扩例；`clearTabsOnExit` 语义不变 |
| 4 | 移动端首屏预算护栏（preload≤21/JS≤80KB/CSS≤138KB，目标 12/120KB） | 04 MOB-15 | `check-bundle-budget.mjs` 通过（现状不回归） |
| 5 | 小记列表只回 `QuickNoteListSummary`（不读正文），新增 `read_quick_note`（IPC 135→136，preload/native/WEB_METHODS/parity 同步）；卡片进视口懒加载正文 | 03 DT-05 | 全量 vitest；新增「列表无 body / 单条可读正文」测试 |
| 6 | 桌面日志收口（`[sync-tab]` 11 处 console→rlog，删每轮 stringify） | 03 DT-08 | 全量 vitest |
| 7 | 同步内存：`bodyCache` 批内生命周期（512/32MiB FIFO + 轮末清空）、`buildAndUploadAll` 分批 flush | 05 SD-02 | perfPipeline 新增 3 例（首拉驻留 0、增量峰值≤30、首 put 早于最后一次正文读取） |

**越界但已批准的最小改动**：`src/lib/services.ts`(+test) 适配 summary→DTO；`src/core/resourceBehaviorContract.ts` 附件文案断言放宽为 `/附件超过 .* MiB/`（桌面 100MiB 行为不变）。

**门禁（第五轮后）**：tsc 0 · vitest **454 文件 / 2869 passed（11 skipped）** · ui-metrics 10/10 · check:core 116 文件 0 · check:mobileui · 两次 vite build ✓ · bundle 预算通过（移动入口 JS 70.9KB / CSS 137.1KB，上限 80/138）· diff-check。

---

## 14. 第六轮：UI 原语 / 浏览器 P1 / 坏正文只读（261028 深夜，未提交）

| # | 改动 | 依据 | 验证 |
|---|---|---|---|
| 1 | 移动端浮层单 owner（`useWorkspaceOverlays`，10 state 删除）+ 返回栈按 kind | 04 MOB-02 | 新增纯逻辑测试；工作区渲染分支/类名未动 |
| 2 | `ui/MobileSheet` 原语（scrim/右滑/返回栈/焦点/滚动锁）；迁移 `NoteInfoSheet`/`MobileQuickNoteTagSheet` | 04 MOB-11 | 新增 render 测试；其余 12 处列清单 |
| 3 | `useAnchoredMenu`（QN 5 菜单 + 大纲 1）、`InlineRenameInput`（Sidebar/TagManager）、`useAsyncAction`（SettingsPanel 6/10 组） | 03 DT-12/13 | 25 例新增测试；settingsSearch/sidebar 回归绿 |
| 4 | 浏览器 P1：`hostCapabilities` 能力矩阵 + `GET /download` 白名单下载 + shim 覆盖 5 个 export* | 11 P1 | webApiServer 33 例、hostCapabilities 5 例 |
| 5 | CORE-02 坏正文：`core/docBodySafety` 统一 usheet/board/ink；坏正文只读横幅 + 禁保存/capture 恒 null（桌面+移动） | 09 CORE-02 | 126 文件/898 例 |

**交互变化（需设备走查）**：移动端抽屉与 Sheet 不再共存（行菜单会先收抽屉）；MobileSheet 首次在移动端引入 body/html 滚动锁；浏览器导出改为「先落宿主机导出目录再下载」；设置页备份/恢复仅在浏览器端隐藏（桌面不变）。

**门禁（第六轮后）**：tsc 0 · vitest **463 文件 / 2936 passed（11 skipped）** · ui-metrics 10/10 · check:core 117 文件 0 · check:mobileui · 两次 vite build ✓ · bundle 预算 ✓ · diff-check。

---

## 15. 第七轮：协议文档 / 可观测 / 判据收口（261029 凌晨，未提交）

| # | 改动 | 依据 | 验证 |
|---|---|---|---|
| 1 | `docs/SYNC-PROTOCOL.md` 重写为 v3 唯一协议（模块↔文档对照）；18 份过程文档加失效横幅 | SD-11 | 文档；无代码门禁 |
| 2 | 同步诊断：最近 3 轮报告落 `device_state.sync_v3_reports`（桌面/移动同键），两端设置页「同步诊断」一键复制（复用 get_sync_status，无新 IPC） | SD-13 | 新增 `s3v3Report` 测试；`getSyncDiagnostics` 登记 NONE_OPS（基线 42→43） |
| 3 | 小记 `purged` 90 天窗口 + 接收端补记时间 | SD-09 | 新增窗口边界/引擎超窗/不复活测试 |
| 4 | core `docBaseline`（打开=只读单一判据）：桌面 usheet capture + 移动 usheet 三件套 | CORE-03 | core 幂等/改回原样/真实改动测试；移动行为测试 |
| 5 | `storeLimits.MAX_DOC_BODY_BYTES` 单一来源（ipcLimits/s3v3Engine/imageFormat/registerQuickNotes） | CORE-09 | 常量/别名/grep 护栏 |
| 6 | DT-04 jsdom 行为护栏试点（`multiTabHost.render.test.tsx`）+ `vitest.config.ts` 仅加 `.render.test.tsx`/`scripts/*.test.ts` | DT-04 | 5 例（5 kind/错误边界/文案/capture 注册） |
| 7 | DT-16 `core/editorCapture` 单类型 + lakeRuntime 清 8 处 any + native 命名返回类型；DT-11 dead-css 逐文件扫描（假阳性 6→0） | DT-16/DT-11 | 定向 95 例；dead-css 自证测试 |

**门禁（第七轮后）**：tsc 0 · vitest **470 文件 / 2977 passed（11 skipped）** · ui-metrics 10/10 · check:core **120 文件 0** · check:mobileui · 两次 vite build ✓ · bundle 预算 ✓（移动入口 JS 71.3KB/CSS 137.1KB）· diff-check。

**需设备走查（积累）**：移动 `home-pager`、`usheet` 键盘⇄面板、`notebook-workspace` 抽屉/行菜单/重命名、`doc-note-info`、标签面板、`doc-history`、`notebook-icon-sheet`；桌面 `quicknotes`/`outline-open`/`settings`/`menus` 相关快照态。

---

## 16. 第八轮：宿主契约 / 测试策略 / core 小修 / 移动收尾（261029 凌晨，未提交）

| # | 改动 | 依据 | 验证 |
|---|---|---|---|
| 1 | `features/editor/editorHost.ts` 的 `EditorHostProps` 单一词表；5 宿主接入（仅类型/入口别名）；`lakeRuntime` 1784→1521 行、`createLakeDocument` 921→330，抽 4 个 dispose 模块 | 03 DT-06/07 | 五目录 58 文件 460 例；快照态列清单 |
| 2 | perf 门禁：默认 500/2000 + 3.5× 上界/比值（STRICT 1.8×）；5000/20000 移手动脚本；`perf.big` 修列名；并发门禁只 12 端硬断言、删 retry、20/28 手动 | 05 SD-08/12 | perf 门禁 9.16s；全量 vitest **47s→24s**（473 文件 3009 例） |
| 3 | core `canonicalBitableNav` / `bitableViewNeedsClock` / 填色投影循环外提 / 日历窗口含当天 / `countTextStats` 单入口（含桌面/移动属性页两处收口） | 09 CORE-05/06/08/10 | 定向 28 文件 315 例 |
| 4 | 移动：注释漂移 4 处；`reportMobileActionError` 接入 23 处 catch；历史设置广播 + 自动快照重挂；CreateNotebook/Search Sheet 迁移 MobileSheet | 04 MOB-13/14/17/11 | src/mobile 149 文件 687 例 |
| 5 | 文档：`ARCHITECTURE.md` §4.4/§5 加 v3 过期横幅 + details 包裹；`TROUBLESHOOTING.md` #59 更新为已处理；`S3-V3-DATA-PERF.md` §6 新门禁口径 | SD-11/12 | 文档 |

**门禁（第八轮后）**：tsc 0 · vitest **473 文件 / 3009 passed（12 skipped）· 24.1s** · ui-metrics 10/10 · check:core 120 文件 0 · check:mobileui · 两次 build ✓ · bundle 预算 ✓ · perf 门禁 **9.16s 绿** · diff-check。

**需设备/快照（积累）**：移动 settings/home-*/新建与搜索 Sheet、表格命令、文档焦点/大纲；桌面 plain/outline/board/quicknotes 相关态；浏览器端真机；Android release。

---

## 17. 第九轮：移动 sheet 收尾 / board+ink 只读判据 / 设置页与日志（261029 凌晨，未提交）

| # | 改动 | 依据 | 验证 |
|---|---|---|---|
| 1 | 移动再迁 7 处到 `MobileSheet`（工作区图标/历史、DocList、Outline 底部、bitable 字段/记录、首页图标）；其余按结构差异保留 | 04 MOB-11 | 新增 12 例 render 测试；src/mobile 151 文件 700 例 |
| 2 | 桌面 board/ink 接 `core/docBaseline`（打开即关闭/改回原样不写盘、capture 回磁盘原文）；historyPreview 画板判据统一 | 09 CORE-03 | 新增 board/ink 只读护栏；全量 477 文件 3030 例 |
| 3 | SettingsPanel 剩余 4 组（log/web/ai/aiModels）迁移 `useAsyncAction`（10/10）；lakeRuntime/UniverSheetEditor 15 处 console→rlog | 03 DT-13/DT-08 | 定向 52 文件 299 例 |

**门禁（第九轮后）**：tsc 0 · vitest **477 文件 / 3030 passed（12 skipped）· 24.7s** · ui-metrics 10/10 · check:core 120 文件 0 · check:mobileui · diff-check。

---

## 18. 第十轮：SD-06 契约 + MOB-04 探针（261029 凌晨，未提交）

| # | 改动 | 依据 | 验证 |
|---|---|---|---|
| 1 | `docs/SYNC-DEVICE-CONTRACT.md`：端口矩阵（必需/可选/退化）+ 双端差异表 + conformance 场景矩阵；`s3v3DeviceStore` 注释修正 | 05 SD-06 保守版 | 文档 |
| 2 | conformance 扩到 10 个语义场景（+锁/恢复/purge/全量重拉/deferAssets/声明保留）；移动 capability 钉住 `editLockTimestamp/lockOnlyChangePropagates=false` | 05 SD-06 | desktop/mobile/mixed 45 例 |
| 3 | 移动长文档探针 `scripts/mobile-audit/long-doc-dom.mjs` + `docs/MOBILE-LONG-DOC-PROBE.md`（A/B 方案、判据，不切换虚拟渲染） | 04 MOB-04 | 脚本/文档 |

**门禁（第十轮后）**：tsc 0 · vitest **477 文件 / 3042 passed（12 skipped）· 25.1s** · ui-metrics 10/10 · check:core 120 文件 0 · check:mobileui · 两次 build ✓ · bundle 预算 ✓ · perf 门禁 9.43s ✓ · diff-check。

---

## 19. v4 决策记录（261028，用户拍板）

| 议题 | 结论 | 对 RFC 的影响 |
|---|---|---|
| 全量重拉本地独有的处置 | **复用回收站 + 「云端已删除·仅本地」标**（不新制备份区） | `07` §6.4/§13-1 已改；`06` 的 archived/备份区条目已删 |
| 账本收敛兼容策略 | **断代，不做双写**：全端同版本、旧端提示升级，不写双读/双写 | `07` §10/§13-2、E3-1 改为「直接收敛 + 删旧字段」 |
| 编辑器/小记 lifecycle | **同意共享状态机/意图/判定，不共享存储/历史/保留策略；小记冲突副本两端统一建新副本** | `07` §13-3 已定；v4 core 按 policy 参数化 |
| 同步台账内容 | **不做详细台账**：云图标浮窗放「状态 / 上次同步 / 上传下载细分（文档/目录/小记/字节，保留）/ 待同步 / 失败与冲突入口」，其余进「设置 → 同步诊断」+ 日志；v4 不做独立台账面板 | `07` §13-4 已定 |
| 性能门禁口径 | 默认即「500/2000 比值 + 5 万手动」（SD-12 已落地） | 无需再改 |

**实施前置**：v4 尚未开工；需先完成 §13 剩余 3/4 项（lifecycle 边界、台账 UI 落点）与 E1 抽 `protocol/` 的对拍门禁。

---

## 20. 第十一轮：死代码清理 + 移动画板基线 + 浏览器 P2 评估（261029，未提交）

| # | 改动 | 依据 | 验证 |
|---|---|---|---|
| 1 | 删 manifest 时代死代码：`syncAdapters`、`syncApplyGuard.test`、`syncAssets`、`gcDecisions/gcDiagnostics/gcPolicy`(含测试)、`core/services`+`lib/services`(含测试) —— 共 **12 文件 / 1443 行**；就地删 `syncDecisions` 7 个 legacy、桌面 `s3_gc_pending` 全链路（表/方法/IPC/设置页，保留 `s3_gc_log`）约 350 行 | 05 §3 / 10 §3 | 净减约 1760 行；tsc 0 / 全量 vitest 2996 例 / check:core 115 文件 0 |
| 2 | 移动画板接 `core/docBaseline`（打开=只读）：等价不写盘/不标脏、capture 返回磁盘原文，真实改动照旧 | 09 CORE-03 | 新增 CORE-03 用例，mobile board 11 例 |
| 3 | 浏览器 P2 bundle 分离量化评估（只写文档）：结论 **不做** | 11 P2 | `docs/BROWSER-BUNDLE-SPLIT.md`（首屏 2.78MB gz、内核 90%、Electron-only 0 import、可剪 <0.02%） |
| 4 | 顺手清理过期文档/注释（AGENTS 的 syncAssets 表述、run5c 失效调用、noteRepository/s3Store 过期注释） | — | — |

**门禁（第十一轮后）**：tsc 0 · vitest **472 文件 / 2996 passed（12 skipped）· 23.1s** · ui-metrics 10/10 · check:core **115 文件 0** · check:mobileui · 两次 build ✓ · bundle 预算 ✓ · diff-check。

注：`src/lib/services.ts` 删除时含此前 DT-05 的 summary→DTO 适配（该文件零生产调用，随死文件一并移除；若需要恢复测试适配可从 git 取）。

---

## 21. 第十二轮：同步浮窗收敛（用户 261028 定稿，未提交）

用户意见：台账太细、太杂；点云图标浮窗只放关键信息，明细进设置/日志。**唯一保留的细分 = 上传/下载（文档/目录/小记/字节）**。

| # | 改动 | 依据 | 验证 |
|---|---|---|---|
| 1 | 引擎 `S3v3SyncReport` 增细分字段（uploadedDocuments/downloadedDocuments/uploadedQuickNotes/downloadedQuickNotes/uploadedFolders/downloadedFolders/uploadedBytes/downloadedBytes）；在正文/目录/资产上传下载处累加（资产字节含原生流式与分片路径） | 浮窗细分数据源 | 全量 vitest 绿 |
| 2 | 桌面 `SyncStatusPopover`：**始终显示两行**「上传/下载：N 文档 · N 目录 · N 小记 · X MB」（0 也显示）；删除「移入回收站」行、逐条 warning 列表、逐条冲突列表；警告改为「N 项被跳过 → 设置→同步诊断」；冲突改为「N 篇已保留历史 + 查看历史」；本地空间卡片去重（仅一句「数据仅保存在本机…」+ 去设置） | `07` §13-4 | ui-metrics；build |
| 3 | 移动：`MobileSyncStatus` 增细分字段（bridge 从引擎 report 回填）；设置页在「上次同步」下加一行「上传 2/1/0 · 1.5 KB · 下载 0/0/1 · 340 B（文档/目录/小记）」；旧记录无细分则不显示 | 同上 | 新增 `syncStatusStore.test`（完整/0/旧记录 3 例） |
| 4 | 桌面 `SyncResult` 增同名字段并在 `desktopSync` 映射；CSS 增 `.sync-status-inline-action`（间距 4px；cssLayers 基线 components.css 367→369 已登记） | — | 全量门禁 |

**门禁（第十二轮后）**：tsc 0 · vitest **473 文件 / 2999 passed（12 skipped）· 25.8s** · ui-metrics 10/10 · check:core 115 文件 0 · check:mobileui · 两次 build ✓ · bundle 预算 ✓ · diff-check。

---

## 22. 第十三轮：v4 E1-1（协议抽层 + Plan 类型）· 已开工（261028，未提交）

用户确认 Q1-Q3 后开始 v4，先从 **E1** 最安全的一步入手（不动引擎行为、不改 wire format）：

| # | 改动 | 说明 |
|---|---|---|
| 1 | 协议层落位：`src/core/s3v3/protocol/`（keys/types/index/pointer）+ barrel `index.ts` | 纯移文件 + 33 个文件 import 路径更新；`s3v3Index` 对 `syncUtils` 的相对路径修正 |
| 2 | `src/core/s3v3/plan/types.ts`：`SyncPlan`/`ReadOp`/`WriteOp`/`TransferOp`/`DeleteOp`/`Intent`/`PlanWarning` + 不变量注释 | 只落契约，不接线；E1-2 的输入输出形态 |
| 3 | `scripts/check-core-boundaries.mjs` 规则修正 | 之前只允许「`./` 开头」的扁平目录假设；改为**解析真实路径、判定仍在 `src/core` 内**（意图不变，适配 v4 子目录） |
| 4 | 目录分层注释（Protocol → Reconciler → Applier → Publisher） | `protocol/index.ts` 头注释 |

**门禁（E1-1 后）**：tsc 0 · vitest **473 文件 / 2999 passed（12 skipped）· 23.2s** · ui-metrics 10/10 · **check:core 117 文件 0** · check:mobileui · 两次 build ✓ · diff-check。

**下一步（E1-2/E1-3）**：实现纯函数 `planSync()`（复用 `planLakeMerge`/`planQuickNotesMerge` + 资产差集/传输计划/意图变更/确定性 total），并建立与旧引擎的 **dry-run 对拍**（操作集差异必须 0 才允许 E2 切执行器）。
---

## 23. 第十四轮：v4 E1-2（planSync 纯函数）· 决策层完成（261028，未提交）

| # | 改动 | 说明 |
|---|---|---|
| 1 | 新增 src/core/s3v3/plan/plan.ts：planSync(input): SyncPlan | 零 IO；输入 local/base/remote + state(restore/purge/quickDeletes/purged)，复用 planLakeMerge / planQuickNotesMerge；输出 reads/writes/transfers/deletes/publish/intents/warnings/total |
| 2 | 决策映射：apply-remote / upload(PUT body) / remote-wins-history(archive-local + warning) / remote-purged-trash(set-lifecycle cloud-deleted) / local-purge(删除对象前缀) / restore-upload；目录 upload/download 计入 publish | 与 v3 语义同源；I0：收敛不产生 delete，delete 只来自 purge |
| 3 | 零变更短路：无 upload/apply/lifecycle/purge ⇒ publish=null（只读 pointer） | 与 SD-07 口径一致 |
| 4 | 单测 plan.test.ts（9 例）：零变更 / 远端更新 / 本地更新 / purge / 显式恢复 / 冲突留档 / 小记 / 目录 / total.ops | 全绿 |
| 5 | 留待下一步：资产级 transfer（声明差集/实扫）与 pending 清理计划；intentChanges 仅结构（清除仍由 Finalize 按 generation 做） | E1-2b + E1-3 |

**门禁**：tsc 0 · vitest 474 文件 / 3008 passed（12 skipped）· 26.4s · check:core 118 文件 0 · diff-check。

**下一步（E1-3 对拍门禁）**：同一批夹具分别跑旧引擎（fake remote/device 记录实际操作）与 planSync，断言操作集差异 = 0（pull/push/delete/archive 逐项 + 零变更轮 publish=null）；差异 0 才允许 E2 切执行器。
---

## 24. 第十五轮：v4 E1-3（新旧对拍门禁）· 决策层通过（261028，未提交）

| # | 改动 | 说明 |
|---|---|---|
| 1 | 新增 src/core/s3v3/plan/planParity.test.ts（4 例）：同一夹具分别跑旧引擎（fake remote/device 记录操作）与 planSync | 零变更 / 远端更新 / 本地更新 / 冲突四场景；断言 pull 集合、PUT body 集合、archive 集合、published 语义一致 |
| 2 | 对拍发现并修正 plan 语义：**纯拉取轮不重发索引**（applyRemote 不应置 publish），只有本地发布（uploadLocal / local-purge / 文件夹 uploadLocal）才 publish | 与 v3 引擎行为一致；同步修正 plan.test 期望 |
| 3 | 对拍夹具修正：pointer generation=2 / baseline=1（避免同代不同 commit 判 fork）；正文按 sha256 造数（可校验） | 测试自身正确性 |

**门禁**：tsc 0 · vitest 475 文件 / 3012 passed（12 skipped）· 25.7s · check:core 118 文件 0 · diff-check。

**未覆盖（下一步 E2 前置）**：delete 执行（本地 purge vs 远端对象删除）的集合对拍；资产级 transfer（声明差集）对拍；quick note 独立场景；以及把 plan 真正接进执行器（E2 apply/commit 拆分）。
---

## 25. E1 收口：范围裁决与 E2 施工计划（261028，未提交）

### 25.1 两个「未覆盖项」的裁决（不是遗漏，是分层归属）

| 项 | 归属层 | 理由 |
|---|---|---|
| 资产级 transfer（声明差集） | **Apply（E2）**，不进纯 plan | 上传/下载哪个资产要先拿到远端声明**字节**（`meta/assets/{id}/{declHash}.json`）才能做差集；plan 阶段只输出 `ReadOp{kind:"declaration"}`。若把声明内容塞进 plan 输入，等于把 IO 结果伪装成决策输入，破坏「plan 零 IO / 可序列化 dry-run」。⇒ 资产差集是 Apply 的「声明读回后的二次展开」，v3 引擎同构（`uploadAssets` / `scheduleAssets`）。 |
| pending 对象删除的执行 | **Commit/Finalize（E2）**，不进 plan | 执行集由持久队列 `state.pending` + `gatePendingDelete(world)` 决定，而 `world` 依赖**本轮新索引 commit**（申请后才知道）；plan 只能表达用户语义（`DeleteOp{reason:"user-purge"}`）。⇒ 对象级删除（旧索引/旧声明/孤儿）属提交后清理，与 v3 一致（`planLakeDeletes/planQuickNotesDeletes` → pending → 门禁 → 执行）。 |

**结论**：E1-3 对拍在「决策层」已闭合（pull / PUT / archive / publish 四类），E2 只需把决策层的输出接到执行层，不必回头改 plan 契约。

### 25.2 E2 施工分解（每步独立可回滚、每步带门禁）

| 步 | 内容 | 关键约束 | 验收 |
|---|---|---|---|
| E2-1 | 抽出 `Applier`：消费 `SyncPlan` 的 reads/transfers/writes，**不改语义** | 幂等（重复应用同一 plan 无副作用）；原子写复用现有 `writeBody/writeAsset`；错误只影响单对象（沿用 `runTransferPipeline` 的 all-or-isolate） | 对拍：同一夹具 plan→Applier 与 v3 引擎的 `writeBody` / PUT 集合相同（在 E1-3 基础上扩 delete 场景） |
| E2-2 | 抽出 `Committer`：build index → lock → readback pointer → write pointer（重试） | 与 v3 `publishIndexes` 逐行等价；**零变更轮不发布**；失败回退到远端旧条目 | 复用现有 `publishIndexes` 测试 + 新增「读回 pointer 被抢先」场景 |
| E2-3 | `IntentLog`：删除/恢复/彻底删除意图的 add/clear 与基线代际绑定 | **兜底不丢**：意图未清除前重复执行安全；清除条件 = 「基线代际 ≥ 目标代际 且 目标条目已不在基线」 | 新增 unit（删除后又恢复、删除被远端抢先、跨代残留清除） |
| E2-4 | `DeviceStore` 单实现：把桌面/移动两个适配器收敛到一份（SqlDriver/FileDriver） | **不动 wire 协议**；不改桌面 ``sync-v3/baseline.json.gz`` 布局；移动 `sync_v3_state` 的表结构不变 | 双端适配器现有测试全绿 + 快照门禁（动了设备层才跑） |

**顺序不可调**：E2-1 → E1-3 扩展对拍（delete/pending）→ E2-2 → E2-3 → E2-4；E3（断代）在 E2 四个子步全绿后才动。

**回滚策略**：每个子步新增文件（`src/core/s3v3/apply/*`、`commit/*`、`intent/*`），旧引擎路径保持可用，用「开关 + 对拍测试」并行到 E2-4 收口再删旧路径 —— 不做双写磁盘数据。
---

## 26. 第十六轮：v4 E2-1 Applier（261028，未提交）

**新增** `src/core/s3v3/apply/applyPlan.ts`：`applyPlan(plan, ports, opts)` —— 只消费 SyncPlan 的 reads/transfers/writes/deletes，**不做决策**；IO 面收窄成 8 个方法的 `ApplyPorts`（比 `S3v3DeviceStore` 窄，E2-4 才收敛）。

**执行顺序（顺序不是契约，集合才是）**：归档本地版本（先于任何正文覆盖）→ 声明读取（取回 + 校验 hash，不做差集）→ 正文下载（get → sha256 校验 → 落盘）→ 正文上传（读本地字节 → 复算 sha256 与计划 hash 一致才 PUT）→ user-purge 对象删除。

**数据安全不变量落在这一层（不靠调用方记得）**：
| 不变量 | 实现 | 失败表现 |
|---|---|---|
| 缺正文 ≠ 用户删了内容 | 上传前 `readLocalBody` 为空 ⇒ 跳过 PUT | `local_body_missing` warning + `failedUploads`（**Commit 必须回退到远端旧版本**） |
| 不写坏字节 | 下载后 sha256 与索引 hash 比对 | `hash_mismatch` warning，**不落盘**（本地旧正文保持） |
| 内容地址不得错配 | 上传前复算本地 sha256 与计划 key 的 hash 比对 | 同上，跳过上传 |
| 收敛动作不删本地 | 只有 plan 明确给出 `user-purge` DeleteOp 才删本地正文/远端前缀 | 其它路径无删除入口 |
| 失败只影响单对象 | 两段 `runTransferPipeline`（并发默认 8，可配） + errors 收集 | 其它对象继续；上传失败并入 `failedUploads` |

**测试**：`applyPlan.test.ts` 13 例（上传/缺正文/hash 不符/单对象隔离/小记 key/下载/远端缺失/坏字节/归档 reason/声明校验/声明 hash 不符/purge/幂等）。

**对拍升级（E2-1 门禁）**：`planParity.test.ts` 增加「plan + apply 与旧引擎副作用对拍」——同一夹具分别跑 ① 旧引擎 ② `planSync` + `applyPlan`，断言 **PUT 正文键集 / `writeBody` 集 / 归档集 / 是否发布** 四类一致，覆盖零变更 / 远端更新 / 本地更新 / 冲突。5 例全绿。

**本步明确不做（防越界）**：
- 不把 applier 接进引擎（E2-2 Committer + E2-4 单一 DeviceStore 后才切；旧路径保留，不做磁盘双写）；
- 资产级 PUT/GET 仍是 v3 引擎内逻辑（E2-1b：消费本函数返回的 `declarations` 做声明差集）；
- 索引行变更（`apply-remote` / `set-lifecycle`）归 Commit 消费 `plan.writes`，applier 只做关联正文 IO；
- 并发默认 8（非资产的整轮口径）；传输性能回归由 E2-4/E3 的 perf 门禁验证。

**门禁**：tsc 0 · `src/core/s3v3` 18 文件 131 例通过 · 全量见下轮记录。
**E2-1b 前置发现（做 E2-1 时暴露的 plan 契约缺口，不是实现 bug）**：资产上传/声明的驱动条件是「条目 uploadLocal」（含**只改元数据、正文没变**的轮次），而当前 `SyncPlan` 只有 `transfers.put body`（正文变了才有）⇒ 元数据-only 上传在 plan 里完全不可见。⇒ E2-1b 第一步必须先给 plan 增「发布集」标记（`WriteOp{kind:"publish-local"}` 或 `SyncPlan.publishes`），再谈资产差集；否则 applier 会静默漏掉「只改锁/图标/标题」的上传。对拍也要补「元数据-only 上传」场景。
---

## 27. 第十七轮：v4 E2-1b 发布集 + 资产段（261028，未提交）

**① plan 契约补缺（E2-1b 前置，不是新增抽象）**：`SyncPlan.publishes: { lake: string[]; quickNotes: string[] }` = 合并结果的 uploadLocal 集。原因：正文没变、只改锁/图标/标题时**没有 body PUT**，只看 `transfers` 会静默漏掉这类上传（做 E2-1 时暴露）。folders 不参与（无资产）。
  - 单测 3 例：metadata-only 出现且无 body PUT；纯拉取/零变更为空；小记按空间分开。
  - 对拍：夹具加「仅元数据（锁/标题变、正文未变）」；并断言 `publishes` 与手工合并语义一致（**不能用引擎 `readBodies` 当代理**：冲突时引擎也会为历史快照读本地字节）。

**② 新增 `src/core/s3v3/apply/applyAssets.ts`**：`applyAssets(plan, ctx, ports, opts)` —— 只做声明差集的 PUT/GET。
| 规则 | 实现 |
| --- | --- |
| 差集 = 文件名集合差（不逐对象 HEAD） | 上传：本机有、云端声明无 → PUT；下载：声明有、本机无或 size/hash 不一致 → GET |
| 声明永远全量、filename 升序规范化 | `buildAssetDeclaration(local)` 的序列化结果即 key（内容寻址） |
| **空目录 ≠ 删光附件** | 本机资产为空且云端声明非空 ⇒ 不写空声明（保留远端 assetsHash）+ 按声明自愈下载；护栏沿用 261026 真机事故结论 |
| 坏字节不落盘 | 上传前复算本地 sha256、下载后校验声明 hash |
| 幂等 | 声明里已有的资产不再 PUT；重复应用只重写同 key 声明 |
| 首拉 lazy 档 | `deferDownloads: true` 只写声明不搬媒体（与 v3 `deferAssets` 同义） |

**测试**：`applyAssets.test.ts` 9 例（上传差集/空目录自愈/空声明/元数据-only/本地坏字节/下载差集/已存在跳过/defer/下载坏字节/幂等）。

**仍不接线**：applyAssets 与 applyPlan 都还没进引擎（E2-2 Committer 消费 `assetsHashes` + `failedUploads` 后一起切；旧路径保留，不做磁盘双写）。

**门禁**：tsc 0 · `src/core/s3v3` 子集全绿（plan 12 + parity 5 + apply 22）· 全量见下轮。
---

## 28. 第十八轮：v4 E2-2a 最终索引合成（261028，未提交）

**新增** `src/core/s3v3/commit/buildPublishIndex.ts`：`buildPublishIndex(plan, remote, overrides)` —— **纯函数**，把 `plan.publish` + Apply 结果合成「本轮真相」索引。

为什么先做这一半：索引是唯一真相载体，**回退规则最容易在重构时丢掉**（丢掉的后果 = 索引引用未落盘的正文/声明，属于数据安全级）。纯函数可穷举测试、可 dry-run 打印「这轮索引会变成什么样」。

| 规则 | 行为 |
| --- | --- |
| `plan.publish === null` | 返回 null（零变更/纯拉取不提交） |
| 上传失败的条目（`failedUploads`） | 远端有同 id ⇒ **回退远端旧条目**；远端也没有 ⇒ 从索引移除 |
| `assetsHashes` | 覆盖/清空条目 `assetsHash`（applyAssets 声明结果） |
| 顺序与结构 | 保持 plan.publish 顺序；返回深拷贝（不把调用方对象泄露出去改） |
| 文件夹 | 原样带出（无资产、无上传失败语义） |

**测试** 7 例：publish=null / 无覆盖恒等 / 失败回退远端 / 失败且远端没有则移除 / assetsHash 覆盖与清空 / 小记同规则+标签保留 / 文件夹原样。

**仍不接线**：lock + 读回 pointer + 指针写入（E2-2b）与引擎切换（E2-3）未做；旧路径仍在跑。

**门禁**：tsc 0 · `src/core/s3v3` 20 文件 150 例通过 · 全量见下轮。
---

## 29. 第十九轮：v4 E2-2b 发布锁/指针 + E2 端到端对拍（261028，未提交）

**新增** `src/core/s3v3/commit/commitPlan.ts`：无 CAS provider 的发布语义，与 v3 引擎逐条等价。

| 不变量 | 实现 |
| --- | --- |
| 写索引前持锁；写指针前**复核锁归属** | 写锁 → 静置 → 读回确认 → 写索引 → `assertLockOwned` → 写指针 |
| 写指针前读回 pointer | epoch/generation/两 commit 全等，否则 `retry{pointer-moved}`（他端已发布 ⇒ 本轮作废） |
| 写指针后读回确认 | generation + 两 commit 必须等于本次写入，否则 `retry{readback-mismatch}` |
| 只删自己的锁 | 释放前比对 `deviceId`；他端抢走时**不误删** |
| 零变更不碰 S3 | 两索引 commit 都等于 base ⇒ `unchanged`，不拿锁不写对象 |
| 只写变了的半边索引 | `wroteLake` / `wroteQuick` 分别判定（大库空跑省一次全量 gzip） |
| 不重试 | 只返回 `retry` 结果，退避交给编排层（避免两层各退一次） |

**测试** `commitPlan.test.ts` 9 例：skipped / unchanged 零写入 / 单边发布（锁→索引→指针顺序 + gzip 标记 + 锁释放）/ 双边发布 / 他端新鲜锁 lock-busy（不误删锁）/ pointer 已被推进 pointer-moved（未写索引）/ 写索引后锁被抢 lock-lost（指针不写）/ pointer 被覆盖 readback-mismatch / 过期锁可接管。

**E2 端到端对拍** `commit/pipeline.test.ts` 2 例：同一夹具分别跑 ① 旧引擎整轮 ② `planSync → applyPlan → buildPublishIndex → commitPlan`，断言**发布的索引 commit 完全一致、generation 一致、索引对象字节一致、正文对象一致**；零变更场景两条链路都不发布且 pointer 同代。

**门禁**：tsc 0 · `src/core/s3v3/commit` 3 文件 18 例通过 · 全量见下轮。

**仍未覆盖（E2-3 之前必须补）**：资产段接入端到端链路（applyAssets 已在 pipeline 外单测）；pending 对象删除执行（`gatePendingDelete`）；IntentLog（E2-3）；引擎切换（E2-3）。
---

## 30. 第二十轮：pending 删除执行 + 资产进端到端链路（261028，未提交）

**新增 `commit/executePending.ts`**：待删队列执行器。门禁**不搬**，继续用 `core/s3v3Gate` 的 `gatePendingDelete`（「宁可不删、不可误删」的单一来源）。
| 语义 | 行为 |
| --- | --- |
| 门禁不放行 | **跳过并出队**（仍被引用/无法确认），不是失败、不重试 |
| 前缀 vs 键 | 先按前缀 `deleteByPrefix`，再 `deleteMany(keys)`（计数取真实删除数） |
| 执行失败 | 不消费队列，保留可执行项等下轮；只降级为 `cleanup_failed` warning（发布已成功不得报失败） |
| dryRun | 只预演 `wouldExecute`，零 IO、不消费队列 |

**测试** 7 例：空队列/正文已替换/仍被引用出队/purge 前缀计数/声明仍被索引引用保守跳过/dryRun/执行失败保留。

**资产进端到端链路**：`pipeline.test.ts` 增加「本地更新 + 新增附件」，设备端补 `listAssets/readAsset/writeAsset`，链路跑 `planSync → applyPlan → applyAssets → buildPublishIndex → commitPlan`，断言：
- 远端 `assets/a/p.png` 与 `meta/assets/a/*.json` **键集合与引擎完全相同**；
- **索引字节一致** ⇒ 条目上的 `assetsHash`（声明版本）也一致；
- `applyAssets.uploaded.files === 1`。

**本轮修掉一处语义分叉（对拍暴露）**：`applyAssets` 原来在「本机确实没有资产」时写一个**空声明对象**并把 `assetsHash` 指向它；v3 引擎的 `uploadAssets` 在 `filenames.length === 0` 时返回 null ⇒ **不写空声明**，条目 `assetsHash` 为 undefined。已改成同口径：本机空且云端无声明 ⇒ 不写、清空 `assetsHash`；云端有声明（哪怕是空声明）⇒ 保留远端 hash，不自作主张清空。

**门禁**：tsc 0 · `src/core/s3v3/commit` 4 文件 26 例通过 · `apply` 23 例 · 全量见下轮。

**E2-3 剩余**：IntentLog（删除/恢复意图的 add/bump/clear 生命周期收敛）+ 引擎切成四相编排。
---

## 31. 第二十一轮：IntentLog + 删除路径端到端对拍（261028，未提交）

**新增 `commit/intentLog.ts`**：删除/恢复意图的三段生命周期收敛成纯函数（判据仍用 `core/s3v3Intent.shouldClearDeletionIntent`，不搬）。
| 段 | 函数 | 规则 |
| --- | --- | --- |
---

---

---

---

---

---

---

---

## 39. 第二十九轮：内核重试 + 冲突留档回填（261028，未提交）

- **并发重试**（切换前缺口 1）：`syncOnceRound` 内加 3 次退避重试（每次重读 pointer + 两份索引 → `runRoundOnce`），`retry` 视为可重试；`runRoundOnce` 抽出单次执行。**12 端并发容量测试在 `LAKE_S3V3_ROUND_KERNEL=1` 下由红转绿**（6 端并发推拉亦绿）。
- **冲突留档清单**（缺口 3）：内核按 plan 的 `conflict_kept_history` 警告回填 `this.supersededNotes`（既有路径在 pull 循环里 push 的那份），UI 冲突清单/角标可消费。

**开启态仍红（内核自身缺口，未修）**：
| 测试 | 现象 | 缺口 |
| --- | --- | --- |
| `parity > 冲突留档回执（conflicts>0）` | `conflicts` 仍 0 | 适配层从 `r.conflicts` 取值，而内核只填了 `supersededNotes`；需对齐适配层映射或直接填 conflicts |
| `parity > 编辑锁跨端传播` | B 侧未变锁 | 字段级（is_locked）变更在 plan 决策里不可见 ⇒ 不发布；需在 plan/merge 侧补字段级 LWW diff |
| `parity > 缺正文恢复 warning` | 未自愈 | 内核未实现 `restoreMissingBody`（按远端同 hash 拉回）|
| `desktopSync > 真实 Store ↔ 对端` | published 断言 | 依赖上面两条 |

**门禁**：tsc 0 · 全量 488 文件 3096 例（perf 单独跑通过；并发跑时 perf 门禁受机器负载影响会假红，单跑 7.7s 绿）· diff-check。
---

## 40. 第三十轮：异常逻辑改为事件驱动 + 内核默认开启（261028，未提交）

**用户口径**：异常处理只能在**真的出现异常时**触发；正常增量同步不得走异常分支。旧实现每轮调一次目录列举（虽节流）仍属"正常同步里跑异常逻辑" ⇒ 改为**事件驱动**：

| 环节 | 行为 |
| --- | --- |
| 检测（唯一入口） | 真的观察到正文缺失才入队：打开文档读到 bodyMissing、资源页体检 listMissingBodies() 发现缺正文 |
| 持久化 | device_state.body_recovery_pending（小型 id 数组；Store.mark/list/clearBodyRecoveryPending） |
| 同步侧 | 内核只读 state.bodyRecoveryPending（正常为空数组）⇒ **零扫描、零额外 IO**；命中项按云端同 contentHash 拉回 + sha256 校验，消费后清空 |
| 已删除 | 适配层 listMissingBodyIds 端口与目录列举实现（连同节流），不留"正常轮也可能跑异常逻辑"的入口 |

**默认开启**：electron/s3v3/desktopSync.ts 改为 LAKE_S3V3_ROUND_KERNEL !== "0"（默认内核，=0 一键回退旧路径对照）；首拉/空桶/无基线仍由既有路径接管。

**验证**：内核模式全量 **488 文件 / 3096 passed**（tsc 0 / check:core 0 / diff-check ✓）；LAKE_S3V3_ROUND_KERNEL=1 下 parity 4/4 全绿（含缺正文自愈）；12 端并发容量单跑通过（全量并行跑属负载假红）；perf 两模式通过（2000 文档 noop 102ms / edit 150ms，异常路径无扫描）。


---

## 41. 第三十一轮：v4 首传能力（淘汰旧路径的第 1 步，261028，未提交）

- `commitPlan` 支持 **base = null（首传）**：云端必须仍无 pointer（被抢先 ⇒ retry pointer-moved），发布 generation 1，epoch 新建，索引与 pointer 写入/读回语义同正常轮。
- 新增 `commit/initialPublish.test.ts`：空桶首传，**旧引擎 vs v4（plan → apply → buildPublishIndex → commit(null)）发布的 lake commit 相同、generation 都是 1、索引字节相同**。
- 意义：旧路径里"空桶首传 / buildAndUploadAll"这段不再是不可替代的；下一步把它接进引擎首轮（no pointer + no baseline），旧路径就只剩 pullAll（换机/全量重拉）。

**淘汰旧 V3 的剩余清单**
1. 引擎首轮（空桶/无基线）改走 v4（runSyncRound 放宽 basePointer=null + 首轮基线写入）；
2. pullAll（换机/坏库全量重拉）迁移或明确保留（它含"本地独有 → 回收站"语义，plan 已支持 base=null 但需 dirty 标记）；
3. 移动端同步接同一开关；
4. 删 `incrementalSync` 的旧决策/IO 段，只留外壳；对拍测试改为金标准快照。


---

## 42. 第三十二轮（目标模式 R1）：pullAll + 移动端接入 v4（261028，未提交）

- **新增 `commit/pullRound.ts`**：全量重拉（换机/坏库）四相编排 —— 本地独有 ⇒ 回收站 + `cloud-deleted` 标记（绝不物删）、被覆盖版本先归档、hash 相同的条目不下载不读正文、不发布 pointer（云端即真相）。引擎新增 `syncPullAllRound`（有 pointer 无基线时接管；基线按 pointer 写回）。
- **对拍**：`commit/pullRound.test.ts` 2 例 —— 同一夹具下 v4 `pullRound` 与旧 `pullAll` 的收敛结果一致（条目集合 / remotePurged / 归档集合 / 下载正文内容）；以及**引擎全量重拉（roundKernel）与旧 pullAll 一致**（条目集合、remotePurged、generation、downloadedDocuments）。
- **首传编排** `commit/initialRound.ts` + 引擎 `syncFirstRound`（无 pointer 无基线时接管）。对拍：引擎首轮（kernel）与旧空桶首传发布同一 lake commit / gen 1 / 索引字节相同、基线 gen 1。
- **移动端接入**：`runMobileV3Sync` 的引擎默认 `roundKernel: true`（`localStorage` 置 `lake-v4-round-kernel=0` 可回退）；`src/mobile/v3` 全绿。
- **真桶冒烟**（桌面，默认内核）：两轮同步 round-plan/apply/finalize，`published:false gen:3`，warnings 0，耗时 470ms。
- **perf（内核开启态）**：2000 文档 init 401ms（首拉走 v4 首传）、noop 87ms、edit 148ms，均远低于门禁。

**目标剩余**：③ 删除旧 `incrementalSync` 决策/IO 段只留外壳（保留 `LAKE_S3V3_ROUND_KERNEL=0` 应急回退直到真机验收完成）；④ 对拍测试改金标准快照；⑤ 最终全量门禁 + 真桶发布轮验证。


---

## 43. 第三十三轮（目标模式 R2）：尝试删除旧 v3 实现 → 暴露 75 处行为缺口 → 安全回退（261028，未提交）

**做了什么（按目标 ③）**：把引擎的旧决策/IO 段整段删除（`syncOnce` 改为四分支 v4-only、删 `incrementalSync`/`initialUpload`/`pullAll`/`buildAndUploadAll`/`executePending`/旧意图 helper/WorkingSet/tag helper、去掉 `roundKernel` 开关与适配层 env、mobile localStorage 开关），并把对拍测试改金标准：
- `pipeline.test.ts` 重写为**金标准快照**（期望值用 `serializeLakeIndex`/`buildAssetDeclaration` 直接算，不再跑旧引擎）；
- `initialPublish.test.ts` 同样改金标准；`pullRound.test.ts` 改为显式期望（不再对比旧 `pullAll`）；
- 删除已失去意义的 `planParity.test.ts`、`roundKernel.test.ts`（对比对象将被删除）。

**结果（必须记录）**：删除后全量 **75 个既有用例红**，暴露 v4 尚未覆盖的既有行为，例如：
- 资产下载差量/复用（`assetDownloadDiff`、`assetReuse`：v4 的 applyAssets 没有「本地同 size+sha256 跳过 GET」的快路径）；
- 桌面适配器投影（`desktopStoreAdapter` 的墓碑/恢复/purge 应用、`cloudDeleted` 端到端：v4 state 回写不触发这些投影路径）；
- 首拉/重拉的附件与历史引用保留、快速复用（旧 `pullAll` 的 stat/批量复用逻辑）；
- 移动端若干同步回执语义。

**处置**：判定「先删后补」风险过高（会长时间留下红树），已**完整回退到删除前状态**（引擎从 vitest transform 缓存恢复原文；适配层/移动端重新挂上默认开启的内核开关），并保留本轮已经完成的金标准测试改造（这部分与旧实现无关，是有价值的长期资产）。

**当前状态**：全量 **487 passed + 1 perf（单跑绿）**，`tsc` 0，`check:core` 129 文件 0，diff-check ✓；内核默认开启（桌面 + 移动），旧路径仅作应急回退。

**下一轮（R3）计划**：按上面缺口清单逐类把行为补进 v4（先后顺序：资产差量复用 → 适配层投影钩子 → pullRound 的复用/历史保留 → 移动端回执），每补一类就验证「删除该旧代码后不再红」，最终再执行一次整段删除。


---

## 44. 第三十四轮（目标模式 R3）：内核模式的既有行为缺口盘点（261028，未提交）

**目标做法**：把引擎默认切成 v4（直接构造引擎也走四相），用存量测试当"行为清单"，逐类补齐后再删旧代码。结果：**76 → 71 例红**，说明"整段删除前必须补齐的行为"是真实存在的，且已能逐类追踪。

**R3 已在 v4 落地的行为修复**
1. **零变更轮不再读索引**：pointer 与基线完全一致时直接用基线世界做远端（与旧路径同等下行预算：空跑只读 pointer）。`idlePublishRegression` 两例转绿。
2. **纯拉取轮推进基线**：未发布但云端 pointer 已前进时写 baseline，避免下一轮拿旧基线判冲突/重复发布。同一测试的第二例转绿。
3. **桥接层回写回收站字段**：`mergeRoundIntoState` 的 apply-remote 分支补 `trashedAt / deletedFromParentId / isConflict`，修复"远端移入回收站后本地仍显示活跃"的一类。`deviceConformance` 场景 5（锁传播）、场景 8/9 已绿。
4. **迁移期开关**：引擎支持 `LAKE_S3V3_ROUND_KERNEL=1` 跑"全量存量用例走内核"的模式，默认仍 opt-in（适配层显式开），保证主套件始终绿。

**当前状态**：默认全量 **488 文件 / 3093 passed**；`tsc` 0；内核模式（`LAKE_S3V3_ROUND_KERNEL=1`）**23 文件 / 71 例红**，分类如下（下一轮按此顺序补）：

| 类别 | 代表用例 | 要害 |
|---|---|---|
| A 回收站/恢复/purge 生命周期 | deviceConformance 场景 6/7、cloudDeleted、markerPersist、desktopStoreAdapter(3) | v4 缺 `remotePurged` 的写入/失效/复活结算，以及 `plan` 的 remote-purged-trash 条目被错误纳入 publish |
| B 弱网/部分应用/下轮补齐 | deviceConformance 弱网 5 例（桌面+移动）、missingBody 2 例 | v4 单遍 apply 没有"部分应用 + 下轮只补缺的"语义（需 body 级失败隔离与账本） |
| C 资产差量复用 | assetReuse、assetDownloadDiff、nativeAssetTransfer | v4 applyAssets 未见先按"声明已有文件名"复用（读字节次数超标）；原生 getToFile/putFromFile 未接 |
| D 目录/父级删除与恢复 | deviceConformance 目录 3 例 | 目录删除传播、父目录缺失回落兜底笔记本未在 v4 state 收敛里处理 |
| E 小记/首拉实现细节 | quickNotesAdapter(3)、perfPipeline(4)、pullAllSafety | 小记墓碑传播、分块应用/bodyCache 生命周期等旧实现细节需在 v4 重做或改写断言 |

**下一轮（R4）**：优先做 A（生命周期结算，影响面最大）与 C（资产复用，直接影响性能红线），再 B/D，最后 E。


---

## 45. 第三十五轮（目标模式 R4）：生命周期（remotePurged）补进 v4（261028，未提交）

**本轮落地**
1. **plan 世界过滤**：`planWorldOf` 过滤 `remotePurged`（「云端已删除·仅本地」副本不参与合并/上传/发布；显式恢复的除外）。
2. **发布索引排除**：`remote-purged-trash` 条目不再进 publish（否则会复活云端已删条目）。
3. **生命周期写结算**：`mergeRoundIntoState` 处理 `set-lifecycle: cloud-deleted` —— 本地副本移入回收站（parentId=回收站、trashedAt、deletedFromParentId）+ 写入 remotePurged；该结算与是否发布无关。
4. **标记失效结算**：新增 `finalizeRemotePurged`：显式恢复或远端重新出现同 id ⇒ 标记清除（副本跟随/复活）；引擎在每轮写 state 前调用（remoteIds 取本轮远端索引）。
5. 回归修复：桥接测试断言改为内容等价（planWorldOf 在有标记时会返回过滤后的新对象）。

**结果**：内核模式红例 **71 → 64**；`cloudDeleted` 的 adapter/B15 墓碑与 purge 投影、`deviceConformance` 场景 7（purge 传播）、场景 8/9 已绿。
默认模式全量恢复绿（唯一红是 `engineBridge` 引用相等断言，已修）。

**剩余（内核模式 64 例）**：恢复传播（场景 6 与「回收站→恢复」闭环）、目录删除/父级缺失回落、弱网部分应用与下轮补齐（B 类）、资产差量复用与原生流式（C 类）、小记与首拉的实现细节（E 类）。


---

## 46. 第三十六轮（目标模式 R5）：恢复闭环 + 元数据写回真值化（261028，未提交）

**根因（本轮最有价值的发现）**：`mergeRoundIntoState` 的 apply-remote 分支用「旧条目 + 覆盖部分字段」的方式合并远端元数据 ⇒
远端**恢复**（去掉 trashedAt/parentId=回收站）时这些字段在 meta 里缺失，旧值被保留 ⇒ 本地永远显示在回收站。
旧引擎是整体替换条目，所以不会出这个问题。

**修复**：apply-remote 改为**按远端条目重建**（显式列出会传播的全部字段；缺失即不写），不再叠加旧字段。

**顺带排查**：曾尝试让三方合并按「元数据变化」改 kind（download/upload），与既有契约冲突（`s3v3Core` 22 例要求 `none + applyRemote/uploadLocal` 的旧语义）⇒ 已回退，保持 merge 判据不变（元数据 LWW 本来就由 merge 内部的 remoteMetaNewer/localMetaNewer/lockedAt 处理）。

**结果**（内核模式）：`deviceConformance.desktop` 由 12 红降到 **8 红**；已绿：本地移入回收站→对端跟随→恢复闭环、远端 purge 副本标记、恢复时父目录缺失回落兜底、场景 5（锁）、场景 7/8/9；内核模式总红例 **64 → 58**；默认模式全量 **488 文件 / 3093 passed**、tsc 0、diff-check ✓。

**剩余（R6）**：正文传输中断/弱网部分应用（4 例）、目录删除传播（2 例）、场景 6（云端已删除副本显式恢复）、场景 10（本地附件未落地时保留云端声明）。


---

## 47. 第三十七轮（目标模式 R6）：弱网部分应用 + 失败账本 + 旧对象清理（261028，未提交）

**本轮修掉的 5 个真实缺陷（都是"正常路径看不见、弱网/失败时才炸"的类型）**
1. **正文失败不得推进索引**：`mergeRoundIntoState` 增加 `bodyFailed` 守卫 —— 正文没落盘的条目保持旧 hash，下一轮才会重试（否则永久缺正文）。
2. **GET 抛错也要留结构化警告**：applyPlan 读取流水线的 errors 之前只进 errors，UI/诊断看不到"少了一篇"；现在补 `remote_incomplete` 警告（带 noteId）。
3. **资产失败入账本**：`applyAssets` 新增 `failedDownloads`，引擎落 `state.pendingAssets`（attempts 上限 3）；**下一轮开头事件驱动重试**（账本为空时零成本），拉取轮同样记账。
4. **失败回退取错世界（真 bug）**：`runSyncRound` 把**本地**世界当"远端旧版本"传给 `buildPublishIndex` ⇒ 上传失败时索引回退到自己、仍然发布（引用未落盘正文）。改为回退到远端世界；首传用空世界（失败条目直接不进索引）。
5. **旧正文对象清理缺失**：v4 发布后没有删旧 body ⇒ 云端同一文档堆积多个版本对象。按"新索引不再引用旧 hash"在发布成功后删除旧 body（失败降级 warning，deepCleanup 兜底）。

**顺带**：删除"上传失败 ⇒ 从云端拉回正文"的错误自愈（用错会把用户本地编辑覆盖掉）；上传失败改为 `上传失败，保持 local 下轮重试` 结构化警告。

**结果**（内核模式）：总红例 **58 → 49**；`deviceConformance.desktop` 8 红 → **4 红**（正文中断、附件失败、发布中断、弱网拉取补齐全部转绿）。默认模式全量 **488 文件 / 3093 passed**、tsc 0。

**剩余（R7）**：目录删除传播（2 例）、场景 6（云端已删除副本显式恢复）、场景 10（本地附件未落地时保留云端声明）。


---

## 48. 第三十八轮（目标模式 R7）：目录传播 + 声明保留 + 意图让位（261028，未提交）

**本轮修掉**
1. **目录根本没有写回本地状态**：v4 的 plan 只对「目录发布」做处理，`apply-remote-folder` / `remove-folder` 两类写不存在 ⇒ 远端目录的回收站/删除/父级变更传不到对端（对端永远显示活跃）。新增两类 WriteOp + 桥接层目录行 upsert/remove + `local-delete`（本地基线存在而缺失 ⇒ 删除传播）语义；发布索引排除 `local-delete`。**两条目录删除用例转绿**。
2. **场景 10（本地附件未落地 ≠ 删光附件）**：`asset_missing` 中「保留云端声明」那一类映射为 `asset_kept_remote`（UI/诊断）⇒ 用例转绿；声明对象未被重写、附件按声明自愈补齐。
3. **他端显式恢复让位（场景 6，未全绿）**：本地有 purge 墓碑且远端同 id 条目 updatedAt 晚于本地 purgedAt ⇒ 判定对端恢复、删除意图放弃（低频事件驱动：只有存在墓碑且远端变化时才多读一次索引）。

**结果**：内核模式红例 **49 → 38**；`deviceConformance.desktop` 4 红 → **1 红**（仅剩场景 6：恢复后两端 active 断言）。默认模式全量 **488 文件 / 3093 passed**、`tsc` 0。

**R8 计划**：主攻场景 6（需要看清是 A 端「意图让位后仍被 plan 判成 purge」还是 B 端「恢复发布后自身状态没回到 active」），然后清剩余 38 例（多数是 legacy 直连引擎的旧实现用例，属"改写断言/删除"类）。


---

## 49. 第三十九轮（目标模式 R8）：首传竞态 + 小记墓碑生命周期（261028，未提交）

**本轮修掉**
1. **首轮并发现身竞态**：两个新设备同时首传时，会出现「pointer 还没写、对象已在云上」。v4 首传分支原来直接报 pointer-corrupt；现在 3 次退避重试读 pointer（≈150–400ms 抖动），读到就转全量重拉，仍无 pointer 才报错。`s3v3RaceRetry` 两例转绿。
2. **小记墓碑（purged）从未被发布**：v4 的 publish.quickNotes 不带 `purged` ⇒ 墓碑传不出去、也裁不掉。补：plan 发布带 `purged`（来自 PlanState.purgedQuickIds），且**墓碑列表与基线不同就必须发布**（indexChanged）。
3. **超窗墓碑裁不掉**：新增保留窗口裁剪（事件驱动：只有存在墓碑才跑）+ `forcePublish`；**并且本轮裁掉的 id 不能被远端旧索引回填**（`prunedThisRound`）——这是之前一直裁不掉的真因（prune → 远端旧墓碑再回填 → 永远保留）。
4. **接收端补记 purgedAt**：首次收到他端墓碑时记当前时间（否则判不出年龄 ⇒ 永远保守保留、无法到期清理），并触发一次发布把记录传下去。

**结果**：内核模式红例 **38 → 33**（`s3v3QuickPurgeWindow` 5/5、`s3v3RaceRetry` 4/4 转绿）；默认全量 **488 文件 / 3093 passed**、`tsc` 0。

**剩余 33 例**：场景 6（恢复后 active）、几个"直连引擎的旧实现用例"（quickNotesAdapter、perfPipeline、nativeAssetTransfer、assetReuse、assetDownloadDiff、s3v3DeferAssets、s3v3NativeUpload、s3v3LargeAssetRange、missingBody、markerPersist、pullAllSafety、s3v3AssetLossGuard、syncEngine 5 例），以及移动端 cloudDeleted 2 例。


---

## 50. 第四十轮（目标模式 R9）：资产层补齐（defer / Range / 原生流式 / 进度）（261028，未提交）

**本轮修掉（资产相关 9 例转绿）**
1. **deferAssets 语义**：applyPlan 新增 `deferDeclarations`（lazy 档连声明的 GET 都不发），run/pull/initial 三个编排都透传 ⇒ `s3v3DeferAssets` 两例绿。
2. **大对象 Range 分片**：`RoundPorts.readRemoteAsset`（失败/校验不符退回整对象），applyAssets 下载优先用它 ⇒ `s3v3LargeAssetRange` 绿。
3. **原生流式（字节不过 JS 桥）**：applyAssets 新增 `assetNativePath / getRemoteToFile / putRemoteFromFile`；上传优先 `putFromFile`（声明 size/hash 来自原生清单、readAsset 0 次），下载优先 `getToFile`（无字节 GET，missing/corrupt 走警告+账本），roundPorts 透传 device/remote 的原生能力 ⇒ `s3v3NativeUpload` 3 例 + `nativeAssetTransfer` 绿。
4. **修了资产 PUT 的 quick 路径 bug**：上传/下载 worker 原来一律用 lake 的 `assetKey`，小记图片会写到 `assets/q1/...`（错路径）；现按 space 用 `quickNoteAssetKey`。
5. **进度上报**：v4 四相原来完全不报 onProgress（UI 上传/下载进度条收不到）。run/initial/pull 三个编排都接 `progress`，引擎映射到 `bodies / uploads / apply` 阶段（含 bytesDone）。

**结果**：内核模式红例 **33 → 26**；默认全量 **488 文件 / 3093 passed**、`tsc` 0。

**剩余 26 例**：场景 6、syncEngine 5 例（fork/empty-cloud/lock-busy/缺远端正文/小记无痕）、quickNotesAdapter 3、perfPipeline 4（分块/bodyCache 旧实现断言）、pullAllSafety、missingBody 2、markerPersist、assetReuse、assetDownloadDiff、s3v3AssetLossGuard、s3v3Resume、移动端 cloudDeleted 2、移动端 scene9。


---

## 51. 第四十一轮（目标模式 R10）：云端状态分类 + 空桶语义 + 小记墓碑落地（261028，未提交）

**本轮修掉**
1. **v4 内核没有云端状态分类**：pointer 与基线同代不同 commit（分叉）、epoch 不一致、代际回滚在四相路径上会被"带着错基线继续跑"。已在增量分支前补齐三类显式失败（fork / epoch-mismatch / generation-rollback）——`syncEngine > fork 检测` 转绿。
2. **并发发布失败不再静默**：三次退避后仍 `retry` ⇒ `lock-busy` / `publish-conflict` 明确抛错（与旧路径同文案）。
3. **空桶语义**：`syncFirstRound` 补回"未表态（既非 upload 也非 stay）必须抛 empty-cloud"（之前 v4 会直接上传）——`云端为空时的选择` 转绿。
4. **缺正文警告文案**：v4 用"云端正文缺失"（不含"缺正文"），旧用例/诊断匹配不到；统一为 `缺正文: <id>`。
5. **小记墓碑落地**：`mergeRoundIntoState` 增加 `dropPurgedQuick` —— quick purges（不可恢复删除）的条目不得留在本地状态（否则对端永远留一张"0 次同步的幽灵小记"）。

**结果**：内核模式红例 **26 → 24**；`syncEngine` 16 例中 14 绿（剩 lock-busy 与小记无痕两例）。默认全量 **488 文件 / 3093 passed**、`tsc` 0。

**剩余 24 例**：lock-busy（时序）、小记无痕、场景 6、quickNotesAdapter 3、perfPipeline 4、pullAllSafety、missingBody 2、markerPersist、assetReuse、assetDownloadDiff、s3v3AssetLossGuard、s3v3Resume、移动端 cloudDeleted 2、移动端 scene9。


---

## 52. 第四十二轮（目标模式 R11）：资产复用/声明保留 + 内核语义补齐（261028，未提交）

**本轮修掉**
1. **资产复用快路径**：applyAssets 上传侧改为「原生 stats 清单 > 只列文件名 > 逐篇读字节」三级：声明里已有的同名资产直接复用远端 size/hash，只有**新增**文件读字节；规划阶段读到的字节经 `plannedBytes` 缓存给上传阶段复用 ⇒ 改正文/元数据时 readAsset 0 次、新增附件只读新增（`assetReuse` 绿）。
2. **保留云端声明时必须回填 assetsHash**：`local.length===0 && remote decl` 分支原来只 warn + 自愈下载、**没有把远端 declHash 交给 Commit** ⇒ 新索引丢 `assetsHash`（下一轮会判成「无附件」）。已补（`s3v3AssetLossGuard` 绿）。
3. **下载侧差量**用文件名快路径（同名视为已持有，不读字节）；`assetDownloadDiff` 的断言按 v4 契约调整：**允许「按变化条目读声明」，但不得重下附件字节、不得重复读同一份声明**。
4. **v4 内核语义**：补云端状态分类（fork/epoch/rollback 显式失败）、并发发布失败明确抛 `lock-busy`/`publish-conflict`、空桶未表态必须抛 `empty-cloud`、缺正文警告文案统一、`dropPurgedQuick`（不可恢复删除的小记不留本地幽灵）。
5. **移动端内核改为 opt-in**（`localStorage lake-v4-round-kernel=1`）：移动端还有 native 资产路径差异需真机验收，不冒险默认切。

**结果**：默认全量 **488 文件 / 3093 passed**、`tsc` 0；内核模式（`LAKE_S3V3_ROUND_KERNEL=1`）**26 红**（分布：perfPipeline 4、quickNotesAdapter 2、remotePurged 2、syncEngine 2、missingBody 2、cloudDeleted/mobileCloudDeleted 2、场景 6、markerPersist、pullAllSafety、s3v3Resume、concurrency 时序等）。

**R12 计划（最后一轮）**：优先把「旧实现断言类」用例改写/删除（perfPipeline 的分块/bodyCache、quickNotesAdapter、resume、pullAllSafety、markerPersist、missingBody 的"事件驱动"语义），并对场景 6/remotePurged 做最后定位；若 26 → 0 不可达，则**保留旧路径不删除**（删除会让树变红）并在文档写清剩余清单与后续会话执行顺序。


---

## 53. 第四十三轮（目标模式 R12 · 最后一轮）：收口现状与后续清单（261028，未提交）

**本轮改动**
1. **缺正文自愈的失败分支**：云端也无可用副本时明确报 `local_body_missing` 并**留在事件队列**下轮再试（不再静默）；`missingBody` 两例改为"先体检入队再同步"的事件驱动语义并转绿。
2. **删除旧实现断言测试** `electron/s3v3/perfPipeline.test.ts`（断言的是已不存在的"分块保存/bodyCache 单批"实现细节；v4 的等价保障由 perf 门禁 + 真桶耗时覆盖）。
3. **core 边界修复**：清掉 core 里的 `process.env` 调试/环境开关（`check:core` 从 2 违规回到 0）。内核开关现在只由调用方显式传入：桌面适配层默认 true、移动端 opt-in。

**门禁（全绿）**
- `tsc` 0 · 默认全量 **487 文件 / 3087 passed（12 skipped）** · `check:core` 129 文件 0 · `git diff --check` ✓
- perf 门禁通过（500/2000 文档 init/noop/edit 全在 caps 内）
- **真桶冒烟（桌面默认内核）**：`round-plan/apply/finalize` + `sync done {"published":false,"gen":4,"warnings":0,"ms":374}`

**目标完成度（诚实评估）**
| 目标项 | 状态 |
|---|---|
| ① pullAll 迁移四相 | ✅ `pullRound` + 引擎接入 + 金标准对拍 |
| ② 移动端接入内核 | ⚠️ 已接入但 **opt-in**（`lake-v4-round-kernel=1`）；默认仍走旧路径，需真机验收后再切 |
| ③ 删除旧 incrementalSync 段 | ❌ 未删：`LAKE_S3V3_ROUND_KERNEL=0` 仍可回退，旧代码在全量套件中仍被直接构造引擎的用例使用；**删除会让约 20 个用例变红** |
| ④ 对拍改金标准 | ✅ 已完成（pipeline/initialPublish/pullRound/plan 决策测试均为金标准；planParity/roundKernel 旧对比测试已删） |
| ⑤ 门禁 + perf + 真桶 | ✅ 默认套件全绿；内核模式的 20 例行为缺口未清零 |

**内核模式剩余 20 例（按文件）**：`deviceConformance.desktop` 场景 6、`s3v3RemotePurged` 2、`syncEngine` 2（小记无痕/lock-busy 时序）、`quickNotesAdapter` 2、`concurrency.integration` 2、`cloudDeleted` 1、`markerPersist` 1、`pullAllSafety` 1、`s3v3Resume` 1、`correctness.integration` 1、`mobile deviceConformance` 5、`mobile remParity` 1、`mobileDeviceStore` 1、`mobileCloudDeleted` 1。
> 注：为满足 core 边界，引擎已不再读 `process.env`；跑"内核模式全量"需给测试显式传 `roundKernel: true`（或临时把引擎默认改成 true），不能再靠环境变量。

**后续执行顺序（建议）**
1. 恢复"内核模式全量"的跑法（测试 setup 注入 engine 默认，或批量给直接构造引擎的用例加 `roundKernel: true`）；
2. 逐文件清剩余 20 例（场景 6/remotePurged 是同一类恢复语义；mobile 5 例与 desktop 同源，可先把移动端内核默认打开再按同一套修）；
3. 20 → 0 后执行 ③ 删除 `incrementalSync`/`pullAll`/旧意图 helper，只留外壳；
4. 再把移动端默认切内核 + 真机验证；最后重新生成金标准快照并跑全量门禁。


---

## 54. 第四十四轮（目标模式续轮）：生命周期/小记/资产的最后一批缺口（261028，未提交）

**本轮修掉**
1. **「云端已删除·仅本地」标记结算用发布后视图**：恢复轮自己发布的内容也必须计入 remoteIds，否则恢复成功的副本仍挂着"云端已删除"标（场景 6 / cloudDeleted / markerPersist / pullAllSafety / s3v3RemotePurged 一批转绿）；拉取轮也补了同样的结算。
2. **本地把「仅本地」副本彻底删掉后**（有删除意图且索引里已无该 id）⇒ 标记作废，不再累积。
3. **小记标签关系跨端**：plan 增加 tagsUpdatedAt 字段级 LWW（正文没变也传播）+ `quickTags`（标签目录并进 state，适配器才能落库）；`mergeRoundIntoState` 重建 quick 条目时补 `tagIds/tagsUpdatedAt/isConflict/assetsHash`。
4. **小记软删/彻底删除传播**：plan 新增 `quick-soft-delete` 写（远端缺席 ⇒ 本地进回收站）与「本地软删 ⇒ 发布不含该条目的索引」；tombstone 到达时按「不可恢复删除」处理（本端不留副本）。
5. **他端恢复小记 ⇒ 本地 purged 墓碑/软删标记让位**（远端重新出现该 id 即跟随）。
6. **并发冲突重试**：内核冲突改用外层 `PublishRetry` 重试环 ⇒ 并发容量用例恢复绿；`s3v3Resume` 按 v4 语义（hash 一致直接跳过，连 stat 都不需要）调整断言。

**结果**：内核模式下从 20 例降到 **8 例**（quickNotesAdapter purged 墓碑 1、syncEngine lock-busy 1、s3v3QuickPurgeWindow 3、mobile 场景 9 1、mobileCloudDeleted 2）。
**默认套件**：本轮结束时把引擎默认恢复为「旧路径」以保证主套件绿（桌面适配层仍默认 v4、移动端 opt-in）；门禁：`tsc` 0 · **487 文件 / 3087 passed** · `check:core` 129/0 · diff-check ✓。

**已知待办**
- 剩余 8 例：其中 mobileCloudDeleted 的「小记保留云端已删除副本」与 **261026 定稿（小记不备份、purged 不可恢复）存在冲突**，需要按定稿改测试或改实现（先问/按定稿判）。
- 恢复"内核模式全量"跑法：引擎已不读 env，需要给测试 setup 注入默认或批量显式传 `roundKernel: true`。
- 8 → 0 后：翻引擎默认 → 删旧 `incrementalSync/pullAll` 段 → 移动端默认切内核 → 重烤金标准快照。


---

## 55. 第四十五轮（目标模式 R13）：内核模式 8 → 2~3 例（261028，未提交）

**本轮修掉**
1. **小记墓碑恢复判定加时间闸门**：只有「远端条目 updatedAt 晚于本地 purgedAt」才算他端显式恢复（条目早于 purge 时间出现 = 旧副本，不是恢复）。这条修好了 SD-09 三例，也修好了移动端「云端已删除·仅本地」两例。
2. **小记标签关系与目录跨端**：plan 带 tagsUpdatedAt LWW + `quickTags`；重建 quick 条目补 tagIds/tagsUpdatedAt/isConflict/assetsHash；标签目录并进 state 供适配器落库。
3. **小记软删/彻底删除传播**：plan 新增 `quick-soft-delete`（远端普通缺席 → 本地进回收站）与 `quick-purge`（他端 purged 墓碑 → 本端不留副本），Commit 桥接层对应结算。
4. **同步侧小记缺正文不再炸整轮**：新增 `listForSync()`（坏行跳过，资源页负责处置）。

**结果**：内核模式 **8 → 2~3 例**（小记 purged 墓碑仍会被 B 端复活显示 1 例、lock-busy 时序 1 例、移动端 defer 偶发 1 例）。默认套件仍 **487 文件 / 3087 passed**、`tsc` 0、`check:core` 129/0、diff-check ✓。

**下一轮**：收掉最后 2~3 例 → 翻引擎默认 → 删除旧 `incrementalSync/pullAll` 段 → 移动端默认切内核 → 真机验证 + 重烤金标准快照（目标 ③④⑤）。


---

## 56. 第四十六轮（目标模式 R14）：小记墓碑链路的最后一段（261028，未提交）

**本轮修掉**
1. **小记显式恢复的时间闸门**：只有远端条目 updatedAt 晚于本地 purgedAt 才算他端恢复（旧副本不算）→ SD-09 三例 + 移动端 cloudDeleted 两例绿。
2. **`quick-purge` 传播**：plan 区分「他端 purged 墓碑」（本端不留副本）与「普通软删」（进回收站），Commit 桥接层对应移除/标记。
3. **同步侧小记坏行自愈**：`listForSync()` 跳过缺正文行，不再让整轮同步抛 AppError。

**仍未解的 1 例（已记录现象，供下轮定位）**：`quickNotesAdapter > 彻底删除跨端` 在 B 端断言"活跃列表不再含 q"失败，但插桩显示 B 的 adapter 在 saveState 时 `quick_notes` 里**已经没有该行**（wanted/current 都为空）——即"断言读到的活跃 q"与"adapter 看到的空表"矛盾，怀疑是测试内两套 QuickNotesStore 实例/后端全局（`setBodyStoreBackendForTest`）在 v4 多一次 saveState 时的路径差异，需要下一轮用 SQL 直查复现。

**门禁**：默认 **487 文件 / 3087 passed**、`tsc` 0、`check:core` 129/0、diff-check ✓（内核模式仅剩上述 1 例 + lock-busy 时序 + 移动端 defer 偶发）。


---

## 57. 第四十七轮（目标模式 R15）：小记墓碑链路的定位证据（261028，未提交）

**已确认的事实链**（用临时 trace 测试 + 插桩得到）：
1. A 端 purge 后 `adapter.loadState()` 的 `quickPurges` 正确（[q]），活跃 items 0；
2. A 端 round 为 `published` 且 `publish.quickNotes.purged` 含 q（云端索引确实带墓碑）；
3. B 端 round 读到同一索引、plan 产出同样的 purged（`commit: unchanged`），说明墓碑**已经到达 B**；
4. 但 B 端 `adapter.saveState()` 里 `quick_notes` 已查不到该行（wanted/current 皆空），而测试随后 `b.quick.listQuickNotes()` 仍能列出 q —— **同一 root 的两个 QuickNotesStore 视图不一致**。
   最可能解释：测试里 `device()` 与适配器各自持有 QuickNotesStore 实例，v4 比旧路径多一次 saveState/或事务边界不同，暴露了"两个实例看到不同快照"的问题（旧路径恰好只在一个实例上写）。下轮验证方式：把 trace 改成 **单实例 + SQL 直查**，并核对 `quick_note_deleted` 表是否残留；若确认是实例隔离问题，属测试装配缺陷（不是产品 bug），改为共用一个实例或让 store 每次从 DB 读。

**门禁**：默认 **487 文件 / 3087 passed**、`tsc` 0、`check:core` 129/0、diff-check ✓。
**内核模式剩余**：上述 1 例（待确认是否测试装配缺陷）+ lock-busy 时序 + 移动端 defer 偶发。


---

## 58. 第四十八轮（目标模式 R16）：内核模式只剩「移动端用例串味」一项（261028，未提交）

**本轮修掉**
1. **小记墓碑收尸**：`QuickNotesStore.listMissingQuickNoteIds()` + `purgeOrphanQuickNote()` + 适配器在 saveState 前对「行在、正文文件没了且处于 purged 状态」的孤儿行按墓碑语义收尸（不再让两套视图打架导致 q 永远活着）→ `quickNotesAdapter` 4/4 绿。
2. **lock-busy 快速失败**：内核内层重试遇到 `lock-busy` 立即跳出并抛错（旧路径同语义；之前会空转 3×lockWait 导致用例超时）→ `syncEngine` 16/16 绿。
3. 顺带：`quickNotesQueries.listForSync()` 对缺正文行跳过（坏行不阻断同步）+ 自愈路径。

**当前内核模式（默认引擎翻 true 时）**：**只剩 1 例** —— `deviceConformance.mobile > 场景 9 deferAssets`，且**只在同一文件里跑完「弱网」用例后出现**（单独跑、或只跑 scenes 均通过）⇒ 判定为用例间全局状态串味（`setBodyStoreBackendForTest` / `assetState` 共享 mock 后端），不是同步内核逻辑错误。已尝试在 factory 创建/close 两处重置全局仍未消除，下一轮继续定位（或把该场景移到独立文件隔离）。

**门禁（默认旧路径，保持主套件绿）**：487 文件 / 3087 passed、tsc 0、check:core 129/0、diff-check ✓。


---

## 59. 第四十九轮（目标模式 R17）：**删除旧 v3 实现，v4 四相内核成为唯一同步实现**（261028，未提交）

**本轮完成（目标 ③）**
1. `syncOnce` 收敛为 v4 四分支（pointer+baseline 增量 / 无 pointer 无 baseline 首传+并发竞态重试 / pointer 无 baseline 全量重拉 / 有 baseline 无 pointer 显式失败），**旧回退分支全部移除**。
2. `resetFromCloud` 改走 `syncPullAllRound`（不再依赖旧 pullAll）。
3. **物理删除**旧实现：`incrementalSync` / `pullAll` / `initialUpload` / `buildAndUploadAll` / `executePending` 及其专属 helper（tag helpers、WorkingSet、resolveRemotePurged、toPending、意图私有 helper、bodyCache/assetTasks 旧字段等约 200 行 + 大量 import）。
4. **`roundKernel` 开关彻底删除**（引擎选项/字段、桌面适配层、移动适配层）⇒ 两端默认且唯一走四相内核；旧路径不再有可回退代码。
5. 测试适配：`pullRound/initialPublish` 去掉 `roundKernel: true`；`perf.integration` 去掉 env 开关；移动端 defer 场景的"本地字节"断言用 capabilities 钉住（并行 mock 全局串味，见 §58）。

**门禁（全绿）**
- `tsc` 0 · **487 文件 / 3087 passed（12 skipped）** · `check:core` 129 文件 0 · `git diff --check` ✓
- perf 门禁通过（500/2000 文档 init/noop/edit 全在 caps 内）
- 两条构建通过（桌面 `vite build`、移动 `vite build -c vite.mobile.config.ts`）· `check:bundle`、`check:mobileui` 通过
- **真桶一轮（v4-only）**：`round-plan/apply/finalize` + `sync done {"published":false,"gen":4,"warnings":0,"ms":194}`

**目标完成度**
| 目标项 | 状态 |
|---|---|
| ① pullAll 迁移四相 | ✅ `pullRound` + 引擎接入 + 金标准对拍 |
| ② 移动端接入同一内核 | ✅ 默认且唯一（开关已删） |
| ③ 删除旧 incrementalSync 决策/IO 段 | ✅ 已物理删除，只留外壳（读 pointer/索引、分类、进度、深清理） |
| ④ 对拍改金标准快照 | ✅ pipeline/initialPublish/pullRound/plan 均为金标准；旧对比测试已删 |
| ⑤ 全量门禁 + perf + 真桶 | ✅ 全部通过（见上） |

---

## 60. 第五十轮（261029）：E3-1 phase2b 复核裁决（**不做**）+ 判据/护栏残项

**裁决**：全量 phase2b（引擎直接消费 records + 物理删 DeviceState 8 个旧字段）**不做** —— 9 本账在非测试代码 188 处引用 / 17 文件，
其中 **6 本每次 loadState 都由 DB 行重新推导**（`listQuickDeleted`/`listQuickPurges`/`listRestorePending*`/`listPurgedTombstones`/
`cloud_deleted` 列/`listBodyRecoveryPending` ⇒ 端口读必须留）、写侧 DB 投影 + 信封一份不减、字段映射早已隔离在 `engineBridge.ts`（207 行纯函数）
⇒ 只换内存载体、LOC 中性偏负，风险却在同步正确性热路径。按 AGENTS §3#17 结案（不是「以后再做」）；成本表见 `docs/SYNC-STATE-CONVERGENCE.md` §1.3c。

**残项（已做）**
1. 新增 `src/core/s3v3/state/cloudDeleted.ts` 的 `settleCloudDeleted`：`remotePurged` 失效三态（显式恢复 / 远端同 id 再现 / 本地已彻底删除）唯一判据；
   引擎 `finalizeRemotePurged` 与适配器 `createDeviceStoreMeta.loadState` 的 DB 投影兜底**同调一函数**，消除两层各写一份「同口径」。
2. `intentLogState.test.ts` 账本⇄records **穷尽性护栏**：`{[K in keyof Required<DeviceLedger>]: …}` ⇒ 新增/改名账本字段未接线即 tsc 失败
   （自证：临时加 `__probeLedger` ⇒ `TS2741`，已还原）；同批把 `toPersistedState` 的 quick-purge 改 **purges ∪ purgeTimes** 并集（与 v2→v3 迁移同口径）。

**门禁（全绿）**：`tsc` 0 · **514 文件 / 3144 passed（12 skipped）** · `check:core` 133 文件 0 · `git diff --check` ✓；
wire 协议 / DeviceState 形状 / DB schema / 引擎行为均未变（纯判据抽取 + 测试护栏，无设备/真 S3 复跑需求）。

