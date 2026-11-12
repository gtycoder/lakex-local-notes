# HANDOFF.md — Local Lakex Notes 项目交接（唯一权威交接文档）

> 写给完全没有上下文的新会话。接手顺序：**README（根）→ 本文件 → AGENTS.md（根，长期红线/机制）**。
> 本文件只保留**【最近 3 个批次 + 当前基线 + 风险 + 真实待办】**；更早的 dated 批次只存在于 git 历史（`git log -p --follow docs/HANDOFF.md`），**不要再往本文件堆批次流水**（261112 Q17 压缩：183KB → 本版）。
> **当前状态以 §1（基线）/ §2（风险）/ §3（待办）为准**；§0 抬头状态只作批次历史。261112 第二轮裁决（Q01–Q27，最终）见 [docs/audit-261112/00-MASTER-PLAN.md 附录 E](audit-261112/00-MASTER-PLAN.md)。
> 移动端（Android）的构建 / 安装 / AVD / CDP / 门禁 / 点按口径 = [docs/MOBILE-OPS.md](MOBILE-OPS.md)；桌面会话不要改它，移动端会话不要改桌面文件。

## 0. 最新交接（最近 3 个批次；更早的见 git）

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

### 261112 · 发布前全仓审计 + R0/R1 收口批（已本地提交，未推送）

- **审计**：6 域并行只读审计 + Lead 交叉复核 ⇒ `docs/audit-261112/`：`00-MASTER-PLAN.md`（总方案 + A–Q 分项 + R0/R1/R2 路线 + Q01–Q27 裁决）+ 分册 02 预览 / 03 桌面 UI 样式 / 04 移动 / 05 core+electron / 06 特性域 / 07 文档清理。代码域 P0 = 0。
- **R0 已落地（产品代码笔 `8e20a6a3`；另 `996b4d6e` docs / `fab629dc` chore）**：
  - 文档：guide 19 章（新增 16 日记 / 17 AI 写作 / 18 换机便携包 / 19 更新中心；目录、平台差异、⌘1–5、设置分类全部对齐）；README 文档表收为入口并指向本文件 §1；ARCHITECTURE 按 v3 重写；STORAGE-LAYERS v3；TAG-SYSTEM-DESIGN / MOBILE-AI / TROUBLESHOOTING / SYNC-DEVICE-CONTRACT / MOBILE-DESIGN 回填。
  - 卫生：`.gitignore` 删三处 vendor/public 忽略；删 23 个零引用脚本 + `INK-DEVICE-CHECK.md` + `src/core/s3v3Gc.ts`；脚本侧机器绝对路径清零。
  - 代码：小记「保存并同步」4 理由透传 + 两端同文案（F-04）；AI 作用域 `data-note-id` 单源（F-03）；日期格式化收口 `core/dateFormat` + lint；`NoteKind` 私抄清零 + 触点护栏；长按单源；`AI_DIALOG_GAP` 单源；`native.ts` IPC 第四面 parity；死 env 开关（`LAKE_SYNC_PROTOCOL` / `LAKE_S3V3_QUICK_NOTES`）删除。
  - 样式：删 35 条被压死声明 + `.ln-modal/.ln-drawer`；新增 `shadowedDecls` 门禁（基线只降）；移动 4 项小修（radius / theme-color / OpenFile 去重 / 契约计数）。
