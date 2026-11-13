# HANDOFF.md — Local Lakex Notes 项目交接（唯一权威交接文档）

> 写给完全没有上下文的新会话。接手顺序：**README（根）→ 本文件 → AGENTS.md（根，长期红线/机制）**。
> 本文件只保留**【最近 3 个批次 + 当前基线 + 风险 + 真实待办】**；更早的 dated 批次只存在于 git 历史（`git log -p --follow docs/HANDOFF.md`），**不要再往本文件堆批次流水**（261112 Q17 压缩：183KB → 本版）。
> **当前状态以 §1（基线）/ §2（风险）/ §3（待办）为准**；§0 抬头状态只作批次历史。261112 第二轮裁决（Q01–Q27，最终）见 [docs/audit-261112/00-MASTER-PLAN.md 附录 E](audit-261112/00-MASTER-PLAN.md)。
> 移动端（Android）的构建 / 安装 / AVD / CDP / 门禁 / 点按口径 = [docs/MOBILE-OPS.md](MOBILE-OPS.md)；桌面会话不要改它，移动端会话不要改桌面文件。

## 0. 最新交接（最近 3 个批次；更早的见 git）

### 261114 · v1.1.3（移动端删除 review 收口 + 级联/关标签详细矩阵 + 发版）

- **用户点单**：① 移动端删除也做 review（笔记本/分组/文档 × 子级/多级子级都要详细测试），删除后**关闭已打开标签、行为与桌面一致**；② 完成后推远程、打 tag 发版。
- **独立 review（trash-reviewer，只读）**确认数据层级联/恢复/purge/幂等/环/dfp/keep-alive 设计已对齐桌面，但抓到 3 个真缺口 + 2 个低风险：G1 批量删除未先落盘（随后 cancelAutoSave 丢最后输入）；G2 单条恢复「原父是活跃文档」被错误回落到笔记本根；G3 purge/自动过期/缺正文彻底删除不关闭已打开标签；G4 purge 残留 orphan_assets 行；G5 purge 无「必须在回收站」守卫。
- **修复（`c3b17bf9`）**：G1 批量 trash 前 flush（失败中止不删）；G2 resolveRestoreParent 补活跃 note 父查询；G3 purge 返回 `noteIds` + 统一 `tabDismissal.dismissNoteTabs` 通道（手动 purge/自动过期/缺正文都收标签）；G4 purge 事务内清 orphan_assets；G5 purge 加回收站守卫 + kind 由 DB 派生（`{purged,noteIds}` 返回）。**设备实测额外 bug**：批量关标签循环 `removeTab` 读旧 `tabsRef` 互相覆盖 ⇒ 父标签残留；新增 `removeTabs(ids)` 一次 setState。矩阵测试：移动 `trashCascade.test.ts` 15 例覆盖 笔记本/分组/文档 × 3~4 层 × 删除/恢复/彻底删除 + 批量顺序 + 幂等 + G2/G4/G5；桌面 `trashCascade.test.ts` 8 例补 笔记本根（多级分组+多级文档）/purge 文档子树；`src/core/tree.test.ts` 2 例（桌面关标签集合子树/环）。
- **设备验收（AVD lake_mobile，CDP 9335，最终构建）**：A 删多级分组（G1>G2>G3>GDOC，打开 GDOC 后删 G1）→ tabCount=0、toast、可回首页；B 删深层层级文档（PARENT>CHILD>GRAND，打开 GRAND 后删 PARENT）→ 无 ghost tab；C 首页长按删笔记本（含多级子文档）→ 标签存档清空、恢复整棵后重进可正常打开；另实测活跃笔记本 purge 返回 false（G5）。证据 `.css-audit/mobile-gone/del-*.png`（gitignore）。
- **门禁**：tsc 0；全量 vitest **939 文件 / 5983 例（5971 passed / 12 skipped）/ 0 failed**；`vite build`（桌面）+ `vite build -c vite.mobile.config.ts`（移动）均成功；`check:bundle`（含 vendor CSS/架构预算：desktop 首屏 577.0/600.0KB、mobile 首屏 342.2/350.0KB、mobile entry 48,994/51,200B）、`check:core` 178/0、`check:mobileui`、`ui-metrics`、`git diff --check` 全过。
- **发版**：`package.json` = **1.1.3**（Android versionName 1.1.3 / versionCode 11103，由 package.json 派生）；注解 tag **`v1.1.3`** 已双推（ref `a3f47335` → commit `12b5f7d3`），Release workflow run **43405437257** 已由 tag 触发；发布说明 = [RELEASE-NOTES](RELEASE-NOTES.md) 顶部段落。
### 261114 · 用户第二轮点单（回收站动作浮动 / 启动不硬开 / 保存被拒可退出 / 移动端同型修复）

- **① 回收站行动作浮动化**（用户截图：两个按钮占标题空间）：`TrashPanel` 文档行与小记行的「恢复 / 彻底删除」包进 `.trash-row-actions` 绝对定位覆盖层（不参与 flex 宽；hover / 选中 / focus-within 显形；行加本地类 `trash-row`、去掉 `ln-list-item--hide-action` 以避开原语跨所有权门禁）。`styles/app/panels.css` +9 声明（基线 112→121）、`cssLayers`/`primitives`/`ui-metrics` 全过。隔离实测：行宽 301.5 时标题可用宽 165.7、浮层 left 243.5 / right 8 / 宽 50（= 改前会占掉的 2×22+gap）、行高不变；hover 时右侧倒计时徽标让位不叠字；文档行/小记行同套类。
- **② 启动不硬开文档**（用户裁决）：删除 `core/coldStartNote`（含测试）与 `useBootstrap` 冷启动落点（lastOpened / 最近文档 / 多维表兜底全删）⇒ **只恢复上次标签，没有标签就保持空态**；`desktopKernelLazy` 预热断言同步（恢复标签一次）；HANDOFF 原 P1「首篇编辑器 fallback 的最终解法」按此结案。
- **③ 保存被拒也能正常退出**（用户裁决：保存已拒绝时未保存内容允许丢）：新增 `core/unloadGuard.blockingDirtyTabs`（`dirty && !deleted && !isSaveFailed`）；`useSavePipeline` 新增 `failedSavesRef`（只记 catch 的真实保存失败；外部改动冲突仍需用户决策、不在此列）；`App` 以 ref 传给 `useDesktopLifecycle`，beforeunload 只对「还能保存」的脏标签 preventDefault；失败/已删标签仍写 draft journal 兜底、允许丢弃。护栏 `unloadGuard.test.ts`。
- **④ 移动端同型修复**（用户要求检查）：确认缺陷 = `noteGoneState` 只看 parentId，删笔记本/分组级联（子文档 parent 不变、只标 `trashed_at`）后打开中的 tab 仍按 active 走保存屏障 ⇒ 关闭/返回/退回首页失败卡住；修复 = noteGoneState 回传 `trashedAt` + `isGoneNote` 全入口传；保存屏障（closeTab / 返回 / 关闭全部 / 完成编辑）命中 gone 走 `discardTab + cancelAutoSave` 并 toast「已在回收站或已删除，已关闭标签；可在回收站恢复」；删分组/笔记本按 `descendantNoteTabIds` 丢弃整棵子树标签、删除前先 flush 在途编辑。**否证**：移动无启动泄漏（listNotes / 工作区树都过滤 trashed_at、无 beforeunload、欢迎小记有 initialized 标记不复活）。残余（P2）：移动无桌面同款「tab 标记 gone + 只读横幅」，旧内容显示到关闭。
- **验证**：tsc 0；全量 vitest **923 passed / 5924 例（5912 passed / 12 skipped）/ 0 failed**（75.4s）；`cssLayers` / `uiPrimitives` / `ui-metrics` / `check:mobileui` PASS；`npx vite build` 成功。隔离实例（新构建、CDP 只读取证，夹具 C 全新库 + D 软删回放）：**C1** 全新库冷启动无 tab/空态且树里仍有 welcome-note（数据在只是不硬开，editor.init=0）；**C2** CDP 点击目录手动打开成功；**C3** 删正文→输入→日志 `save_note 失败 笔记不存在`→`Browser.close` 后 **203ms 正常退出**（≤10s，before-quit+will-quit 都有，草稿兜底落盘成功）；**C4** 浮动动作 position=absolute/right:8px、hover 宽 50 不溢出、标题宽度 idle=hover delta=0。证据 `/tmp/lakex-verify/evidence/SUMMARY-ROUND2.md`（不入库）。移动端：AVD lake_mobile 装最终 APK，设备级两场景（删文档后「完成」/Android 返回）PASS，证据 `.css-audit/mobile-gone/*.png`。
- **追加（用户追问「带子级 / 多级子级的删除」）**：审计结论 = **桌面一直有级联**（`trashLifecycle.deleteTreeNode`：多级分组、文档下多级子文档、回收站中间节点 purge、整棵恢复全部 PASS）；真正缺的是**移动端 note 分支**：`trashNote` 与 `trashTreeItem(note)` 只动根 ⇒ 子文档变 `trashed_at=NULL` 悬空行（树里不可见、搜索里还在）、purge/restore 也只处理根。已修：抽 `src/mobile/data/trashSubtree.ts`（`parent_id` ∪ `deleted_from_parent_id+trashed_at` 两路边集合）统一 `trashSubtree`；`noteRepository.trashNote` / `trashTreeItem(note)` / `restoreTreeItem(note)` / `purgeTreeItem(note)` 全部按子树处理。桌面 `deleteTreeNode` 同时补两点：已 trashed 节点重复删除**幂等**（不改 parent，避免批量顺序把子树拆成多个回收站根）、级联集合改用 `flattenedSubtreeIds`（覆盖被同步扁平化的后代）。护栏：`electron/trashCascade.test.ts`（5 例：多级分组删除/删除带子文档的文档/嵌套 purge/整棵恢复/批量先子后父幂等）、`src/mobile/data/trashCascade.test.ts`（6 例：note 删除/trashNote/恢复/彻底删除/批量顺序/分组嵌套）。
- **文档**：AGENTS §3#5（级联/幂等）与 §3#16（移动端同源）/ §4 启动 bullet / §7#12b、`docs/RESILIENCE.md` §3.5 +4 行、本文件 §1/§3 已同步；本批 commit 见 `git log -1`。
### 261114 · 回收站幽灵文档修复（启动自动打开已删除文档 + 清空回收站后关不掉退不出）

