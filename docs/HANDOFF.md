# HANDOFF.md — Local Lakex Notes 项目交接（唯一权威交接文档）

> 写给完全没有上下文的新会话。接手顺序：**README（根）→ 本文件 → AGENTS.md（根，长期红线/机制）**。
> 本文件只保留【最近约 10 个批次 + 当前基线 + 风险 + 真实待办】；更早的 dated 批次已删除，只在 git 历史可查（`git log -p --follow docs/HANDOFF.md`）。
> **261109 第三次重写**：397KB → ~25KB；五份旧发布说明合并为 [docs/RELEASE-NOTES.md](RELEASE-NOTES.md)，一批已完成的研究/审计/回归文档随之删除（git 可查）。文中旧 commit hash 仅是历史记录，`git show` 未必可达。
> **当前状态以 §1（基线）/ §2（风险）/ §3（待办）为准**；§0 的批次抬头保留当时的「已发布 / 已提交 / 待验收」口径，**不要据此判断今天是否已推送**。
> 移动端（Android）的构建 / 安装 / AVD / CDP / 门禁 / 点按口径 = [docs/MOBILE-OPS.md](MOBILE-OPS.md)；桌面会话不要改它，移动端会话不要改桌面文件。

## 0. 最新交接（261109）

### 261109 · 便携包（桌面 → 手机 一次性全量搬运）
- 需求：S3 首次全量同步贵；桌面导出单 zip（不含历史）→ 网盘/USB → 手机覆盖导入 → 之后 S3 只做增量。用户口径：覆盖；含回收站/小记/标签；排除历史快照；不加密；单包 **≤4GiB**（超限暂不支持分卷）；一次性 bootstrap；桌面仅在云同步已启用且上轮同步成功/无待同步时可用；手机导入不强制先配 S3。
- 桌面：`electron/portable/{zipStore,portableExport}.ts`（自研 store-only zip、VACUUM INTO 快照、白名单遍历）+ `electron/ipc/registerPortable.ts` + 设置页「备份与恢复 → 导出便携包」；IPC 通道 173→176。
- 手机：`PortablePackagePlugin.kt`（选包/解压/只读读桌面库/复制文件/回滚）+ `src/mobile/portable/*`（tree_nodes+notes→folders/notes、quick-notes→quick_notes/tags、baseline→sync_v3_state、FTS 重建、失败回滚）+ 设置页入口。
- 验证：桌面在隔离 userData 上真实导出通过（5.6MB / 96 entries / 14 文档 / 4 目录 / 3 小记 / 4 标签 / 75 资产，无 history/draft/logs）；手机真机导入通过（14 文档：6 doc/3 usheet/2 bitable/2 ink/1 board、5 目录含回收站、3 小记、4 标签、92 文件；打开 doc 与 bitable 正常，note_history=0、is_dirty=0、v3 baseline 已写入）。**踩坑已修**：store-only zip 原先用数据描述符，Java `ZipInputStream` 会读成空文件（真机报「便携包无效」）⇒ 改为本地头写 CRC/大小（每个文件读两遍），重导通过。
- 真机验证（大包 3.0GiB 合成数据：314 文档 + 165 资产 + 3 小记 + 4 标签；包 486 entries / 3,216,634,405 B，<4GiB）：导入成功，结果 314 文档 / 5 目录 / 3 小记 / 4 标签 / 482 文件（3065.2MB）。逐项核对：DB 行（notes/folders/quick_notes/tags/tag_links）与源完全一致、is_dirty 全 0、note_history 仅 1 条为导入后本机自动快照（非包内历史）、**482 个正文/资产文件 sha256 与源逐一相同**、165 个资产大小逐一相同（3,213,670,762 B）、手机 v3 baseline 与包内 baseline 完全相等（314/5/3/4，commits 一致）。S3 接续：src/core/s3v3Engine.ts 仅在无 baseline 时 full-sync；导入已写 baseline ⇒ 配好真实 S3 后走增量。该合成包用假 S3 基线，**不可用于真实 S3**；真实接续须从已同步的真实桌面导出。
- 门禁：tsc 0；vitest **783 files / 4993 passed / 12 skipped / 0 failed**（含 perf 集成偶发，重跑通过）；check:core / check:mobileui / diff-check 通过；Kotlin 离线编译通过。

### 261109 · 真实 S3 端到端验收（便携包 → 手机 → 增量同步）
- 真实七牛桶（Endpoint s3.cn-north-1.qiniucs.com / Region cn-north-1 / Bucket local-lake-hebei），测试前缀 **lakex-notes-dev3-portabletest2**（保留：98 对象 / 约 5.1MB，供复测；旧 ...portabletest 已删）。
- 桌面（隔离 userData，真实 dev 数据 14 文档 / 3 小记 / 75 资产）：首传 17 篇 + 92 对象、pending 0；导出便携包 5.6MB（baseline epoch 8cb91383、gen 1）。
- 手机：覆盖导入包成功（14 文档 / 5 目录 / 3 小记 / 4 标签 / 92 文件）；用桌面导出的迁移码导入 S3 配置；首次同步 **↑0 ↓0**，云端 pointer **仍为 generation 1**、commits 与包 baseline 完全一致（未发布新索引）；手机 baseline = 14 notes / 4 folders。
- 真机发现并修复：① 桌面同步成功后未清 folders.is_dirty ⇒ 待同步目录常驻、便携包导出被挡；已在 desktopSync 成功后按 updatedAt 条件 markFolderSynced。② 移动端 listFoldersForSync 把固定「回收站」笔记本也发布 ⇒ 首轮同步平白多发一代并把 notebook-trash 写进云端；已排除 TRASH_NOTEBOOK_ID（与桌面同口径）。
- 门禁：tsc 0；vitest **783 files / 4993 passed / 12 skipped / 0 failed**；diff-check 通过；Android 离线构建通过。