- **门禁（本批实测，数值见 §1）**：tsc 0；全量 vitest 874 文件 / 5512 passed / 0 failed；ui-metrics / check:core / check:mobileui / 双 build / bundle+arch / diff-check 全绿。
- **未做**：设备类矩阵（桌面 42 态 / 手机+平板 10 态 / 23 屏 / windowsweep）本批未跑；剩余 21 条 shadowed 声明与移动 `mobile.css` 域归位留 R1。
- **R1 已落地（261112 第二轮裁决 Q01–Q27；产品代码笔 `e87016bd` 等 7 笔）**：
  - 预览：`features/preview/` 基础层（types/policy/previewAsset/useReadOnlyKernelViewer，4 份 viewer 包装 → 1 个 hook）；Q02 原图档位（Lightbox 先显示档后换原图）、Q06 桌面回收站/历史/属性双击放大、PREVIEW_POLICY 接线；Q04 移动打开回收站文档=只读预览+横幅、Q07 LakeEditor `interaction:"preview"`、Q03 移动历史快照预览（doc 只读 / 非 doc 结构化摘要）、Q05 预览档字号。
  - 拆分 Q19=C2 前 5 项：`core/bitableDoc` 2419→9 模块；`electron/quickNotes` 1451→9 模块；`electron/webApiServer` 988→5 模块；`BitableEditor` 2112→1496+6 hook；`QuickNotesWorkspace` 1320→735+3 hook 并搬进 `features/quickNotes/`（Q20A）。
  - 清理/原生/文档：Q16 删 `docs/audit-261027/`（结论收编 RESILIENCE §9–§10 / SYNC-PROTOCOL §15）；Q23 删 v1/v2 同步账本迁移；Q24 文案；Q21 `AssetPaths.kt` 单源+10 例对抗测试；Q22 `SecureStore→SecretBox`（ALIAS/PREFS 不变）；Q17 HANDOFF 183KB→21KB；Q25 CONTRIBUTING/SECURITY；Q26 AGENTS lazy 边界；Q11 DESIGN `.ln-row2`；Q12 guide 写明「AI 助手对话不保存」。
- **R1 门禁（本批实测，数值见 §1）**：tsc 0；全量 vitest 882 文件 / 5559 passed / 0 failed；ui-metrics 66/21；check:core 172/0；双 build + bundle/arch PASS；diff-check 0；`gradlew testDebugUnitTest` 31 tests 全绿。
- **R1 未做/待验**：设备矩阵未跑（桌面 42 态 / 手机+平板 10 态 / 23 屏 / windowsweep）——移动预览 Sheet 几何、SecureStore 真机读回、历史预览返回键均需设备验证；拆分 6–10（`Sidebar`/`SettingsPanel`/`lakeRuntime`/`InkPad`/`main.ts`）按 Q19=C2 留发布后；剩余 21 条 shadowed 声明与移动 `mobile.css` 域归位留 R1 后续。

## 1. 当前基线（唯一状态来源）

> 数值 = 最近一次实测（261112 日记收口批，低负载串行）。**任何状态判断以本节 + `git status` / `git log -1` 为准**。

**版本与仓库**

- 主分支 `master`；**HEAD 以 `git log -1` 为准**；R2 已提交 6 笔拆分/设备记录（`a23631f6` sidebar / `fd268432` settings / `231fe845` electron boot / `c00d3a60` lakeRuntime / `4a9b965c` ink 测试 / `e352e2cb` 设备记录）；**产品代码基线 = `8e20a6a3`（R0）/ `e87016bd`（R1）/ `e352e2cb`（R2）/ `3fad8821`（R2 收尾：位置合并 + 同步专用写路径 + 单篇降级）**；**日记收口批产品笔 = `199f3403`（不可变守卫）/ `fd58dc0a`（移动移除取消标记）/ `d4d03260`（移动目标剔除日记子树）/ `f965e62c`（转文档共享弹窗）/ `4b6a524a`（转小记媒体搬运）/ `400dcc75`（showNotice 全空间可见）**（详见 §0）。
- **未 push**：`origin/master` 仍为 `8cc65e06`（本地领先若干提交，数量以 `git rev-list --count 8cc65e06..HEAD` 为准）；`github/master` = `2e512c48`。需要推送时按 AGENTS §2 双远端流程。
- `package.json` = **1.1.0**；Android `versionName 1.1.0` / `versionCode 11100`（从根 package.json 派生：`1000 + major*10000 + minor*100 + patch`，只增不减）。**下一版 = v1.1.1**（`docs/RELEASE-NOTES.md` 已含 v1.1.1 段与 `11101`；发版时按 `RELEASE.md` bump 根 package.json 并打注解 tag，**不手改 build.gradle**）。
- tag：`v1.0.0`–`v1.0.5`、**`v1.1.0`**（`075272b2` = AI 写作 + 日记两个新空间）；**v1.1.1 未发**（见上）；已发布 tag 不再移动。发布说明 = [docs/RELEASE-NOTES.md](RELEASE-NOTES.md)（**v1.1.1 → v1.0.0** 倒序；当前 tag 段落 = CI 生成 GitHub Release 正文的来源）。
- 分支/远端：`master` 唯一长期分支；`origin` = Gitee（SSH，第二 pushurl = GitHub HTTPS）⇒ `git push origin <branch>` 一次推两边；GitHub 只在推 tag 时构建。remote 不入库 ⇒ 新 clone 跑 `npm run setup:remotes`。
- **工作树**：截至日记收口批 clean（HEAD 以 `git log -1` 为准；HANDOFF 回写批已提交 `99df5f86`，发版文档收口 `0c7175cf`/`de684e98`/`7a62d349`）；**本次文档一致性批（task-101）改动未提交**；并行批在途以 `git status` 分辨；提交时「只 stage 本批文件」，**绝不用 `git add -A`**。
- 261110 一次性历史清理（`.ai-writing-recon/` 用 `git filter-repo` 从全部历史移除，重写 v1.1.0 之后的提交；tag 未变）⇒ 旧 clone 需 `git fetch --force --prune && git reset --hard origin/master`。