- **用户现场**（正式库 + 开发库都复现）：删光笔记本后重启仍自动打开回收站里的欢迎文档；它以可编辑标签出现（编辑器无只读横幅），保存被主进程守卫拒（`笔记已在回收站或已被删除，保存被拒绝；请先显式恢复: welcome-note`）；⌘Q/关窗被 `beforeunload` 永久拦住（日志 `[ui] 窗口无响应` + 只有 before-quit 没有 will-quit，最后靠 60s 超时/强杀）。用户清空回收站后旧 `seed` 又把 `welcome-note` 复活成孤儿行（父笔记本已 purge、侧栏看不到）⇒ 再启动继续打开它，再次「关不掉退不出」。
- **根因**：① 删除笔记本时**只有根节点** `parent_id` 移进回收站，子文档 `parent_id` 不变、只标 `trashed_at`（`trashLifecycle.deleteTreeNode` 级联）；`store.bootstrap()` 只按 `parent_id != 回收站` 过滤 ⇒ 回收站子文档泄漏进启动快照（tab session 的 `liveIds` 认为它活、`lastOpenedNoteId` 命中它 ⇒ 冷启动/恢复标签打开它）。② `readNote`/`getNoteDigest`/`isGoneNote` 都不读 `trashed_at` ⇒ 标签不标 deleted/只读；同时 `beforeunload` 只要「有脏标签」就 preventDefault，而 gone 文档保存永远被拒 ⇒ 脏标记永不清除、退出永久被拦。③ 旧 `schemaInit.seed()` 只看 notes 表是否为空 ⇒ 清空回收站（purge 物理删行）后把固定 id 的欢迎笔记复活到已不存在的默认笔记本下（幽灵孤儿，还会被同步当新文档上传）。
- **修复**：`bootstrap()` 只收「`trashed_at IS NULL` + `is_purged=0` + 父节点在位且不在回收站」；`NoteSummary.trashedAt` 回传（两份声明：`src/lib/types.ts` 与 `electron/noteQueries.ts` 镜像类型）+ `readNote` SELECT 补列；`readNoteDigest.deleted` 用 `trashed_at`；`isGoneNote({parentId, trashedAt, …})` 新判据 + `noteRef.isNoteRefGone` 同步；`seed()` 仅全新库（无 notes、无墓碑、默认笔记本在位）种欢迎笔记，启动自愈 `removeResurrectedAfterPurge()` 清「已 purge 又复活」的幽灵行（墓碑保留、幂等）；渲染层 gone ⇒ `dirty:false`（`useSyncProgress` / `App.handleBlockedSave`），`beforeunload` 只拦「脏且未 deleted」，`App.handleTrashChanged` 在 purge/清空后按 `getNoteDigest` 收掉已打开标签；冷启动剔除日记条目（261110 同口径）。
- **验证**：单测新增 `electron/startupTrash.test.ts`（7 例：删笔记本泄漏/删单篇/清空不复活血缘/幽灵自愈/父节点防御）+ `syncDecisions.test.ts` trashedAt 2 例 + `useBootstrap.render.test.tsx` 日记冷启动 1 例（相关 13 文件 217 例全过）。隔离实例（新构建 + 正式数据副本、仅 CDP 只读取证）：**A 套**（当前正式库真实状态）两次冷启动都无 tab/空态/无保存失败，幽灵行被自愈删除（`removed 1 resurrected-after-purge ghost note(s)`）、墓碑保留、二次启动不复活；**B 套**（合成回放删笔记本软删现场）无 tab/空态，`welcome-note` 仍在回收站可恢复（回收站 UI 显示「个人笔记」），宿主数据零改动；证据 `/tmp/lakex-verify/evidence/`（不入库）。开发版窗口实测：修复后启动为「开始写第一篇笔记」空态、无 tab、无错误。
- **门禁**：tsc 0；全量 vitest 见 §1；`git diff --check` 0；`npx vite build` 成功。
- **文档**：AGENTS §3#16 / §4 启动 bullet / §7#12b、`docs/RESILIENCE.md` §3.5 已同步。
### 261114 · v1.1.2 发版（62 笔提交：S3 数据安全修复 + 移动首屏/同步性能 + 云同步闸门）

- **发版**：`npm version patch` → 1.1.2（Android versionName 1.1.2 / versionCode 11102）；注解 tag **`v1.1.2`**；master 与 tag 双推（Gitee `origin` + GitHub `github`）⇒ **Release workflow run 43384377793 已跑通**（macOS x64/arm64 dmg+zip / Windows NSIS / **Android release APK 三项 build 全 success**），GitHub Release `v1.1.2` 已发布 **8 个资产**：Android APK（33.6MB）/ arm64 dmg+zip / x64 dmg+zip / Windows exe / `latest.json` / `release-body.md`；Gitee 发行版同步取决于 `GITEE_TOKEN`（不配只留代码+tag 镜像）。
- **内容**：见 [docs/RELEASE-NOTES.md](RELEASE-NOTES.md) 顶部段落（同步数据安全：恢复后编辑被覆盖 / 附件声明一致性 / 小记共享正文 / 目录位置合并 / 小记恢复回弹 / 兜底未分类固定 id / 云同步开启闸门；移动端：入口瘦身 61,006→48,759B、基线落 gzip、云清理预览、AI 供应商；桌面：快捷键、回收站窄分栏、无障碍基线）。
- **发版前门禁**（@ 1.1.2 提交）：tsc 0；全量 vitest 931 文件 / 5901 例 0 failed；ui-metrics、check:core 178/0、check:mobileui、check:bundle/arch（mobile entry 48,759/51,200、首屏 341,652/350,000）全过；diff-check 干净。设备：lake_mobile 三屏正常、lake_gate 10 态基线按该构建重烤并两轮 0 差异。

### 261114 · 移动首屏瘦身第二批（入口 −12.2KB，预算收紧）

- **盘点**：入口 chunk 133 模块 / 486KB 源码，其中「点击才出现」的浮层与非首 tab 页面被静态打进入口。
- **改**：`ImageLightbox` / `AttachmentPreview` / `CreateNotebookSheet` / `DefaultNotebookPickerSheet` + `TagsHomeTab` / `NotebookGrid` 全部改 `lazy()` + `Suspense(null)`（与既有 `DiaryPage`/`MobileAiPage` 同一模式）。
- **实测**：入口 JS **61,006 → 48,759B gz（−12.2KB）**；首屏资源图 **353,397 → 341,652B（−11.7KB）**；preload 7 → 10（预算 12）；视觉零变化（只拆包）。
- **预算随目标收紧**：`check-bundle` mobile-entry-js 60KB → **50KB**（余 2,441B）；`check-arch` mobile 首屏 360,000 → **350,000B**（余 8,348B）。以后再涨就红，别再靠「冻结现状值」。
- **顺带修两条护栏的误判**：`kernelStyleBootstrap` 判「懒入口会挂内核」改为**先去注释**再匹配（`imagePreview` 注释里提到 LakeEditor，纯图片预览被误判）；`crossEndClassCoverage` 的「移动端在用」**把动态 import 也算上**（改 lazy 后只认 `from` 会把共享浮层误判成僵尸清单）。
- 门禁：tsc 0；全量 vitest 931 文件 / 5901 例 0 failed；ui-metrics、check:core 178/0、check:mobileui、check:bundle/arch（新预算）全过；diff-check 干净。
- **设备验收**（新 APK 已装 lake_mobile 5554 与 lake_gate 5556）：lake_mobile 上小记首屏 / 知识库（书架卡）/ 标签（空态）三屏均正常渲染（lazy chunk 正常拉取、无白屏/无 ChunkLoadError）；**lake_gate 已按新构建重烤 10 态基线并连跑两轮 0 差异**（baseline 已提交）。

### 261114 · 移动端 AI 获取模型列表（`ee7aeea5`）

- Kotlin `AiChatPlugin.listModels`：GET {baseUrl}/models（草稿 baseUrl/Key 优先，保存前也能拉）；解析 data[].id / models[]；
  错误走既有 codeForStatus/errorResult。JS 契约 `AiModelsResult/AiModelsOptions` + bridge.aiListModels（浏览器预览 unavailable）。
- 设置页模型行加「获取模型列表」：成功展示候选并自动填第一个空模型；失败显示供应商原因；无 Key 明确提示不发请求；
  切换供应商/重开页面清空候选。guide/10 同步。

### 261114 · 两端统一「云同步开启闸门」（`c808ce0c`）

- **用户裁决**：移动端与桌面端统一逻辑 —— **没配置 S3 或没通过连接测试，都不能开启云同步**；点击只提示「先测试通过才能开启」，状态保持关闭。
- 单一来源 `core/cloudSyncGate`：`cloudSyncEnableGate(configured, verified)` + `s3ConfigFingerprint`（连接字段、不含 Secret）；`lib/s3FormState` 保留 re-export。
- 桌面：开关 desc/onChange/alert 走闸门；`saveSyncCfg` **删除「点开启时自动测试再开」**——必须先由用户点「测试连接」通过才写 enabled。
- 移动端：`useS3SettingsForm` 记「测试通过指纹」（返回值以 OK 开头才算；改连接字段即失效）；SettingsDrawer 开关走闸门；
  「未配置却已开启」旧状态在读到设置后自动关一次并说明原因；开关显示改严格 `enabled === true`（默认关 = 是否已配置 S3）。
- 护栏：core 闸门单测 + 移动端测试 OK/FAIL/改字段失效用例；settings-s3 快照重烤（0 差异）；设备实测未测通时点开关保持关闭并给提示。
- **提醒样式（261114 用户点单）**：闸门提醒改**红字**（桌面 `.config-item__error`、移动 `mb-form__desc--error`，均为既有 status-error 单一来源），且**只出现一处**（desc 保留正常说明，不再与提醒重复）；桌面实测恰好 1 处、颜色 rgb(179,56,47)；移动端提醒放进 `Block`（横向内距 18px），不再作为裸 div 贴在卡外缘（边界问题）；settings-s3 元素数 2045→2047（Block 包装），基线已重烤 0 差异。

### 261113 · 设备验收批（lake_mobile 真机环节 + 门禁态）

- **A1 门禁态**：`lake_gate`（5556）上 `check-mobile-snap` **10 态 0 差异**（基线 14:00 已按当前安装包重烤，无需再烤）；**下次装新移动包后仍需重烤**（基线绑构建）。
- **A2 D1-C（移动 baseline 落文件）设备实测**（lake_mobile 5554，真实桶临时前缀，已删净）：`files/sync-v3/baseline.json.gz.b64` 存在（856B，小库）⇒ 基线确实搬出 SQLite 整行。
  - **重复点**（内容未变，`requests=1 get=1 put=0`）：总 247–486ms，`push-state 113–268` / `push-pointer 102–122` / **`push-baseline 8–32ms`**（D1-A「重复点不重写基线」生效；旧实现每点都整份归位）。
  - **变更路径**（`requests=11`）：`push-state 142–203` / `push-pointer 648–1111` / `push-body 5–33` / `push-index 107–301` / `push-upload 19–36` / `push-publish 443–783` / `push-baseline 368–542`；总 1.9–2.8s。⚠️ 本机到七牛网络的 pointer/publish 往返占大头；**push-baseline 变更路径仍 370–540ms（当前库极小）**，与历史 5000 文档 548–795ms 不可直接比较，待大数据集复测。
