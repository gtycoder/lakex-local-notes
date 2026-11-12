# HANDOFF.md — Local Lakex Notes 项目交接（唯一权威交接文档）

> 写给完全没有上下文的新会话。接手顺序：**README（根）→ 本文件 → AGENTS.md（根，长期红线/机制）**。
> 本文件只保留**【最近 3 个批次 + 当前基线 + 风险 + 真实待办】**；更早的 dated 批次只存在于 git 历史（`git log -p --follow docs/HANDOFF.md`），**不要再往本文件堆批次流水**（261112 Q17 压缩：183KB → 本版）。
> **当前状态以 §1（基线）/ §2（风险）/ §3（待办）为准**；§0 抬头状态只作批次历史。261112 第二轮裁决（Q01–Q27，最终）见 [docs/audit-261112/00-MASTER-PLAN.md 附录 E](audit-261112/00-MASTER-PLAN.md)。
> 移动端（Android）的构建 / 安装 / AVD / CDP / 门禁 / 点按口径 = [docs/MOBILE-OPS.md](MOBILE-OPS.md)；桌面会话不要改它，移动端会话不要改桌面文件。

## 0. 最新交接（最近 3 个批次；更早的见 git）

### 261112 · 发布前全仓审计 + R0/R1 收口批（已本地提交，未推送）

- **审计**：6 域并行只读审计 + Lead 交叉复核 ⇒ `docs/audit-261112/`：`00-MASTER-PLAN.md`（总方案 + A–Q 分项 + R0/R1/R2 路线 + Q01–Q27 裁决）+ 分册 02 预览 / 03 桌面 UI 样式 / 04 移动 / 05 core+electron / 06 特性域 / 07 文档清理。代码域 P0 = 0。
- **R0 已落地（产品代码笔 `8e20a6a3`；另 `996b4d6e` docs / `fab629dc` chore）**：
  - 文档：guide 19 章（新增 16 日记 / 17 AI 写作 / 18 换机便携包 / 19 更新中心；目录、平台差异、⌘1–5、设置分类全部对齐）；README 文档表收为入口并指向本文件 §1；ARCHITECTURE 按 v3 重写；STORAGE-LAYERS v3；TAG-SYSTEM-DESIGN / MOBILE-AI / TROUBLESHOOTING / SYNC-DEVICE-CONTRACT / MOBILE-DESIGN 回填。
  - 卫生：`.gitignore` 删三处 vendor/public 忽略；删 23 个零引用脚本 + `INK-DEVICE-CHECK.md` + `src/core/s3v3Gc.ts`；脚本侧 `/Users/admin` 清零。
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

### 261112 · 桌面文档图片预览只数到视口内几张（107 张 → 显示 1/8）

- **根因**：桌面文档编辑器是 `EditorTab`（自己 `createLakeDocument`，不走 `LakeEditor`），调 `attachImagePreviewClick(host)` 时**没传 resolver** ⇒ 走 DOM 收集；虚拟渲染 + 卡片懒加载下 DOM 只有视口内几张（实测 8 张）。历史护栏读的是 `LakeEditor.tsx`（变量还叫 `EDITOR_TAB`）⇒ 真正的桌面编辑器从未被覆盖。
- **修法**：`EditorTab` 双击时现场 `editorRef.getDocument("text/lake")` → `extractImagesFromContent()`（含未保存的新插图）；取不到（实例重建/销毁中）返回空 ⇒ 按既有约定回退 DOM 收集。
- **实测**：同一篇（736KB、107 张 image 卡）修复前「2 / 8」→ 修复后「2 / 107」（锁定态同样 2 / 107），双击到 Lightbox 105ms。
- **护栏**：`src/features/editor/imagePreviewAttach.render.test.tsx`（source：EditorTab 必须传 resolver；行为：正文全量、索引按 DOM 子序列对齐、回退、tap/click 语义）。

### 261112 · 移动端图片「点击看大图、双击编辑」（用户定稿）