### 261110 · 便携包只接受 .zip.lln
- 用户定稿：不为历史数据做兼容 ⇒ Android staging 按文件名只接受 .zip.lln，旧 .zip 直接拒绝；桌面导出/UI/文档同步去掉「兼容旧 .zip」。

### 261109 · 便携包纯离线导出 + 后续 S3 接续
- 用户定稿：不配置 S3 也能导出；已启用云同步时导出前自动 sync 一次；纯离线迁移支持，之后配 S3 仍能同步。
- 桌面 portableExport：无 baseline.json.gz 时不再拒绝，改为生成 localOnly 内容哈希清单（notes/quickNotes 的 sha256）；manifest baseline=null。有云端基线时行为不变（manifest 带 baseline）。
- 手机导入：manifest.baseline=null 时只读内容哈希、不写 sync_v3_state.baseline；结果页明确提示「纯离线包」。Android staging 允许 baseline 为 null。
- 导出前同步：设置页按钮始终可用；portableExportStatus 返回 cloudActive/lastSyncedAt，cloudActive=true 时先 syncNow，失败则停止导出。
- 验证：桌面无 S3 隔离实例真实导出（5.6MB，baseline=null、内容哈希完整）；同一工作区随后配空 S3 前缀首传 14 文档/92 对象成功。手机（第二台模拟器）导入离线包成功（14/5/3/4/92，baseline=null），随后配 S3 同步成功并写入云端 baseline（↑0↓0，下载 4 目录；文档内容相同故 0 正文）。
- 测试前缀 ...-portabletest2 / ...-offlinetest 已清理；原 lakex-notes-dev3 未写。

### 261109 · 备份语义澄清 + 移动端顺序 + 便携包架构 review
- 备份语义：整库备份 = 完整工作区（DB 快照 + 正文/资源/历史快照），用于归档/整机迁移；自动/立即备份 = 仅两个数据库快照（无正文/资源/历史），用于快速回滚。两者互补；按钮/文案改为「整库备份（完整目录）/自动备份（仅数据库）/立即备份数据库/从数据库快照恢复」。
- 移动端设置顺序对齐桌面：常规 → 外观 → 云端与同步 → 备份与恢复 → 历史 → 导入 → 资源管理 → 清理缓存 → 回收站 → AI 助手 → 更新中心 → 关于；编辑器页标题改为「常规」。
- 移动端备份与恢复再拆三组：恢复 / 修复缺失数据 / 从桌面迁移；移除此前的页尾长说明，便携包说明压缩为一段。
- 261110 移动端设置表面统一：恢复「灰底 + 白卡」层次（手写分组容器自动补卡，Group/Section 原语不变）；云端与同步拆为「连接信息 / 连接与同步 / 配置迁移 / 服务说明」四组；关于拆为「关于 / 数据诊断」两组。
- 261110 P0 原语收敛：SettingsDrawer / BasicSettingsSections 全部改用 Group/Section，新增 settingsPrimitivesGuard 测试禁止再手写 mb-set-group/mb-set-items；S3/备份/关于按语义分组。
- 261110 P1：新增移动端 .mb-btn--settings（主题色描边、透明底，仅设置页），替换设置页 primary/secondary/ghost；设置菜单图标底色改 --mb-set-tone-* 令牌，不再写死 hex。确认/重命名/更新弹窗仍用 primary 实心。
- 261110 移动快照扩到 **9 态**：新增 settings-s3 / settings-backup / settings-about；设置抽屉/子页入口先判已开（避免二次点击把抽屉关掉），行用 DOM click + scrollIntoView。已在 lake_gate 连跑两轮，9 态 0 差异；基线 `scripts/mobile-audit/baseline/mobile-snap.json` 已重烤。
- 仍待：深/暖色下的设置页设备走查（移动端当前只有浅色/深色/纯黑三档）。
- 便携包 review：导出前同步下沉到主进程 beforeExport（任何入口一致）；离线哈希改用 noteBodyRelativePath 单一来源并缺正文直接报错；manifest.baseline=null 语义与 localOnly 哈希文件写入 spec §9。