- **A2 D3（移动云清理预览/dryRun）**：`gcDeepCleanup({dryRun:true})` 与真删返回同形 `{dryRun,candidateCount,deletedCount,bytes,keys,kept,skippedRecent,ageUnknown}`，本次无可清理对象（`candidateCount=0,kept=9,skippedRecent=6`）；候选/已删两字段分离、dryRun 不删已验证。无法造 7 天前对象 ⇒ 「有候选时预览不删、确认才删」的设备级验证留待有真实孤儿时补。
- **收尾**：lake_mobile `pm clear` 重置、临时桶前缀 14 对象删净（residual 0）、`/tmp` 凭据与探针脚本已删。

### 261114 · 移动端 AI 助手接入「服务供应商」配置（`bbe84434`）

- **用户点单**：移动端设置也像桌面一样先选服务供应商，配置项与桌面 AiSection 对齐。
- **供应商**：同一份 `core/aiProviders` 目录（OpenAI / DeepSeek / 通义千问 / 智谱 GLM / 小米 MiMo / 自定义）；切换即填该家默认接口地址、模型、思考参数。选择只存本机 localStorage（`lakex-local-notes-mobile.ai.provider`，不含密钥、不参与同步）；打开页面时**按已保存 baseUrl 反推供应商优先**，其次本机选择，最后默认第一家。
- **字段与桌面同序**：服务（供应商 → 接口地址）→ 凭据（API Key + 清除）→ 模型与参数（模型 → 思考强度 → 思考模式 → 温度）→ 连通性（保存/测试 → AI 助手开关）→ 本机历史。思考强度/思考模式只在该家 `supportsReasoning/supportsThinking` 时出现；思考模式开启时隐藏温度（与桌面条件一致）。
- **保存语义**：支持家送 `reasoningEffort/thinking`；不支持家显式 `null` 清掉上一次切换的残留；保存后按服务端配置回填（思考参数未存过则回落该家默认）。
- **已知差异（有意）**：移动端 Key 由原生 Keystore 单配置持有（只有一份，API Key 行说明已写明「切换供应商后请确认 Key 属于该家」）；桌面按供应商各存一份配置与 Key，且桌面有「获取模型列表」——移动端原生通道暂未加 listModels（模型手填 / 用供应商默认）。
- **门禁**：tsc 0；vitest `src/mobile`（327 文件 / 1640 用例）0 failed；check:mobileui / check:bundle / check:arch PASS；APK `--sync --install` 到 lake_mobile(5554)，设备截图核对供应商/思考强度与桌面同序；新增 `aiProviderPrefs` 单测 + 表单供应商/思考参数用例；guide/10 Android 配置表同步。

### 261113 · S3 流程缺陷收口批（P1/P2 全清 + 4 轮真实桶复验；#10/#11/P3-6 已验证）

- **#8 兜底「未分类」固定 id**（task-15，HEAD 312cbb57 后真实桶 **28/28 PASS**；**261113 用户裁决：认 id 不认名字，用户自建同名本一律不动 ⇒ 已撤掉「按标题收编旧随机 id」那条**）：场景1 删光笔记本→建根文档 ⇒ 固定 id、云端仅一本、B 同步得同一 id 且不再新增；场景3 多本/同名本时绝不碰用户数据。旧随机 id 的兜底保留不迁移（多一本同名无害）。
- **第 4 轮复验**（task-14，HEAD f0b577b8 后）：#10 purge 顺序 PASS（含发布失败注入 ⇒ 对象不提前删、恢复后补删）；#11 空桶首传 purged PASS（首轮 gen=1 即带墓碑，无多一轮）；**P3-6 视觉 PASS（含收紧后三态）**：行宽 303.5 且另有徽标 ⇒ 倒计时 display:none；行宽 420 ⇒ 恢复 block；只有倒计时一个徽标的 280 窄行 ⇒ 仍 block（判据是「窄 + 另有徽标」，非纯宽度；截图 /tmp/lake-e2e/p36-new-*.png）；精简回归 10/10。**#12 判为「入口未命中」**：e2e 走的是「回收站副本（无 active 行）」⇒ pipeline 先返回 not-found；守卫对「active 行 + remotePurged」这一真实态已由单测覆盖（pipeline 2 例），未观测到复活。遗留待设备/UI 复验：编辑器开着时他端 purge，随后「保存并同步」是否走 full-sync（remote-deleted）。另有观察：B 有未同步编辑 + 未拉取 purge 的变体会产生孤儿正文对象（未复活，GC 可清），待第 5 轮定点确认。
### 261113 · S3 流程缺陷收口批（P1/P2 全清 + 3 轮真实桶复验 74/74）