- **语义**：移动端**单击 = 大图预览**，**双击 = 编辑**；范围 = 小记卡片（封面 + 预览内图 + 标签详情富预览）+ 文档（阅读态与编辑态）。桌面仍双击看图（单击留给选中/改尺寸）。
- **实现要点（判据别再换）**：`attachImagePreviewClick` 加 `{ tap?: boolean }`；判定必须挂 **`pointerdown` + 300ms 时间窗 + 位置差 ≤28px**（WebView click 延迟 ~150ms、两击间隔实测 251ms、内核点按后会重渲染图片卡 ⇒ 不挂 click、不比元素身份），移动 >12px 或滚动即取消；首页卡片在 `QuickNoteCard.handleImageTap` 内自实现同一套，写作卡（独立内核实例）单独接线。
- **实测**：5554 CDP 真实触摸——单击封面 ⇒「1 / 1」；双击封面 ⇒ 无 Lightbox、进编辑；编辑态单击 ⇒「1 / 1」。
- **代价**：单击预览要等一个判定窗（~300ms），触屏区分单击/双击的必然成本。

## 1. 当前基线（唯一状态来源）

> 数值 = 最近一次实测（261112 R1 批）。**任何状态判断以本节 + `git status` / `git log -1` 为准**。

**版本与仓库**

- 主分支 `master`；HEAD = **`ad3761bb`**（261112 R1 回写笔；产品代码笔 = `e87016bd`）；R1 批次 7 笔（基础层 `7e385373` / electron 拆分 `5acd0bec` / 小记拆分 `4c1e56c5` / Kotlin `f7c1abce` / 清理 `2487b733` / docs `832802a9` / 预览宿主 `9384ae30` + `b3f2fb47` / bitable 拆分 `2a67d902` / 复核 `e87016bd`）；**产品代码基线 = `8e20a6a3`（R0）/ `e87016bd`（R1）**。
- **未 push**：`origin/master` 仍为 `8cc65e06`（本地 ahead 17）；`github/master` = `2e512c48`。需要推送时按 AGENTS §2 双远端流程。
- `package.json` = **1.1.0**；Android `versionName 1.1.0` / `versionCode 11100`（从根 package.json 派生：`1000 + major*10000 + minor*100 + patch`，只增不减）。
- tag：`v1.0.0`–`v1.0.5`、**`v1.1.0`**（`075272b2` = AI 写作 + 日记两个新空间）；已发布 tag 不再移动。发布说明 = [docs/RELEASE-NOTES.md](RELEASE-NOTES.md)（v1.1.0 → v1.0.0 倒序；v1.1.0 段 = CI 生成 GitHub Release 正文的来源）。
- 分支/远端：`master` 唯一长期分支；`origin` = Gitee（SSH，第二 pushurl = GitHub HTTPS）⇒ `git push origin <branch>` 一次推两边；GitHub 只在推 tag 时构建。remote 不入库 ⇒ 新 clone 跑 `npm run setup:remotes`。
- **工作树**：R1 已全部本地提交，`git status` clean；后续批次继续按「只 stage 本批文件」规则，**绝不用 `git add -A`**。
- 261110 一次性历史清理（`.ai-writing-recon/` 用 `git filter-repo` 从全部历史移除，重写 v1.1.0 之后的提交；tag 未变）⇒ 旧 clone 需 `git fetch --force --prune && git reset --hard origin/master`。

**门禁基线（261112 R1 批实测；分层口径见 AGENTS §3#21）**

- `npx tsc --noEmit` = **0**。
- 全量 vitest = **882 文件（871 passed / 11 skipped）/ 5559 passed / 12 skipped / 0 failed**。
- `node scripts/ui-metrics.mjs`：颜色 0 / 字号 0 / `!important` 9 = 允许清单 / `crossFileDupGroups` 66 / `shadowedDecls` 21（只降）/ 未定义令牌 0。
- `check:core` 172 文件 0 违规；`check:mobileui` 通过。
- `check:bundle` + `check:arch` PASS：desktop 首屏 566,116 / 600,000、app-js 194,724 / 307,200；mobile 首屏 349,051 / 360,000、entry 60,763 / 61,440、CSS 140,383 / 141,312、preload 6。
- `git diff --check` = **0**。
- 设备/视觉（最近记录）：手机 **10 态** + 平板 **10 态** 基线重烤并连跑两轮 0 差异；23 屏走查 23/23；`edit-surface-invariants` quicknote 11 + document 11 ALL PASS；capture 入口装置 10/10。**桌面 `check:stylesnap` 42 态仍未跑**（无夹具缓存，见 §3）。