### 261109 · UI 整理（移动端 + 桌面设置）
- 用户原则：能点的控件排在纯文字说明之前（免责声明除外）。
- 移动端：设置菜单把「更新中心」从首项移到「关于」上方（倒数第二）；备份与恢复/便携包导入/关于诊断改为「标题 → 操作按钮 → 说明/状态」；更新中心「检查间隔」改用 Field（控件独占一行，说明不再被右控件挤成窄列）；新增 mb-set-block--actions-first 原语（无手写样式）。
- 桌面设置：Block 新增 descAfter（操作/统计先出现、说明后置）；备份与恢复把「导出便携包」上移到自动备份之前、各操作块按钮前置；关于把「诊断（复制诊断信息）」上移到版本/环境之前，第三方许可保持最后。
- 备份与恢复再分组（对齐「数据维护」的多分组式）：桌面 = 备份 / 恢复 / 迁移到手机 三组；移动端 = 恢复 / 从桌面迁移 两组。每组内仍保持「操作 → 说明」。
- 261109 后续微调：桌面「备份占用 + 上次备份结果」拆成置底的「存储占用」组；关于页「数据与存储」置顶；数据维护页「回收站」「全文搜索」置顶。
- 261109 按钮/下拉与顺序收尾：新增 .ln-btn--outline（主题色描边 + 透明底，不填色），备份与恢复页动作按钮统一该样式；备份间隔改为 Select 下拉（每天/每周）；关于页顺序最终为「关于 → 数据与存储 → 诊断 → 版本与运行环境 → 第三方许可」（用户要求「关于」置顶）。
- 261109 设置页按钮原语收敛：新增 .ln-btn--settings（主题色描边 + 透明底 + 默认文字色，不填色/不染字），只在设置页使用；已替换 SettingsPanel / UpdateCenter / RebuildDataBlock 内的 primary/secondary/outline 按钮。重命名、确认等对话框仍保持实心 primary，不动。
- 便携包后缀改为 .zip.lln（桌面导出文件名；导入端兼容旧 .zip），见 docs/PORTABLE-TRANSFER.md。

### 261109 · 更新中心（桌面 + Android）
- 新增应用内更新中心：检查更新（GitHub latest release 的 `latest.json`，CI 生成）/ 更新日志（复用 `docs/RELEASE-NOTES.md`）/ 自动检查（默认开，启动 + 6/12/24h）/ 自动下载（默认开；Android 仅 Wi-Fi）/ 忽略此版本；**不做静默安装**（桌面打开安装包、Android 拉起系统安装器）。
- 桌面新增 8 个 IPC 通道（165→173，parity 通过）；Android 新增 `UpdatePlugin.kt`（DownloadManager + sha256/证书指纹校验 + FileProvider 安装器）；规格见 [docs/UPDATE-CENTER.md](UPDATE-CENTER.md)。
- 门禁：`npx tsc --noEmit` = 0；`npx vitest run` = **788 文件（777 passed / 11 skipped）/ 4961 passed / 12 skipped / 0 failed**；`git diff --check` = 0；新增单测 37 例。**Android 设备侧未验证**（下载→校验→系统安装器交互留待真机/模拟器）。
- 261109 追加：桌面更新中心改为设置独立「更新」分类页（无弹窗，检查频率用 Select 下拉）；移动端设置菜单「更新中心」放「关于」上方（倒数第二）、「关于」置底；两端的检查间隔都改用既有下拉原语（Select / PickerSheet），未新增 CSS。

### 261109 · 文档收口与门禁复核
- 重写本文件：删除 261106 及更早的 dated 批次（git 可查）；合并五份旧 RELEASE-NOTES；清理已删文档的悬空引用；所有相对链接重定向到现存文档（文档地图见 §1）。
- 清理一批已完成/过期文档与死代码（清单见 §1「工作树」）；更新中心规格与实现见 [docs/UPDATE-CENTER.md](UPDATE-CENTER.md)（见上一条 261109 更新中心）。
- 门禁实测（清理后）：`npx tsc --noEmit` = **0**；`npx vitest run` = **770 文件 / 4918 passed / 12 skipped / 0 failed**（11 文件 skipped）；`git diff --check` = **0**。`check:bundle` 的 mobile-entry 仍超目标（已知红，见 §1）。
- 本文件之后：先按 §1 核实 HEAD / worktree，再从 §3 领活；§2/§3 已定稿的语义不要再重新争论。

### 261108 · v1.0.4（移动端顶栏 / 手写板修复，已发布）
- 首页顶栏统一 16px 页边距（`--mb-page-pad`）、文字 tab `nowrap`、窄屏不再挤换行；Sheet / 全屏标签页头部与状态条右内距收口到 16。
- 手写板移动端导航新增「新建页」；阅读态单指左右滑动翻页（横向 ≥60px 且横向占优，纯视图不写正文）；页码固定单行。
- 版本 1.0.4 / versionCode 11004；发布说明并入 [docs/RELEASE-NOTES.md](RELEASE-NOTES.md)。验证：真机 412×842 截图通过；移动端 6 态基线重烤后两轮 0 差异、平板 6 态 0 差异、`check:mobileui` 通过。

### 261108 · v1.0.3（Gitee APK 镜像链路，已发布）
- 无业务改动，用于验证「GitHub 全量 + Gitee 只同步 Android APK」链路。Gitee 单附件上限 100MB、仓库附件 1GB ⇒ mac/Windows 包超限，workflow 只上传 `android-release.apk` 并校验响应。
- 本次 Gitee APK 上传约 30 分钟；步骤超时放宽到 50 分钟、单请求 40 分钟，避免慢速上传被误杀。GitHub Release 6 个资产齐全（commit `213c2f79`）；Gitee Release 说明带 GitHub 链接。
- 版本 1.0.3 / versionCode 11003。