**门禁基线（261112 晚最新一次实测；分层口径见 AGENTS §3#21）**

- `npx tsc --noEmit` = **0**。
- 全量 vitest（低负载串行门禁，发版复核三处修复 `142244cd` 之后）：**文件 = 总 918（907 passed / 11 skipped）**；**用例 = 总 5772（5760 passed / 12 skipped）/ 0 failed**。偶发 `perf.integration` 满载抖动口径见下条（单跑复验通过）。
- ⚠️ `electron/s3v3/perf.integration.test.ts`：**低负载串行本轮无抖动（通过）**；满载/并发构建时偶发（单跑 PASS），门禁判定以单跑/低负载为准（同 §2 既有口径）。
- `node scripts/ui-metrics.mjs`：颜色 0 / 字号 0 / `!important` 9 = 允许清单 / `crossFileDupGroups` 45 / `shadowedDecls` **0**（task-34 已清零，门禁只降）/ 未定义令牌 0。
- `check:core` 172 文件 0 违规；`check:mobileui` 通过。
- `check:bundle` + `check:arch` PASS：desktop 首屏 567,551 / 600,000、app-js 196,192 / 307,200；mobile 首屏 348,211 / 360,000、entry 60,803 / 61,440、CSS 139,503 / 141,312、preload 6。
- `git diff --check` = **0**。
- **真实 S3 桶验收**：A 档三桌面隔离实例 **20/20 PASS**（`3fad8821`）；**B 档 13 条 57/57 PASS**（task-58，含 S72 修复后复跑），唯一测试前缀 **0 残留**（[19](audit-261112/19-s3-real-bucket-subset.md)）。**移动多端 A–K 已跑完（task-72/74 已关闭；D 场景修复后复跑 9/9、收尾 0 残留，见 [21 号报告](audit-261112/21-s3-multi-end-mobile.md)）**。
- 设备/视觉（最近记录）：手机 **10 态** + 平板 **10 态** 基线重烤并连跑两轮 0 差异；23 屏走查 23/23；`edit-surface-invariants` quicknote 11 + document 11 ALL PASS；capture 入口装置 10/10。**桌面 `check:stylesnap` 42 态已重烤**（34 严格态两轮 0 差异，8 窄窗按 UNSTABLE 跳过；基线已更新，见 §3）。

**设备与环境（本机实测）**