- **修复**（每项都带护栏）：P1#2 发布轮不再抹掉「云端已删除·仅本地」副本；P1#3 附件「清单有但读不出字节」整条回退（不写新声明 + 索引回退 + 有告警 + 下轮自动补传）；P2#4 目录位置三件套独立合并（目录删除/恢复不再被他端改名吞掉；配套修「wire 上 trashed 目录 parentId 投影 null 导致落库被复活」）；P2#5 小记标签发布侧 LWW；P2#6 快路径 tagIds 排序；P2#7 小记 purge 前缀单一来源；R5 新问题「恢复后首次编辑被他端旧副本覆盖」（同步镜像恢复端口把 updated_at 写成本机 now ⇒ 对齐守卫跳过 ⇒ 本地误判更新、stale 上传）——修法 = 引擎自己写生命周期时元数据应用不带 expected 守卫。
- **真实桶 3 轮复验**（前缀 lakex-notes-dev3/e2e/*，每轮独立前缀、收尾 0 残留）：第 1 轮 272 断言抓到 5 个问题；第 2 轮 56/60（C1/C2 已修 PASS，暴露 P1#3 残余 + R5）；**第 3 轮 74/74 PASS**（R5 恢复后编辑 14/14、P1#3 残余 9/9、抽检 6 项、R5 回归 12/12）。
- **C3 定案**：锁只在渲染层是**设计如此**（只锁本地编辑、不拦同步；守卫不得下沉共用写函数，已写入 AGENTS §4）。UI 路径已真实桶验证：锁到达时编辑器当场切只读、UI 打字不落 DOM、解锁恢复。
- 门禁：tsc 0；core + electron/s3v3 **194 文件 / 1356 例**全过；真实桶脚本与证据在 /tmp/lake-e2e（未入仓）。

### 261114 · 壳层快捷键接入思源口径（`87b909d1`）

- **单一来源** `src/lib/shortcuts/registry.ts`：命令表 + 不可绑定保留键（系统编辑键 + 内核 ⌘F/⌘B/I/U + 思源禁用的 ⌘S/⌘Q）+ 纯函数匹配/格式化；键位用 **KeyboardEvent.code**（⇧] 不受键盘布局影响），`Mod` = mac ⌘ / 其它平台 Ctrl。`useWindowShortcuts` 改为消费注册表（capture、只命中才 preventDefault、输入法组字跳过、Esc 语义不变）。
- **绑定（思源同款）**：⌘P（⌘K 保留为别名）= 全局搜索；⌘N = 新建文档（知识库→新建弹窗 / 日记→今天新建 / 其它空间先回知识库）；⌘W = 关闭当前标签（无标签 no-op，**不关窗口**）；⇧⌘[ / ⇧⌘] = 上/下一个标签（本空间循环）；F9 = 立即同步（未配置/关闭走既有 toast 给理由）。**保留自己的**：⌘] 侧栏、⌘⇧Enter 专注、⌘1–5 空间、⌘, 设置、Esc。**未采用**：思源 ⌘1–9（撞空间切换）、⌘[ / ⌘] 前进后退（⌘] 已作侧栏）。
- **展示收口**：设置页「快捷键」从注册表生成（+6 行，`SETTING_ITEMS` 同步登记；settingsSearch/settingsGroups 两个漂移护栏同步放行注册表行）；[guide/13](../guide/13-shortcuts.md) 重写为同一份清单（含 Windows/Linux Ctrl 口径与平板边界）。
- **验证**：tsc 0；定向 vitest（registry/hook/settingsSearch/settingsGroups）绿；`check:bundle` / `check:arch` PASS；隔离实例（临时 `LAKE_USER_DATA` + CDP 9232，结束时清进程与目录）实测：⌘P/⌘K 搜索、⌘N 弹窗、F9 同步理由提示、Esc 关闭、⇧⌘[ / ⇧⌘] 切标签、⌘W 关标签（2→1）、无标签 ⌘W no-op。
- **P2（可修改）未做（用户 261114 裁决）**：调研坑 = 菜单 accelerator 双轨 / 平台归一 / 内核保留键 / 录制 UX / 设置项搜索结果；触发条件 = 命令数 15+ 或常用键不顺手。
- **第二批（`eaf5ab9f`，用户 261114「继续推进第二批」）**：标签切换增加 `⌃⇥ / ⌃⇧⇥` 通道（与 `⇧⌘] / ⇧⌘[` 并列）；新增 `⇧⌘G` 锁定/解锁当前文档（编辑器 contenteditable 实测 true→null→true）、`⌥H` 打开当前文档历史；设置页/搜索随注册表自动加两行。实测隔离实例通过；全量门禁随本批转绿（见 §1）。
- **全量 vitest（`eaf5ab9f` 之后）= 0 failed**（928 文件 / 5885 用例；并行会话的 S3 WIP 已落地，红不再出现）。
- **261114 追加（用户点单）**：移动端「云端与同步」把「第三方 S3 服务说明」**移到页首**（先讲计费/隐私，再填连接信息）；`settings-s3` 快照重烤（元素数 2045 不变、指纹更新；`--states settings-s3 --write-baseline` 合并写回，其余 9 态保留），APK 已 `--sync --install` 到 lake_mobile（5554，可点击窗口）与 lake_gate（5556）。

### 261113 · S3 真实桶实测 + 流程缺陷修复批（D1-C / D3 / D4 / C1-C2-C4 / P1）

- **真实桶端到端矩阵**（双桌面隔离实例 + 真实桶，3 轮 **272 断言**，脚本与证据在 `/tmp/lake-e2e`）：笔记本/嵌套目录/改名移动/软删恢复/purge+重建×5、文档双向改与冲突、小记快路径连点、资产差集与 GC、缺正文从云端恢复（含重启）、「云端已删除·仅本地」双遍 —— 大部分 PASS；抓到 5 个稳定问题（C1 高 / C2、C3 中 / C4 低-中 / C5 低）。
- **修掉的**：**C1** 小记「他端删除→本端恢复」跨端失效 + 删除回弹（merge 的 local-delete 缺时间戳比较 + saveQuickNotes 只看墓碑存在性 ⇒ 改为「远端 updatedAt vs 基线/墓碑」LWW）；**C2** 纯拉取轮小记时间戳 1970（engineBridge 优先用远端 meta 时间）；**C4** 冲突文案误标（新增 `conflict_kept_history` kind：「已保留本地历史版本」）；**C5** 手动「立即清理」被保留窗口挡住（`ignoreRetention` 透传成 `retentionDays=0`）。**C3 定案 = 不是缺陷**：锁只在渲染层是设计（只锁本地编辑、不拦同步，守卫不得下沉共用写函数，AGENTS §4 已记）；真实桶 UI 路径已验证（编辑器当场翻只读、UI 打字不落 DOM、解锁恢复）。
- **静态审查 12 条**（`docs/SYNC-PROTOCOL` 逐段对代码）：已修 **P1 小记共享正文对象被按 hash 误删**（删一条毁另一条云端正文，两处删除路径都加引用检查）；**P1 剩余**：附件 PUT 失败仍写新声明（声明在/对象缺、永不重试）、发布轮丢「云端已删除」副本的回收站落库；**P2 待修**：目录缺位置三件套合并、小记标签发布侧 LWW、快路径不排序 tagIds、小记 purge 漏删 `meta/assets` 前缀。
- **D4 墓碑退役**：恢复过的目录/叶子不再背永久墓碑（他端删除不再被静默丢弃、不再复活）；删掉零调用且 SQL 坏掉的 `revokeLocalDeletion`；复查补「叶子恢复」漏洞。**D1-C**：移动 baseline 搬出 `sync_v3_state` 整行 → `sync-v3/baseline.json.gz.b64`（5000 文档行 1.11MB→247B、文件 426KB、过桥约 -82%），文件损坏/丢失 = 同步硬失败（绝不把缺基线当「云端缺席=删除」）。**D3**：移动云清理补「预览 + dryRun」，候选数与已删数分开、无预览不能删。
- 门禁：tsc 0；core/s3v3 + electron/s3v3 107 文件 / 580 例、mobile 71 文件 / 287 例、全量 mobile 326 文件 / 1632 例全过；diff-check 干净。

### 261113 · 日记本开放改名/换图标 + 转小记回退为「复制 + 回收站」（`1457bc1d` / `5a555dca`）

- **用户裁决①（替代 261112 §3#25② 的一半）**：日记本**只开放改名与换图标**；删除/移动/排序/作移动目标/space 降级仍拒绝；日记条目与年/月分组仍不可改名/图标。桌面 = `noteMetadataRepository` 新增 `assertNotDiaryContent`（仅日记子树拒绝，本体放行）；移动端 = `treeRepository.diaryNotebookOf`（与桌面同判据）+ 改名/图标/移动/排序/删除守卫、`batchNotes` 目标剔除、`mobilePlatformPort` 单调闸。**移动端入口 = 日记页页头 ⋯（日记本已存在才显示）→ 只给「重命名 / 设置图标」**；桌面不新造入口（数据层放行，等待专门入口设计）。`NotebookWorkspace` 标题锁判据改用 `notebookSpace`（原用过滤后列表 ⇒ 恒 false，日记条目顶栏可改）。
- **用户裁决②（最终版，261113 晚二次裁决）**：「转为小记」= **复制 + 原稿进回收站**（可恢复），**卡片零剥离**。初期按「移动」实现（新 id + 资产目录整体移动 + 物理移除 + 删除意图）后，用户比较两案改为「复制 + 回收站」——内容小、双份占用临时（回收站 90 天自动过期），换来可恢复 + 不碰同步语义 + 回滚更简单。代码已回退到「`createQuickNoteFromContent` + 软删 `deleteTreeNode`/`trashTreeItem`」，只保留零剥离与三层作用域改写；`droppedKinds` 字段恒空（IPC 形状兼容）。
- **文档**：AGENTS §3#25②③、[DIARY](DIARY.md)、[guide 16](../guide/16-diary.md) 同步新口径（含「卡片零剥离 / droppedKinds 恒空 / 原稿进回收站可恢复」）。
- **收尾清理（`5a555dca`）**：删掉移动专属死代码（adopt/rollback/removeNoteForQuickNoteMove/deleted 意图/资产目录移动）与通知里的「未搬运」分支（零剥离后不可达）；移动端 ⋯ 菜单「日记本设置」入口、桌面左栏头 ⋯ 入口均与数据层守卫对齐。
- **门禁**：tsc 0；vitest **923 文件（912 passed / 11 skipped）/ 5837 用例（5825 passed / 12 skipped）/ 0 failed**；check:mobileui 通过；check:core 177/0；check:bundle / check:arch PASS；diff-check 0；APK `--sync --install`（lake_gate 5556）；日记页 ⋯ 菜单/重命名/设置图标 设备级截图核对，空态不显示入口。
- **欠账**：桌面「日记本改名/换图标」入口已在 `74038597` 补齐（左栏头 ⋯ → NamePromptDialog / NodeIconPicker）；转换后原稿在回收站（可恢复），无遗留数据损失面。

### 261113 · 移动端设置项对齐桌面 + 长说明行上下布局 + 选择器/Secret 修正（`de244d3a`）

- **设置项顺序对齐桌面**：云端与同步（字段序 Endpoint → AK → SK → Bucket → Region → 前缀；「连接」并入 S3 对象存储；配置迁移前置；同步策略/同步诊断拆组）；AI 助手（接口地址 → API Key（清除紧邻）→ 模型 → 温度 → 保存/测试 → 开关）；常规（附件 → 默认空间）；历史（定期清理 → 自动快照）。依据 = 桌面 SyncSection/AiSection/EditorSection/HistorySection。
- **长说明/长选项行改上下两段**：`Item` 新增 `stacked`（**复用 --field 几何**，不新增第二套 CSS —— 移动端层围栏只许降）；已应用 max-open-tabs / 默认空间 / 自动同步模式 / 自动同步间隔。
- **默认笔记本选择器重做**：`button.mb-set-item` 在 Sheet 里吃到浏览器默认外观（粗边框灰盒）⇒ 改用选择器原语 `.mb-sheet--picker` + `.mb-list-item` + `role=option/aria-selected` + 打勾。
- **Secret Key 逻辑修复**：未配置 S3 时不再显示无意义掩码（掩码只在已存密钥时出现；未配置 = 空输入框，与桌面 `S3_DEFAULTS` 同口径）。
- **设备门禁**：mobile-snap 的 settings-s3 断言随分组改名；lake_gate（5556）重灌夹具后**重烤 10 态基线，连跑 0 差异**；APK 已 --sync --install 验收（截图见会话 / 本批无独立报告）。
- 门禁：tsc 0；vitest 919 文件 / 5789 passed / 12 skipped / 0 failed；check:mobileui 通过；diff-check 0。
- ⚠️ 本轮工作树与其他会话（Codex）并发改动同一 worktree：本批只 stage 自己的 11 个文件提交，**未动**日记/同步/发布文档那批改动。

### 261113 · 移动端「转为小记」+ 发版复核 P2/P3 + v1.1.1 发布（已本地提交）

- **移动端补「转为小记」（task-106，`a57cf3cf`）**：日记条目 ⋯ 新增「转为小记」，与桌面同语义 —— 原 Lake 正文复制成新小记、图片/附件搬到 `/quick-notes/<id>/`（**原资产保留**）、原文软删进回收站（可恢复）；数据层 `src/mobile/diary/diaryToQuickNote.ts`（非 doc 拒绝 / 已引用资产缺失明确失败 / 不可承载卡片剥掉并 `droppedKinds` 明说 / 任一步失败 `removeUnsyncedQuickNote` 回滚不留半成品）+ `bridge/diary.diaryToQuickNote`（写域）+ 文案与桌面逐字一致 + ⋯ 二次确认与 toast。**至此两端都有两个单篇出口**。设备验收（5556：含图小记 / board 卡明说未搬运 / 回收站恢复）见 [22 号报告 §11](audit-261112/22-diary-untag-multi-end.md)，证据 `audit-261112/evidence/diary-to-quicknote-mobile/`。
- **发版复核 P2/P3（task-105，`839c7a93`）**：core/electron + 桌面 UI —— 转换守卫、资产匹配、kind 单一来源、目录告警、计数、可访问性、toast×dock。
- **v1.1.1 已发布**：tag `v1.1.1`（GitHub Release 8 个资产 = APK / macOS arm64 dmg+zip / Windows exe / latest.json / release-body；run id 见 §1），本地 packaged smoke 通过；发布说明 = [RELEASE-NOTES](RELEASE-NOTES.md) 顶部段落。
- **文档收口（261113）**：AGENTS §3#25③ 明确「两端都有、同名同语义」；[DIARY](DIARY.md) / [guide 16](../guide/16-diary.md) 补移动端入口与行为（⋯ 菜单、媒体复制、原稿可恢复、droppedKinds、非 doc 拒绝）；[RELEASE.md](RELEASE.md) 新增 GitHub Secrets 节（Android 4 个名字 + 缺失后果 + `GITEE_TOKEN`）；[README](../README.md) / [MOBILE-OPS](MOBILE-OPS.md) 的 Android secret 名改为 `ANDROID_KEYSTORE_BASE64`（`ANDROID_KEYSTORE_PATH` 是 workflow 派生变量）。
- 本波门禁见 §1。

### 261112 · 日记本不可变 + 两出口 + 回收站预览加固（已本地提交，未推送）

- **日记本固定不可变（261112 用户裁决，红线见 AGENTS §3#25）**：`199f3403` 移除「取消日记标记」并把日记本定为固定不可变笔记本（`space` 只升不降；删除 / 改名 / 图标 / 排序 / 移动**均设守卫拒绝**）；`fd58dc0a` 移动端移除入口与写路径（保留单篇出口）；`d4d03260` 移动目标候选统一剔除日记子树（core 单一判据，桌面+移动共用）。
- **两个单篇出口**：`f965e62c`「转为文档」复用 AI 写作「生成文档」同款共享弹窗（只选知识库笔记本、标题可改、不选分组；先 move 再 rename）；`4b6a524a`「转为小记」原样承载 Lake 正文并搬运图片/附件（`/<noteId>/` → `/quick-notes/<id>/`，journal 原子/回滚/droppedKinds 明说；原稿进回收站可恢复、原资产保留）。
- **UI 修复**：`400dcc75` 非知识库空间也能看到 `showNotice` 提示（toast 从状态栏空壳拆出，7 个空间可见）；`3cf19a29` 回收站「云端已删除（仅本地）」副本整行可点 + 标题不再被徽标挤成 0 宽（缺正文给明确提示，task-89）。
- **发版复核修复（261112 晚）**：`142244cd` 三处真缺陷——F-01 `plan.withPosition` 显式写位置 null（否则本地已恢复被远端正文更新回滚）、F-02 同步 apply 冻结日记本的 parent/trashed 位置（旧端/脏索引不能再移动/回收它）、F-03 日记→小记创建阶段失败也回滚并清 journal/staging（不再出现「报错但重启补出小记」）。
- **文档/契约**：AGENTS §3#25、[docs/DIARY.md](DIARY.md)、[guide/16-diary.md](../guide/16-diary.md) 已同步口径；本波门禁数字见 §1。
- **发版前文档收口（261112 晚，docs-only，已本地提交）**：`0c7175cf` 新增 [25 发版前移动端复核](audit-261112/25-release-review-mobile.md)；`de684e98` 补 **v1.1.1** 发布说明段 + 发版标题/版本号核对要点；`7a62d349` guide 同步本轮行为变化（日记固定+两出口 / 单篇失败降级 / 逐项 warning / 仅本地副本可预览）；随后 `task-101` 做 AGENTS/HANDOFF/SYNC-PROTOCOL/DIARY 四文档一致性复核（本批改动未提交）。

### 261112 · R2/C2 拆分收口 + 设备验收 + S3 真实桶收口（已本地提交，未推送）

- **拆分 6–10（Q19=C2）**：Sidebar 1857→1498（7 内部组件到 sidebar/）；SettingsPanel 1447→89（11 个 sections + useSettingsPanelScope 722 行）；electron/main.ts 1306→1100（boot/paths.ts + boot/ipcWiring.ts 281 行，21 依赖显式传递、单例留 main）；lakeRuntime 1699→538（6 个 kernel 模块，lazy 边界/模块级单例/__disposeExtras 时序保持）；InkPad 阶段② 完成：抽 `InkCanvas` + `InkToolbarDesktop`（InkPad 1790→1533），ink 全测 226 例绿；品牌启动（见下）改透明雀。
- **设备验收（真机 + 模拟器）**：R1 APK 已 --sync --install 到真机 Xiaomi 2109119BC（Android 14）与 5554 模拟器；**Q04 通过**（回收站文档 = 只读预览 + 横幅「编辑与保存会被拦截」，CDP 断言 + 截图）；**Q22 通过**（SecureStore→SecretBox：set/get → force-stop 重启 → get 仍为原值 → remove 清空，真机 Keystore 冒烟）；首页/Dock 正常、logcat 无 FATAL。记录与截图：[docs/audit-261112/12-device-check.md](audit-261112/12-device-check.md)。
- **设备门禁矩阵（R2 代码重装后）**：手机 10 态（lake_gate / 9336）与平板 10 态（lake_tab / 9340）均按夹具重烤后**连跑两轮 0 差异**；多维表 3 态重烤后两轮 0 差异；**23 屏走查 23/23 ok**；窗口矩阵 `pass: true`。基线三份（mobile-snap / tablet / bitable）已随本批更新。**桌面 42 态也已重烤**：合成夹具 + 隔离实例，42/42 态采集、34 严格态连跑两轮 0 差异（8 窄窗按既有 UNSTABLE 跳过）；基线 `scripts/css-audit/baseline/stylesnap.json` 已更新。
- **门禁（R2 收尾实测）**：tsc 0；全量 vitest **886 文件（875 passed / 11 skipped）/ 5597 用例（5585 passed / 12 skipped）/ 0 failed**；ui-metrics **shadowed 0 / 跨文件重复 45** / !important 9=清单；check:core 172/0；check:mobileui 通过；双 build + bundle/arch PASS（desktop 首屏 567,551/600,000、app-js 196,192/307,200；mobile 348,211/360,000、entry 60,803/61,440、css 139,503/141,312）；diff-check 0。
- **待验/未做**：Q03 历史预览、Q07 preview 档、Q05 字号的设备级点按（单测已绿）；~~移动小记画廊 video/audio 混入~~（已修 task-32）；~~剩余 21 条 shadowed 声明~~（已清零 task-34）+ ~~mobile.css 域归位~~（已完成 task-33）；~~docs 侧机器路径~~（已清零 task-35）。**设备矩阵（手机/平板 10 态 + 多维表 3 态 + 23 屏 + 窗口 + 桌面 42 态）已全部重烤并两轮 0 差异**。
- **S3 真实桶验收（A 档 20/20 + B 档 57/57）**：三桌面隔离实例 + 七牛真实桶（**唯一测试前缀**，结束只 DELPREFIX 本前缀）⇒ **A 档 20/20 场景 PASS**；**B 档 13 条 57/57 PASS**（task-58 完成；含 S72 修复后复跑），前缀 **0 残留**。记录：[13 写路径越界扫查](audit-261112/13-write-guard-sweep.md) · [14 S3 场景矩阵（收口 45 有 / 28 部分 / 1 真空）](audit-261112/14-s3-scenario-matrix.md) · [19 B 档 13 条验收](audit-261112/19-s3-real-bucket-subset.md) · [21 移动多端 A–F](audit-261112/21-s3-multi-end-mobile.md)。
- **同步语义收口（`3fad8821`，task-44 落地）**：位置三件套独立三方合并（`src/core/s3v3/plan/positionMerge.ts`）+ 纯移动轮也发布（`apply-position`）；同步专用写路径（`saveSynced`/`saveSyncedNote`，桌面+移动同口径）；单篇 apply 异常降级为 warning+continue（不再整轮卡死）；P1-a engineBridge 改读 `meta.nodeType` 根治；P1-b 目录 local-purge 置 indexChanged。锁字段独立合并与发布 = **task-47 已落地**（基线+lockedAt LWW，见 §2）。语义要点见 §2。
- **品牌启动图（`8a131acd` / `6c5e52b1`）**：启动标记改**透明双绿折纸雀**、启动底走**主题窗色**（去掉白底/薄荷圆）；启动动画改 CSS 后删除已无引用的 APNG/poster（约 −1MB）。
- **文档批次**：主计划 K–P 重复段去重（`a2caf0ba`，821→698 行 / −123，无内容丢失）；本轮只读审计分册 [13](audit-261112/13-write-guard-sweep.md) 写路径守卫越界扫查 · [14](audit-261112/14-s3-scenario-matrix.md) S3 全场景矩阵 · [15](audit-261112/15-readonly-gates-warning.md) 只读门禁与同步 warning 通路 · [16](audit-261112/16-mobile-lifecycle.md) 移动端生命周期等价性 · [17](audit-261112/17-lock-trash-ui.md) 只读/回收站/云端已删除/保存被拒 UI 一致性 · [18](audit-261112/18-evidence-lifecycle.md) 生命周期实测 · [19](audit-261112/19-s3-real-bucket-subset.md) 真实桶 B 档 · [20](audit-261112/20-independent-review-batch2.md) 独立复核 batch2 · [21](audit-261112/21-s3-multi-end-mobile.md) 移动多端 A–F。
- **S3 语义修复第二波（261112 晚，均已本地提交）**：① **S72** 被远端移入回收站 + 本地有未同步编辑 ⇒ **强制留历史快照**（`903a47aa`）；② **F-01b** 目录 purge 后云端索引残留（4 处叠加根因）已修（`fa2fbdad`）+ 矩阵附录 D 回写（`dc882945`）；③ **H73-G1** 位置赢家为远端时生命周期变更不再被 `lifecycleRace` 永久挡住（`4db266e9`）；④ apply 跳过改**独立 kind `apply_skipped`** + 诊断逐项 + P0 回归护栏（`1db5dea6`）；⑤ `positionMerge` / `mergeNoteLock` 表驱动 **32 例**（`811df501`）；⑥ 矩阵收口（覆盖 **45 有 / 28 部分 / 1 真空**、新增 S08）（`18019c1f`）。**task-46/47/52–58 全部关闭**；本波门禁见 §1。
- **AGENTS 新红线（`68e90df4`）**：§3#23 写路径守卫分层（用户策略只在入口/同步专用写路径，声明 U/S/I/R/M 调用方分类）+ §3#24 位置与内容正交（位置基线三方合并、恢复历史=内容动作、purge 整棵子树、**不加位置 wire 时间戳**）——内容以 AGENTS 为准，本文不复述。

## 1. 当前基线（唯一状态来源）

> 数值 = 最近一次实测（261113 批，低负载串行）。**任何状态判断以本节 + `git status` / `git log -1` 为准**。

**版本与仓库**

- 主分支 `master`；**HEAD 以 `git log -1` 为准**；R2 已提交 6 笔拆分/设备记录（`a23631f6` sidebar / `fd268432` settings / `231fe845` electron boot / `c00d3a60` lakeRuntime / `4a9b965c` ink 测试 / `e352e2cb` 设备记录）；**产品代码基线 = `8e20a6a3`（R0）/ `e87016bd`（R1）/ `e352e2cb`（R2）/ `3fad8821`（R2 收尾：位置合并 + 同步专用写路径 + 单篇降级）**；**日记收口批产品笔 = `199f3403`（不可变守卫）/ `fd58dc0a`（移动移除取消标记）/ `d4d03260`（移动目标剔除日记子树）/ `f965e62c`（转文档共享弹窗）/ `4b6a524a`（转小记媒体搬运）/ `400dcc75`（showNotice 全空间可见）**；**261113 批 = `839c7a93`（发版复核 P2/P3）/ `a57cf3cf`（移动端「转为小记」+ 22 号报告 §11 + RELEASE.md Secrets 节）**（详见 §0）。
- **推送**：v1.1.3 发版 commit `12b5f7d3` 与注解 tag `v1.1.3` 已双推（Gitee `origin` + GitHub `github`，tag ref `a3f47335` → commit `12b5f7d3`）；随后 docs 收尾提交会再推一次 master ——以后以 `git rev-list --count origin/master..HEAD` 为准。
- `package.json` = **1.1.3**；Android `versionName 1.1.3` / `versionCode 11103`（从根 package.json 派生：`1000 + major*10000 + minor*100 + patch`，只增不减；**不手改 build.gradle**）。
- tag：`v1.0.0`–`v1.0.5`、`v1.1.0`、`v1.1.1`（261112 已发）、`v1.1.2`（261114 已发）、**`v1.1.3`（261114 已打 tag 并双推；Release workflow run `43405437257` 由 tag 触发；发布说明段落 = RELEASE-NOTES 顶部 `# LakexLocalNotes v1.1.3`）**；已发布 tag 不再移动。发布说明 = [docs/RELEASE-NOTES.md](RELEASE-NOTES.md)（**v1.1.3 → v1.0.0** 倒序；当前 tag 段落 = CI 生成 GitHub Release 正文的来源）。
- 分支/远端：`master` 唯一长期分支；`origin` = Gitee（SSH，第二 pushurl = GitHub HTTPS）⇒ `git push origin <branch>` 一次推两边；GitHub 只在推 tag 时构建。remote 不入库 ⇒ 新 clone 跑 `npm run setup:remotes`。
- **工作树**：261114 批 = `f3a0e60c`（幽灵文档）→ `b676440f`（回收站浮动动作/启动不硬开/保存被拒可退出/移动 gone）→ `bbeddc3f`（级联删除）→ `c3b17bf9`（移动删除 review 收口）→ 发版 commit（1.1.3，见 `git log`）；历史上并行会话共用工作树时一律「只 stage 本批文件」，**绝不用 `git add -A`**。
- 261110 一次性历史清理（`.ai-writing-recon/` 用 `git filter-repo` 从全部历史移除，重写 v1.1.0 之后的提交；tag 未变）⇒ 旧 clone 需 `git fetch --force --prune && git reset --hard origin/master`。

**门禁基线（v1.1.3 发版批实测 2026-11-13 17:56；分层口径见 AGENTS §3#21）**

- `npx tsc --noEmit` = **0**。
- 全量 vitest（低负载串行门禁）：**文件 = 总 939（928 passed / 11 skipped）**；**用例 = 总 5983（5971 passed / 12 skipped）/ 0 failed**（71.2s）。偶发 `perf.integration` 满载抖动口径见下条（单跑复验通过）。本批动了回收站行样式 ⇒ 跑了 `cssLayers`/`uiPrimitives`/`ui-metrics`（均 PASS；无该行的样式快照态，未跑 stylesnap）；移动端改动已装 APK 并设备级验收；`npx vite build` 成功（隔离验证用构建）。
- ⚠️ `electron/s3v3/perf.integration.test.ts`：**低负载串行本轮无抖动（通过）**；满载/并发构建时偶发（单跑 PASS），门禁判定以单跑/低负载为准（同 §2 既有口径）。
- `node scripts/ui-metrics.mjs`：颜色 0 / 字号 0 / `!important` 9 = 允许清单 / `crossFileDupGroups` 45 / `shadowedDecls` **0**（task-34 已清零，门禁只降）/ 未定义令牌 0。
- `check:core` **178** 文件 0 违规；`check:mobileui` 通过。
- `check:bundle` + `check:arch` PASS：desktop 首屏 571,442 / 600,000（余量 28.6KB）、app-js 197,537 / 307,200；mobile 首屏 **341,652 / 350,000**（余量 8.3KB，261114 已收紧）、entry **48,759 / 51,200（50KB）**（余量 2.4KB）、CSS 139,210 / 141,312、preload 10 / 12；vendor CSS 分层审计 OK。移动入口从「434B 余量」恢复到可加 2.4KB 的健康区。
- `git diff --check` = **0**。
- **真实 S3 桶验收**：A 档三桌面隔离实例 **20/20 PASS**（`3fad8821`）；**B 档 13 条 57/57 PASS**（task-58，含 S72 修复后复跑），唯一测试前缀 **0 残留**（[19](audit-261112/19-s3-real-bucket-subset.md)）。**移动多端 A–K 已跑完（task-72/74 已关闭；D 场景修复后复跑 9/9、收尾 0 残留，见 [21 号报告](audit-261112/21-s3-multi-end-mobile.md)）**。
- 设备/视觉（最近记录）：手机 **10 态** + 平板 **10 态** 基线重烤并连跑两轮 0 差异；23 屏走查 23/23；`edit-surface-invariants` quicknote 11 + document 11 ALL PASS；capture 入口装置 10/10。**桌面 `check:stylesnap` 42 态已重烤**（34 严格态两轮 0 差异，8 窄窗按 UNSTABLE 跳过；基线已更新，见 §3）。

**设备与环境（本机实测）**

- Node **v24.18.0**（`$HOME/.nvm/versions/node/v24.18.0/bin`，必须 24）；JDK **21**（`/Library/Java/JavaVirtualMachines/jdk-21.jdk`）；Android SDK `/opt/homebrew/share/android-commandlinetools`。
- AVD：`lake_mobile`（开发）/ `lake_gate`（门禁固定夹具，**勿改其数据**）/ `lake_tab`（平板与窗口矩阵）；移动 CDP **9335 开发 / 9336 门禁 / 9340 平板**（桌面 dev 9222；serial 以 `adb devices` 为准）。
- 数据：开发 `~/Library/Application Support/lakex-local-notes-dev`；正式 `.../lakex-local-notes`（**禁止触碰**）；日志在对应目录 `logs/`。
- **261112 R1 设备验收**：真机 Xiaomi 2109119BC（Android 14，serial 50950385）+ 5554 模拟器已装 R1 APK；Q04 回收站文档只读预览、Q22 SecureStore→SecretBox 跨重启真机通过；快照矩阵（手机 10 态 / 平板 10 态 / 多维表 3 态 / 23 屏 / 窗口矩阵）已重烤并两轮 0 差异；Q03/Q07/Q05 观感项仍待人工点收；桌面 42 态已重烤（证据 [docs/audit-261112/12-device-check.md](audit-261112/12-device-check.md)）。

**发布与推送事实**

- **v1.1.3 已发**（261114）：tag `v1.1.3`（注解，commit `12b5f7d3`）→ Release workflow run **43405437257**（tag 推送即触发；产物/Release 资产以 CI 结果为准，见 Actions 页）。
- **v1.1.2 已发**（261114）：tag `v1.1.2`（注解）→ Release workflow run **43384377793**；产物 8 资产见上（§0 本批）；Android job 的 release 签名校验通过（4 个 secrets 齐备）。
- Android 签名 = release keystore（证书 SHA-256 见 git 历史 v1.0.2 批次）；**keystore 必须离线备份**，丢失后无法覆盖升级。
- macOS = x64 + arm64 分开打包，ad-hoc 签名未公证（首次打开走「仍要打开」）。
- **GitHub 推送优先走 SSH remote `github`**（HTTPS 到 github.com 实测不通）；**VPN 开启时 GitHub 一律不通**（含发版 tag），发版前确认 VPN 已关。
- 发版流程 [docs/RELEASE.md](RELEASE.md)；用户手册 [guide/README.md](../guide/README.md)。

**文档地图（现存；已删文档不要再链；本表是唯一索引）**

- 入口 / 红线：[README.md](../README.md) · 本文件 · [AGENTS.md](../AGENTS.md) · [CONTRIBUTING.md](../CONTRIBUTING.md) · [SECURITY.md](../SECURITY.md)
- 架构 / 产品 / 设计：[docs/ARCHITECTURE.md](ARCHITECTURE.md) · [docs/PRODUCT.md](PRODUCT.md) · [docs/DESIGN.md](DESIGN.md) · [docs/MOBILE-DESIGN.md](MOBILE-DESIGN.md) · [docs/PAD-ADAPTATION.md](PAD-ADAPTATION.md)
- 同步 / 存储 / 容错：[docs/SYNC-PROTOCOL.md](SYNC-PROTOCOL.md) · [docs/STORAGE-LAYERS.md](STORAGE-LAYERS.md) · [docs/RESILIENCE.md](RESILIENCE.md) · [docs/SYNC-DEVICE-CONTRACT.md](SYNC-DEVICE-CONTRACT.md) · [docs/SYNC-STATE-CONVERGENCE.md](SYNC-STATE-CONVERGENCE.md)
- 空间 / 契约：[docs/DIARY.md](DIARY.md) · [docs/AI-WRITING.md](AI-WRITING.md) · [docs/TAG-SYSTEM-DESIGN.md](TAG-SYSTEM-DESIGN.md) · [docs/PANEL-CONTRACT.md](PANEL-CONTRACT.md)
- 发布 / 更新 / 换机：[docs/RELEASE-NOTES.md](RELEASE-NOTES.md) · [docs/RELEASE.md](RELEASE.md) · [docs/UPDATE-CENTER.md](UPDATE-CENTER.md) · [docs/PORTABLE-TRANSFER.md](PORTABLE-TRANSFER.md)
- 内核 / 表格 / 多维表 / 手写板：[docs/LAKEX-CONTRACT.md](LAKEX-CONTRACT.md) · [docs/lakexEditor-developer-docs/](lakexEditor-developer-docs/) · [docs/USHEET-UPGRADE.md](USHEET-UPGRADE.md) · [docs/INK-PAD.md](INK-PAD.md) · [docs/BITABLE-VIEWPORT.md](BITABLE-VIEWPORT.md)
- 移动端：[docs/MOBILE-OPS.md](MOBILE-OPS.md) · [docs/MOBILE-TECH-STACK.md](MOBILE-TECH-STACK.md) · [docs/MOBILE-AI.md](MOBILE-AI.md) · [docs/MOBILE-BITABLE-DINGTALK.md](MOBILE-BITABLE-DINGTALK.md) · [docs/MOBILE-USHEET-YUQUE-PARITY.md](MOBILE-USHEET-YUQUE-PARITY.md) · [docs/MOBILE-SHEET-EXCEPTIONS.md](MOBILE-SHEET-EXCEPTIONS.md) · [docs/MOBILE-LONG-DOC-PROBE.md](MOBILE-LONG-DOC-PROBE.md) · [docs/MOBILE-EMPTY-CATCH-LEDGER.md](MOBILE-EMPTY-CATCH-LEDGER.md)
- 工程 / 排错：[docs/DEVELOPMENT.md](DEVELOPMENT.md) · [docs/CODEX-GUIDE.md](CODEX-GUIDE.md) · [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) · [docs/LOGGING.md](LOGGING.md) · [docs/LAKE-CONTENT-WRITING.md](LAKE-CONTENT-WRITING.md)
- 使用手册：[guide/README.md](../guide/README.md)（19 章）
- 审计（本轮）：[docs/audit-261112/00-MASTER-PLAN.md](audit-261112/00-MASTER-PLAN.md)（分册 02–07 同目录；裁决见附录 E）
- **已删（只在 git 可查，不要再链）**：`audit-261027/` 4 份审计（261112 R1 消引用后删）· `INK-DEVICE-CHECK.md` · `S3-REDESIGN.md` · `S3-V3-FINAL-REPORT.md` · 五份旧发布说明（已并入 RELEASE-NOTES）

## 2. 风险与已知不稳定（跨批次，别再踩）

- **快照门禁依赖设备数据**：只在专用 AVD + 固定夹具上跑；改外壳几何/构成、重灌夹具、`pm clear`、装新构建、跑过造数据探针后**必须先重烤基线**（`--from <warm>.json --write-baseline`），否则下次全量必红。5554/5556 实例有验证数据，误跑必假红。23 屏走查装置修过「菜单页误点关闭」的潜伏 bug ⇒ **历史绿灯不完全可信**。
- **模拟器 `force-stop`/`am kill` 会丢最近的 WebView localStorage 写入**（261110 控制变量实测，**不是产品代码问题**）：验「默认空间 / 主题 / 侧栏宽度」这类本机偏好要用 App 自己的退出路径（首页连按两次返回退出再启动）。
- **验收状态**：「已合并 / 已双推 / 已发布」≠「用户逐条点收」。设备绿灯只代表装置与计算值，不代表真实第三方环境（分享面板 / 文件选择器 / AI 外部服务 / S3 覆盖恢复）。
- **平板回退史**：十三批「expanded 改内核固定工具栏」已被十四批整体回退；残留旧路径（内核工具栏、`body.lake-tablet`、`__lakeSetTablet`、`nativeDeviceHint`）若被重新引入 = 第三套口径。
- **inkDoc v4（写 4、读 1|2|3|4）**：旧端读到 v4 进只读保护 ⇒ 跨端混用要在发布说明写清（含「手机/平板需重装新包」）；改格式只能「新端写新版、旧端只读」并同步 [docs/INK-PAD.md](INK-PAD.md)。
- **依赖补丁 4 处**（univer ui / plait draw / xiangfa mindmap / lakex-drawnix）：升级后必须 grep 过滤句计数 = 0 且设备上出现「手形工具 — H」；**patch 打上但未命中不会报错**，必须逐条确认语义生效（登记见 AGENTS §2）。
- **设备装置不进 CI**（无 AVD/GPU）：PR 门禁只覆盖 tsc/vitest/双 build/core/ui-metrics/bundle/arch；设备类验证必须人工跑。
- **`npx cap sync` 会改写 `android/capacitor.settings.gradle`**（`../../lakex-local-notes/node_modules` → `../node_modules`，本机等价）⇒ 每次 android 构建后、提交前 `git checkout -- android/capacitor.settings.gradle`，生成文件不要提交。
- **并行会话共用工作树**：提交前必须 `git status` 分辨；只 stage 本批文件；共享基线文件（如 `src/styles/cssLayers.test.ts`）被双方各改几行时，用 `git hash-object -w` + `git update-index --cacheinfo` 只提交本批版本；**绝不用 `git add -A`**。
- **门禁预算现状**：`check:bundle` 的 mobile-entry 在目标附近，脚本冻结的是「现状值」；不要把它当绿，也不要把冻结值当目标。
- **全量 vitest 的 `electron/s3v3/perf.integration.test.ts` 在「多模拟器 + 构建」并行时会因宿主负载误报**（261112 实测：全量跑 1 例红、单跑通过；它是 500/2000 文档的阶段耗时门禁）⇒ 见它红先看宿主负载/单跑。
- **死代码/死 CSS 清理的常踩假阳性**：`SplitHandle` 的 `${className}-handle` 定位类是命中带的 `position: relative` 锚点（删了 = 「拖不动」，261110 真 bug）；移动大纲层级 `.lv1–3`、`.diary-split-handle` 同类动态类。判「没人用」先按 AGENTS §3#14 三排除；批量删样式/注释后必须核对 `mobile.css` 注释配平并跑一次视觉门禁自证。
- **删文档/审计产物前先消引用**：例 = `audit-261027/` 4 份（5 处源码注释 + 4 处文档引用）：先把结论搬进 `RESILIENCE`/`SYNC-PROTOCOL` 并改注释再删（261112 Q16 做法），否则出处断链、后续会话只能去 git 里捞。
- **日期显示口径已变（261112 Q9）**：`8/4` → `08-04`、带秒 → 去秒；快照/截图里的旧格式属预期差异。
- **`DocumentEditor` 现 import `mobile/bridge/assets`**（OpenFile 去重）⇒ 移动分包已过 `check:arch`，后续动移动懒加载先跑 bundle/arch。
- **261112 R1/R2 设备面现状**：Q04 / Q22 已真机通过；Q03/Q07/Q05 仍只有单测需人工点按；**全部快照矩阵（手机/平板 10 态 + 多维表 3 态 + 23 屏 + 窗口 + 桌面 42 态）已重烤并两轮 0 差异**；移动小记画廊 video/audio 混入已修（task-32）。
- **真实 S3 多端验收（261112，唯一前缀）**：抓到 3 个同步缺陷并已全部修复（**`3fad8821`，task-44**；P0 回收站/删除语义、P1-a 嵌套 folder parentId、P1-b 目录 purge 未清云端索引），复跑真实桶 **20/20 PASS、前缀 0 残留**、deviceConformance 绿。**S3 同步语义要点（以后按这些判，别再重新推演）：**

  - **回收站 = 特殊笔记本；删除 = 移动（且会传播）**：移入回收站 = 「移到 `notebook-trash`」的软删（正文/附件不删、**不写墓碑**），位置三元组随索引同步；purge 才是不可恢复；**恢复是唯一显式例外**（恢复标记 → local-wins）。
  - **日记本 = 固定不可变的特殊笔记本**（261112 用户裁决；契约 AGENTS §3#25）：不可取消/删除/改名/换图标/排序/作移动目标，`space` 只升不降；两个单篇出口见下（转为文档 / 转为小记）。
  - **位置三件套独立合并**：`parentId` / `trashedAt` / `deletedFromParentId` 与内容**分开**做三方合并（`src/core/s3v3/plan/positionMerge.ts`）：本地动则本地赢并发布（纯移动轮也 `indexChanged`，新增 `apply-position` 写），远端动则应用远端，两边都动按 `updatedAt` LWW；**内容赢家 ≠ 位置赢家**（内容赢家是远端时不要再上传本地旧字节）。**wire 上 trashed 条目 `parentId` 恒为 `null`**（本地容器 id `notebook-trash` 不进 wire，task-61；原始父只在 `deletedFromParentId`）。
  - **编辑锁独立合并**：`isLocked/lockedAt` 按云端基线 + `lockedAt` LWW 独立合并（task-47）：本地锁变化即 `indexChanged` 发布（他端持续编辑正文期间也发得出去）；锁不是合并屏障——他端正文照常应用、A 的锁保留；解锁是否传播靠基线变更检测（不依赖"解锁必须带时间戳"）。
  - **同步专用写路径**：`saveSynced`（`electron/store.ts` `saveSyncedNote` / `electron/noteContentRepository.ts:61` / 端口 `saveSyncedNote`；移动 `applySyncedBody` 同口径）允许 **trashed 行**接收正文、保留 trashed、**purged 永拒** ⇒ **用户保存守卫（`assertNodeWritable` 等）不得下沉到同步/镜像路径**（否则新设备首拉/他端编辑整轮失败；F04 同类事故，**task-52/53 已闭合**——守卫分层契约见 AGENTS §3#23）。
  - **单篇 apply 失败降级**：单篇异常记 warning 后 `continue`（桌面 `SyncResult.warnings` / 移动 `warningDetails`），**不再整轮 syncNow 抛错导致设备永久卡死**。
  - **被远端移入回收站 + 本地有未发布编辑 ⇒ 强制留档**（S72，`903a47aa`）：判据 = 位置赢家为**远端 trashed** + 本地相对基线有变化 + 内容赢家为**本地** ⇒ `archive-local` 写历史快照（两份都改时只留一份）；不静默丢弃本地编辑。
  - **位置赢家=远端时不受 `lifecycleRace` 保护**（H73-G1，`4db266e9`）：该保护只覆盖「本地窗口内自己移入/移出」；远端 win 的生命周期类变更必须落地，不得被永久挡住。
  - **目录 purge 意图在设备本地 `intents`**（F-01b，`fa2fbdad`/`dc882945`）：**不新造 wire 墓碑**；回收站副本**永不 upload**、发布排除 remote-purged-trash、`fieldChanged` 不上传已删正文；显式恢复让位（远端 `updatedAt > purgedAt` 时以远端删除为准）。
  - **移动端生命周期/锁（task-55/56，已闭合）**：回收站容器 id 不落 `notes.parent_id`（N1）；`applyRemoteNoteMeta` 对 trashed 行跳过 title/parent（N3）；移动锁未生效（N4/M3）——**均已在 task-55/56 修复**。

- **日记本不可变与两个单篇出口（261112 用户裁决，契约 AGENTS §3#25）**：
  - **固定不可变**：日记本 = 像回收站一样的**特殊笔记本**，**不可取消标记/不可删除/不可改名/不可换图标/不可排序/不作为移动目标**；`space` 只允许 `null → diary` **单调升级**，禁止 `diary → null`（发布/导入/恢复同样拒绝）；底层通用排序/改名/图标 IPC 若可达日记子树必须拒绝。
  - **转为文档 = 同一 note 移动 + 可改名**：把这篇日记**移动到**知识库其他笔记本（正文/历史/回收站/索引跟随，不删除）；共享弹窗只选笔记本、标题默认日期可改、**先 move 再 rename**、失败可见。
  - **转为小记 = 原 Lake 正文 + 媒体复制搬运**：用该日记的**原正文**创建一条小记（**复制**，新 id），图片/附件搬到小记资产作用域（`/<noteId>/` → `/quick-notes/<id>/`；**原资产保留**），随后日记原文**移入回收站**（软删、可恢复、不是 purge）；承载不了的卡片（`droppedKinds`）必须剥掉并**明说**，非 doc 类型（表格/多维表/画板/手写板）整篇拒绝。
  - **回收站「云端已删除（仅本地）」副本必须可只读预览**：整行可点、标题不被徽标挤成 0 宽、缺正文给明确提示（task-89）。
  - **`showNotice` 在全部 7 个空间可见**（`NoticeToast`；桌面状态栏只是宿主之一，task-93）。
  - **已知限制（明确记录）**：同步镜像 apply 仍会应用远端的日记子树 `title`/`icon`（**入口层禁止、非 UI 暴露，不做字段冻结**）。**两个单篇出口两端都有**（261113 移动端补齐「转为小记」，`a57cf3cf`）。
- **InkPad 结构拆分（Q19-10）未做**：仅抽了 `inkPadModel` 纯逻辑 + 11 例行为测试；组合根 + 4 hook + 2 子组件拆分因 127 条文本护栏与 10 useState/45 useCallback 依赖网，留发布后按「先迁护栏 → 再抽 hook → 最后设备门禁」执行。
- **发布链路**：Gitee 单附件 100MB / 仓库 1GB 上限（mac/Windows 包只能走 GitHub）；GitHub 慢速上传依赖 workflow 的 50 分钟步骤超时，不要缩短。
- **历史编号与旧批次已失效**：旧文档/代码注释里的「HANDOFF §3#N / §4 / §7.x」是历史编号，**不对应本文**；更早的 §0 批次条目（如「第十四批」）也已删除，**只在 git 历史可查**。待办只看 §3（本节与 §3 都不编号）。

## 3. 待办（唯一待办清单）

> 规则：只有「真问题 / 不做有代价 / 收益大于复杂度」才进本节（AGENTS §3#17）；完成后**直接删行**，历史留 git。

**当前批次（261114 第二轮点单）待办**

- **本批代码待办已清零**（4 条点单全部落地 + 回归测试 + 隔离实例 C1–C4 全 PASS + 移动设备级两场景 PASS，见 §0）；剩余 = **发版**（正式包 1.1.2 仍含旧缺陷，用户升级需新版本）。
- **移动端「tab 标记 gone + 只读横幅」缺失（261114 审计残余，P2）**：打开中被删后旧内容仍显示，自动保存 1s 后明说「保存被拒绝」，关闭/返回/完成会丢弃标签并 toast；未做只读横幅（不在本次最小修复范围）。

**上一批次（261113 转小记 + 发版复核批）待办**

- **本批代码待办已清零**（task-105/106 已闭合：发版复核 P2/P3 + 移动端「转为小记」）；剩余只有设备点收与下一版发布（P0）。
- **S19（目录重建）：不计划**（显式 id 重建不是用户流程；矩阵登记即可）。
- 其余真剩余见下方 P0/P1/P2（设备点收 / 发版 / 已知欠账）。
- **接手清单（261113 会话收尾，给下一会话）**：当前 master `2c997420`（已双推）、v1.1.1 已发布、任务板 0 未完成；下列事项按「需裁决 / 设备 / 代码欠账 / 外部 WIP」分组，开工前先读本文件 §0–§2 与对应报告。
  - **① 用户裁决（261113 10:20，已定，别再问）**：(a) **下一版发版暂不做**——保持 1.1.1；要发时流程 = RELEASE-NOTES 补段 → `npm version …--no-git-tag-version` → 提交 → 注解 tag → 双推 tag（只有 tag 触发 CI；发前按 `docs/RELEASE.md` §七.4 核 Android 4 个 secrets + `GITEE_TOKEN`）。(b) **首篇编辑器 fallback 不做**（不拆内核 chunk、不改「启动自动打开」语义）。(c) **观感点收由用户自己验**（Q03 历史 Sheet / Q07 preview 档 / Q05 字号 / 桌面双击放大 / 平板「点空白落光标」）。(d) **移动顶栏 44→52 不做**。
  - **② 设备类欠账（需真机/构建）**：便携包真实 3GB 数据验证；更新中心设备验收（Android 下载→校验→系统安装器）；桌面 3 项实机 + 平板复验；导入/导出/键盘真机冒烟；依赖补丁 4 处升级复核；23 屏走查（本轮未跑，命令见 `24-release-review-ui.md`/`27-release-mobile-snap.md`）。
  - **③ 代码级欠账（可排期）**：复制多张大图同步阻塞（剪贴板 API 限制）；大库 2 万文档/20 万附件与真实 Android 物理机验收从未做过；缺正文/缺小记三条恢复路径仅单测 mock；移动端表格块级命令入口未接。**S3 流程审查剩余（低优）**：~~#10/#11/#12~~ 已修（261113 第二批）。~~#8 孤儿父各端各建随机「未分类」~~ **已修**：兜底新建改用固定 id `notebook-uncategorized`（单一来源，跨端同一本）；**认 id 不认名字** —— 用户自建的同名「未分类」一律不动，旧随机 id 不迁移（多一本同名无害）。复核报告保留不修：P3-4/5（**P3-6 已于 261113 修复并三态复验**）、F-10/11/14/16/17（理由见 `23/24-release-review-*.md`）。
  - **④ 外部并行 WIP（先确认归属，勿盲提交）**：工作树可能有其它会话的 `src/mobile/settings/**`、`scripts/mobile-audit/mobile-snap.mjs` 等未提交改动（261113 为移动设置页顺序对齐），与 §3 本批无关；提交前 `git status` 核对并只 add 自己路径。
  - **⑤ 参考**：发版复核 `23-release-review-core` / `24-release-review-ui` / `25-release-review-mobile` / `26-release-readiness`（NO-GO 唯一阻塞=版本未 bump，已解决）/ `27-release-mobile-snap`；真实桶与多端 `19`/`21`；日记语义 `AGENTS §3#25` + `docs/DIARY.md`。

**P0（不做就卡住主线）**

- **R1/R2 设备点收（门禁矩阵已全过，观感项待人工）**：已过 = Q04 / Q22、手机/平板 10 态 + 多维表 3 态 + 23 屏 + 窗口矩阵 + **桌面 42 态**（两轮 0 差异）；待人工 = Q03 历史 Sheet、Q07 preview 档、Q05 字号、桌面双击放大观感；真机 50950385 已装最新 APK。
- **下一版发布（v1.1.1 已发，下一版待定）**（流程 [docs/RELEASE.md](RELEASE.md)）：发布说明写清 ① inkDoc v4 旧端只读 / 手机需重装；② 标签顺序仅设备本地；③ 标签删除 = 缺席（两端都要升级）；④ 发版前全量矩阵；⑤ 发版前按 RELEASE.md §七.4 核对 Secrets（Android 4 个 + `GITEE_TOKEN`）。
- **每批收尾固定动作**：更新 §1 基线与门禁计数 + §3 + §0 批次抬头；提交后立刻回写。

**P1（该做但可排期）**

- ~~**移动小记画廊混入视频/音频**~~（已修，task-32：`previewAssets` 只筛 image mime；设备验证已随 10 态矩阵）。
- **图片缩略残余（261111 收口后）**：~~① canvas 回退可能写显示尺寸~~（已修 `866babd1`：复制图片写原图尺寸/不可知则省略）；② 复制多张大图时同步阻塞（剪贴板 API 限制，属性能专项）；③ 会话内放行依赖「待上传卡计数 = 1」，多图并发时当会话不缩（重开按正文 origin 缩，安全降级）；④ 桌面文档编辑器（Retina 优先）与平板未启用同类缩略（平板实际已启用，见复核报告）。
- **移动性能基线**：lake_gate 录制 + `--compare` 已通过（冷启 1586 / capture 893 / 写作卡热开 332 / 文档打开 4ms）；⚠️ **键盘两项该 AVD 采不到**，键盘长任务口径仍以 5554 历史记录为准（775→72ms）；换 AVD / 换包 / 改视口必须 `--record` 重烤。
- ~~**小记快路径 push-state 优化**~~（已修，task-83：移动端整行 `sync_v3_state` 3 读→1 读）。~~**push-baseline 548–795ms**~~ **已修（261113）**：A 重复点不重写基线 + 归位单查询 + 复用已读信封；C 方案把 baseline 搬出整行改落 `sync-v3/baseline.json.gz.b64`（5000 文档行 1.11MB→247B，文件 426KB，过桥约 -82%），预计 150–250ms（设备实测待补）。
- ~~**首篇编辑器 fallback 的最终解法（需用户裁决）**~~ **已裁决（261114）**：采用 ②「恢复标签为空时不自动开、保持空态」——已删 `core/coldStartNote` 冷启动落点，见 §0 本批。
- **设备类欠账**：便携包真实 3GB 数据验证；更新中心设备验收（Android 下载→校验→系统安装器）；桌面 3 项实机复核 + 平板复验；导入/导出/键盘真机冒烟；依赖补丁 4 处升级复核。

**P2（体验缺口 / 长期）**

- **docs 侧硬编码机器路径（R2 task-35 已清零）**：脚本侧 R0 清零；AGENTS / DEVELOPMENT / CODEX-GUIDE / MOBILE-OPS / 契约文档 / audit 存档里的本机绝对路径统一改成 `<repo>` 或 `$(git rev-parse --show-toplevel)`（示例统一写 `/Users/<you>/...`）；本机绝对路径已 0 命中（仅测试夹具里保留通用示例 `/Users/x`）。
- **audit-261112 分册**：作为本轮方案留档；若有仍有效但未进上述落点的结论，按需搬进对应文档（不留在 HANDOFF）。
- 大库与**真实 Android 物理机验收从未做过**；~~移动云清理无 UI 入口~~（入口早已有，261113 补预览/dryRun，D3）· ~~目录恢复后 `deleted_notes` 残留~~（261113 修，D4 墓碑退役）；缺正文/缺小记三条恢复路径只有单测 mock。
- 移动端文本格式未接入口（unlink / replace / style→code·quote / 表格块级命令族）；顶栏 44→52 需另开需求；平板「点空白落光标」待用户裁决。
- 移动端首轮元数据再发布（初始发布后第一轮整轮同步会因既有 tag 版本元数据做一次「只含元数据」的再发布；与快路径无关）。

**已闭合（别重复做；细节见 git）**

- **261113 批**：移动端「转为小记」（task-106，`a57cf3cf`）· 发版复核 P2/P3（task-105，`839c7a93`）· v1.1.1 发布（8 个 Release 资产 + 本地 packaged smoke）· 文档收口（AGENTS/DIARY/guide16/README/MOBILE-OPS）。
- **261112 日记收口批**：日记本固定不可变 + 取消标记已移除（task-84/85/87/88）· 移动目标剔除日记子树（task-90）· 转文档共享弹窗（task-91）· 转小记媒体搬运（task-92）· 回收站仅本地副本预览加固（task-89）· showNotice 全空间可见（task-93）· S3 多端 A–K 与 R-D（task-72/74）· 移动同步 warning 持久化 + apply_skipped 对齐代码（task-67）。
- 空间命名两端「知识库」；桌面按钮梯队 + 移动 `mb-btn`；AGENTS 预算（≤64KB 内）；首屏瘦身（entry 60KB / preload 6）；小记写作卡全屏 + 键盘长任务 775→72ms；单条小记推 13→11；手机/平板各 10 态快照 + 23 屏 + `edit-surface-invariants` 重标定 + capture 入口装置；图片缩略三边界 + 小记封面/预览去重；桌面/移动图片预览语义（双击 vs 单击预览双击编辑）。