### 261108 · v1.0.2（Android 正式签名，已发布）
- Android APK 从 debug keystore 切到 **release keystore**（GitHub Secrets 注入），CI 增加解码 + `apksigner` 指纹校验。证书 SHA-256：`A8:BA:87:F7:F7:A5:E0:68:71:CB:CF:4E:EF:10:78:A0:38:01:E2:B5:B6:DD:3C:82:55:51:6A:B5:CF:21:2E:35`。
- **v1.0.1（debug key）升级 v1.0.2 必须卸载重装**（会清本机数据，先备份）；v1.0.2 起同 key 可覆盖升级，keystore 必须离线备份。
- macOS 仍 x64 + arm64 ad-hoc（未公证）；Windows NSIS 不变。GitHub Release commit `6e37aa89`。

### 261108 · v1.0.1（macOS 双架构 + ad-hoc 签名，已发布）
- 修复 v1.0.0 macOS 产物被判「已损坏」：CI 改 `--x64 --arm64` 分别打包，`mac.identity=- + mac.hardenedRuntime=false` 做 ad-hoc 有效签名；universal 单包因 sharp arm64/x64 原生依赖冲突不可用。
- 未公证 ⇒ 首次打开走「系统设置 → 隐私与安全性 → 仍要打开」；免提示仍需 Apple Developer ID + 公证。commit `3ec036b4`。
- APK 仍是 debug keystore 签的 release 变体（正式签名在 v1.0.2 完成）。

### 261108 · v1.0.0 正式发版（已发布）
- 首个 1.0 正式版；GitHub Release（workflow run `42471006316` success）：mac arm64 dmg/zip（199MB）、Windows NSIS（165MB）、Android release APK（34.5MB）。
- 发版过程修复：打包冒烟搜索无障碍断言过期（「搜索标题和正文」→「搜索标题、正文和标签」）；CI 固定 npm 官方源 + electron 镜像 + Gradle 腾讯镜像；Android APK 改名不再依赖 `node -p`。
- **tag 事实**：v1.0.0 tag 在多次失败流水线后最终指向 `02be1b00`（产物来自该 commit），此前被移动过；此后 tag 不可移动，发错只能 bump 版本再发。macOS 未签名/未公证、Android 为 debug keystore 签的 release 变体。

### 261108 · 发版前 UI 抽样回归 + 其它 261107/261108 落地面
- **UI 抽样回归**（真实 CDP 鼠标/触摸驱动桌面隔离实例 + Android gate 手机/平板）：新建笔记本/文档、目录多选与右键批量、创建副本、批量打标签、批量删除确认与回收站恢复、文档标签/标签空间、全文搜索、S3 配置与首拉/上传、A/B 双向跨设备删除传播、历史恢复、附件下载、大文档、整库备份、原生文件选择器（dev-only 测试钩子）、S3 冲突留档。结论：未发现功能性报错/数据错误。残余风险 = 真实第三方 Android 分享面板、Android 文件选择器、AI 外部服务、S3 被覆盖版本一键恢复（回归文档已删，git 可查）。
- **文件导入（桌面）**：「导入」子菜单按类型分项 Markdown / Word(.docx) / Excel(.xlsx) / CSV；主进程 `mammoth` → HTML（图片转 data URL）、`read-excel-file` → usheet 工作簿；新增 `mammoth@1.13.0`、`read-excel-file@9.3.14`（仅在主进程，不影响首屏）。限制：.doc/.xls 不支持；Word 页眉页脚/脚注/修订/文本框/公式/分栏等不导入；Excel 只导值（公式取缓存）；CSV 全文本。移动端分享导入仍只覆盖 Markdown。
- 同窗口还落地：桌面「创建副本」（进度 + 取消、`noteDuplication` 存储无关抽取）、桌面多选菜单重做（工具条删除、动作收进右键、全选图标、批量打标只追加且可新建标签）、AI 助手架构收口（请求模型 + 定位/输出单源、AI 写作助手卡、面板视觉收敛）、单块复制桥（图文混排）、桌面「置顶」+ 移动端「常用」统一改名「置顶」。

### 261107 · 上线前最后一批（标签存储统一 + 数据安全守卫 + 同步/多选/安全修复）
- **桌面文档标签关系迁入小记库**（261107 起）：一次性 `ATTACH` 跨库事务 + 行数校验 + `tag_storage_meta.note_links_v2` 标记；失败保持主库旧服务（可回退，主库旧表保留一版、不再读写）。wire `tagIds/tagsUpdatedAt` 不变。**备份/恢复必须同时恢复两库**（`restoreMainDatabaseFromBackup` 已同步处理，缺失小记库时只恢复主库）。
- **数据安全**：`saveBaseline` 改守卫式归位（只清「本地 updated_at 仍等于基线快照」的行）；`applyRemoteNoteMeta` 用「本轮开始前本地快照」守卫；空目录保护上收 `core/quickNoteTags`。桌面 `sync-progress` 双订阅修复（进度刷新由常驻 `useSyncProgress` 单一 owner）。
- **移动多选**：`SELECTION_MAX=500`（旧实现 2 万篇 O(n²)）；`DocListSheet` >80 行用 `@tanstack/react-virtual`。
- **安全**：`read_import_image` 只接受本会话系统选择框选过的文件所在目录（含子目录）下的图片。
- **口径单源**：`core/duplicateNotesReport` / `errorContract` / `settingsDefaults` / `tagAggregate` / `batchNotesReport`；`desktop/treeSelection`、`desktop/moveTreeModel` 迁入 `src/core`。
- 门禁：tsc 0；vitest 784 文件 / 4947 例；`check:bundle` 的 mobile-entry 在**本批改动前的 HEAD 就已超**（entry 65,460B / preload 33 / 首屏 374,060B），本轮按现状冻结预算（66KB / 34 条 / 380KB）让 CI 恢复绿，目标仍是 60KB / ≤12 条 / 360KB。