- Node **v24.18.0**（`$HOME/.nvm/versions/node/v24.18.0/bin`，必须 24）；JDK **21**（`/Library/Java/JavaVirtualMachines/jdk-21.jdk`）；Android SDK `/opt/homebrew/share/android-commandlinetools`。
- AVD：`lake_mobile`（开发）/ `lake_gate`（门禁固定夹具，**勿改其数据**）/ `lake_tab`（平板与窗口矩阵）；移动 CDP **9335 开发 / 9336 门禁 / 9340 平板**（桌面 dev 9222；serial 以 `adb devices` 为准）。
- 数据：开发 `~/Library/Application Support/lakex-local-notes-dev`；正式 `.../lakex-local-notes`（**禁止触碰**）；日志在对应目录 `logs/`。
- **261112 R1 设备验收**：真机 Xiaomi 2109119BC（Android 14，serial 50950385）+ 5554 模拟器已装 R1 APK；Q04 回收站文档只读预览、Q22 SecureStore→SecretBox 跨重启真机通过；快照矩阵（手机 10 态 / 平板 10 态 / 多维表 3 态 / 23 屏 / 窗口矩阵）已重烤并两轮 0 差异；Q03/Q07/Q05 观感项仍待人工点收；桌面 42 态已重烤（证据 [docs/audit-261112/12-device-check.md](audit-261112/12-device-check.md)）。

**发布与推送事实**

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
  - **已知限制（明确记录）**：① 同步镜像 apply 仍会应用远端的日记子树 `title`/`icon`（**入口层禁止、非 UI 暴露，不做字段冻结**）；② **移动端暂无「转为小记」入口**（仅桌面；「转为文档」两端都有）。
- **InkPad 结构拆分（Q19-10）未做**：仅抽了 `inkPadModel` 纯逻辑 + 11 例行为测试；组合根 + 4 hook + 2 子组件拆分因 127 条文本护栏与 10 useState/45 useCallback 依赖网，留发布后按「先迁护栏 → 再抽 hook → 最后设备门禁」执行。
- **发布链路**：Gitee 单附件 100MB / 仓库 1GB 上限（mac/Windows 包只能走 GitHub）；GitHub 慢速上传依赖 workflow 的 50 分钟步骤超时，不要缩短。
- **历史编号与旧批次已失效**：旧文档/代码注释里的「HANDOFF §3#N / §4 / §7.x」是历史编号，**不对应本文**；更早的 §0 批次条目（如「第十四批」）也已删除，**只在 git 历史可查**。待办只看 §3（本节与 §3 都不编号）。

## 3. 待办（唯一待办清单）

> 规则：只有「真问题 / 不做有代价 / 收益大于复杂度」才进本节（AGENTS §3#17）；完成后**直接删行**，历史留 git。

**当前批次（日记收口批）待办**

- **本批代码待办已清零**（task-67 已闭合：移动同步 warning 持久化 + `apply_skipped` 对齐，见「已闭合」）；剩余只有设备点收与发版（P0）。
- **S19（目录重建）：不计划**（显式 id 重建不是用户流程；矩阵登记即可）。
- 其余真剩余见下方 P0/P1/P2（设备点收 / 发版 / 已知欠账）。

**P0（不做就卡住主线）**

- **R1/R2 设备点收（门禁矩阵已全过，观感项待人工）**：已过 = Q04 / Q22、手机/平板 10 态 + 多维表 3 态 + 23 屏 + 窗口矩阵 + **桌面 42 态**（两轮 0 差异）；待人工 = Q03 历史 Sheet、Q07 preview 档、Q05 字号、桌面双击放大观感；真机 50950385 已装最新 APK。
- **下一版发布**（流程 [docs/RELEASE.md](RELEASE.md)）：发布说明写清 ① inkDoc v4 旧端只读 / 手机需重装；② 标签顺序仅设备本地；③ 标签删除 = 缺席（两端都要升级）；④ 发版前全量矩阵。
- **每批收尾固定动作**：更新 §1 基线与门禁计数 + §3 + §0 批次抬头；提交后立刻回写。

**P1（该做但可排期）**