**设备与环境（本机实测）**

- Node **v24.18.0**（`$HOME/.nvm/versions/node/v24.18.0/bin`，必须 24）；JDK **21**（`/Library/Java/JavaVirtualMachines/jdk-21.jdk`）；Android SDK `/opt/homebrew/share/android-commandlinetools`。
- AVD：`lake_mobile`（开发）/ `lake_gate`（门禁固定夹具，**勿改其数据**）/ `lake_tab`（平板与窗口矩阵）；移动 CDP **9335 开发 / 9336 门禁 / 9340 平板**（桌面 dev 9222；serial 以 `adb devices` 为准）。
- 数据：开发 `~/Library/Application Support/lakex-local-notes-dev`；正式 `.../lakex-local-notes`（**禁止触碰**）；日志在对应目录 `logs/`。

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
- **261112 R1 的三个待设备验证面**：① 移动预览的 Sheet/全屏层几何（历史 Sheet 50dvh、回收站全屏层与键盘/SafeArea、返回键逐层收）；② `SecureStore→SecretBox` 只做了 JVM 单测（Keystore 真机路径未验，ALIAS/PREFS 与密文格式逐字不变 ⇒ 旧密钥可解）；③ 移动小记画廊仍可能把 video/audio 放进 Lightbox（261112 审计线索，未修）。
- **发布链路**：Gitee 单附件 100MB / 仓库 1GB 上限（mac/Windows 包只能走 GitHub）；GitHub 慢速上传依赖 workflow 的 50 分钟步骤超时，不要缩短。
- **历史编号与旧批次已失效**：旧文档/代码注释里的「HANDOFF §3#N / §4 / §7.x」是历史编号，**不对应本文**；更早的 §0 批次条目（如「第十四批」）也已删除，**只在 git 历史可查**。待办只看 §3（本节与 §3 都不编号）。

## 3. 待办（唯一待办清单）

> 规则：只有「真问题 / 不做有代价 / 收益大于复杂度」才进本节（AGENTS §3#17）；完成后**直接删行**，历史留 git。

**P0（不做就卡住主线）**

- **R1 设备验收（261112 R1 代码已全部本地提交，未 push；门禁已绿）**：① 移动预览：回收站只读打开（应用级全屏层叠放/返回键/恢复后刷新）、历史 Sheet 预览（doc 只读 LakeEditor + 非 doc 结构化摘要，50dvh 几何）、`LakeEditor interaction="preview"`（无卡片菜单但可看图/开附件）、预览档字号；② 桌面预览：回收站/历史/属性**双击图片放大**（画廊取正文全量、先档位图后原图）；③ `SecureStore→SecretBox` 真机读回（写/读/删 S3 密钥、杀进程重开）；④ 移动预览改动需装包（`android-build.sh --sync --install`）后逐项点收。
- **发布前设备/视觉矩阵**：桌面 42 态（需夹具机）、手机 + 平板 10 态、23 屏走查、windowsweep（R1 只跑了 tsc/全量 vitest/双 build/bundle/arch，设备类未跑）。
- **下一版发布**（流程 [docs/RELEASE.md](RELEASE.md)）：发布说明写清 ① inkDoc v4 旧端只读 / 手机需重装；② 标签顺序仅设备本地；③ 标签删除 = 缺席（两端都要升级）；④ 发版前全量矩阵。
- **每批收尾固定动作**：更新 §1 基线与门禁计数 + §3 + §0 批次抬头；提交后立刻回写。

**P1（该做但可排期）**