### 261107 · 推送前 review（修复死样式清理误伤注释 + 清理死 API）
- **真实回归**：死样式清理脚本按「选择器 { 规则 }」正则删除，把注释里的 `.ne-editor-wrap-content { overflow-y: auto }` 示例当规则删掉，**连带删掉该注释的 `*/`** ⇒ `mobile.css` 出现未闭合注释，紧随其后的 QuickNoteComposer 动作行样式被整体注释。已恢复；mobile.css 声明数 1607→1617（仍低于改动前 1665）。
- 删除重命名改弹窗后遗留的 `renamingId/renameValue/onRename*` 死 props；`settingsGroups.test` 改为解析联合类型再断言；`useTagDragSort` 返回值只保留消费字段。
- **教训**：批量删样式/注释后必须核对注释配平（mobile.css 现 174/173 是既有历史不配平，不得新增），并跑一次设备/视觉门禁自证。

### 261107 · 移动端架构收敛（P1/P2 四批）
- **新原语**：`src/mobile/lib/actionError.ts`（`toastActionError`，22 处收口，文案逐字不变）、`ui/EmptyState.tsx`（43 处空态）、`ui/TopBarIconButton.tsx`（真按钮）、`ui/rowActivation.ts`、`ui/SheetFooter.tsx`（13 文件）、`ui/docBatch.ts`（多选共享判据）、`lib/listTime.ts`；`SettingsDrawer` 菜单模型抽到 `settings/settingsMenu.ts`；`TagsHomeTab` 拖拽抽 `tags/useTagDragSort.ts`；toast 二轮再迁 12 处（累计 34 处 / 12 文件）。
- **CSS 收敛**：bitable 细边白面合并、`.mb-list-item` 并入 `.mb-row`、新增 `.mb-glass`；死样式清理 −21 规则 / −90 声明。`mobileLayers` 基线同步收紧（kit 596→575、mobile 1665→1609 等）。
- 审计与 backlog 写进 [docs/MOBILE-DESIGN.md](MOBILE-DESIGN.md)「UI 原语与架构审计（261107）」；未做：大文件拆分、PageHeader 抽取（复核后判定不做，理由已记）。设备验证：手机 6 态 / 平板 6 态 / 多维表 3 态 0 差异。

### 261107 · 移动端 v2「柔光纸面」P1–P4 + 多选/命名/移动重做
- **v2 视觉基线**：唯一参照 `preview/mobile-paper-light.html`（不入库）；theme 令牌（光场 / 三层表面 / 柔光玻璃 / 圆角 12/16/26/28 / 动效）、三屏外壳（首页 / 文档 / 设置）光场与滚动玻璃顶栏、设置分组卡 + 彩色图标块、纯黑 OLED 档、笔记本动态主色（`core/mobileAccent`，不写正文、不参与同步）、共享元素转场（小记卡→写作卡、文档卡→工作区）。规格见 [docs/MOBILE-DESIGN.md](MOBILE-DESIGN.md)。
- **交互重做**：多选页 v2（`.mb-sel-topbar` / 浮动等分动作条 / 复选框绝对定位零位移 / 新增「置顶」「打标签」）；新建与重命名统一走 `NameSheet` 弹窗（不再行内 input）；移动目标选择只允许选笔记本（平铺 `MoveTargetTreeSheet` + 搜索，单选/多选共用）。
- **设备验收口径**：三套快照（手机 6 态 / 平板 6 态 / 多维表 3 态）必须以**重装后的新 APK** 重烤并连跑两轮 0 差异；旧 APK 上的绿灯不算数（261107 踩过）。
- 已知遗留：设置子页图标块未全铺（按用户要求先留）；移动端 `@layer` 未做（CSS 仍靠 import 顺序）。

## 1. 当前基线（唯一状态来源，261109）

> 本节按 261109 实测重写。**任何状态判断以本节 + `git status` / `git log -1` 为准**；§0 的抬头状态只作批次历史。

**版本与仓库**

- 分支 `master`，HEAD = **本提交**（以 `git log -1` 为准；其下 `04eb32a7`（文档对齐）、`967c09e6`（文档清理）、`e4f1fd3f`（代码清理），再往上是 `b78c11df` = tag `v1.0.4` 指向的 commit）。
- `package.json` = **1.0.4**；Android `versionName 1.0.4` / `versionCode 11004`（从根 `package.json` 派生，版本号单一来源）。
- tag：`v1.0.0`–`v1.0.4`（另有旧 `v0.0.1` / `v0.0.2`）；已发布 tag 不再移动。
- **唯一 worktree**：`/Users/admin/file/local-lake/lakex-local-notes`；只有 `master`（本地 + Gitee + GitHub），无在途特性分支。
- 远端：`origin` = Gitee（SSH，日常拉取/推送源），第二 pushurl = GitHub HTTPS ⇒ `git push origin <branch>` 一次推两边；GitHub 只在推 tag 时构建。
- 发布说明：[docs/RELEASE-NOTES.md](RELEASE-NOTES.md)（v1.0.4 → v1.0.0 倒序合集，原五份独立文件已合并删除）。