- ~~**移动小记画廊混入视频/音频**~~（已修，task-32：`previewAssets` 只筛 image mime；设备验证已随 10 态矩阵）。
- **图片缩略残余（261111 收口后）**：① XHR 失败/旧包/超 12MP 的 webp·avif 回退 canvas，可能写显示尺寸；② 复制多张大图时同步阻塞（剪贴板 API 限制）；③ 会话内放行依赖「待上传卡计数 = 1」，多图并发时当会话不缩（重开按正文 origin 缩，安全降级）；④ 桌面文档编辑器（Retina 优先）与平板未启用同类缩略。
- **移动性能基线**：lake_gate 录制 + `--compare` 已通过（冷启 1586 / capture 893 / 写作卡热开 332 / 文档打开 4ms）；⚠️ **键盘两项该 AVD 采不到**，键盘长任务口径仍以 5554 历史记录为准（775→72ms）；换 AVD / 换包 / 改视口必须 `--record` 重烤。
- **小记快路径后续（非必须）**：请求已 13→11；重复点首次 `push-state` 约 1455ms（SQLite/原生桥多次调用，第二次 25ms）⇒ 可把 baseline + 单条行 + 标记合并成一次窄端口调用；**不要省写后 pointer 读回**（「已同步」可信度）。
- **首篇编辑器 fallback 的最终解法（需用户裁决）**：① 拆内核 chunk（大改，需 RFC）；② 改「启动自动打开文档」语义（恢复标签为空时不自动开 / 先画列表再开）。当前预热只抢几十 ms。
- **设备类欠账**：便携包真实 3GB 数据验证；更新中心设备验收（Android 下载→校验→系统安装器）；桌面 3 项实机复核 + 平板复验；导入/导出/键盘真机冒烟；依赖补丁 4 处升级复核。

**P2（体验缺口 / 长期）**

- **docs 侧硬编码机器路径（R2 task-35 已清零）**：脚本侧 R0 清零；AGENTS / DEVELOPMENT / CODEX-GUIDE / MOBILE-OPS / 契约文档 / audit 存档里的本机绝对路径统一改成 `<repo>` 或 `$(git rev-parse --show-toplevel)`（示例统一写 `/Users/<you>/...`）；本机绝对路径已 0 命中（仅测试夹具里保留通用示例 `/Users/x`）。
- **audit-261112 分册**：作为本轮方案留档；若有仍有效但未进上述落点的结论，按需搬进对应文档（不留在 HANDOFF）。
- 大库与**真实 Android 物理机验收从未做过**；移动云清理无 UI 入口、目录恢复后 `deleted_notes` 残留；缺正文/缺小记三条恢复路径只有单测 mock。
- 移动端文本格式未接入口（unlink / replace / style→code·quote / 表格块级命令族）；顶栏 44→52 需另开需求；平板「点空白落光标」待用户裁决。
- 移动端首轮元数据再发布（初始发布后第一轮整轮同步会因既有 tag 版本元数据做一次「只含元数据」的再发布；与快路径无关）。

**已闭合（别重复做；细节见 git）**

- **261112 日记收口批**：日记本固定不可变 + 取消标记已移除（task-84/85/87/88）· 移动目标剔除日记子树（task-90）· 转文档共享弹窗（task-91）· 转小记媒体搬运（task-92）· 回收站仅本地副本预览加固（task-89）· showNotice 全空间可见（task-93）· S3 多端 A–K 与 R-D（task-72/74）· 移动同步 warning 持久化 + apply_skipped 对齐代码（task-67）。
- 空间命名两端「知识库」；桌面按钮梯队 + 移动 `mb-btn`；AGENTS 预算（≤64KB 内）；首屏瘦身（entry 60KB / preload 6）；小记写作卡全屏 + 键盘长任务 775→72ms；单条小记推 13→11；手机/平板各 10 态快照 + 23 屏 + `edit-surface-invariants` 重标定 + capture 入口装置；图片缩略三边界 + 小记封面/预览去重；桌面/移动图片预览语义（双击 vs 单击预览双击编辑）。