- **R1 样式/移动余量**：剩余 21 条 shadowed 声明（`feature.css` 3 / `misc.css` 4 / 共享规则 14）；移动 `mobile.css` 域归位（bitable/board/editor 约 300 行，需设备 2–3 态）。
- **移动小记画廊混入视频/音频**（261112 审计发现）：`HomePage`/`TagQuickNotePreview` 的 `previewAssets` 把非图片资源也放进 Lightbox 画廊，左右切会切到 video（img 显示失败）；建议复用同一 resolver 只筛 image mime，属行为变更 + 需设备验证。
- **拆分 6–10（Q19=C2 的发布后部分）**：`Sidebar`(1857) / `SettingsPanel`(1447) / `lakeRuntime`(1699) / `InkPad`(1907) / `main.ts`(1306)；`InkPad` 拆分前必须先补「落笔→防抖→保存」纯逻辑测试。
- **图片缩略残余（261111 收口后）**：① XHR 失败/旧包/超 12MP 的 webp·avif 回退 canvas，可能写显示尺寸；② 复制多张大图时同步阻塞（剪贴板 API 限制）；③ 会话内放行依赖「待上传卡计数 = 1」，多图并发时当会话不缩（重开按正文 origin 缩，安全降级）；④ 桌面文档编辑器（Retina 优先）与平板未启用同类缩略。
- **移动性能基线**：lake_gate 录制 + `--compare` 已通过（冷启 1586 / capture 893 / 写作卡热开 332 / 文档打开 4ms）；⚠️ **键盘两项该 AVD 采不到**，键盘长任务口径仍以 5554 历史记录为准（775→72ms）；换 AVD / 换包 / 改视口必须 `--record` 重烤。
- **日记「取消标记」残余验收**：跨端 wire 传播（一端取消 → 另一端知识库出现该本、日记空间消失）需**真机 + 配 S3**；取消是单向的（无回标入口，回标另立项）。
- **小记快路径后续（非必须）**：请求已 13→11；重复点首次 `push-state` 约 1455ms（SQLite/原生桥多次调用，第二次 25ms）⇒ 可把 baseline + 单条行 + 标记合并成一次窄端口调用；**不要省写后 pointer 读回**（「已同步」可信度）。
- **首篇编辑器 fallback 的最终解法（需用户裁决）**：① 拆内核 chunk（大改，需 RFC）；② 改「启动自动打开文档」语义（恢复标签为空时不自动开 / 先画列表再开）。当前预热只抢几十 ms。
- **设备类欠账**：便携包真实 3GB 数据验证；更新中心设备验收（Android 下载→校验→系统安装器）；桌面 3 项实机复核 + 平板复验；导入/导出/键盘真机冒烟；依赖补丁 4 处升级复核。

**P2（体验缺口 / 长期）**

- **docs 侧硬编码机器路径**：脚本侧已清零（R0），仍有约 18 个 tracked 文件含 `/Users/admin/...`（AGENTS / DEVELOPMENT / CODEX-GUIDE / MOBILE-OPS / 契约文档 / audit 存档）；开源前统一替换为示例路径（代码块用 `$(git rev-parse --show-toplevel)`，正文用 `<repo>`）。
- **audit-261112 分册**：作为本轮方案留档；若有仍有效但未进上述落点的结论，按需搬进对应文档（不留在 HANDOFF）。
- 大库与**真实 Android 物理机验收从未做过**；移动云清理无 UI 入口、目录恢复后 `deleted_notes` 残留；缺正文/缺小记三条恢复路径只有单测 mock。
- 移动端文本格式未接入口（unlink / replace / style→code·quote / 表格块级命令族）；顶栏 44→52 需另开需求；平板「点空白落光标」待用户裁决。
- 移动端首轮元数据再发布（初始发布后第一轮整轮同步会因既有 tag 版本元数据做一次「只含元数据」的再发布；与快路径无关）。

**已闭合（别重复做；细节见 git）**

- 空间命名两端「知识库」；桌面按钮梯队 + 移动 `mb-btn`；AGENTS 预算（≤64KB 内）；首屏瘦身（entry 60KB / preload 6）；小记写作卡全屏 + 键盘长任务 775→72ms；单条小记推 13→11；手机/平板各 10 态快照 + 23 屏 + `edit-surface-invariants` 重标定 + capture 入口装置；图片缩略三边界 + 小记封面/预览去重；桌面/移动图片预览语义（双击 vs 单击预览双击编辑）。