**工作树（261109 清理批 + 更新中心批，已提交）**

- 清理批分三个本地提交：`e4f1fd3f`（代码死文件 26 个）、`967c09e6`（文档清理：删 20 篇 + 5 份旧发布说明合并为 [docs/RELEASE-NOTES.md](RELEASE-NOTES.md)）、`04eb32a7`（HANDOFF / AGENTS / README / PRODUCT / DESIGN / MOBILE-OPS 对齐）；工作树应为 clean（以 `git status` 为准），未 push。
- 文档：删除一批已完成/过期的研究、审计、回归文档；新增 RELEASE-NOTES 合集；ARCHITECTURE / LAKEX-CONTRACT / MOBILE-LONG-DOC-PROBE 等随清理更新。
- 代码：删除已确认无引用的死模块（`src/core/decideUpload*`、`lakeReconcile*`、`quickNoteReconcile*`、`syncDecision*`、`electron/mdToHtml.ts`、`electron/storeUtils.ts`、`electron/syncDecision.ts` 及若干一次性 scripts）；`QuickNoteEditor` / `QuickNotePreview` 等有小改。
- 本文件（HANDOFF）已重写并随本批提交；其余文件清单与 diff 见上述提交。
- **261109 更新中心批（本提交）**：`docs/UPDATE-CENTER.md` + `src/core/update/` + `electron/update/` + `electron/ipc/registerUpdate.ts` + 桌面 `UpdateCenter` UI + Android `UpdatePlugin.kt` + 移动更新中心 UI + CI `scripts/generate-update-manifest.mjs`；新增单测 37 例。

**门禁基线（261109 清理后实测）**

- `npx tsc --noEmit` = **0 错**。
- `npx vitest run` = **794 文件（783 passed / 11 skipped）/ 4993 passed / 12 skipped / 0 failed**。
- `git diff --check` = **0**。
- `check:bundle`：**mobile-entry 仍超目标（已知红，非本批引入）**。脚本当前按现状冻结为 entry JS gzip ≤66KB、modulepreload ≤34 条、首屏 ≤380KB（`check-arch`）；目标仍是 **60KB / ≤12 条 / 360KB**，瘦身后收紧（§3 P1）。运行前需先有 `dist` / `dist-mobile` 构建产物（本机当前无 `dist`）。
- 其它样式/边界/设备门禁按改动范围跑（分层口径见 AGENTS §3#21）；最近一次完整设备记录 = **v1.0.4 发版前**：手机 6 态、平板 6 态、多维表 3 态均重烤后两轮 0 差异。

**设备与环境（本机实测）**

- Node **v24.18.0**（`$HOME/.nvm/versions/node/v24.18.0/bin`，必须 24）；JDK **21**（`/Library/Java/JavaVirtualMachines/jdk-21.jdk`；系统默认 java 是 1.8，手跑 gradlew 必须指 21）；Android SDK `/opt/homebrew/share/android-commandlinetools`。
- AVD 3 个：`lake_mobile`（开发默认）/ `lake_gate`（门禁固定夹具，**勿改其数据**）/ `lake_tab`（平板与窗口矩阵）；移动端 AVD 的 CDP **9335 开发 / 9336 门禁 / 9340 平板与窗口矩阵**（桌面 dev 走 9222；设备 serial 以 `adb devices` 现场为准）。
- 手机 6 态 / 平板 6 态 / 多维表 3 态 = v1.0.4 前重烤并两轮 0 差异；**23 屏走查最近一次记录是 261103**（A3 修过装置里「菜单页误点关闭」的 bug），之后未随 v1.0.4 重跑，发版前需补。
- 桌面数据：开发 `~/Library/Application Support/lakex-local-notes-dev`，正式 `~/Library/Application Support/lakex-local-notes`（**禁止触碰**）；日志在对应目录 `logs/`。

**发布与推送事实**

- Android 签名 = release keystore（证书 SHA-256 见 §0 v1.0.2）；keystore 必须离线备份，丢失后无法覆盖升级。
- macOS = x64 + arm64 分开打包，ad-hoc 签名未公证（首次打开走「仍要打开」）；免提示需 Apple Developer ID + 公证。
- **GitHub 推送走 HTTPS**（SSH key 未在 GitHub 侧生效）；本机偶发 HTTP2 framing / 443 超时 ⇒ 先 `git -c http.version=HTTP/1.1 push <url> <branch>` 重试；仍失败就只推 Gitee、恢复后补推。曾用 `http.curloptResolve` 仅对单次 git 命令覆盖 DNS 解决（不改全局 DNS/代理/TLS，不固化 IP）。
- 发版流程见 [docs/RELEASE.md](RELEASE.md)；用户手册见 [guide/README.md](../guide/README.md)。

**文档地图（现存；已删文档不要再链）**

- 概览 / 红线：[README.md](../README.md) · 本文件 · [AGENTS.md](../AGENTS.md)
- 架构：[docs/ARCHITECTURE.md](ARCHITECTURE.md) · 产品 / 设计：[docs/PRODUCT.md](PRODUCT.md) · [docs/DESIGN.md](DESIGN.md) · [docs/MOBILE-DESIGN.md](MOBILE-DESIGN.md) · [docs/PAD-ADAPTATION.md](PAD-ADAPTATION.md)
- 同步 / 存储 / 容错：[docs/SYNC-PROTOCOL.md](SYNC-PROTOCOL.md) · [docs/STORAGE-LAYERS.md](STORAGE-LAYERS.md) · [docs/RESILIENCE.md](RESILIENCE.md) · [docs/SYNC-DEVICE-CONTRACT.md](SYNC-DEVICE-CONTRACT.md) · [docs/SYNC-STATE-CONVERGENCE.md](SYNC-STATE-CONVERGENCE.md)
- 内核 / 表格 / 多维表 / 手写板：[docs/LAKEX-CONTRACT.md](LAKEX-CONTRACT.md) · [docs/lakexEditor-developer-docs/](lakexEditor-developer-docs/) · [docs/USHEET-UPGRADE.md](USHEET-UPGRADE.md) · [docs/INK-PAD.md](INK-PAD.md) · [docs/BITABLE-VIEWPORT.md](BITABLE-VIEWPORT.md)
- 移动端：[docs/MOBILE-OPS.md](MOBILE-OPS.md) · [docs/MOBILE-TECH-STACK.md](MOBILE-TECH-STACK.md) · [docs/MOBILE-AI.md](MOBILE-AI.md) · [docs/MOBILE-BITABLE-DINGTALK.md](MOBILE-BITABLE-DINGTALK.md) · [docs/MOBILE-USHEET-YUQUE-PARITY.md](MOBILE-USHEET-YUQUE-PARITY.md)
- 工程 / 排错：[docs/DEVELOPMENT.md](DEVELOPMENT.md) · [docs/CODEX-GUIDE.md](CODEX-GUIDE.md) · [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) · [docs/LOGGING.md](LOGGING.md) · [docs/RELEASE.md](RELEASE.md) · [docs/UPDATE-CENTER.md](UPDATE-CENTER.md) · [docs/PORTABLE-TRANSFER.md](PORTABLE-TRANSFER.md)

## 2. 风险与已知不稳定（跨批次，别再踩）

- **快照门禁依赖设备数据**：只在专用 AVD + 固定夹具上跑；改外壳几何/构成、重灌夹具、`pm clear`、装新构建、跑过造数据探针后**必须先重烤基线**（`--from <warm>.json --write-baseline`），否则下次全量必红。5554/5556 实例有验证数据，误跑必假红。23 屏走查装置修过「菜单页误点关闭」的潜伏 bug ⇒ **历史绿灯不完全可信**。
- **验收状态**：「已合并 / 已双推 / 已发布」≠「用户逐条点收」。261102 十四批、261103 各批只有设备实测记录；设备绿灯只代表装置与计算值，不代表真实第三方环境（分享面板 / 文件选择器 / AI 外部服务 / S3 覆盖恢复）。
- **平板回退史**：十三批「expanded 改内核固定工具栏」已被十四批整体回退；残留旧路径（内核工具栏、`body.lake-tablet`、`__lakeSetTablet`、`nativeDeviceHint`）若被重新引入 = 第三套口径。
- **inkDoc v4（写 4、读 1|2|3|4）**：旧端读到 v4 会进只读保护 ⇒ 跨端混用必须在发布说明里写清（含「手机/平板需重装新包」）；改格式只能「新端写新版、旧端只读」并同步 [docs/INK-PAD.md](INK-PAD.md)。
- **依赖补丁 4 处**（univer ui / plait draw / xiangfa mindmap / lakex-drawnix）：升级后必须 grep 过滤句计数 = 0 且设备上出现「手形工具 — H」；**patch 打上但未命中不会报错**，必须逐条确认语义生效（登记见 AGENTS §2）。
- **设备装置不进 CI**（无 AVD/GPU）：`.github` 的 PR 门禁只覆盖 tsc/vitest/双 build/core/ui-metrics/bundle/arch；设备类验证必须人工跑。
- **门禁预算现状**：`check:bundle` 的 mobile-entry 在 HEAD 已超目标，脚本冻结的是「现状值」；不要把它当绿，也不要把冻结值当目标。
- **历史文档已删除**：261109 起一批研究/审计/回归/旧发布说明已删（git 可查）；旧文档/代码注释里的「HANDOFF §3#N / §4」是历史编号，**不对应本文**，待办只看 §3（本节不编号）。README / 其它文档中若仍有指向已删文档或旧编号的引用，以 git 与现存文档为准（本批不改其它文件）。
- **发布链路**：Gitee 单附件 100MB / 仓库 1GB 上限（mac/Windows 包只能走 GitHub）；GitHub 慢速上传需依赖 workflow 的 50 分钟步骤超时，不要缩短。

## 3. 待办（唯一待办清单）

> 规则：只有「真问题 / 不做有代价 / 收益大于复杂度」才进本节（AGENTS §3#17）；完成后**直接删行**，历史留 git。
> 本节**不再编号**：旧文档/注释里的「§3#N」是历史编号，不对应下面的条目。

**P0（不做就卡住主线）**

- **每批收尾固定动作**：更新 §1 基线与门禁计数 + §3 + §0 批次抬头状态；提交/推送后立刻回写，别让 §0 的「未提交」标记漂移。
- **下一版发布**（流程见 [docs/RELEASE.md](RELEASE.md)）：发布说明必须写清 ① inkDoc v4：旧端打开只读、手机/平板需重装；② 标签顺序只在设备本地生效（不同步）；③ 标签删除 = 缺席，两端都要升级（旧端仍会把墓碑写回索引）；④ 发布说明统一维护在 [docs/RELEASE-NOTES.md](RELEASE-NOTES.md)。发版前跑全量门禁：手机 6 态 + 平板 6 态 + 多维表 3 态 + 23 屏走查 + `check:windowsweep` + 桌面 42 态（桌面 42 态本机无合成夹具缓存，需有夹具的机器补）。
- **移动端首屏瘦身**（发版后专项）：HEAD 实测 entry-js 65.5KB gz / preload 33 条 / 首屏 374KB，已超目标（60KB / ≤12 条 / 360KB）；先砍回目标值，再收紧 `check-bundle-budget.mjs` 与 `check-arch.mjs`。

**P1（该做但可排期）**

- **便携包真实数据验证**：小包、3GiB 合成包、真实 S3 增量接续（dev 数据）均已验收；仍待用真实 3GB 数据从已同步桌面导一次（大小/耗时/内存）。
- **更新中心设备验证（261109 已实现，待设备验收）**：Android 真机/模拟器走一遍「检查→下载（DownloadManager 通知）→ sha256/证书校验→系统安装器→覆盖安装保数据」；桌面走一遍「检查→下载→打开 dmg/exe」；验证「忽略此版本」「下载中断/重启恢复」「仅 Wi-Fi 自动下载」。规格 [docs/UPDATE-CENTER.md](UPDATE-CENTER.md)。
- **桌面 3 项实机复核**：usheet 整行/整列选中不跳滚动、桌面手写板 14 色、设置/小记/历史 lazy 路径交互冒烟（P12 遗留）。**平板（lake_tab）复验页签/页面面板**：代码无形态分支（`formFactor` 只改外壳宽度与侧栏），Android 手机已实测，平板需装同一份 APK 复核一次。
- **261104 三项裁决的残余验证**（裁决本身是 AGENTS §4 的定稿，别再立项）：**缺正文云端拉回需在配了 S3 的真机走一遍**（目前仅单测 mock）；**表单视图大表行数帽**（一次性 `getValues`、默认 35 行，超大表若卡再加）；**资源管理两处 UI 改动未重跑 6 态快照 + 23 屏走查**（只在设置子页，预期 0 差异，发版前一并跑）；**资源「附件」系统打开未设备专项验**（需真实附件 + 系统应用；图片 Lightbox 已验）。
- **小记标签剩余**：只有「小记→文档转换是否携带标签」待定。其余已收口、别再立项：置顶已删、标签顺序设备本地、删除 = 缺席、移动端标签管理（拖拽/改名/删除/合并已做）、改名/删除全量重建。
- **导入 / 导出 / 键盘真机冒烟债**：① 桌面 Markdown 导入用真实 md（含图片/表格/脚注/超大文件）跑一遍；② 移动端 .md 系统分享（冷/热启动、多文件、未设置默认笔记本、失败回滚）真机验收；③ 批量导出真实目录（画板 PDF 打开/未打开两种、ink 多页、同名冲突）；④ 移动端键盘稳定（标签/批量打标签/搜索/新建/默认笔记本）真机键盘验收。
- **移动端 Word / Excel / CSV 导入（如需）**：目前只有桌面导入；移动端分享导入仍只覆盖 Markdown，需要时另立项（注意移动入口预算）。
- **依赖补丁 4 处升级复核**（仅当升级对应依赖时）：见 §2。

**P2（体验缺口 / 长期）**

- **大库与真实设备**：墓碑 payload 老化（261025 定「后续优化」）；大库阈值探测（>2 万文档 / 索引 3–5MB）；**真实 Android 物理机验收从未做过**；PARITY 残余（移动云清理无 UI 入口、目录恢复后 `deleted_notes` 残留）。移动缺正文的「云端拉回 / 历史恢复 / 重建纯文本」三条只在单测 mock 覆盖，需真机 + 配 S3 验证。
- **移动端文本格式**：261104 设备实测已收口 —— H1–H6 / 字号 / 颜色 / 对齐 / 列表 / 缩进 / 行高 / 上下标 / 清除格式全部生效；字号+行高已合并成一行步进器，对齐 4 档（含两端对齐）。未接入口：unlink / replace / style→code·quote / 表格块级命令族；画图插入项解禁、移动视图拖拽排序、PdfRender `cacheDir` 清理按需再做。
- **顶栏真 44 → 52**（六批 A4 结论）需另开需求；平板内容画布「点空白落光标」待用户裁决。

**已闭合，别重复**

- 二轮/实机修复批「未跑 6 态」→ 六批 A3 已重烤、0 差异。
- 「胶囊固定底部」与「平移画布开关」已被二轮覆盖（前者撤回、后者整体删除）。
- P9–P12 候选：`s3v3Report` 按需（−1.2KB，否决）、`isolate:false`（回退留结论）。
- 平板「走内核工具栏 / 不挂胶囊」两条例外已撤回（AGENTS 已同步）。
